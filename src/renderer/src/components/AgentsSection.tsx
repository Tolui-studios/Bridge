import { useEffect, useRef, useState } from 'react'
import type {
  AgentPermissionMode,
  AgentSessionSummary,
  AgentStreamItem,
  Game
} from '@shared/types'
import { useAgents } from '../hooks/useAgents'

const TOOL_CHOICES = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch']
const DEFAULT_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write']

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: '', label: 'Session default' }
]

const MODE_OPTIONS: { value: AgentPermissionMode; label: string; hint: string }[] = [
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Auto-accept file edits; other tools need the allowlist.' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only planning mode — no tool execution.' },
  { value: 'dontAsk', label: "Don't ask", hint: 'Deny anything not on the allowlist, never prompt.' },
  { value: 'default', label: 'Default', hint: 'Standard permission behavior (headless: unapproved tools are denied).' }
]

export default function AgentsSection({ game }: { game: Game }) {
  const { sessions, activeId, setActiveId, transcript, start, cancel, error, clearError } =
    useAgents(game.id)
  const [showForm, setShowForm] = useState(false)

  const running = sessions.find((s) => s.status === 'running') ?? null
  const active = sessions.find((s) => s.id === activeId) ?? null
  const formOpen = !running && (showForm || sessions.length === 0)

  return (
    <section className="mt-10 border-t border-neutral-900 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Agents
        </h3>
        {!formOpen && !running && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            + New Agent
          </button>
        )}
        {running && (
          <button
            onClick={() => cancel(running.id)}
            className="rounded-md border border-red-900 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/40"
          >
            Cancel agent
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
          onLaunch={async (task, mode, tools, model) => {
            const ok = await start({
              task,
              permissionMode: mode,
              allowedTools: tools,
              ...(model ? { model } : {})
            })
            if (ok) setShowForm(false)
            return ok
          }}
        />
      )}

      {sessions.length > 0 && (
        <ul className="mb-3 space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={() => setActiveId(session.id)}
            />
          ))}
        </ul>
      )}

      {active && <Transcript items={transcript} runningTask={active.status === 'running'} />}
    </section>
  )
}

function LaunchForm({
  onLaunch
}: {
  onLaunch: (
    task: string,
    mode: AgentPermissionMode,
    tools: string[],
    model: string
  ) => Promise<boolean>
}) {
  const [task, setTask] = useState('')
  const [mode, setMode] = useState<AgentPermissionMode>('acceptEdits')
  const [tools, setTools] = useState<string[]>(DEFAULT_TOOLS)
  const [model, setModel] = useState<string>('claude-sonnet-5')
  const [busy, setBusy] = useState(false)

  const launch = async (): Promise<void> => {
    if (!task.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onLaunch(task.trim(), mode, tools, model)
      if (ok) setTask('')
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
    </div>
  )
}

const STATUS_STYLE: Record<AgentSessionSummary['status'], { dot: string; label: string }> = {
  running: { dot: 'bg-amber-400 animate-pulse', label: 'text-amber-300' },
  done: { dot: 'bg-emerald-500', label: 'text-emerald-400' },
  error: { dot: 'bg-red-500', label: 'text-red-400' },
  cancelled: { dot: 'bg-neutral-600', label: 'text-neutral-500' }
}

function SessionRow({
  session,
  active,
  onSelect
}: {
  session: AgentSessionSummary
  active: boolean
  onSelect: () => void
}) {
  const style = STATUS_STYLE[session.status]
  const meta: string[] = [new Date(session.startedAt).toLocaleTimeString()]
  if (session.numTurns !== null) meta.push(`${session.numTurns} turns`)
  if (session.costUsd !== null) meta.push(`$${session.costUsd.toFixed(4)}`)
  return (
    <li>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
          active ? 'bg-neutral-800/80' : 'hover:bg-neutral-900'
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-300" title={session.task}>
          {session.task}
        </span>
        <span className={`shrink-0 text-[10px] uppercase tracking-wide ${style.label}`}>
          {session.status}
        </span>
        <span className="shrink-0 text-[10px] text-neutral-600">{meta.join(' · ')}</span>
      </button>
    </li>
  )
}

const KIND_STYLE: Record<AgentStreamItem['kind'], string> = {
  system: 'text-neutral-500',
  text: 'text-neutral-200 whitespace-pre-wrap',
  tool: 'text-sky-300',
  'tool-result': 'text-neutral-500',
  denied: 'text-red-400',
  result: 'text-emerald-300',
  stderr: 'text-orange-300/90'
}

function Transcript({ items, runningTask }: { items: AgentStreamItem[]; runningTask: boolean }) {
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
        <p className="text-neutral-600">{runningTask ? 'Waiting for the agent…' : 'No output.'}</p>
      )}
      {items.map((item) => (
        <p key={item.id} className={KIND_STYLE[item.kind]}>
          {item.kind === 'tool' && <span className="text-sky-500">→ </span>}
          {item.kind === 'tool-result' && <span className="text-neutral-700">← </span>}
          {item.text}
        </p>
      ))}
      {runningTask && <p className="animate-pulse text-neutral-600">▍</p>}
    </div>
  )
}
