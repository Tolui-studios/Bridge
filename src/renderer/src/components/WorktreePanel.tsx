import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentSessionSummary,
  ChangedFile,
  Game,
  GameWorktreeChanges,
  GitRepoStatus,
  WorktreeRow
} from '@shared/types'
import { computeOverlap, type OverlapSource } from '@shared/worktreeOverlap'
import { cleanIpcError } from '../lib/ipcError'
import { samePathIsh } from '../lib/paths'
import { useRojo } from '../hooks/useRojo'

/** Overlap-source key for the repo checkout itself (never a real path). */
const MAIN_KEY = 'main'
/** Keep long expanded file lists from tanking the renderer. */
const MAX_RENDERED_FILES = 200
const MAX_BANNER_FILES = 8

const STATUS_STYLE: Record<ChangedFile['status'], string> = {
  A: 'text-emerald-400',
  M: 'text-neutral-400',
  D: 'text-red-400',
  R: 'text-sky-400',
  '?': 'text-neutral-500'
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/)[0].trim()
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

/** Same normalization as computeOverlap, for looking up its results. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function useWorktreeData(gameId: string): {
  rows: WorktreeRow[]
  changes: GameWorktreeChanges | null
  sessions: AgentSessionSummary[]
  status: GitRepoStatus | null
  refresh: () => void
} {
  const [rows, setRows] = useState<WorktreeRow[]>([])
  const [changes, setChanges] = useState<GameWorktreeChanges | null>(null)
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [status, setStatus] = useState<GitRepoStatus | null>(null)

  const refresh = useCallback((): void => {
    window.bridge
      .listWorktrees(gameId)
      .then(setRows)
      .catch(() => setRows([]))
    window.bridge
      .worktreeChanges(gameId)
      .then(setChanges)
      .catch(() => {})
    window.bridge
      .listAgentSessions(gameId)
      .then(setSessions)
      .catch(() => {})
    window.bridge
      .gitStatus(gameId)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [gameId])

  useEffect(() => {
    setRows([])
    setChanges(null)
    setSessions([])
    setStatus(null)
    refresh()

    // Same focus+timer backstop as RepoBar (agents commit underneath us), plus
    // agent status events — those fire exactly when a worktree is claimed or
    // released. Debounced because status also fires on mode/model changes.
    const onFocus = (): void => refresh()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(refresh, 15_000)
    let debounce: number | undefined
    const unsubscribe = window.bridge.onAgentEvent((event) => {
      if (event.type !== 'status' || event.session.gameId !== gameId) return
      const session = event.session
      setSessions((prev) => {
        const index = prev.findIndex((s) => s.id === session.id)
        if (index === -1) return [session, ...prev]
        const next = prev.slice()
        next[index] = session
        return next
      })
      window.clearTimeout(debounce)
      debounce = window.setTimeout(refresh, 1_500)
    })
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
      window.clearTimeout(debounce)
      unsubscribe()
    }
  }, [gameId, refresh])

  return { rows, changes, sessions, status, refresh }
}

/**
 * The game's worktrees: who holds each one, what files each has changed, and
 * — the point of the panel — which files two or more trees are touching at
 * once. Those are merge conflicts in the making, surfaced while the agents
 * are still running instead of at PR-merge time on GitHub.
 */
