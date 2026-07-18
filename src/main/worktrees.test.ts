import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WorktreeService } from './worktrees'
import type { Game } from '@shared/types'

let root: string
let repoPath: string

function git(...args: string[]): void {
  execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' })
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

  it('keeps worktrees outside the repo directory itself', async () => {
    const service = new WorktreeService()
    const lease = await service.acquire(makeGame(), 'session-d')
    const rel = path.relative(repoPath, lease.path)
    expect(rel.startsWith('..')).toBe(true)
  })
})
