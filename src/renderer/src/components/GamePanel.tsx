import { useCallback, useState } from 'react'
import type { Game, GoalsMutation } from '@shared/types'
import { progressOf } from '@shared/goalsParser'
import { useGoals } from '../hooks/useGoals'
import { cleanIpcError } from '../lib/ipcError'
import ProgressBar from './ProgressBar'
import Checklist from './Checklist'
import EditableText from './EditableText'

interface Props {
  game: Game
  onEdit: () => void
  onRemove: () => void
}

export default function GamePanel({ game, onEdit, onRemove }: Props) {
  const { state, refresh, createTemplate, mutate } = useGoals(game.id)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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
          <footer className="flex items-center justify-between border-t border-neutral-900 pt-4">
            <span className="truncate font-mono text-[10px] text-neutral-700" title={state.path}>
              {state.path} · read {new Date(state.updatedAt).toLocaleTimeString()}
            </span>
            <button
              onClick={refresh}
              className="shrink-0 rounded-md border border-neutral-800 px-3 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-300"
            >
              Refresh
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
