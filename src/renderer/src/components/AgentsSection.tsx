import { useEffect, useRef, useState } from 'react'
import type {
  AgentPermissionMode,
  AgentSessionSummary,
  AgentStreamItem,
  Game
} from '@shared/types'
import TestChecklist from './TestChecklist'
import { cleanIpcError } from '../lib/ipcError'
import { ROBLOX_MCP_TOOL_GLOB } from '@shared/robloxMcp'
import { useAgents } from '../hooks/useAgents'
import { useVaultNotes } from '../hooks/useVault'
import { useTeam } from '../hooks/useTeam'

const SUBAGENT_PILL = 'Subagents'
/** 'Agent' is the subagent tool in current Claude Code; 'Task' covers older CLIs. */
const SUBAGENT_TOOL_NAMES = ['Agent', 'Task']
const STUDIO_PILL = 'Roblox Studio'
const TOOL_CHOICES = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash',
  'WebSearch',
  'WebFetch',
  SUBAGENT_PILL,
  STUDIO_PILL
]
const DEFAULT_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', SUBAGENT_PILL, STUDIO_PILL]

const TOOL_HINTS: Record<string, string> = {
  [SUBAGENT_PILL]: 'Allow the agent to spawn subagents (Agent/Task tool)',
  [STUDIO_PILL]:
    'Studio-side work via the Roblox Studio MCP — instances, meshes, asset uploads, screenshots. Requires Roblox Studio to be running.'
}

function expandTools(tools: string[]): string[] {
  return tools.flatMap((tool) => {
    if (tool === SUBAGENT_PILL) return SUBAGENT_TOOL_NAMES
    if (tool === STUDIO_PILL) return [ROBLOX_MCP_TOOL_GLOB]
    return [tool]
  })
}

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-fable-5', label: 'Fable 5 (max cost)' },
  { value: '', label: 'Session default' }
]

const MODE_OPTIONS: { value: AgentPermissionMode; label: string; hint: string }[] = [
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Auto-accept file edits; other tools need the allowlist.' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only planning mode — no tool execution.' },
  { value: 'dontAsk', label: "Don't ask", hint: 'Deny anything not on the allowlist, never prompt.' },
  { value: 'default', label: 'Default', hint: 'Standard permission behavior (headless: unapproved tools are denied).' }
]

