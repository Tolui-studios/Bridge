import { useState } from 'react'
import type { Game } from '@shared/types'
import { progressOf } from '@shared/goalsParser'
import { useGoals } from '../hooks/useGoals'
import ProgressBar from './ProgressBar'
import Checklist from './Checklist'

interface Props {
  game: Game
  onEdit: () => void
  onRemove: () => void
}

export default function GamePanel({ game, onEdit, onRemove }: Props) {
  const { state, refresh, createTemplate } = useGoals(game.id)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

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
            onClick={onEdit}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800"
          >
            Edit
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
          {state.doc.goal && (
            <blockquote className="border-l-4 border-emerald-500/60 pl-4 text-lg text-neutral-300">
              {state.doc.goal}
            </blockquote>
          )}
          {state.doc.phase && (
            <span className="inline-block rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-300">
              Phase: {state.doc.phase}
            </span>
          )}
          <ProgressBar progress={progressOf(state.doc)} />
          <Checklist items={state.doc.items} />
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