export default function WorktreePanel({ game }: { game: Game }) {
  const rojoStatus = useRojo(game.id)
  const { rows, changes, sessions, status, refresh } = useWorktreeData(game.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forcePath, setForcePath] = useState<string | null>(null)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)

  const overlap = useMemo(() => {
    if (!changes) return computeOverlap([])
    const sources: OverlapSource[] = []
    if (changes.main && changes.main.files.length > 0) {
      sources.push({ key: MAIN_KEY, files: changes.main.files.map((f) => f.path) })
    }
    for (const w of changes.worktrees) {
      sources.push({ key: w.path, files: w.files.map((f) => f.path) })
    }
    return computeOverlap(sources)
  }, [changes])

  /** Conflicted files per source, keyed slash/case-insensitively. */
  const conflictsByKey = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const [key, files] of Object.entries(overlap.byKey)) map.set(normPath(key), files)
    return map
  }, [overlap])

  if (!changes?.isRepo) return null

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

  /** Best-known session for a worktree: the live holder, else the newest past run there. */
  const sessionFor = (row: WorktreeRow): AgentSessionSummary | null => {
    if (row.sessionId) {
      const live = sessions.find((s) => s.id === row.sessionId)
      if (live) return live
    }
    return (
      sessions
        .filter((s) => samePathIsh(s.cwd, row.path))
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    )
  }

  const labelFor = (key: string): string => {
    if (key === MAIN_KEY) return 'main checkout'
    const row = rows.find((r) => samePathIsh(r.path, key))
    const name = row?.name ?? basename(key)
    const session = row ? sessionFor(row) : null
    return session ? `${name} (“${firstLine(session.task)}”)` : name
  }

  const conflictEntries = Object.entries(overlap.byFile)
  const mainConflicted = conflictsByKey.has(normPath(MAIN_KEY))
  const mainDirtyCount = changes.main?.files.length ?? 0

  return (
    <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Worktrees ({rows.length})
        </h3>
        {mainDirtyCount > 0 && (
          <span
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] ${
              mainConflicted
                ? 'border-amber-800/60 bg-amber-950/30 text-amber-300'
                : 'border-neutral-700 bg-neutral-900 text-neutral-400'
            }`}
            title={
              `Uncommitted in the repo checkout:\n` +
              (changes.main?.files ?? [])
                .slice(0, 12)
                .map((f) => f.path)
                .join('\n') +
              (mainDirtyCount > 12 ? `\n+${mainDirtyCount - 12} more` : '')
            }
          >
            main checkout: {mainDirtyCount} uncommitted{changes.main?.truncated ? '+' : ''}
          </span>
        )}
      </div>

      {conflictEntries.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2">
          <p className="text-xs font-medium text-amber-300">
            ⚠ {conflictEntries.length} file{conflictEntries.length > 1 ? 's' : ''} touched by more
            than one working tree — whoever merges second will conflict with (or silently override)
            the first:
          </p>
          <ul className="mt-1 space-y-0.5">
            {conflictEntries.slice(0, MAX_BANNER_FILES).map(([file, holders]) => (
              <li key={file} className="font-mono text-[11px] text-amber-300/80">
                {overlap.display[file] ?? file}
                <span className="text-amber-500/70"> — {holders.map(labelFor).join(' + ')}</span>
              </li>
            ))}
            {conflictEntries.length > MAX_BANNER_FILES && (
              <li className="text-[11px] text-amber-500/70">
                +{conflictEntries.length - MAX_BANNER_FILES} more
              </li>
            )}
          </ul>
        </div>
      )}

      {(message || error) && (
        <p
          className={`mt-2 whitespace-pre-wrap break-words font-mono text-[11px] ${error ? 'text-red-400' : 'text-neutral-500'}`}
          title={error ?? message ?? ''}
        >
          {error ?? message}
        </p>
      )}

      <ul className="mt-3 space-y-1">
        {rows.length === 0 && (
          <li className="text-[11px] text-neutral-600">
            No worktrees yet — launching an agent creates one.
          </li>
        )}
        {rows.map((worktree) => {
          const serving =
            Boolean(rojoStatus?.running) && samePathIsh(rojoStatus?.targetPath, worktree.path)
          const session = sessionFor(worktree)
          const changeSet = changes.worktrees.find((w) => samePathIsh(w.path, worktree.path))
          const fileCount = changeSet?.files.length ?? 0
          const rowConflicts = conflictsByKey.get(normPath(worktree.path)) ?? []
          const expanded = expandedPath !== null && samePathIsh(expandedPath, worktree.path)
          return (
            <li key={worktree.path}>
              <div
                className={`flex items-center gap-2.5 rounded px-1 py-1 ${serving ? 'bg-emerald-950/20' : ''}`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${worktree.inUse ? 'bg-amber-400' : 'bg-neutral-700'}`}
                  title={
                    worktree.inUse
                      ? `In use by a live agent${session ? `: ${firstLine(session.task)}` : ''}`
                      : session
                        ? `Free — leftover from: ${firstLine(session.task)}`
                        : 'Free'
                  }
                />
                <span className="font-mono text-[11px] text-neutral-300">{worktree.name}</span>
                {session && (
                  <span
                    className="max-w-40 shrink-0 truncate rounded border border-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-500"
                    title={session.task}
                  >
                    {firstLine(session.task)}
                  </span>
                )}
                {serving && (
                  <span
                    className="shrink-0 text-[10px] text-emerald-400"
                    title={`rojo serve is pointed at this worktree on :${rojoStatus?.port}`}
                  >
                    ● :{rojoStatus?.port}
                  </span>
                )}
                {worktree.branch && (
                  <span
                    className="truncate font-mono text-[10px] text-neutral-600"
                    title={worktree.branch}
                  >
                    {worktree.branch}
                  </span>
                )}
                <span
                  className={`shrink-0 text-[10px] ${worktree.ahead > 0 ? 'text-emerald-500' : 'text-neutral-700'}`}
                  title={
                    worktree.ahead > 0
                      ? `${worktree.ahead} commit${worktree.ahead > 1 ? 's' : ''} not on ${status?.branch ?? 'the base branch'}`
                      : 'Identical to the base branch — nothing to PR'
                  }
                >
                  {worktree.ahead > 0 ? `+${worktree.ahead}` : '—'}
                </span>
                <button
                  onClick={() => setExpandedPath(expanded ? null : worktree.path)}
                  disabled={fileCount === 0}
                  title={
                    fileCount === 0
                      ? 'No files changed vs the base branch'
                      : `${fileCount}${changeSet?.truncated ? '+' : ''} changed file${fileCount > 1 ? 's' : ''} — click to ${expanded ? 'collapse' : 'list them'}`
                  }
                  className="shrink-0 rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 disabled:cursor-default disabled:hover:border-neutral-800 disabled:hover:text-neutral-500"
                >
                  {fileCount}
                  {changeSet?.truncated ? '+' : ''} file{fileCount === 1 ? '' : 's'} {expanded ? '▾' : '▸'}
                </button>
                {rowConflicts.length > 0 && (
                  <span
                    className="shrink-0 rounded border border-amber-800/60 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-300"
                    title={`Also being changed elsewhere:\n${rowConflicts
                      .map((f) => overlap.display[f] ?? f)
                      .join('\n')}`}
                  >
                    ⚠ {rowConflicts.length} shared
                  </span>
                )}
                <span className="ml-auto flex shrink-0 gap-1.5">
                  <button
                    onClick={() =>
                      act(`test-${worktree.path}`, async () => {
                        const result = await window.bridge.rojoOpenBuild(game.id, worktree.path)
                        return [
                          `Serving ${result.status.targetLabel ?? worktree.name} on :${result.status.port} — hit Connect in Studio.`,
                          ...result.notes.filter((n) => !n.startsWith('Now serving'))
                        ].join(' ')
                      })
                    }
                    disabled={busy !== null || serving}
                    title="Swap rojo serve to this worktree (and open it in VS Code) to test the agent's work in Studio"
                    className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300 disabled:opacity-40"
                  >
                    {busy === `test-${worktree.path}` ? 'Serving…' : serving ? 'Serving' : 'Test'}
                  </button>
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
                  {worktree.branch && status?.webUrl && (
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
              </div>
              {expanded && changeSet && (
                <ul className="mb-1 ml-5 mt-0.5 space-y-px border-l border-neutral-800/60 pl-3">
                  {changeSet.files.slice(0, MAX_RENDERED_FILES).map((file) => {
                    const holders = overlap.byFile[normPath(file.path)]
                    return (
                      <li
                        key={file.path}
                        className={`flex items-baseline gap-2 font-mono text-[10px] ${holders ? 'text-amber-300' : 'text-neutral-500'}`}
                        title={
                          holders
                            ? `Also touched by ${holders
                                .filter((h) => !samePathIsh(h, worktree.path))
                                .map(labelFor)
                                .join(' + ')}`
                            : undefined
                        }
                      >
                        <span className={`w-3 shrink-0 ${STATUS_STYLE[file.status]}`}>
                          {file.status}
                        </span>
                        <span className="truncate">{file.path}</span>
                        {file.uncommitted && (
                          <span className="shrink-0 text-neutral-600">· uncommitted</span>
                        )}
                        {holders && <span className="shrink-0 text-amber-500">⚠</span>}
                      </li>
                    )
                  })}
                  {changeSet.files.length > MAX_RENDERED_FILES && (
                    <li className="text-[10px] text-neutral-600">
                      +{changeSet.files.length - MAX_RENDERED_FILES} more files
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