export default function AgentsSection({ game }: { game: Game }) {
  const {
    sessions,
    activeId,
    setActiveId,
    transcript,
    start,
    cancel,
    reprompt,
    interrupt,
    error,
    clearError
  } = useAgents(game.id)
  const [showForm, setShowForm] = useState(false)
  const { team } = useTeam()
  const teammateSessions = team.sessions.filter(
    (s) => s.gameId === game.id && s.owner !== team.me
  )

  // Pop the checklist the moment a run finishes with steps to verify, so the
  // handoff isn't something the operator has to go looking for. Each session
  // only auto-opens once per app run.
  const [testFor, setTestFor] = useState<AgentSessionSummary | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const autoShown = useRef<Set<string>>(new Set())
  useEffect(() => {
    const finished = sessions.find(
      (s) =>
        s.status !== 'running' &&
        s.status !== 'idle' &&
        s.testSteps.length > 0 &&
        !autoShown.current.has(s.id)
    )
    if (finished) {
      autoShown.current.add(finished.id)
      setTestFor(finished)
    }
  }, [sessions])

  const active = sessions.find((s) => s.id === activeId) ?? null
  const activeLive = active !== null && (active.status === 'running' || active.status === 'idle')
  const liveCount = sessions.filter((s) => s.status === 'running' || s.status === 'idle').length
  const formOpen = showForm || sessions.length === 0

  return (
    <section className="mt-10 border-t border-neutral-900 pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Agents{liveCount > 0 && <span className="ml-2 text-amber-400/80">{liveCount} live</span>}
        </h3>
        {!formOpen && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            + New Agent
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2">
          <p className="text-xs text-red-300">{error}</p>
          <button onClick={clearError} className="shrink-0 text-xs text-red-400/70 hover:text-red-300">
            ✕
          </button>
        </div>
      )}

      {formOpen && (
        <LaunchForm
          gameId={game.id}
          onLaunch={async ({ task, mode, tools, model, vaultNotes }) => {
            const ok = await start({
              task,
              permissionMode: mode,
              allowedTools: expandTools(tools),
              ...(model ? { model } : {}),
              ...(vaultNotes.length > 0 ? { vaultNotes } : {})
            })
            if (ok) setShowForm(false)
            return ok
          }}
        />
      )}

      {sessions.length > 0 && (
        <ul className="mb-3 max-h-52 space-y-1 overflow-y-auto pr-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={() => setActiveId(session.id)}
              onStop={
                session.status === 'running' || session.status === 'idle'
                  ? () => cancel(session.id)
                  : null
              }
              onShowTests={session.testSteps.length > 0 ? () => setTestFor(session) : null}
            />
          ))}
        </ul>
      )}

      {testFor && <TestChecklist session={testFor} onClose={() => setTestFor(null)} />}

      {teammateSessions.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
            Teammates&apos; agents
          </p>
          <ul className="space-y-1">
            {teammateSessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center gap-2.5 rounded-md border border-neutral-900 px-3 py-2"
                title={`${session.owner} — ${session.task}`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    session.status === 'running'
                      ? 'bg-amber-400 animate-pulse'
                      : session.status === 'idle'
                        ? 'bg-sky-400'
                        : session.status === 'done'
                          ? 'bg-emerald-500'
                          : session.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-neutral-600'
                  }`}
                />
                <span className="shrink-0 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-neutral-300">
                  {session.owner.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">
                  {session.task}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-500">
                  {session.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span
              className="truncate font-mono text-[10px] text-neutral-600"
              title={active.cwd ?? undefined}
            >
              {active.cwd ? `${basename(active.cwd)} · ` : ''}
              {active.status}
              {liveError && <span className="ml-2 text-red-400">{liveError}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {activeLive && <LiveControls session={active} onError={setLiveError} />}
              {active.status === 'running' && (
                <button
                  onClick={() => interrupt(active.id)}
                  title="Stop the current turn but keep the session alive for follow-ups"
                  className="rounded-md border border-amber-800 px-2.5 py-1 text-[11px] text-amber-300 transition-colors hover:bg-amber-950/40"
                >
                  Interrupt
                </button>
              )}
              {activeLive && (
                <button
                  onClick={() => cancel(active.id)}
                  title={
                    active.status === 'running'
                      ? 'Abort the turn and end this session'
                      : 'End this idle session'
                  }
                  className="rounded-md border border-red-900 px-2.5 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-950/40"
                >
                  {active.status === 'running' ? 'Stop' : 'End session'}
                </button>
              )}
            </span>
          </div>
          <Transcript items={transcript} running={active.status === 'running'} />
          {activeLive && (
            <FollowUpRow
              running={active.status === 'running'}
              onSend={(text) => reprompt(active.id, text)}
            />
          )}
        </>
      )}
    </section>
  )
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

interface LaunchInput {
  task: string
  mode: AgentPermissionMode
  tools: string[]
  model: string
  vaultNotes: string[]
}

function LaunchForm({
  gameId,
  onLaunch
}: {
  gameId: string
  onLaunch: (input: LaunchInput) => Promise<boolean>
}) {
  const [task, setTask] = useState('')
  const [mode, setMode] = useState<AgentPermissionMode>('acceptEdits')
  const [tools, setTools] = useState<string[]>(DEFAULT_TOOLS)
  const [model, setModel] = useState<string>('claude-sonnet-5')
  const [selectedNotes, setSelectedNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const vaultNotes = useVaultNotes(gameId)

  const launch = async (): Promise<void> => {
    if (!task.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onLaunch({
        task: task.trim(),
        mode,
        tools,
        model,
        vaultNotes: selectedNotes
      })
      if (ok) {
        setTask('')
        setSelectedNotes([])
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        rows={3}
        placeholder="What should the agent do in this game?"
        className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600"
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            title="Session default runs whatever your Claude Code session is set to — can be the most expensive tier."
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-emerald-600"
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AgentPermissionMode)}
            title={MODE_OPTIONS.find((o) => o.value === mode)?.hint}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-emerald-600"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">Tools</span>
          <div className="flex flex-wrap gap-1">
            {TOOL_CHOICES.map((tool) => {
              const on = tools.includes(tool)
              return (
                <button
                  key={tool}
                  onClick={() =>
                    setTools((prev) => (on ? prev.filter((t) => t !== tool) : [...prev, tool]))
                  }
                  title={TOOL_HINTS[tool]}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    on
                      ? 'border-emerald-600 bg-emerald-600/15 text-emerald-300'
                      : 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {tool}
                </button>
              )
            })}
          </div>
        </div>
        <button
          onClick={() => void launch()}
          disabled={!task.trim() || busy}
          className="ml-auto rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy ? 'Launching…' : 'Launch agent'}
        </button>
      </div>
      {vaultNotes.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="mt-1 shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Notes
          </span>
          <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
            {vaultNotes.map((note) => {
              const on = selectedNotes.includes(note.relPath)
              return (
                <button
                  key={note.relPath}
                  onClick={() =>
                    setSelectedNotes((prev) =>
                      on ? prev.filter((p) => p !== note.relPath) : [...prev, note.relPath]
                    )
                  }
                  title={`${note.relPath} — attach this vault note to the agent's context`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    on
                      ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                      : 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {note.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<AgentSessionSummary['status'], { dot: string; label: string }> = {
  running: { dot: 'bg-amber-400 animate-pulse', label: 'text-amber-300' },
  idle: { dot: 'bg-sky-400', label: 'text-sky-300' },
  done: { dot: 'bg-emerald-500', label: 'text-emerald-400' },
  error: { dot: 'bg-red-500', label: 'text-red-400' },
  cancelled: { dot: 'bg-neutral-600', label: 'text-neutral-500' }
}

/**
 * Mode and model pickers for a session that is already running. The SDK
 * applies both to the next turn, so a run started in Plan can be promoted to
 * Accept edits — or moved onto a cheaper model — without losing its context.
 */
function LiveControls({
  session,
  onError
}: {
  session: AgentSessionSummary
  onError: (message: string | null) => void
}) {
  const [busy, setBusy] = useState(false)

  const apply = (change: () => Promise<void>): void => {
    setBusy(true)
    onError(null)
    change()
      .catch((err) => onError(cleanIpcError(err)))
      .finally(() => setBusy(false))
  }

  const select =
    'rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-400 outline-none hover:border-neutral-600 disabled:opacity-40'

  return (
    <>
      <select
        value={session.permissionMode}
        disabled={busy}
        onChange={(e) =>
          apply(() =>
            window.bridge.setAgentMode(session.id, e.target.value as AgentPermissionMode)
          )
        }
        title="Change this running session's permission mode — applies from the next tool call"
        className={select}
      >
        {MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        value={session.model ?? ''}
        disabled={busy}
        onChange={(e) => apply(() => window.bridge.setAgentModel(session.id, e.target.value))}
        title="Change this running session's model — applies from the next turn"
        className={select}
      >
        {MODEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
  onStop,
  onShowTests
}: {
  session: AgentSessionSummary
  active: boolean
  onSelect: () => void
  onStop: (() => void) | null
  onShowTests: (() => void) | null
}) {
  const style = STATUS_STYLE[session.status]
  const meta: string[] = [new Date(session.startedAt).toLocaleTimeString()]
  if (session.numTurns !== null) meta.push(`${session.numTurns} turns`)
  if (session.costUsd !== null) meta.push(`$${session.costUsd.toFixed(4)}`)
  return (
    <li>
      <div
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect()
        }}
        title={session.cwd ? `Workspace: ${session.cwd}` : session.task}
        className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
          active ? 'bg-neutral-800/80' : 'hover:bg-neutral-900'
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{session.task}</span>
        {session.cwd && (
          <span className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 font-mono text-[9px] text-neutral-500">
            {basename(session.cwd)}
          </span>
        )}
        <span className={`shrink-0 text-[10px] uppercase tracking-wide ${style.label}`}>
          {session.status}
        </span>
        <span className="shrink-0 text-[10px] text-neutral-600">{meta.join(' · ')}</span>
        {onShowTests && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onShowTests()
            }}
            title={`${session.testSteps.length} step${session.testSteps.length > 1 ? 's' : ''} to verify in Studio`}
            className="shrink-0 rounded border border-sky-900 px-1.5 py-0.5 text-[10px] text-sky-400 transition-colors hover:bg-sky-950/40"
          >
            Test ({session.testSteps.length})
          </button>
        )}
        {onStop && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onStop()
            }}
            role="button"
            title="Stop this session"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-600 opacity-0 transition-opacity hover:bg-red-950/50 hover:text-red-400 group-hover:opacity-100"
          >
            ✕
          </span>
        )}
      </div>
    </li>
  )
}

