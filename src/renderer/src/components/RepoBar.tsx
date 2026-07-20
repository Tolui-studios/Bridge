import { useCallback, useEffect, useState } from 'react'
import type { Game, GitRepoStatus, WorktreeRow } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

function timeAgo(epochMs: number): string {
  const mins = Math.round((Date.now() - epochMs) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Git controls for a game: branch/ahead-behind/dirty, Pull, worktrees + PRs. */
export default function RepoBar({ game }: { game: Game }) {
  const [status, setStatus] = useState<GitRepoStatus | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [forcePath, setForcePath] = useState<string | null>(null)

  const refresh = useCallback((): void => {
    window.bridge
      .gitStatus(game.id)
      .then(setStatus)
      .catch(() => setStatus(null))
    window.bridge
      .listWorktrees(game.id)
      .then(setWorktrees)
      .catch(() => setWorktrees([]))
  }, [game.id])

  useEffect(() => {
    setStatus(null)
    setWorktrees([])
    setMessage(null)
    setError(null)
    setShowWorktrees(false)
    refresh()
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
          <button
            onClick={() => setShowWorktrees((v) => !v)}
            className="rounded-md border border-neutral-800 px-3 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-300"
          >
            Worktrees ({worktrees.length})
          </button>
        </span>
      </div>

      {(message || error) && (
        <p className={`mt-2 truncate font-mono text-[11px] ${error ? 'text-red-400' : 'text-neutral-500'}`} title={error ?? message ?? ''}>
          {error ?? message}
        </p>
      )}

      {showWorktrees && (
        <ul className="mt-3 space-y-1 border-t border-neutral-800/60 pt-2">
          {worktrees.length === 0 && (
            <li className="text-[11px] text-neutral-600">
              No worktrees yet — launching an agent creates one.
            </li>
          )}
          {worktrees.map((worktree) => (
            <li key={worktree.path} className="flex items-center gap-2.5 rounded px-1 py-1">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${worktree.inUse ? 'bg-amber-400' : 'bg-neutral-700'}`}
                title={worktree.inUse ? 'In use by a live agent' : 'Free'}
              />
              <span className="font-mono text-[11px] text-neutral-300">{worktree.name}</span>
              {worktree.branch && (
                <span className="truncate font-mono text-[10px] text-neutral-600" title={worktree.branch}>
                  {worktree.branch}
                </span>
              )}
              <span
                className={`shrink-0 text-[10px] ${worktree.ahead > 0 ? 'text-emerald-500' : 'text-neutral-700'}`}
                title={
                  worktree.ahead > 0
                    ? `${worktree.ahead} commit${worktree.ahead > 1 ? 's' : ''} not on ${status.branch ?? 'the base branch'}`
                    : 'Identical to the base branch — nothing to PR'
                }
              >
                {worktree.ahead > 0 ? `+${worktree.ahead}` : '—'}
              </span>
              <span className="ml-auto flex shrink-0 gap-1.5">
                <button
                  onClick={() =>
                    act(`code-${worktree.path}`, () =>
                      window.bridge.openInEditor(game.id, worktree.path)
                    )
                  }
                  disabled={busy !== null}
                  title={`Open ${worktree.path} in VS Code`}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
                >
                  {busy === `code-${worktree.path}` ? 'Opening…' : 'VS Code'}
                </button>
                {worktree.branch && status.webUrl && (
                  <button
                    onClick={() =>
                      act(`pr-${worktree.path}`, async () => {
                        const url = await window.bridge.createPr(
                          game.id,
                          worktree.branch!,
                          worktree.path
                        )
                        refresh()
                        return url
                      })
                    }
                    disabled={busy !== null}
                    title="Commit any pending changes in this worktree, push the branch, and open a GitHub PR"
                    className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
                  >
                    {busy === `pr-${worktree.path}` ? 'Pushing…' : 'Create PR'}
                  </button>
                )}
                {!worktree.inUse &&
                  (forcePath === worktree.path ? (
                    <button
                      onClick={() =>
                        act(`rm-${worktree.path}`, async () => {
                          await window.bridge.removeWorktree(game.id, worktree.path, true)
                          setForcePath(null)
                        })
                      }
                      className="rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-950/40"
                    >
                      Force remove
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        act(`rm-${worktree.path}`, async () => {
                          try {
                            await window.bridge.removeWorktree(game.id, worktree.path, false)
                          } catch (err) {
                            setForcePath(worktree.path)
                            throw err
                          }
                        })
                      }
                      disabled={busy !== null}
                      title="Remove this worktree (refuses if it has uncommitted changes)"
                      className="rounded border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500 hover:border-red-900 hover:text-red-400 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
