import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ChangedFile,
  Game,
  GameWorktreeChanges,
  WorktreeChangeSet,
  WorktreeRow
} from '@shared/types'
import { ensureGeneratedIgnored } from './gitOps'

const execFileAsync = promisify(execFile)
const MAX_SLOTS = 32
/** Caps every changed-file list so IPC payloads and render cost stay bounded. */
const MAX_CHANGED_FILES = 400

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

  /**
   * Serializes every pool mutation. Agent launches fire concurrently, and an
   * unserialized acquire is a TOCTOU race: two sessions pass the pristine
   * check on the same worktree before either claims it, and the second's
   * `reset --hard` erases the first agent's in-flight work.
   */
  private chain: Promise<unknown> = Promise.resolve()

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => {})
    return next
  }

  acquire(game: Game, sessionId: string): Promise<WorktreeLease> {
    return this.serialize(() => this.acquireLocked(game, sessionId))
  }

  private async acquireLocked(game: Game, sessionId: string): Promise<WorktreeLease> {
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

    // Prune costs a git spawn and the common launch has nothing to prune —
    // only pay for it when a registered worktree has vanished from disk.
    let existing = await this.list(game.repoPath)
    if (existing.some((w) => isUnder(w.path, game.worktreeRoot) && !fs.existsSync(w.path))) {
      await this.git(game.repoPath, ['worktree', 'prune'])
      existing = await this.list(game.repoPath)
    }
    const underRoot = existing.filter((w) => isUnder(w.path, game.worktreeRoot))

    // Only a PRISTINE worktree may be reused. A worktree that still holds the
    // previous agent's uncommitted changes or unmerged commits is left alone
    // and a fresh slot is allocated instead — otherwise the next agent starts
    // on top of work it never did, and that work is at risk of being lost.
    const candidates = underRoot.filter(
      (w) => !this.inUse.has(normalize(w.path)) && fs.existsSync(w.path)
    )
    const states = await Promise.all(
      candidates.map((c) => this.reuseState(c.path, game.defaultBranch))
    )
    const index = states.findIndex((state) => state !== 'not-reusable')
    if (index >= 0) {
      const free = candidates[index]
      if (states[index] === 'behind') {
        // Safe: pristine means nothing to lose, and it stops the agent from
        // starting on a base branch that has moved on since this was created.
        try {
          await this.git(free.path, ['reset', '--hard', game.defaultBranch])
        } catch {
          // Non-fatal: worst case the agent starts from a slightly older base.
        }
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
          // Branch left over from a removed worktree. Only recycle it when it
          // holds no work of its own — checking out an old tip would hand this
          // agent the previous agent's unmerged commits (bypassing the
          // pristine check), and its next commit would bury them.
          if (!(await this.isAncestor(game.repoPath, branch, game.defaultBranch))) continue
          await this.git(game.repoPath, ['branch', '-D', branch])
          await this.git(game.repoPath, ['worktree', 'add', dir, '-b', branch, game.defaultBranch])
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
   * Reusability of a worktree, cheapest checks first and in parallel:
   * - `current`: clean tree, HEAD already equals the base tip — reusable
   *   as-is, no reset needed.
   * - `behind`: clean tree but on an older base commit — reusable after a
   *   `reset --hard` catches it up.
   * - `not-reusable`: dirty, ahead of base (unmerged agent commits), or
   *   unreadable — never handed to a new agent, its work is at risk.
   */
  private async reuseState(
    worktreePath: string,
    defaultBranch: string
  ): Promise<'current' | 'behind' | 'not-reusable'> {
    try {
      const headsPromise = this.git(worktreePath, ['rev-parse', 'HEAD', defaultBranch]).catch(
        () => null
      )
      const { stdout: dirty } = await this.git(worktreePath, ['status', '--porcelain'])
      if (dirty.trim() !== '') return 'not-reusable'
      const heads = await headsPromise
      if (heads) {
        const lines = heads.stdout.trim().split(/\r?\n/)
        if (lines.length >= 2 && lines[0] === lines[1]) return 'current'
      }
      return (await this.aheadOfBase(worktreePath, defaultBranch)) === 0
        ? 'behind'
        : 'not-reusable'
    } catch {
      return 'not-reusable'
    }
  }

  release(sessionId: string): void {
    for (const [key, holder] of this.inUse) {
      if (holder === sessionId) this.inUse.delete(key)
    }
  }

  /**
   * Re-lease one SPECIFIC directory for a resumed session — the SDK's
   * conversation transcript is keyed by the dir the session ran in, so a
   * resume cannot take whatever the pool hands out. No `reset --hard` and no
   * pristine check: the leftover state IS the point. Serialized with
   * acquire/remove so the dir can't be claimed or reset mid-check.
   */
  acquireAt(game: Game, sessionId: string, dir: string): Promise<WorktreeLease> {
    return this.serialize(() => this.acquireAtLocked(game, sessionId, dir))
  }

  private async acquireAtLocked(
    game: Game,
    sessionId: string,
    dir: string
  ): Promise<WorktreeLease> {
    const resolved = path.resolve(dir)
    if (normalize(resolved) === normalize(game.repoPath)) {
      // The original run fell back to the repo dir (non-git game, or the
      // worktree setup failed) — resume there too. Not an exclusive lease,
      // same as the original fallback.
      return {
        path: game.repoPath,
        branch: null,
        created: false,
        note: 'resuming directly in the game folder'
      }
    }
    if (!isUnder(resolved, game.worktreeRoot)) {
      throw new Error('That session’s workspace is not one of this game’s worktrees.')
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(
        'This session’s worktree no longer exists on disk, so it cannot be resumed.'
      )
    }
    if (this.inUse.has(normalize(resolved))) {
      throw new Error('That worktree is busy with another agent session.')
    }
    this.inUse.set(normalize(resolved), sessionId)
    this.propagateLocalClaudeMd(game.repoPath, resolved)
    return { path: resolved, branch: null, created: false, note: null }
  }

  /** Worktrees under this game's worktreeRoot, with live-usage flags. */
  async listWithUsage(game: Game): Promise<WorktreeRow[]> {
    if (!fs.existsSync(path.join(game.repoPath, '.git'))) return []
    await this.git(game.repoPath, ['worktree', 'prune'])
    const existing = await this.list(game.repoPath)
    const mine = existing.filter((w) => isUnder(w.path, game.worktreeRoot) && fs.existsSync(w.path))
    return Promise.all(
      mine.map(async (w) => {
        const holder = this.inUse.get(normalize(w.path)) ?? null
        return {
          path: w.path,
          name: path.basename(w.path),
          branch: w.branch,
          inUse: holder !== null,
          sessionId: holder,
          ahead: await this.aheadOfBase(w.path, game.defaultBranch)
        }
      })
    )
  }

  /**
   * Every file each of this game's working trees touches — the worktrees
   * (committed-vs-base plus uncommitted) and the main checkout (uncommitted
   * only; committed-vs-base is meaningless on the base itself). Read-only by
   * design: no prune, so the 15s UI poll never races the serialized mutators.
   */
  async changesForGame(game: Game): Promise<GameWorktreeChanges> {
    const fetchedAt = Date.now()
    if (!fs.existsSync(path.join(game.repoPath, '.git'))) {
      return { gameId: game.id, isRepo: false, main: null, worktrees: [], fetchedAt }
    }
    const existing = await this.list(game.repoPath)
    const mine = existing.filter((w) => isUnder(w.path, game.worktreeRoot) && fs.existsSync(w.path))
    const [main, ...worktrees] = await Promise.all([
      this.changedFiles(game.repoPath, game.defaultBranch, false).then((set) => ({
        path: game.repoPath,
        branch: game.defaultBranch,
        ...set
      })),
      ...mine.map((w) =>
        this.changedFiles(w.path, game.defaultBranch, true).then((set) => ({
          path: w.path,
          branch: w.branch,
          ...set
        }))
      )
    ])
    return { gameId: game.id, isRepo: true, main, worktrees, fetchedAt }
  }

  /**
   * Files this working dir touches: committed diff against the merge-base
   * with the base branch (three-dot, so a base that moved on never pollutes
   * the list) plus uncommitted working-tree changes, deduped by path. When
   * both exist for one path the committed status letter wins and
   * `uncommitted` is set. Degrades to uncommitted-only if the base diff fails
   * (renamed base, detached edge cases) — same spirit as aheadOfBase.
   */
  private async changedFiles(
    dirPath: string,
    baseBranch: string,
    includeCommitted: boolean
  ): Promise<Omit<WorktreeChangeSet, 'path' | 'branch'>> {
    let committed: ChangedFile[] = []
    if (includeCommitted) {
      try {
        const { stdout } = await this.git(dirPath, [
          'diff',
          '--name-status',
          '-z',
          `${baseBranch}...HEAD`
        ])
        committed = parseNameStatusZ(stdout)
      } catch {
        // Unknown base — the uncommitted list below still tells the story.
      }
    }
    let uncommitted: ChangedFile[] = []
    try {
      const { stdout } = await this.git(dirPath, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all'
      ])
      uncommitted = parseStatusPorcelainZ(stdout)
    } catch {
      // Unreadable tree: report whatever the committed diff found.
    }
    const byPath = new Map<string, ChangedFile>()
    for (const file of committed) byPath.set(file.path, file)
    for (const file of uncommitted) {
      const prior = byPath.get(file.path)
      byPath.set(file.path, prior ? { ...prior, uncommitted: true } : file)
    }
    const all = [...byPath.values()]
    return { files: all.slice(0, MAX_CHANGED_FILES), truncated: all.length > MAX_CHANGED_FILES }
  }

  /** True when `branch` has no commits that `base` lacks (merged or identical). */
  private async isAncestor(repoPath: string, branch: string, base: string): Promise<boolean> {
    try {
      await this.git(repoPath, ['merge-base', '--is-ancestor', branch, base])
      return true
    } catch {
      return false
    }
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
  remove(game: Game, worktreePath: string, force: boolean): Promise<void> {
    // Same pool as acquire: a remove landing between another launch's
    // candidate scan and its claim is the same race, so it takes the chain.
    return this.serialize(() => this.removeLocked(game, worktreePath, force))
  }

  private async removeLocked(game: Game, worktreePath: string, force: boolean): Promise<void> {
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

/**
 * Parse `git diff --name-status -z` output: NUL-separated [status, path]
 * pairs, except renames/copies which are [R…|C…, oldPath, newPath] triples —
 * the NEW path is what the tree contains, so that one is kept.
 */
export function parseNameStatusZ(raw: string): ChangedFile[] {
  const tokens = raw.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i + 1 < tokens.length; ) {
    const code = tokens[i]
    if (code === '') break
    if (code[0] === 'R' || code[0] === 'C') {
      const newPath = tokens[i + 2]
      if (newPath === undefined) break
      files.push({ path: newPath, status: code[0] === 'R' ? 'R' : 'A', uncommitted: false })
      i += 3
    } else {
      const letter = code[0]
      files.push({
        path: tokens[i + 1],
        status: letter === 'A' || letter === 'D' ? letter : 'M',
        uncommitted: false
      })
      i += 2
    }
  }
  return files
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` output:
 * NUL-separated `XY path` entries; a rename/copy in X carries the OLD path as
 * one extra NUL token, consumed and dropped. Everything here is by
 * definition uncommitted.
 */
export function parseStatusPorcelainZ(raw: string): ChangedFile[] {
  const tokens = raw.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const filePath = entry.slice(3)
    let status: ChangedFile['status']
    if (x === '?') {
      status = '?'
    } else {
      const code = y !== ' ' ? y : x
      status = code === 'A' || code === 'D' || code === 'M' || code === 'R' ? code : 'M'
    }
    files.push({ path: filePath, status, uncommitted: true })
    if (x === 'R' || x === 'C') i++
  }
  return files
}
