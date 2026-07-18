import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import type { Game } from '@shared/types'

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

  async acquire(game: Game, sessionId: string): Promise<WorktreeLease> {
    if (!fs.existsSync(path.join(game.repoPath, '.git'))) {
      return {
        path: game.repoPath,
        branch: null,
        created: false,
        note: 'No git repo here — agent runs directly in the game folder (git init the repo to get worktree isolation).'
      }
    }

    await this.git(game.repoPath, ['worktree', 'prune'])
    const existing = await this.list(game.repoPath)
    const underRoot = existing.filter((w) => isUnder(w.path, game.worktreeRoot))
    const free = underRoot.find(
      (w) => !this.inUse.has(normalize(w.path)) && fs.existsSync(w.path)
    )
    if (free) {
      this.inUse.set(normalize(free.path), sessionId)
      this.propagateLocalClaudeMd(game.repoPath, free.path)
      return { path: free.path, branch: free.branch, created: false, note: null }
    }

    fs.mkdirSync(game.worktreeRoot, { recursive: true })
    const taken = new Set(existing.map((w) => normalize(w.path)))
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const dir = path.join(game.worktreeRoot, `agent-${slot}`)
      if (taken.has(normalize(dir)) || fs.existsSync(dir)) continue
      const branch = `agent-${slot}`
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
    throw new Error(`Could not allocate a worktree after ${MAX_SLOTS} attempts.`)
  }

  release(sessionId: string): void {
    for (const [key, holder] of this.inUse) {
      if (holder === sessionId) this.inUse.delete(key)
    }
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

function normalize(p: string): string {
  return path.resolve(p).toLowerCase()
}

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
