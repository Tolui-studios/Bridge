import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  Query,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '@shared/ipc-channels'
import { parseBridgeMarkers } from '@shared/goalMarkers'
import type { BridgeMarker } from '@shared/goalMarkers'
import type {
  AgentEvent,
  AgentLaunchConfig,
  AgentSessionSummary,
  AgentStatus,
  AgentStreamItem,
  AgentStreamKind,
  Game
} from '@shared/types'
import type { WorktreeService } from './worktrees'
import type { SessionStore } from './sessionStore'

const MAX_ITEMS_PER_SESSION = 500
const MAX_ITEM_TEXT = 2000
const MAX_TOOL_RESULT_TEXT = 400
const KEEP_SESSIONS_PER_GAME = 50
const PERSIST_DEBOUNCE_MS = 1500

/** Push-based async iterable used as the SDK's streaming prompt input. */
class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: ((result: IteratorResult<T>) => void)[] = []
  private ended = false

  get isEnded(): boolean {
    return this.ended
  }

  push(value: T): void {
    if (this.ended) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.values.push(value)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
      }
    }
  }
}

interface SessionRecord {
  summary: AgentSessionSummary
  /** null = persisted session whose transcript has not been loaded yet. */
  items: AgentStreamItem[] | null
  /** Live-session plumbing; null on sessions restored from disk. */
  abort: AbortController | null
  input: AsyncQueue<SDKUserMessage> | null
  query: Query | null
  claudeSessionId: string | null
  saveTimer: NodeJS.Timeout | null
  /** Successful check-bar updates, for the vault run summary. */
  goalNotes: string[]
  lastText: string | null
  lastResult: string | null
}

/** Session facts handed to the vault run-summary writer. */
export interface RunExtras {
  goalNotes: string[]
  lastText: string | null
  lastResult: string | null
}

export interface AgentServiceHooks {
  /** Called whenever a session settles (result, idle, error, cancelled). */
  onSettled?: () => void
  /** Mirror of every status change (team sync publishes these). */
  onStatus?: (summary: AgentSessionSummary) => void
  /** Rate-limit info that rides along agent streams (free usage updates). */
  onRateLimit?: (info: SDKRateLimitInfo) => void
  /** Appended to the initial task so agents know the check-bar protocol. */
  taskFooter?: (gameId: string) => string
  /** Applies a BRIDGE marker to GOALS.md; returns a transcript note. */
  applyMarker?: (gameId: string, marker: BridgeMarker) => string
  /** Builds the prompt block for attached vault notes. */
  vaultContext?: (gameId: string, relPaths: string[]) => string
  /** Installs toolchain + packages into the workspace before launch. */
  prepareWorkspace?: (dir: string) => Promise<string[]>
  /** Writes a run summary (vault); returns a transcript note or null. */
  onRunEnded?: (summary: AgentSessionSummary, extras: RunExtras) => string | null
}

/**
 * Owns agent sessions in the main process. Sessions are interactive
 * (streaming input; follow-ups, interrupt, idle) and games run any number in
 * parallel, one worktree each. Finished sessions persist to disk via
 * SessionStore and are restored (summaries eagerly, transcripts lazily) at
 * startup, capped at the newest 50 per game.
 */
