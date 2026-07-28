import { app, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  McpServerConfig,
  PermissionResult,
  Query,
  SDKMessage,
  SDKRateLimitInfo,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { IPC } from '@shared/ipc-channels'
import { parseBridgeMarkers } from '@shared/goalMarkers'
import type { BridgeMarker } from '@shared/goalMarkers'
import { ROBLOX_MCP_PACKAGE, ROBLOX_MCP_SERVER, wantsRobloxMcp } from '@shared/robloxMcp'
import type {
  AgentEvent,
  AgentLaunchConfig,
  AgentPermissionMode,
  AgentSessionSummary,
  AgentStatus,
  AgentStreamItem,
  AgentStreamKind,
  Game
} from '@shared/types'
import {
  buildChoiceAnswers,
  parseAskUserQuestionInput,
  summarizeChoiceAnswers,
  summarizeChoiceQuestions
} from './agentChoices'
import type { WorktreeLease, WorktreeService } from './worktrees'
import type { SessionStore } from './sessionStore'

const MAX_ITEMS_PER_SESSION = 500
const MAX_ITEM_TEXT = 2000
const MAX_TOOL_RESULT_TEXT = 400
const KEEP_SESSIONS_PER_GAME = 50
const PERSIST_DEBOUNCE_MS = 1500

/**
 * Absolute path to the Claude Code binary, or undefined to let the SDK find it.
 *
 * In a packaged build the SDK resolves the binary relative to its own module
 * path, which lands *inside* `app.asar`. Electron's fs shim makes that path
 * readable, so the SDK's existence check passes — but the OS cannot spawn an
 * executable from inside an archive, and the SDK reports it as a libc
 * mismatch (misleading on Windows). `asarUnpack` puts a real copy on disk;
 * this points the SDK at it.
 */
function claudeExecutable(): string | undefined {
  if (!app.isPackaged) return undefined
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const path = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    exe
  )
  // If the platform package name ever changes, fall back to the SDK's own
  // resolution rather than passing a path that definitely doesn't exist.
  return existsSync(path) ? path : undefined
}

/**
 * Studio MCP servers for this launch, or `{}` when the whitelist didn't ask
 * for them — an unused entry would still spawn a server process per session.
 *
 * When the Bridge-managed install is ready (mcpInstall.ts), the server runs
 * as plain `node <entry>` — nothing npm-shaped on the launch path. Until
 * then it falls back to npx with the pinned version.
 *
 * Windows can't spawn the `npx.cmd` shim directly (Node dropped the implicit
 * shell for `.cmd` in the CVE-2024-27980 fix), so npx goes through `cmd /c`.
 */
