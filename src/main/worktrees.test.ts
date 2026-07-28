import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WorktreeService, parseNameStatusZ, parseStatusPorcelainZ } from './worktrees'
import type { Game } from '@shared/types'

let root: string
let repoPath: string

function git(...args: string[]): void {
  execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' })
}

/** Slash- and case-insensitive: git prints `/`, path.join produces `\`. */
function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    name: 'Test Game',
    repoPath,
    defaultBranch: 'main',
    worktreeRoot: path.join(root, 'game-worktrees'),
    ...overrides
  }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-wt-'))
  repoPath = path.join(root, 'game')
  fs.mkdirSync(repoPath)
  execFileSync('git', ['init', '-b', 'main', repoPath], { stdio: 'pipe' })
  git('config', 'user.email', 'test@test.test')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(repoPath, 'GOALS.md'), '# Test Game — Current Goal\n')
  fs.writeFileSync(path.join(repoPath, '.gitignore'), 'CLAUDE.local.md\n')
  fs.writeFileSync(path.join(repoPath, 'CLAUDE.local.md'), 'local rules\n')
  git('add', '-A')
  git('commit', '-m', 'init')
})

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    // tmp dir cleanup is best-effort on Windows (git objects are read-only)
  }
})

describe('WorktreeService', () => {
  it('falls back to the repo dir when there is no git repo', async () => {
    const service = new WorktreeService()
    const plainDir = path.join(root, 'not-a-repo')
    fs.mkdirSync(plainDir, { recursive: true })
    const lease = await service.acquire(makeGame({ repoPath: plainDir, id: 'plain' }), 's1')
    expect(lease.path).toBe(plainDir)
    expect(lease.note).toContain('No git repo')
  })

  it('creates agent-1 with its own branch, checked-out files, and CLAUDE.local.md', async () => {
    const service = new WorktreeService()
    const game = makeGame()
    const lease = await service.acquire(game, 's1')
    expect(lease.created).toBe(true)
    expect(path.basename(lease.path)).toBe('agent-1')
    expect(lease.branch).toBe('agent-1')
    expect(fs.existsSync(path.join(lease.path, 'GOALS.md'))).toBe(true)
    expect(fs.readFileSync(path.join(lease.path, 'CLAUDE.local.md'), 'utf8')).toBe('local rules\n')
  })

  it('allocates a second worktree while the first is held, then reuses after release', async () => {
    const service = new WorktreeService()
    const game = makeGame()
    const first = await service.acquire(game, 'session-a')
    const second = await service.acquire(game, 'session-b')
    expect(path.basename(first.path)).toBe('agent-1')
    expect(path.basename(second.path)).toBe('agent-2')
    expect(second.created).toBe(true)

    service.release('session-a')
    const reused = await service.acquire(game, 'session-c')
    expect(path.basename(reused.path)).toBe('agent-1')
    expect(reused.created).toBe(false)
  })

  it('does not hand a released worktree with uncommitted changes to the next agent', async () => {
    const service = new WorktreeService()
    const game = makeGame({ id: 'dirty', worktreeRoot: path.join(root, 'dirty-worktrees') })
    const first = await service.acquire(game, 'session-a')
    fs.writeFileSync(path.join(first.path, 'work-in-progress.luau'), '-- unsaved work\n')
    service.release('session-a')

    const next = await service.acquire(game, 'session-b')
    expect(next.path).not.toBe(first.path)
    // The previous agent's work is still sitting where it was left.
    expect(fs.existsSync(path.join(first.path, 'work-in-progress.luau'))).toBe(true)
  })

  it('does not reuse a released worktree that has unmerged commits', async () => {
    const service = new WorktreeService()
    const game = makeGame({ id: 'ahead', worktreeRoot: path.join(root, 'ahead-worktrees') })
    const first = await service.acquire(game, 'session-a')
    fs.writeFileSync(path.join(first.path, 'feature.luau'), '-- done\n')
    execFileSync('git', ['-C', first.path, 'add', '-A'], { stdio: 'pipe' })
    execFileSync('git', ['-C', first.path, 'commit', '-m', 'agent work'], { stdio: 'pipe' })
    service.release('session-a')

    const next = await service.acquire(game, 'session-b')
    expect(next.path).not.toBe(first.path)
    expect(fs.existsSync(path.join(first.path, 'feature.luau'))).toBe(true)
  })

  it('resets a reused worktree that fell behind the base branch', async () => {
    const service = new WorktreeService()
    const game = makeGame({ id: 'behind', worktreeRoot: path.join(root, 'behind-worktrees') })
    const first = await service.acquire(game, 'session-a')
    service.release('session-a')

    // Base advances after the worktree was created and released.
    fs.writeFileSync(path.join(repoPath, 'NEW-FILE.md'), 'landed on main\n')
    git('add', '-A')
    git('commit', '-m', 'advance main')

    const reused = await service.acquire(game, 'session-b')
    // git reports forward-slash paths; compare resolved forms.
    expect(path.resolve(reused.path)).toBe(path.resolve(first.path))
    expect(reused.created).toBe(false)
    expect(fs.existsSync(path.join(reused.path, 'NEW-FILE.md'))).toBe(true)
  })

  it('recovers when a worktree directory was deleted out from under git', async () => {
    const service = new WorktreeService()
    const game = makeGame({ id: 'deleted', worktreeRoot: path.join(root, 'deleted-worktrees') })
    const first = await service.acquire(game, 'session-a')
    service.release('session-a')
    fs.rmSync(first.path, { recursive: true, force: true, maxRetries: 3 })

    const next = await service.acquire(game, 'session-b')
    expect(next.path).not.toBe('')
    expect(fs.existsSync(path.join(next.path, 'GOALS.md'))).toBe(true)
  })

  it('keeps worktrees outside the repo directory itself', async () => {
    const service = new WorktreeService()
    const lease = await service.acquire(makeGame(), 'session-d')
    const rel = path.relative(repoPath, lease.path)
    expect(rel.startsWith('..')).toBe(true)
  })

  it('serializes concurrent acquires so two sessions never share a worktree', async () => {
    const service = new WorktreeService('conc')
    const game = makeGame({ id: 'conc', worktreeRoot: path.join(root, 'conc-worktrees') })
    // Leave one pristine worktree behind — the racy prize both launches want.
    const seeded = await service.acquire(game, 'seed')
    service.release('seed')
    expect(fs.existsSync(seeded.path)).toBe(true)

    const [a, b] = await Promise.all([
      service.acquire(game, 'racer-a'),
      service.acquire(game, 'racer-b')
    ])
    expect(a.path).not.toBe(b.path)
  })

  it('reports the holding sessionId in listWithUsage', async () => {
    const service = new WorktreeService('owner')
    const game = makeGame({ id: 'owner', worktreeRoot: path.join(root, 'owner-worktrees') })
    const lease = await service.acquire(game, 'session-x')
    let rows = await service.listWithUsage(game)
    let row = rows.find((r) => samePath(r.path, lease.path))
    expect(row?.inUse).toBe(true)
    expect(row?.sessionId).toBe('session-x')

    service.release('session-x')
    rows = await service.listWithUsage(game)
    row = rows.find((r) => samePath(r.path, lease.path))
    expect(row?.inUse).toBe(false)
    expect(row?.sessionId).toBeNull()
  })

  it('recycles a fully merged leftover branch instead of checking out its old tip', async () => {
    const service = new WorktreeService('recycle')
    const game = makeGame({ id: 'recycle', worktreeRoot: path.join(root, 'recycle-worktrees') })
    const first = await service.acquire(game, 'session-a')
    service.release('session-a')
    // The worktree dir vanishes (OneDrive, manual delete) but the branch stays.
    git('worktree', 'remove', '--force', first.path)
    // The base moves on afterwards.
    fs.writeFileSync(path.join(repoPath, 'recycle-marker.luau'), '-- new on main\n')
    git('add', '-A')
    git('commit', '-m', 'advance main')

    const second = await service.acquire(game, 'session-b')
    expect(path.basename(second.path)).toBe(path.basename(first.path))
    expect(second.created).toBe(true)
    // Recreated from today's base, not resurrected from the old tip.
    expect(fs.existsSync(path.join(second.path, 'recycle-marker.luau'))).toBe(true)
  })

  it('skips a slot whose leftover branch still holds unmerged commits', async () => {
    const service = new WorktreeService('keepwork')
    const game = makeGame({ id: 'keepwork', worktreeRoot: path.join(root, 'keepwork-worktrees') })
    const first = await service.acquire(game, 'session-a')
    fs.writeFileSync(path.join(first.path, 'precious.luau'), '-- unmerged agent work\n')
    execFileSync('git', ['-C', first.path, 'add', '-A'], { stdio: 'pipe' })
    execFileSync('git', ['-C', first.path, 'commit', '-m', 'agent work'], { stdio: 'pipe' })
    service.release('session-a')
    git('worktree', 'remove', '--force', first.path)

    const second = await service.acquire(game, 'session-b')
    expect(path.basename(second.path)).not.toBe(path.basename(first.path))
    // The unmerged branch survives, commits intact.
    const tip = execFileSync('git', ['-C', repoPath, 'rev-parse', `${first.branch}`], {
      stdio: 'pipe'
    })
      .toString()
      .trim()
    expect(tip.length).toBeGreaterThan(0)
  })
})

