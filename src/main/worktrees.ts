import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, WorktreeRow } from '@shared/types'
import { ensureGeneratedIgnored } from './gitOps'

const execFileAsync = promisify(execFile)
const MAX_SLOTS = 32

export interface WorktreeLease {
  path: string
  branch: string | null
  created: boolean
  /** Set when the lease fell back to the repo dir instead of a worktree. */
  note: string | null
}

interface WorktreeInfo {
  path: string
  branch: string | null
}

/**
 * One agent → one worktree. Worktrees live under the game's `worktreeRoot`
 * (a sibling of the repo, never inside it), named `agent-<n>` with a matching
 * branch. Free worktrees are reused across sessions; `CLAUDE.local.md` is
 * copied in because it is gitignored and never checks out on its own.
 * Electron-free so it can be unit-tested against real git repos.
 */
export class WorktreeService {
  /** normalized worktree path -> session id currently holding it */
  private inUse = new Map<string, string>()

  /**
   * @param branchPrefix Prefix for agent branch names. Multi-user studios
   * pass a per-user prefix (e.g. `agent-tofu`) so pushed branches never
   * collide across machines. Directory names stay `agent-<n>` (local-only).
   */
  constructor(private readonly branchPrefix: string = 'agent') {}

  async acquire(game: Game, sessionId: string): Promise<WorktreeLease> {
    if (!fs.existsSync(path.join(game.repoPath, '.git'))) {
      return {
        path: game.repoPath,
        branch: null,
        created: false,
        note: 'No git repo here — agent runs directly in the game folder (git init the repo to get worktree isolation).'
      }
    }

    // Shared by every worktree, so one call keeps generated output from
    // counting as "work" in the pristine check below — and from ever being
    // swept into a commit.
    ensureGeneratedIgnored(game.repoPath)

    await this.git(game.repoPath, ['worktree', 'prune'])
    const existing = await this.list(game.repoPath)
    const underRoot = existing.filter((w) => isUnder(w.path, game.worktreeRoot))

    // Only a PRISTINE worktree may be reused. A worktree that still holds the
    // previous agent's uncommitted changes or unmerged commits is left alone
    // and a fresh slot is allocated instead — otherwise the next agent starts
    // on top of work it never did, and that work is at risk of being lost.
    let free: WorktreeInfo | null = null
    for (const candidate of underRoot) {
      if (this.inUse.has(normalize(candidate.path))) continue
      if (!fs.existsSync(candidate.path)) continue
      if (!(await this.isPristine(candidate.path, game.defaultBranch))) continue
      free = candidate
      break
    }
    if (free) {
      // Safe: pristine means nothing to lose, and it stops the agent from
      // starting on a base branch that has moved on since this was created.
      try {
        await this.git(free.path, ['reset', '--hard', game.defaultBranch])
      } catch {
        // Non-fatal: worst case the agent starts from a slightly older base.
      }
      this.inUse.set(normalize(free.path), sessionId)
      this.propagateLocalClaudeMd(game.repoPath, free.path)
      return { path: free.path, branch: free.branch, created: false, note: null }
    }

    fs.mkdirSync(game.worktreeRoot, { recursive: true })
    const taken = new Set(existing.map((w) => normalize(w.path)))
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const dir = path.join(game.worktreeRoot, `agent-${slot}`)
      if (taken.has(normalize(dir)) || fs.existsSync(dir)) continue
      const branch = `${this.branchPrefix}-${slot}`
      try {
        try {
          await this.git(game.repoPath, ['worktree', 'add', dir, '-b', branch, game.defaultBranch])
        } catch {
          // Branch already exists (from a pruned worktree) — try checking it out.
          await this.git(game.repoPath, ['worktree', 'add', dir, branch])
        }
      } catch {
        continue
      }
      this.inUse.set(normalize(dir), sessionId)
      this.propagateLocalClaudeMd(game.repoPath, dir)
      return { path: dir, branch, created: true, note: null }
    }
    throw new Error(
      `All ${MAX_SLOTS} worktree slots are taken and none are reusable — every one still holds uncommitted changes or unmerged commits. Open the Worktrees list and remove the finished ones (or merge their branches) to free a slot.`
    )
  }

  /**
   * True only when this worktree carries no work of its own: a clean tree
   * (ignored files like `Packages/` don't count) and no commits ahead of the
   * base branch. Anything unknown counts as NOT pristine, so an unreadable
   * worktree is never handed to a new agent.
   */
  private async isPristine(worktreePath: string, defaultBranch: string): Promise<boolean> {
    try {
      const { stdout: dirty } = await this.git(worktreePath, ['status', '--porcelain'])
      if (dirty.trim() !== '') return false
      return (await this.aheadOfBase(worktreePath, defaultBranch)) === 0
    } catch {
      return false
    }
  }

  release(sessionId: string): void {
    for (const [key, holder] of this.inUse) {
      if (holder === sessionId) this.inUse.delete(key)
    }
  }

  /** Worktrees under this game's worktreeRoot, with live-usage flags. */
  async listWithUsage(game: Game): Promise<WorktreeRow[]> {
    if (!fs.existsSync(path.join(game.repoPath, '.git'))) return []
    await this.git(game.repoPath, ['worktree', 'prune'])
    const existing = await this.list(game.repoPath)
    const mine = existing.filter((w) => isUnder(w.path, game.worktreeRoot) && fs.existsSync(w.path))
    return Promise.all(
      mine.map(async (w) => ({
        path: w.path,
        name: path.basename(w.path),
        branch: w.branch,
        inUse: this.inUse.has(normalize(w.path)),
        ahead: await this.aheadOfBase(w.path, game.defaultBranch)
      }))
    )
  }

  /** Commits on this worktree's branch that aren't on the base branch. */
  private async aheadOfBase(worktreePath: string, defaultBranch: string): Promise<number> {
    try {
      const { stdout } = await this.git(worktreePath, [
        'rev-list',
        '--count',
        `${defaultBranch}..HEAD`
      ])
      return Number.parseInt(stdout.trim(), 10) || 0
    } catch {
      return 0
    }
  }

  /** Remove a worktree (refuses while a live session holds it). */
  async remove(game: Game, worktreePath: string, force: boolean): Promise<void> {
    if (!isUnder(worktreePath, game.worktreeRoot)) {
      throw new Error('That path is not one of this game’s worktrees.')
    }
    if (this.inUse.has(normalize(worktreePath))) {
      throw new Error('A live agent session is using this worktree. Stop it first.')
    }
    const args = ['worktree', 'remove']
    if (force) args.push('--force')
    args.push(worktreePath)

    let last = ''
    // Windows can't delete a file another process has open. Some holders are
    // momentary (the search indexer, Defender scanning a fresh checkout), so
    // one retry clears them; an editor with the folder open never will.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.git(game.repoPath, args)
        return
      } catch (err) {
        const anyErr = err as { stderr?: string; message?: string }
        last = (anyErr.stderr || anyErr.message || 'git worktree remove failed').trim()
        if (!isLockError(last) || attempt === 1) break
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
    }

    if (isLockError(last)) {
      throw new Error(
        `Windows won't let git delete ${path.basename(worktreePath)} because something still has it open — most often VS Code (Bridge's own "VS Code" button opens worktrees), a running Rojo server, or a terminal sitting in that folder. Close it and try again.`
      )
    }
    throw new Error(last.slice(0, 300))
  }

  private async list(repoPath: string): Promise<WorktreeInfo[]> {
    const { stdout } = await this.git(repoPath, ['worktree', 'list', '--porcelain'])
    const infos: WorktreeInfo[] = []
    let current: WorktreeInfo | null = null
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) infos.push(current)
        current = { path: line.slice('worktree '.length).trim(), branch: null }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      }
    }
    if (current) infos.push(current)
    return infos
  }

  private propagateLocalClaudeMd(repoPath: string, worktreePath: string): void {
    // CLAUDE.local.md is gitignored, so a fresh worktree never receives it.
    const src = path.join(repoPath, 'CLAUDE.local.md')
    const dest = path.join(worktreePath, 'CLAUDE.local.md')
    try {
      if (fs.existsSync(src) && !fs.existsSync(dest)) fs.copyFileSync(src, dest)
    } catch {
      // Non-fatal: the agent just misses local overrides.
    }
  }

  private git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', ['-C', repoPath, ...args], { windowsHide: true })
  }
}

/** A "someone else has this file open" failure rather than a git objection. */
function isLockError(message: string): boolean {
  return /permission denied|access is denied|being used by another process|EPERM|EBUSY|resource busy/i.test(
    message
  )
}

function normalize(p: string): string {
  return path.resolve(p).toLowerCase()
}

/** Is `child` inside `parent`? Used to keep path-taking IPC calls in bounds. */
export function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
