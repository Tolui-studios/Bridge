import { useState } from 'react'
import type { Game, GameDeleteTargets } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

/**
 * Deleting a game reaches outside Bridge and none of it can be undone, so the
 * dialog is deliberately awkward: every target is off by default, each says
 * exactly what it destroys, and the button stays dead until the game's name is
 * typed. Nothing here should be doable by muscle memory.
 */
export default function DeleteGameModal({
  game,
  onClose,
  onDeleted
}: {
  game: Game
  onClose: () => void
  onDeleted: (message: string) => void
}) {
  const [targets, setTargets] = useState<GameDeleteTargets>({
    local: false,
    github: false,
    team: false
  })
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = typed.trim() === game.name
  const anyTarget = targets.local || targets.github || targets.team

  const run = (): void => {
    setBusy(true)
    setError(null)
    window.bridge
      .deleteGame(game.id, targets)
      .then(onDeleted)
      .catch((err) => {
        setError(cleanIpcError(err))
        setBusy(false)
      })
  }

  const row = (
    key: keyof GameDeleteTargets,
    label: string,
    detail: string
  ): React.ReactElement => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-neutral-800 px-3 py-2 hover:border-neutral-700">
      <input
        type="checkbox"
        checked={targets[key]}
        onChange={(e) => setTargets((prev) => ({ ...prev, [key]: e.target.checked }))}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-red-500"
      />
      <span className="min-w-0">
        <span className="block text-xs text-neutral-200">{label}</span>
        <span className="block break-words text-[10px] leading-relaxed text-neutral-500">
          {detail}
        </span>
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-red-900/60 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-red-300">Delete “{game.name}”</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
          Bridge always forgets this game. Tick anything else you also want destroyed — none of it
          can be undone.
        </p>

        <div className="mt-4 space-y-2">
          {row('local', 'Local files', `${game.repoPath} and its worktrees — permanently deleted from this machine.`)}
          {row('github', 'GitHub repository', 'Deletes the remote repo, including all branches, PRs and issues. Teammates lose it too.')}
          {row('team', 'Team server data', 'Goals, the team note, and mirrored session history for every teammate.')}
        </div>

        <label className="mt-4 block">
          <span className="text-[11px] text-neutral-400">
            Type <span className="font-mono text-neutral-200">{game.name}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-red-700"
          />
        </label>

        {error && <p className="mt-2 whitespace-pre-wrap break-words text-[11px] text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={run}
            disabled={!confirmed || busy}
            title={
              confirmed
                ? undefined
                : 'Type the game name exactly to enable this'
            }
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40"
          >
            {busy ? 'Deleting…' : anyTarget ? 'Delete permanently' : 'Remove from Bridge'}
          </button>
        </div>
      </div>
    </div>
  )
}