function mcpServersFor(
  allowedTools: readonly string[],
  mcpEntry: string | null
): Record<string, McpServerConfig> {
  if (!wantsRobloxMcp(allowedTools)) return {}
  if (mcpEntry) {
    return {
      [ROBLOX_MCP_SERVER]: {
        type: 'stdio',
        command: 'node',
        args: [mcpEntry, '--auto-install-plugin']
      }
    }
  }
  const args = ['-y', ROBLOX_MCP_PACKAGE, '--auto-install-plugin']
  return {
    [ROBLOX_MCP_SERVER]:
      process.platform === 'win32'
        ? { type: 'stdio', command: 'cmd', args: ['/c', 'npx', ...args] }
        : { type: 'stdio', command: 'npx', args }
  }
}

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
  saveTimer: NodeJS.Timeout | null
  /** Resolves the pending AskUserQuestion tool call once the operator answers. */
  choiceResolver: ((result: PermissionResult) => void) | null
  /** The raw AskUserQuestion input, echoed back verbatim in the answer. */
  choiceRaw: Record<string, unknown> | null
  /** Tool calls our canUseTool already rendered a 'denied' line for. */
  deniedToolUseIds: Set<string>
  /** Cost/turn totals from before a resume — SDK totals reset per process. */
  costBase: number
  turnsBase: number
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
  /** Appends a BRIDGE:NOTE to the game's CLAUDE.md; returns a transcript note. */
  applyNote?: (gameId: string, text: string) => string
  /** Builds the prompt block for attached vault notes. */
  vaultContext?: (gameId: string, relPaths: string[]) => string
  /** Installs toolchain + packages into the workspace before launch. */
  prepareWorkspace?: (dir: string, game: Game) => Promise<string[]>
  /** Entry path of the Bridge-managed Roblox MCP install, when ready. */
  robloxMcpEntry?: () => string | null
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
      // Newer summary fields post-date earlier sessions on disk.
      const summary = {
        ...persisted,
        testSteps: persisted.testSteps ?? [],
        pendingQuestion: persisted.pendingQuestion ?? null,
        pendingChoices: persisted.pendingChoices ?? null,
        claudeSessionId: persisted.claudeSessionId ?? null
      }
      if (summary.status === 'running' || summary.status === 'idle') {
        // The app died while this session was live.
        summary.status = 'cancelled'
        summary.endedAt = summary.endedAt ?? Date.now()
        // A question that died with the process can no longer be answered.
        summary.pendingChoices = null
      }
      this.sessions.set(summary.id, {
        summary,
        items: null,
        abort: null,
        input: null,
        query: null,
        saveTimer: null,
        choiceResolver: null,
        choiceRaw: null,
        deniedToolUseIds: new Set(),
        costBase: 0,
        turnsBase: 0,
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
        // AskUserQuestion must stay OFF the allowlist: an allow rule would
        // bypass canUseTool and the tool would run with no answers.
        allowedTools: config.allowedTools.filter((t) => t !== 'AskUserQuestion'),
        model: config.model ?? null,
        cwd: null,
        startedAt: Date.now(),
        endedAt: null,
        costUsd: null,
        numTurns: null,
        error: null,
        testSteps: [],
        pendingQuestion: null,
        pendingChoices: null,
        claudeSessionId: null
      },
      items: [],
      abort: new AbortController(),
      input: new AsyncQueue<SDKUserMessage>(),
      query: null,
      saveTimer: null,
      choiceResolver: null,
      choiceRaw: null,
      deniedToolUseIds: new Set(),
      costBase: 0,
      turnsBase: 0,
      goalNotes: [],
      lastText: null,
      lastResult: null
    }
    this.sessions.set(record.summary.id, record)
    this.emitStatus(record)
    void this.run(record, game, record.input!, record.abort!, {
      kind: 'start',
      task,
      vaultNotes: config.vaultNotes ?? []
    })
    return { ...record.summary }
  }

  /**
   * Reopen a finished session with its full SDK conversation context. The
   * record is revived in place — same Bridge session id, same transcript,
   * same claude session id — and `rawText` becomes the agent's next message.
   * Every guard runs before any state flips, so a failure leaves the session
   * exactly as it was.
   */
  async resume(game: Game, sessionId: string, rawText: string): Promise<AgentSessionSummary> {
    const record = this.require(sessionId)
    const text = rawText.trim()
    if (!text) throw new Error('Prompt text is required.')
    if (isLive(record.summary.status)) throw new Error('That session is still live.')
    if (record.summary.gameId !== game.id) throw new Error('That session belongs to a different game.')
    const resumeId = record.summary.claudeSessionId
    if (!resumeId) {
      throw new Error('This session cannot be resumed — it ran before resume support shipped.')
    }
    // Hydrate the transcript BEFORE the first push: a restored record has
    // items === null, and letting push() start a fresh [] would make the next
    // persist overwrite the on-disk transcript with only the new lines.
    if (record.items === null) {
      record.items = this.store.loadItems(record.summary.gameId, sessionId) ?? []
    }
    // The SDK's conversation JSONL is keyed by the project dir derived from
    // cwd, so a resume must run where the session originally ran.
    const lease = await this.worktrees.acquireAt(
      game,
      sessionId,
      record.summary.cwd ?? game.repoPath
    )
    // Guard against a concurrent resume that won the race while we awaited
    // (the repo-dir fallback lease isn't exclusive, so acquireAt can't catch it).
    if (isLive(record.summary.status)) throw new Error('That session is already live again.')

    record.abort = new AbortController()
    record.input = new AsyncQueue<SDKUserMessage>()
    record.query = null
    record.summary.status = 'running'
    record.summary.endedAt = null
    record.summary.error = null
    record.summary.pendingQuestion = null
    record.summary.pendingChoices = null
    record.costBase = record.summary.costUsd ?? 0
    record.turnsBase = record.summary.numTurns ?? 0
    // The next onRunEnded should describe this run, not the previous one.
    record.goalNotes = []
    record.lastText = null
    record.lastResult = null
    this.push(record, 'system', `resuming session in ${lease.path}`)
    if (lease.note) this.push(record, 'system', lease.note)
    this.push(record, 'user', text)
    this.emitStatus(record)
    void this.run(record, game, record.input, record.abort, { kind: 'resume', text, resumeId, lease })
    return { ...record.summary }
  }

  /** Snapshot of one session's summary (IPC uses it to resolve the game). */
  summaryOf(sessionId: string): AgentSessionSummary {
    return { ...this.require(sessionId).summary }
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
    record.input.push(userMessage(text, record.summary.claudeSessionId))
    // Whatever the agent was waiting on, this reply is the answer.
    const answered = record.summary.pendingQuestion !== null
    record.summary.pendingQuestion = null
    if (record.summary.status === 'idle') {
      record.summary.status = 'running'
      this.emitStatus(record)
    } else if (answered) {
      this.emitStatus(record)
    }
  }

  /** Stop the current turn but keep the session alive for follow-ups. */
  interrupt(sessionId: string): void {
    const record = this.require(sessionId)
    if (record.summary.status !== 'running') throw new Error('No turn is currently running.')
    const q = record.query
    if (!q) throw new Error('Session is still starting.')
    this.settleChoices(record, {
      behavior: 'deny',
      message: 'The operator interrupted this turn before answering.'
    })
    void q.interrupt().catch((err: unknown) => {
      this.push(record, 'stderr', `interrupt failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  /**
   * Answer a pending AskUserQuestion. Keys are the exact question text;
   * values are the picked label(s) or the operator's free-text answer. The
   * resolved tool call unblocks the agent's turn.
   */
  answerChoices(sessionId: string, answers: Record<string, string | string[]>): void {
    const record = this.require(sessionId)
    const questions = record.summary.pendingChoices
    if (
      !isLive(record.summary.status) ||
      !questions ||
      !record.choiceResolver ||
      !record.choiceRaw
    ) {
      // Also the loser of an answer-vs-interrupt race — the choice settled first.
      throw new Error('No multiple-choice question is waiting.')
    }
    const shaped = buildChoiceAnswers(record.choiceRaw, questions, answers)
    if ('error' in shaped) throw new Error(shaped.error)
    this.push(record, 'user', summarizeChoiceAnswers(questions, answers))
    this.settleChoices(record, { behavior: 'allow', updatedInput: shaped.updatedInput })
  }

  /**
   * Resolve the pending AskUserQuestion (if any) and clear its UI state.
   * Idempotent — the first settle wins, later calls are no-ops — so the
   * abort listener, interrupt, cancel, and answer can all call it safely.
   */
  private settleChoices(record: SessionRecord, result: PermissionResult): void {
    const resolve = record.choiceResolver
    if (!resolve) return
    record.choiceResolver = null
    record.choiceRaw = null
    if (record.summary.pendingChoices) {
      record.summary.pendingChoices = null
      this.emitStatus(record)
    }
    resolve(result)
  }

  /**
   * The SDK's permission callback. Only AskUserQuestion gets an interactive
   * path — the promise stays pending until the operator answers in the UI.
   * Everything else is denied, preserving the headless auto-deny behavior
   * Bridge had before this callback existed. Never resolves null: the SDK
   * fails closed and would park the tool call forever.
   */
  private decidePermission(
    record: SessionRecord,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    toolUseID: string
  ): Promise<PermissionResult> {
    if (toolName !== 'AskUserQuestion') {
      this.markDenied(record, toolUseID)
      this.push(record, 'denied', `permission denied: ${toolName}`)
      return Promise.resolve({
        behavior: 'deny',
        message: `Bridge runs headless — ${toolName} is not on this session's allowlist.`,
        toolUseID
      })
    }
    const questions = parseAskUserQuestionInput(input)
    if (!questions) {
      this.markDenied(record, toolUseID)
      this.push(record, 'denied', 'malformed AskUserQuestion input — asked the agent to retry')
      return Promise.resolve({
        behavior: 'deny',
        message: 'Malformed AskUserQuestion input — re-ask with 1-4 questions of 2-4 options each.',
        toolUseID
      })
    }
    record.summary.pendingChoices = questions
    record.choiceRaw = input
    this.push(record, 'goal', summarizeChoiceQuestions(questions))
    this.emitStatus(record)
    return new Promise<PermissionResult>((resolve) => {
      record.choiceResolver = resolve
      signal.addEventListener(
        'abort',
        () =>
          this.settleChoices(record, {
            behavior: 'deny',
            message: 'The turn was interrupted before the operator answered.'
          }),
        { once: true }
      )
    })
  }

  /** Remember a toolUseID we rendered, so permission_denied doesn't re-render it. */
  private markDenied(record: SessionRecord, toolUseID: string): void {
    record.deniedToolUseIds.add(toolUseID)
    // If the SDK never emits permission_denied for callback denies, entries
    // are never consumed — cap the set so a deny-heavy session stays bounded.
    if (record.deniedToolUseIds.size > 200) {
      const oldest = record.deniedToolUseIds.values().next().value
      if (oldest !== undefined) record.deniedToolUseIds.delete(oldest)
    }
  }

  /**
   * Change the permission mode of a LIVE session. The SDK applies it to the
   * next tool call, so a run started in `plan` can be promoted to
   * `acceptEdits` without losing its context and starting over.
   */
  async setPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    const record = this.require(sessionId)
    if (!isLive(record.summary.status)) throw new Error('That session has already finished.')
    const q = record.query
    if (!q) throw new Error('Session is still starting.')
    await q.setPermissionMode(mode)
    record.summary.permissionMode = mode
    this.push(record, 'system', `permission mode → ${mode}`)
    this.emitStatus(record)
  }

  /** Change the model of a LIVE session (empty string = session default). */
  async setModel(sessionId: string, model: string): Promise<void> {
    const record = this.require(sessionId)
    if (!isLive(record.summary.status)) throw new Error('That session has already finished.')
    const q = record.query
    if (!q) throw new Error('Session is still starting.')
    await q.setModel(model || undefined)
    record.summary.model = model || null
    this.push(record, 'system', `model → ${model || 'session default'}`)
    this.emitStatus(record)
  }

  /** End the session: gently when idle, hard-abort when a turn is running. */
  cancel(sessionId: string): void {
    const record = this.require(sessionId)
    if (!isLive(record.summary.status)) return
    this.settleChoices(record, {
      behavior: 'deny',
      message: 'The session was ended before the operator answered.'
    })
    const wasRunning = record.summary.status === 'running'
    record.input?.end()
    if (wasRunning) record.abort?.abort()
  }

  /**
   * Drop a session's verification steps once the operator has worked through
   * them. They stay in the transcript as `test step:` lines, so this clears
   * the outstanding-work signal (badge, auto-popup) without losing the record.
   */
  clearTestSteps(sessionId: string): void {
    const record = this.require(sessionId)
    if (record.summary.testSteps.length === 0) return
    record.summary.testSteps = []
    this.emitStatus(record)
    this.persist(record)
  }

  /**
   * The most recent session that ran in this worktree — used to describe the
   * PR raised from it (the agent's task and the steps it left to verify).
   */
  findByWorktree(gameId: string, cwd: string): AgentSessionSummary | null {
    const target = cwd.replace(/[\\/]+$/, '').toLowerCase()
    const matches = [...this.sessions.values()]
      .map((r) => r.summary)
      .filter(
        (s) => s.gameId === gameId && (s.cwd ?? '').replace(/[\\/]+$/, '').toLowerCase() === target
      )
      .sort((a, b) => b.startedAt - a.startedAt)
    return matches[0] ? { ...matches[0] } : null
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
        this.settleChoices(record, { behavior: 'deny', message: 'The game was removed.' })
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
        this.settleChoices(record, { behavior: 'deny', message: 'Bridge is shutting down.' })
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
    input: AsyncQueue<SDKUserMessage>,
    abort: AbortController,
    opts:
      | { kind: 'start'; task: string; vaultNotes: string[] }
      | { kind: 'resume'; text: string; resumeId: string; lease: WorktreeLease }
  ): Promise<void> {
    // Resume enters already holding its lease (acquired by resume() so its
    // guards could run before any state flipped).
    let leased = opts.kind === 'resume'
    try {
      let cwd = game.repoPath
      if (opts.kind === 'resume') {
        cwd = opts.lease.path
      } else {
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
      }
      record.summary.cwd = cwd
      this.emitStatus(record)

      if (this.hooks.prepareWorkspace) {
        this.push(record, 'system', 'preparing workspace (toolchain + packages)…')
        try {
          for (const note of await this.hooks.prepareWorkspace(cwd, game)) {
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

      const claudeExe = claudeExecutable()
      if (app.isPackaged && !claudeExe) {
        this.push(
          record,
          'stderr',
          'could not find the unpacked Claude Code binary; falling back to the SDK default (this usually fails in a packaged build)'
        )
      }

      if (opts.kind === 'resume') {
        // No footer/vault re-send: the protocol and context are already part
        // of the resumed conversation.
        input.push(userMessage(opts.text, null))
      } else {
        const footer = this.hooks.taskFooter?.(game.id) ?? ''
        let vaultBlock = ''
        if (opts.vaultNotes.length > 0 && this.hooks.vaultContext) {
          try {
            vaultBlock = this.hooks.vaultContext(game.id, opts.vaultNotes)
            if (vaultBlock)
              this.push(record, 'system', `attached ${opts.vaultNotes.length} vault note(s)`)
          } catch (err) {
            this.push(record, 'stderr', `vault notes failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        input.push(userMessage(opts.task + footer + vaultBlock, null))
      }
      const stream = query({
        prompt: input,
        options: {
          cwd,
          permissionMode: record.summary.permissionMode,
          allowedTools: record.summary.allowedTools,
          ...(record.summary.model ? { model: record.summary.model } : {}),
          ...(opts.kind === 'resume' ? { resume: opts.resumeId } : {}),
          // Multiple-choice questions (AskUserQuestion) surface in the UI;
          // every other unapproved tool is denied, as headless mode always did.
          canUseTool: (toolName, toolInput, { signal, toolUseID }) =>
            this.decidePermission(record, toolName, toolInput, signal, toolUseID),
          // Studio-side work (instances, generated meshes, asset uploads) runs
          // through this; only spawned when the whitelist opted in.
          mcpServers: mcpServersFor(
            record.summary.allowedTools,
            this.hooks.robloxMcpEntry?.() ?? null
          ),
          ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
          // Load the memory layers: ~/.claude/CLAUDE.md (studio-wide) and the
          // workspace CLAUDE.md — the SDK loads neither by default.
          settingSources: ['user', 'project'],
          // The SDK's single switch for the Skill tool — without it the
          // generate-3d-model skill the conventions point agents at may be
          // unavailable. ('Skill' in allowedTools is the deprecated spelling.)
          skills: 'all',
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
          // Persisted with the summary — this is what makes the session
          // resumable later, including after a crash.
          record.summary.claudeSessionId = message.session_id
          this.push(
            record,
            'system',
            `session started · ${message.model} · claude-code ${message.claude_code_version} · ${message.tools.length} tools · mode ${message.permissionMode} · cwd ${message.cwd}`
          )
          this.emitStatus(record)
        } else if (message.subtype === 'permission_denied') {
          // Skip denies our canUseTool already rendered (the SDK may emit
          // this event for callback denies too — either way, one line).
          if (!record.deniedToolUseIds.delete(message.tool_use_id)) {
            this.push(record, 'denied', `permission denied: ${message.tool_name}`)
          }
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
        // SDK totals reset per query() process — the bases carry what a
        // resumed session had already spent, so money never vanishes.
        record.summary.costUsd = record.costBase + message.total_cost_usd
        record.summary.numTurns = record.turnsBase + message.num_turns
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
    for (const marker of parseBridgeMarkers(text)) {
      // A question for the operator: surface it and wait. The agent ends its
      // turn after asking, so the session goes idle and the reply becomes its
      // next message through the existing follow-up path.
      if (marker.kind === 'ask') {
        const question = marker.text.trim()
        if (question) {
          record.summary.pendingQuestion = record.summary.pendingQuestion
            ? `${record.summary.pendingQuestion}\n${question}`
            : question
          this.push(record, 'goal', `question: ${question}`)
          this.emitStatus(record)
        }
        continue
      }
      // NOTE goes to the game's canonical CLAUDE.md (single writer), never
      // the worktree copy — one agent's learning reaches every future agent.
      if (marker.kind === 'note') {
        const text = marker.text.trim()
        if (text && this.hooks.applyNote) {
          try {
            this.push(record, 'goal', this.hooks.applyNote(record.summary.gameId, text))
          } catch (err) {
            this.push(
              record,
              'goal',
              `note failed ('${text}'): ${err instanceof Error ? err.message : String(err)}`
            )
          }
        }
        continue
      }
      // TEST steps are for the operator, not GOALS.md — collect, don't apply.
      if (marker.kind === 'test') {
        const step = marker.text.trim()
        if (step && !record.summary.testSteps.includes(step)) {
          record.summary.testSteps.push(step)
          this.push(record, 'goal', `test step: ${step}`)
          this.emitStatus(record)
        }
        continue
      }
      if (!this.hooks.applyMarker) continue
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
    // A dead session must never persist a question nobody can answer.
    this.settleChoices(record, {
      behavior: 'deny',
      message: 'The session ended before the operator answered.'
    })
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
