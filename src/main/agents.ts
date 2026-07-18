import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '@shared/ipc-channels'
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

const MAX_ITEMS_PER_SESSION = 500
const MAX_ITEM_TEXT = 2000
const MAX_TOOL_RESULT_TEXT = 400

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
  items: AgentStreamItem[]
  abort: AbortController
  input: AsyncQueue<SDKUserMessage>
  query: Query | null
  claudeSessionId: string | null
}

/**
 * Owns agent sessions in the main process. Each session is interactive:
 * streaming prompt input keeps the Claude Code process alive between turns
 * ('idle' status), so the operator can send follow-ups, interrupt the
 * current turn, or end the session. Games can run multiple sessions in
 * parallel — each agent gets its own git worktree via WorktreeService.
 */
export class AgentService {
  private sessions = new Map<string, SessionRecord>()

  constructor(
    private readonly worktrees: WorktreeService,
    private readonly onSettled?: () => void
  ) {}

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
      claudeSessionId: null
    }
    this.sessions.set(record.summary.id, record)
    this.emitStatus(record)
    void this.run(record, game, task)
    return { ...record.summary }
  }

  /** Send a follow-up prompt into a live session (queued if a turn is running). */
  reprompt(sessionId: string, rawText: string): void {
    const record = this.require(sessionId)
    const text = rawText.trim()
    if (!text) throw new Error('Prompt text is required.')
    if (!isLive(record.summary.status)) throw new Error('This session has ended.')
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
    record.input.end()
    if (wasRunning) record.abort.abort()
  }

  list(gameId: string): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .map((r) => ({ ...r.summary }))
      .filter((s) => s.gameId === gameId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  transcript(sessionId: string): AgentStreamItem[] {
    return [...this.require(sessionId).items]
  }

  closeAll(): void {
    for (const record of this.sessions.values()) {
      if (isLive(record.summary.status)) {
        record.input.end()
        record.abort.abort()
      }
    }
  }

  private async run(record: SessionRecord, game: Game, task: string): Promise<void> {
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

      record.input.push(userMessage(task, null))
      const stream = query({
        prompt: record.input,
        options: {
          cwd,
          permissionMode: record.summary.permissionMode,
          allowedTools: record.summary.allowedTools,
          ...(record.summary.model ? { model: record.summary.model } : {}),
          // Load the memory layers: ~/.claude/CLAUDE.md (studio-wide) and the
          // workspace CLAUDE.md — the SDK loads neither by default.
          settingSources: ['user', 'project'],
          abortController: record.abort,
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
        this.finish(record, record.abort.signal.aborted ? 'cancelled' : 'done', null)
      }
    } catch (err) {
      if (isLive(record.summary.status)) {
        if (record.abort.signal.aborted) {
          this.finish(record, 'cancelled', null)
        } else {
          const message = err instanceof Error ? err.message : String(err)
          this.push(record, 'stderr', message)
          this.finish(record, 'error', message)
        }
      }
    } finally {
      record.input.end()
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
            this.push(record, 'text', block.text.trim())
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
      case 'result': {
        record.summary.costUsd = message.total_cost_usd
        record.summary.numTurns = message.num_turns
        this.push(
          record,
          'result',
          `${message.subtype} · ${message.num_turns} turns · $${message.total_cost_usd.toFixed(4)} · ${(message.duration_ms / 1000).toFixed(1)}s`
        )
        if (message.is_error) {
          this.finish(record, 'error', message.subtype)
          record.input.end()
        } else if (!record.input.isEnded && !record.abort.signal.aborted) {
          // Session stays alive for follow-up prompts.
          record.summary.status = 'idle'
          this.emitStatus(record)
          this.onSettled?.()
        }
        break
      }
      default:
        break
    }
  }

  private finish(record: SessionRecord, status: AgentStatus, error: string | null): void {
    record.summary.status = status
    record.summary.endedAt = Date.now()
    record.summary.error = error
    this.emitStatus(record)
    this.onSettled?.()
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
    record.items.push(item)
    if (record.items.length > MAX_ITEMS_PER_SESSION) record.items.shift()
    this.emit({ type: 'item', item })
  }

  private emitStatus(record: SessionRecord): void {
    this.emit({ type: 'status', session: { ...record.summary } })
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