describe('changed files', () => {
  it('parseNameStatusZ handles adds, modifies, deletes, and renames', () => {
    const raw = 'M\0src/a.luau\0A\0src/b.luau\0R100\0old.luau\0new.luau\0D\0gone.luau\0'
    expect(parseNameStatusZ(raw)).toEqual([
      { path: 'src/a.luau', status: 'M', uncommitted: false },
      { path: 'src/b.luau', status: 'A', uncommitted: false },
      { path: 'new.luau', status: 'R', uncommitted: false },
      { path: 'gone.luau', status: 'D', uncommitted: false }
    ])
    expect(parseNameStatusZ('')).toEqual([])
  })

  it('parseStatusPorcelainZ maps untracked, modified, staged, and renamed entries', () => {
    const raw = '?? new.luau\0 M src/a.luau\0A  staged.luau\0R  renamed.luau\0was.luau\0 D dropped.luau\0'
    expect(parseStatusPorcelainZ(raw)).toEqual([
      { path: 'new.luau', status: '?', uncommitted: true },
      { path: 'src/a.luau', status: 'M', uncommitted: true },
      { path: 'staged.luau', status: 'A', uncommitted: true },
      { path: 'renamed.luau', status: 'R', uncommitted: true },
      { path: 'dropped.luau', status: 'D', uncommitted: true }
    ])
    expect(parseStatusPorcelainZ('')).toEqual([])
  })

  it('reports committed and uncommitted files for a worktree, deduped', async () => {
    const service = new WorktreeService('changes')
    const game = makeGame({ id: 'changes', worktreeRoot: path.join(root, 'changes-worktrees') })
    const lease = await service.acquire(game, 'session-a')
    // One committed file, then touched again; one plain uncommitted edit.
    fs.writeFileSync(path.join(lease.path, 'committed.luau'), '-- v1\n')
    execFileSync('git', ['-C', lease.path, 'add', '-A'], { stdio: 'pipe' })
    execFileSync('git', ['-C', lease.path, 'commit', '-m', 'work'], { stdio: 'pipe' })
    fs.writeFileSync(path.join(lease.path, 'committed.luau'), '-- v2, uncommitted\n')
    fs.appendFileSync(path.join(lease.path, 'GOALS.md'), 'edited\n')

    const changes = await service.changesForGame(game)
    expect(changes.isRepo).toBe(true)
    const mine = changes.worktrees.find((w) => samePath(w.path, lease.path))
    expect(mine).toBeDefined()
    expect(mine?.branch).toBe(lease.branch)
    const byPath = new Map(mine?.files.map((f) => [f.path, f]))
    expect(byPath.get('committed.luau')).toEqual({
      path: 'committed.luau',
      status: 'A',
      uncommitted: true
    })
    expect(byPath.get('GOALS.md')).toEqual({ path: 'GOALS.md', status: 'M', uncommitted: true })
    service.release('session-a')
  })

  it('covers the main checkout dirty files as uncommitted-only', async () => {
    const service = new WorktreeService('mainchk')
    const game = makeGame({ id: 'mainchk', worktreeRoot: path.join(root, 'mainchk-worktrees') })
    const marker = path.join(repoPath, 'main-dirty.luau')
    fs.writeFileSync(marker, '-- operator edit\n')
    try {
      const changes = await service.changesForGame(game)
      expect(changes.main?.path).toBe(repoPath)
      const entry = changes.main?.files.find((f) => f.path === 'main-dirty.luau')
      expect(entry).toEqual({ path: 'main-dirty.luau', status: '?', uncommitted: true })
    } finally {
      fs.rmSync(marker, { force: true })
    }
  })

  it('returns isRepo:false outside a git repo', async () => {
    const service = new WorktreeService()
    const plainDir = path.join(root, 'not-a-repo-changes')
    fs.mkdirSync(plainDir, { recursive: true })
    const changes = await service.changesForGame(
      makeGame({ id: 'plain-changes', repoPath: plainDir })
    )
    expect(changes.isRepo).toBe(false)
    expect(changes.main).toBeNull()
    expect(changes.worktrees).toEqual([])
  })
})
