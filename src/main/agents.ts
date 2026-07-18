import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
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

const MAX_ITEMS_PER_SESSION = 500
const MAX_ITEM_TEXT = 2000
const MAX_TOOL_RESULT_TEXT = 400

interface SessionRecord {
  summary: AgentSessionSummary
  items: AgentStreamItem[]
  abort: AbortController
}

/**
 * Owns agent sessions in the main process: one live Claude Code agent per
 * game (Phase 2 constraint), spawned via the Agent SDK with cwd set to the
 * game's repo. Streams a simplified transcript to all renderer windows over
 * a single event channel — the renderer never touches the SDK or processes.
 */
export class AgentService {
  private sessions = new Map<string, SessionRecord>()

  start(game: Game, config: AgentLaunchConfig): AgentSessionSummary {
    const task = config.task.trim()
    if (!task) throw new Error('Task is required.')
    for (const record of this.sessions.values()) {
      if (record.summary.gameId === game.id && record.summary.status === 'running') {
        throw new Error('An agent is already running for this game. Cancel it or wait for it to finish.')
      }
    }
    const record: SessionRecord = {
      summary: {
        id: randomUUID(),
        gameId: game.id,
        task,
        status: 'running',
        permissionMode: config.permissionMode,
        allowedTools: [...config.allowedTools],
        model: config.model ?? null,
        startedAt: Date.now(),
        endedAt: null,
        costUsd: null,
        numTurns: null,
        error: null
      },
      items: [],
      abort: new AbortController()
    }
    this.sessions.set(record.summary.id, record)
    this.emitStatus(record)
    void this.run(record, game, task)
    return { ...record.summary }
  }

  cancel(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Unknown agent session.')
    if (record.summary.status !== 'running') return
    record.abort.abort()
  }

  list(gameId: string): AgentSessionSummary[] {
    return [...this.sessions.values()]
      .map((r) => ({ ...r.summary }))
      .filter((s) => s.gameId === gameId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  transcript(sessionId: string): AgentStreamItem[] {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Unknown agent session.')
    return [...record.items]
  }

  closeAll(): void {
    for (const record of this.sessions.values()) {
      if (record.summary.status === 'running') record.abort.abort()
    }
  }

  private async run(record: SessionRecord, game: Game, task: string): Promise<void> {
    try {
      const stream = query({
        prompt: task,
        options: {
          cwd: game.repoPath,
          permissionMode: record.summary.permissionMode,
          allowedTools: record.summary.allowedTools,
          ...(record.summary.model ? { model: record.summary.model } : {}),
          abortController: record.abort,
          stderr: (data: string) => {
            const text = data.trim()
            if (text) this.push(record, 'stderr', text)
          },
          env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bridge/0.1.0' }
        }
      })
      for await (const message of stream) {
        this.handle(record, message)
      }
      if (record.summary.status === 'running') {
        this.finish(record, record.abort.signal.aborted ? 'cancelled' : 'done', null)
      }
    } catch (err) {
      if (record.summary.status !== 'running') return
      if (record.abort.signal.aborted) {
        this.finish(record, 'cancelled', null)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        this.push(record, 'stderr', message)
        this.finish(record, 'error', message)
      }
    }
  }

  private handle(record: SessionRecord, message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          this.push(
            record,
            'system',
            `session started · ${message.model} · claude-code ${message.claude_code_version} · ${message.tools.length} tools · mode ${message.permissionMode}`
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
        this.finish(record, message.is_error ? 'error' : 'done', message.is_error ? message.subtype : null)
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
  }

  private push(record: SessionRecord, kind: AgentStreamKind, rawText: string): void {
    const text =
      rawText.length > MAX_ITEM_TEXT ? `${rawText.slice(0, MAX_ITEM_TEXT)}…` : rawText
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
