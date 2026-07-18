import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AddGameInput, Game, GameMutationResult } from '@shared/types'
import { cleanIpcError } from '../lib/ipcError'

interface Props {
  /** null = add mode; a Game = edit mode. */
  initial: Game | null
  onClose: () => void
  onSubmit: (value: AddGameInput | Game) => Promise<GameMutationResult>
  /** Create-new-game flow (folder + git init + org repo); absent in edit mode. */
  onCreate?: (name: string) => Promise<GameMutationResult>
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

export default function AddGameModal({ initial, onClose, onSubmit, onCreate }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [repoPath, setRepoPath] = useState(initial?.repoPath ?? '')
  const [defaultBranch, setDefaultBranch] = useState(initial?.defaultBranch ?? 'main')
  const [worktreeRoot, setWorktreeRoot] = useState(initial?.worktreeRoot ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedWarnings, setSavedWarnings] = useState<string[] | null>(null)
  const [mode, setMode] = useState<'create' | 'existing'>('create')

  const editing = initial !== null
  const creating = !editing && mode === 'create' && onCreate !== undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const browse = async (): Promise<void> => {
    const picked = await window.bridge.pickFolder()
    if (!picked) return
    setRepoPath(picked)
    if (!name.trim()) setName(basename(picked))
    if (!worktreeRoot.trim()) setWorktreeRoot(`${picked}-worktrees`)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      let result: GameMutationResult
      if (creating) {
        result = await onCreate(name)
      } else {
        const value: AddGameInput | Game = editing
          ? { ...(initial as Game), name, repoPath, defaultBranch, worktreeRoot }
          : { name, repoPath, defaultBranch, worktreeRoot }
        result = await onSubmit(value)
      }
      if (result.warnings.length > 0) {
        setSavedWarnings(result.warnings)
      } else {
        onClose()
      }
    } catch (err) {
      setError(cleanIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = creating ? name.trim().length > 0 : name.trim().length > 0 || !editing

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        {savedWarnings ? (
          <>
            <h3 className="text-lg font-semibold text-neutral-100">Game saved</h3>
            <ul className="mt-4 space-y-2">
              {savedWarnings.map((warning, i) => (
                <li
                  key={i}
                  className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300"
                >
                  {warning}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-neutral-100">
              {editing ? 'Edit game' : 'Add game'}
            </h3>
            {!editing && onCreate && (
              <div className="mt-3 flex gap-1 rounded-lg bg-neutral-950 p-1">
                <button
                  onClick={() => setMode('create')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    mode === 'create'
                      ? 'bg-neutral-800 text-neutral-100'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Create new game
                </button>
                <button
                  onClick={() => setMode('existing')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    mode === 'existing'
                      ? 'bg-neutral-800 text-neutral-100'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Add existing project
                </button>
              </div>
            )}
            <div className="mt-5 space-y-4">
              {creating ? (
                <>
                  <Field label="Name">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Kingdom of Ash"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && name.trim()) void submit()
                      }}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-emerald-600"
                    />
                  </Field>
                  <p className="rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
                    Creates a folder in your games folder, initializes git with a starter
                    GOALS.md, and creates a private repo in the studio's GitHub org — teammates
                    will see it under Team games automatically.
                  </p>
                </>
              ) : (
                <>
                  <Field label="Repo path">
                    <div className="flex gap-2">
                      <input
                        value={repoPath}
                        onChange={(e) => setRepoPath(e.target.value)}
                        placeholder="C:\path\to\game-repo"
                        className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 outline-none focus:border-emerald-600"
                      />
                      <button
                        onClick={() => void browse()}
                        className="shrink-0 rounded-md border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
                      >
                        Browse…
                      </button>
                    </div>
                  </Field>
                  <Field label="Name">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="My Game"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-emerald-600"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Default branch">
                      <input
                        value={defaultBranch}
                        onChange={(e) => setDefaultBranch(e.target.value)}
                        placeholder="main"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 outline-none focus:border-emerald-600"
                      />
                    </Field>
                    <Field label="Worktree root">
                      <input
                        value={worktreeRoot}
                        onChange={(e) => setWorktreeRoot(e.target.value)}
                        placeholder="(auto)"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 outline-none focus:border-emerald-600"
                      />
                    </Field>
                  </div>
                  {!editing && (
                    <p className="rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
                      Projects without a GitHub remote get a private repo created in the studio
                      org and pushed automatically, so teammates can see them. Projects already
                      on GitHub are left untouched.
                    </p>
                  )}
                </>
              )}
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
                onClick={() => void submit()}
                disabled={busy || !canSubmit}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy
                  ? creating
                    ? 'Creating…'
                    : 'Saving…'
                  : creating
                    ? 'Create game'
                    : editing
                      ? 'Save changes'
                      : 'Add game'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      {children}
    </label>
  )
}