export class AgentService {
  private sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly worktrees: WorktreeService,
    private readonly store: SessionStore,
    private readonly hooks: AgentServiceHooks = {}
  ) {
    for (const persisted of this.store.loadAllSummaries()) {
      const summary = { ...persisted }
      if (summary.status === 'running' || summary.status === 'idle') {
        // The app died while this session was live.
        summary.status = 'cancelled'
        summary.endedAt = summary.endedAt ?? Date.now()
      }
      this.sessions.set(summary.id, {
        summary,
        items: null,
        abort: null,
        input: null,
        query: null,
        claudeSessionId: null,
        saveTimer: null,
        goalNotes: [],
        lastText: null,
        lastResult: null
      })
    }
  }

  start(game: Game, config: AgentLaunchConfig): AgentSessionSummary {
    const task = config.task.trim()
    if (!task) throw new Error('Task is required.')
    const record: SessionRecord = {
      summary: {
        id: randomUUID(),
        gameId: game.id,
        task,
        status: 'running',
        permissionMode: config.permissionMode,
        allowedTools: [...config.allowedTools],
        model: config.model ?? null,
        cwd: null,
        startedAt: Date.now(),
        endedAt: null,
        costUsd: null,
        numTurns: null,
        error: null
      },
      items: [],
      abort: new AbortController(),
      input: new AsyncQueue<SDKUserMessage>(),
      query: null,
      claudeSessionId: null,
      saveTimer: null,
      goalNotes: [],
      lastText: null,
      lastResult: null
    }
    this.sessions.set(record.summary.id, record)
    this.emitStatus(record)
    void this.run(record, game, task, record.input!, record.abort!, config.vaultNotes ?? [])
    return { ...record.summary }
  }

  /** Send a follow-up prompt into a live session (queued if a turn is running). */
  reprompt(sessionId: string, rawText: string): void {
    const record = this.require(sessionId)
    const text = rawText.trim()
    if (!text) throw new Error('Prompt text is required.')
    if (!isLive(record.summary.status) || !record.input || record.input.isEnded) {
      throw new Error('This session has ended.')
    }
    this.push(record, 'user', text)
    record.input.push(userMessage(text, record.claudeSessionId))
    if (record.summary.status === 'idle') {
      record.summary.status = 'running'
      this.emitStatus(record)
    }
  }

  /** Stop the current turn but keep the session alive for follow-ups. */
  interrupt(sessionId: string): void {
    const record = this.require(sessionId)
    if (record.summary.status !== 'running') throw new Error('No turn is currently running.')
    const q = record.query
    if (!q) throw new Error('Session is still starting.')
    void q.interrupt().catch((err: unknown) => {
      this.push(record, 'stderr', `interrupt failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  /** End the session: gently when idle, hard-abort when a turn is running. */
  cancel(sessionId: string): void {
    const record = this.require(sessionId)
    if (!isLive(record.summary.status)) return
    const wasRunning = record.summary.status === 'running'
    record.input?.end()
    if (wasRunning) record.abort?.abort()
  }

  list(gameId: string): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .map((r) => ({ ...r.summary }))
      .filter((s) => s.gameId === gameId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  transcript(sessionId: string): AgentStreamItem[] {
    const record = this.require(sessionId)
    if (record.items === null) {
      record.items = this.store.loadItems(record.summary.gameId, sessionId) ?? []
    }
    return [...record.items]
  }

  /** Stop and forget every session for a removed game, including on disk. */
  removeForGame(gameId: string): void {
    for (const [id, record] of [...this.sessions]) {
      if (record.summary.gameId !== gameId) continue
      if (isLive(record.summary.status)) {
        record.input?.end()
        record.abort?.abort()
      }
      if (record.saveTimer) clearTimeout(record.saveTimer)
      this.sessions.delete(id)
    }
    this.store.removeGame(gameId)
  }

  closeAll(): void {
    for (const record of this.sessions.values()) {
      if (isLive(record.summary.status)) {
        record.input?.end()
        record.abort?.abort()
        // Persist synchronously now — the run loop may not get to finish()
        // before the process exits.
        this.finish(record, 'cancelled', null)
      }
    }
  }

  private async run(
    record: SessionRecord,
    game: Game,
    task: string,
    input: AsyncQueue<SDKUserMessage>,
    abort: AbortController,
    vaultNotes: string[]
  ): Promise<void> {
    let leased = false
    try {
      let cwd = game.repoPath
      try {
        const lease = await this.worktrees.acquire(game, record.summary.id)
        leased = true
        cwd = lease.path
        if (lease.note) {
          this.push(record, 'system', lease.note)
        } else {
          this.push(
            record,
            'system',
            `${lease.created ? 'created' : 'reusing'} worktree ${lease.path}${lease.branch ? ` (branch ${lease.branch})` : ''}`
          )
        }
      } catch (err) {
        this.push(
          record,
          'stderr',
          `worktree setup failed (${err instanceof Error ? err.message : String(err)}) — running directly in ${game.repoPath}`
        )
      }
      record.summary.cwd = cwd
      this.emitStatus(record)

      if (this.hooks.prepareWorkspace) {
        this.push(record, 'system', 'preparing workspace (toolchain + packages)…')
        try {
          for (const note of await this.hooks.prepareWorkspace(cwd)) {
            this.push(record, 'system', note)
          }
        } catch (err) {
          this.push(
            record,
            'stderr',
            `workspace preparation failed: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      const footer = this.hooks.taskFooter?.(game.id) ?? ''
      let vaultBlock = ''
      if (vaultNotes.length > 0 && this.hooks.vaultContext) {
        try {
          vaultBlock = this.hooks.vaultContext(game.id, vaultNotes)
          if (vaultBlock) this.push(record, 'system', `attached ${vaultNotes.length} vault note(s)`)
        } catch (err) {
          this.push(record, 'stderr', `vault notes failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      input.push(userMessage(task + footer + vaultBlock, null))
      const stream = query({
        prompt: input,
        options: {
          cwd,
          permissionMode: record.summary.permissionMode,
          allowedTools: record.summary.allowedTools,
          ...(record.summary.model ? { model: record.summary.model } : {}),
          // Load the memory layers: ~/.claude/CLAUDE.md (studio-wide) and the
          // workspace CLAUDE.md — the SDK loads neither by default.
          settingSources: ['user', 'project'],
          abortController: abort,
          stderr: (data: string) => {
            const text = data.trim()
            if (text) this.push(record, 'stderr', text)
          },
          env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge/0.1.0' }
        }
      })
      record.query = stream
      for (;;) {
        const next = await stream.next()
        if (next.done) break
        this.handle(record, next.value)
      }
      if (isLive(record.summary.status)) {
        this.finish(record, abort.signal.aborted ? 'cancelled' : 'done', null)
      }
    } catch (err) {
      if (isLive(record.summary.status)) {
        if (abort.signal.aborted) {
          this.finish(record, 'cancelled', null)
        } else {
          const message = err instanceof Error ? err.message : String(err)
          this.push(record, 'stderr', message)
          this.finish(record, 'error', message)
        }
      }
    } finally {
      input.end()
      if (leased) this.worktrees.release(record.summary.id)
    }
  }

  private handle(record: SessionRecord, message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          record.claudeSessionId = message.session_id
          this.push(
            record,
            'system',
            `session started · ${message.model} · claude-code ${message.claude_code_version} · ${message.tools.length} tools · mode ${message.permissionMode} · cwd ${message.cwd}`
          )
        } else if (message.subtype === 'permission_denied') {
          this.push(record, 'denied', `permission denied: ${message.tool_name}`)
        }
        break
      }
      case 'assistant': {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            record.lastText = block.text.trim()
            this.push(record, 'text', block.text.trim())
            this.applyMarkers(record, block.text)
          } else if (block.type === 'tool_use') {
            this.push(record, 'tool', `${block.name} ${compactJson(block.input)}`.trim())
          }
        }
        break
      }
      case 'user': {
        const content = message.message.content
        if (!Array.isArray(content)) break
        for (const block of content) {
          if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
            const text = summarizeToolResult(block.content, block.is_error === true)
            if (text) this.push(record, 'tool-result', text)
          }
        }
        break
      }
      case 'rate_limit_event': {
        try {
          this.hooks.onRateLimit?.(message.rate_limit_info)
        } catch {
          // Usage harvesting must never break sessions.
        }
        break
      }
      case 'result': {
        record.summary.costUsd = message.total_cost_usd
        record.summary.numTurns = message.num_turns
        const resultLine = `${message.subtype} · ${message.num_turns} turns · $${message.total_cost_usd.toFixed(4)} · ${(message.duration_ms / 1000).toFixed(1)}s`
        record.lastResult = resultLine
        this.push(record, 'result', resultLine)
        if (message.is_error) {
          this.finish(record, 'error', message.subtype)
          record.input?.end()
        } else if (record.input && !record.input.isEnded && !record.abort?.signal.aborted) {
          // Session stays alive for follow-up prompts.
          record.summary.status = 'idle'
          this.emitStatus(record)
          this.persist(record)
          this.hooks.onSettled?.()
        }
        break
      }
      default:
        break
    }
  }

  private applyMarkers(record: SessionRecord, text: string): void {
    if (!this.hooks.applyMarker) return
    for (const marker of parseBridgeMarkers(text)) {
      try {
        const note = this.hooks.applyMarker(record.summary.gameId, marker)
        if (/^[✓→+]/.test(note)) record.goalNotes.push(note)
        this.push(record, 'goal', note)
      } catch (err) {
        this.push(
          record,
          'goal',
          `check-bar update failed (${marker.kind} '${marker.text}'): ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  private finish(record: SessionRecord, status: AgentStatus, error: string | null): void {
    if (!isLive(record.summary.status)) return
    record.summary.status = status
    record.summary.endedAt = Date.now()
    record.summary.error = error
    this.emitStatus(record)
    if ((status === 'done' || status === 'error') && this.hooks.onRunEnded) {
      try {
        const note = this.hooks.onRunEnded(
          { ...record.summary },
          { goalNotes: [...record.goalNotes], lastText: record.lastText, lastResult: record.lastResult }
        )
        if (note) this.push(record, 'system', note)
      } catch (err) {
        console.warn('[agents] vault run summary failed', err)
      }
    }
    this.persist(record)
    for (const removedId of this.store.prune(record.summary.gameId, KEEP_SESSIONS_PER_GAME)) {
      const removed = this.sessions.get(removedId)
      if (removed && !isLive(removed.summary.status)) this.sessions.delete(removedId)
    }
    this.hooks.onSettled?.()
  }

  private persist(record: SessionRecord): void {
    if (!this.sessions.has(record.summary.id)) return
    if (record.saveTimer) {
      clearTimeout(record.saveTimer)
      record.saveTimer = null
    }
    try {
      this.store.save({ ...record.summary }, record.items ?? [])
    } catch (err) {
      console.warn('[agents] failed to persist session', record.summary.id, err)
    }
  }

  private schedulePersist(record: SessionRecord): void {
    if (record.saveTimer) return
    record.saveTimer = setTimeout(() => {
      record.saveTimer = null
      this.persist(record)
    }, PERSIST_DEBOUNCE_MS)
  }

  private push(record: SessionRecord, kind: AgentStreamKind, rawText: string): void {
    const text = rawText.length > MAX_ITEM_TEXT ? `${rawText.slice(0, MAX_ITEM_TEXT)}…` : rawText
    const item: AgentStreamItem = {
      id: randomUUID(),
      sessionId: record.summary.id,
      gameId: record.summary.gameId,
      ts: Date.now(),
      kind,
      text
    }
    if (!record.items) record.items = []
    record.items.push(item)
    if (record.items.length > MAX_ITEMS_PER_SESSION) record.items.shift()
    this.emit({ type: 'item', item })
    this.schedulePersist(record)
  }

  private emitStatus(record: SessionRecord): void {
    const summary = { ...record.summary }
    this.emit({ type: 'status', session: summary })
    try {
      this.hooks.onStatus?.(summary)
    } catch {
      // Team mirroring must never break local sessions.
    }
  }

  /** Count of live sessions (for presence). */
  liveCount(): number {
    let count = 0
    for (const record of this.sessions.values()) {
      if (isLive(record.summary.status)) count++
    }
    return count
  }

  private emit(event: AgentEvent): void {
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvAgentEvent, event)
    }
  }

  private require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Unknown agent session.')
    return record
  }
}

function isLive(status: AgentStatus): boolean {
  return status === 'running' || status === 'idle'
}

function userMessage(text: string, sessionId: string | null): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    ...(sessionId ? { session_id: sessionId } : {})
  }
}

function compactJson(input: unknown): string {
  try {
    const json = JSON.stringify(input)
    if (!json || json === '{}') return ''
    return json.length > 160 ? `${json.slice(0, 160)}…` : json
  } catch {
    return ''
  }
}

function summarizeToolResult(content: unknown, isError: boolean): string {
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((part) =>
        typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : ''
      )
      .filter(Boolean)
      .join(' ')
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return isError ? 'tool error' : ''
  if (text.length > MAX_TOOL_RESULT_TEXT) text = `${text.slice(0, MAX_TOOL_RESULT_TEXT)}…`
  return isError ? `⚠ ${text}` : text
}
