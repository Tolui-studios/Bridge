import { useCallback, useEffect, useState } from 'react'
import type { Game, GitRepoStatus } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

function timeAgo(epochMs: number): string {
  const mins = Math.round((Date.now() - epochMs) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Git controls for a game: branch/ahead-behind/dirty, Pull, org placement. */
export default function RepoBar({ game }: { game: Game }) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback((): void => {
    window.bridge
      .gitStatus(game.id)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [game.id])

  useEffect(() => {
    setStatus(null)
    setMessage(null)
    setError(null)
    refresh()

    // Git state changes underneath us constantly — agents commit, the operator
    // edits in VS Code, Wally drops packages in. Without this the counts are
    // whatever they were when the panel mounted, which reads as "the numbers
    // are wrong". Refresh on focus (cheap, covers alt-tabbing back from an
    // editor) and on a slow timer as a backstop.
    const onFocus = (): void => refresh()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(refresh, 15_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [refresh])

  if (!status?.isRepo) return null

  const act = (label: string, action: () => Promise<string | void>): void => {
    setBusy(label)
    setError(null)
    setMessage(null)
    action()
      .then((result) => {
        if (typeof result === 'string') setMessage(result)
        refresh()
      })
      .catch((err) => setError(cleanIpcError(err)))
      .finally(() => setBusy(null))
  }

  return (
    <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-xs text-neutral-300">⎇ {status.branch ?? '(no branch)'}</span>
        {status.hasUpstream && (
          <span className="text-[11px] tabular-nums text-neutral-500">
            <span className={status.ahead > 0 ? 'text-amber-300' : ''}>↑{status.ahead}</span>{' '}
            <span className={status.behind > 0 ? 'text-sky-300' : ''}>↓{status.behind}</span>
          </span>
        )}
        {status.dirtyFiles > 0 && (
          <span className="text-[11px] text-amber-400/90">{status.dirtyFiles} uncommitted</span>
        )}
        {status.inStudioOrg === false && (
          <button
            onClick={() => act('move-org', () => window.bridge.moveToOrg(game.id))}
            disabled={busy !== null}
            title={`Origin is ${status.remoteUrl} — outside the studio org, so teammates can't see it. Click to create the org repo, repoint origin, and push.`}
            className="rounded-md border border-amber-800 px-2.5 py-0.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-950/40 disabled:opacity-40"
          >
            {busy === 'move-org' ? 'Moving…' : 'personal repo — Move to studio org'}
          </button>
        )}
        <span className="text-[11px] text-neutral-600">
          {status.lastPulledAt ? `pulled ${timeAgo(status.lastPulledAt)}` : 'never pulled'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={() => act('pull', () => window.bridge.gitPull(game.id))}
            disabled={busy !== null}
            title="git pull --ff-only"
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 disabled:opacity-40"
          >
            {busy === 'pull' ? 'Pulling…' : 'Pull'}
          </button>
        </span>
      </div>

      {(message || error) && (
        <p
          className={`mt-2 whitespace-pre-wrap break-words font-mono text-[11px] ${error ? 'text-red-400' : 'text-neutral-500'}`}
          title={error ?? message ?? ''}
        >
          {error ?? message}
        </p>
      )}
    </div>
  )
}
