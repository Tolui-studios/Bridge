import { useCallback, useState } from 'react'
import type { Game, GoalsMutation } from '@shared/types'
import { progressOf } from '@shared/goalsParser'
import { useGoals } from '../hooks/useGoals'
import { useSettings } from '../hooks/useVault'
import { useTeam } from '../hooks/useTeam'
import { cleanIpcError } from '../lib/ipcError'
import ProgressBar from './ProgressBar'
import Checklist from './Checklist'
import EditableText from './EditableText'
import AgentsSection from './AgentsSection'
import RepoBar from './RepoBar'
import TeamNote from './TeamNote'
import ToolingSection from './ToolingSection'

interface Props {
  game: Game
  onEdit: () => void
  onRemove: () => void
}

export default function GamePanel({ game, onEdit, onRemove }: Props) {
  const { state, refresh, createTemplate, mutate } = useGoals(game.id)
  const { settings } = useSettings()
  const { team } = useTeam()
  const occupants = team.users.filter((u) => u.gameId === game.id && u.name !== team.me)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  const [decisionOpen, setDecisionOpen] = useState(false)

  const run = useCallback(
    async (mutation: GoalsMutation): Promise<void> => {
      setActionError(null)
      try {
        await mutate(mutation)
      } catch (err) {
        setActionError(cleanIpcError(err))
        throw err
      }
    },
    [mutate]
  )

  const fire = useCallback(
    (mutation: GoalsMutation): void => {
      run(mutation).catch(() => {})
    },
    [run]
  )

  const openRepo = (): void => {
    setActionError(null)
    window.bridge.openRepo(game.id).catch((err) => setActionError(cleanIpcError(err)))
  }

  const openInVsCode = (): void => {
    setActionError(null)
    window.bridge.openInEditor(game.id).catch((err) => setActionError(cleanIpcError(err)))
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold text-neutral-100">{game.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-neutral-600" title={game.repoPath}>
            {game.repoPath}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={openRepo}
            title="Open the repo folder in File Explorer"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Open Folder
          </button>
          <button
            onClick={openInVsCode}
            title="Open the repo folder in VS Code"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            VS Code
          </button>
          <button
            onClick={onEdit}
            title="Edit this game's registration (name, paths, branch)"
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Settings
          </button>
          {confirmingRemove ? (
            <span className="flex items-center gap-2">
              <button
                onClick={onRemove}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
              >
                Confirm remove
              </button>
              <button
                onClick={() => setConfirmingRemove(false)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-800"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:border-red-900 hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
      </header>

      {occupants.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2">
          <p className="text-xs text-amber-300">
            {occupants.map((u) => u.name).join(', ')}{' '}
            {occupants.length === 1 ? 'is' : 'are'} working on this project right now — coordinate
            before launching agents here to avoid merge collisions.
          </p>
        </div>
      )}

      <RepoBar game={game} />

      <ToolingSection game={game} />

      {actionError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2">
          <p className="text-xs text-red-300">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="shrink-0 text-xs text-red-400/70 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {actionInfo && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-emerald-900/50 bg-emerald-950/30 px-3 py-2">
          <p className="text-xs text-emerald-300">{actionInfo}</p>
          <button
            onClick={() => setActionInfo(null)}
            className="shrink-0 text-xs text-emerald-400/70 hover:text-emerald-300"
          >
            ✕
          </button>
        </div>
      )}

      {state === null && <p className="text-sm text-neutral-500">Loading GOALS.md…</p>}

      {state?.status === 'missing' && (
        <div className="rounded-lg border border-dashed border-neutral-700 p-8 text-center">
          <p className="text-sm text-neutral-400">No GOALS.md in this repo yet.</p>
          <button
            onClick={createTemplate}
            className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Create GOALS.md from template
          </button>
        </div>
      )}

      {state?.status === 'unreadable' && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-center">
          <p className="text-sm text-red-300">GOALS.md exists but could not be read.</p>
          <button
            onClick={refresh}
            className="mt-3 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      )}

      {state?.status === 'ok' && state.doc && (
        <div className="space-y-6">
          <div className="flex border-l-4 border-emerald-500/60 pl-4">
            <EditableText
              value={state.doc.goal ?? ''}
              placeholder="Set the current goal…"
              onSave={(text) => run({ kind: 'set-goal', goal: text })}
              className="w-full text-lg text-neutral-300 hover:text-neutral-100"
              inputClassName="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-lg text-neutral-200 outline-none focus:border-emerald-600"
              title="Click to edit the goal"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Phase
            </span>
            <EditableText
              value={state.doc.phase ?? ''}
              placeholder="Set phase…"
              onSave={(text) => run({ kind: 'set-phase', phase: text })}
              className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500"
              inputClassName="rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs text-neutral-200 outline-none focus:border-emerald-600"
              title="Click to edit the phase"
            />
          </div>
          <ProgressBar progress={progressOf(state.doc)} />
          <Checklist
            items={state.doc.items}
            onToggle={(index, item) =>
              fire({ kind: 'toggle-item', index, expectText: item.text, done: !item.done })
            }
            onEditText={(index, item, text) =>
              fire({ kind: 'edit-item', index, expectText: item.text, text })
            }
            onRemove={(index, item) => fire({ kind: 'remove-item', index, expectText: item.text })}
            onSetInProgress={(index, item) =>
              fire({ kind: 'set-in-progress', index, expectText: item?.text })
            }
            onAdd={(text) => run({ kind: 'add-item', text })}
          />
          <footer className="flex items-center justify-between gap-2 border-t border-neutral-900 pt-4">
            <span className="truncate font-mono text-[10px] text-neutral-700" title={state.path}>
              {state.path} · read {new Date(state.updatedAt).toLocaleTimeString()}
            </span>
            <span className="flex shrink-0 gap-2">
              {settings?.vaultPath && (
                <button
                  onClick={() => setDecisionOpen(true)}
                  title="Record a design decision in the vault's Decisions.md for this game"
                  className="rounded-md border border-neutral-800 px-3 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-300"
                >
                  Log decision
                </button>
              )}
              <button
                onClick={refresh}
                className="rounded-md border border-neutral-800 px-3 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-300"
              >
                Refresh
              </button>
            </span>
          </footer>
        </div>
      )}

      <TeamNote gameId={game.id} />

      <AgentsSection game={game} />

      {decisionOpen && (
        <DecisionModal
          onClose={() => setDecisionOpen(false)}
          onSave={async (title, body) => {
            await window.bridge.logDecision(game.id, title, body)
            setDecisionOpen(false)
            setActionInfo('Decision logged to the vault.')
          }}
        />
      )}
    </div>
  )
}

function DecisionModal({
  onClose,
  onSave
}: {
  onClose: () => void
  onSave: (title: string, body: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave(title.trim(), body)
    } catch (err) {
      setError(cleanIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-neutral-100">Log a decision</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Appends to this game&apos;s Decisions.md in the vault.
        </p>
        <div className="mt-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Decision title"
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Why? Context, alternatives considered, consequences…"
            className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-emerald-600"
          />
        </div>
        {error && (
          <p className="mt-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!title.trim() || busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save decision'}
          </button>
        </div>
      </div>
    </div>
  )
}