const KIND_STYLE: Record<AgentStreamItem['kind'], string> = {
  system: 'text-neutral-500',
  user: 'text-emerald-200',
  text: 'text-neutral-200 whitespace-pre-wrap',
  tool: 'text-sky-300',
  'tool-result': 'text-neutral-500',
  denied: 'text-red-400',
  result: 'text-emerald-300',
  stderr: 'text-orange-300/90',
  goal: 'text-amber-300'
}

function Transcript({ items, running }: { items: AgentStreamItem[]; running: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [items.length])

  return (
    <div
      ref={boxRef}
      className="max-h-80 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed"
    >
      {items.length === 0 && (
        <p className="text-neutral-600">{running ? 'Waiting for the agent…' : 'No output.'}</p>
      )}
      {items.map((item) => (
        <p key={item.id} className={KIND_STYLE[item.kind]}>
          {item.kind === 'user' && <span className="text-emerald-500">❯ </span>}
          {item.kind === 'tool' && <span className="text-sky-500">→ </span>}
          {item.kind === 'tool-result' && <span className="text-neutral-700">← </span>}
          {item.kind === 'goal' && <span className="text-amber-500">⚑ </span>}
          {item.text}
        </p>
      ))}
      {running && <p className="animate-pulse text-neutral-600">▍</p>}
    </div>
  )
}

function FollowUpRow({
  running,
  onSend
}: {
  running: boolean
  onSend: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const ok = await onSend(trimmed)
      if (ok) setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void send()
        }}
        placeholder={running ? 'Send a follow-up (queued until this turn ends)…' : 'Send a follow-up prompt…'}
        className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600"
      />
      <button
        onClick={() => void send()}
        disabled={!text.trim() || busy}
        className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
      >
        Send
      </button>
    </div>
  )
}
