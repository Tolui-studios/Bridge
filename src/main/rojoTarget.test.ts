import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  planServeAction,
  resolveServeTarget,
  samePath,
  shouldLaunchStudio,
  shouldLaunchVsCode
} from './rojoTarget'

const repo = path.resolve('/games/kingdom')
const worktree = path.resolve('/games/kingdom-worktrees/agent-2')

describe('resolveServeTarget', () => {
  it('defaults to the repo and labels it main', () => {
    expect(resolveServeTarget({ repoPath: repo })).toEqual({
      path: repo,
      label: 'main',
      isMain: true
    })
  })

  it('labels a worktree by its folder name', () => {
    expect(resolveServeTarget({ repoPath: repo }, worktree)).toEqual({
      path: worktree,
      label: 'agent-2',
      isMain: false
    })
  })

  it('treats an explicit repo path (with a trailing separator) as main', () => {
    expect(resolveServeTarget({ repoPath: repo }, repo + path.sep).isMain).toBe(true)
  })

  it('is case-insensitive on Windows', () => {
    const target = resolveServeTarget({ repoPath: repo }, repo.toUpperCase())
    expect(target.isMain).toBe(process.platform === 'win32')
  })
})

describe('planServeAction', () => {
  it('starts when nothing is being served', () => {
    expect(planServeAction(null, repo)).toBe('start')
  })

  it('reuses when the same target is already served', () => {
    expect(planServeAction(repo, repo + path.sep)).toBe('reuse')
  })

  it('swaps when a different target is requested', () => {
    expect(planServeAction(repo, worktree)).toBe('swap')
    expect(planServeAction(worktree, repo)).toBe('swap')
  })
})

describe('samePath', () => {
  it('normalizes relative segments', () => {
    expect(samePath(path.join(repo, 'x', '..'), repo)).toBe(true)
  })
})

describe('shouldLaunchVsCode', () => {
  it('opens for a fresh or reused main-checkout serve', () => {
    expect(shouldLaunchVsCode('start', true)).toBe(true)
    expect(shouldLaunchVsCode('reuse', true)).toBe(true)
  })

  it('never opens on a swap — Serve main from a worktree is a retarget', () => {
    expect(shouldLaunchVsCode('swap', true)).toBe(false)
  })

  it('never opens for worktree targets', () => {
    expect(shouldLaunchVsCode('start', false)).toBe(false)
    expect(shouldLaunchVsCode('reuse', false)).toBe(false)
    expect(shouldLaunchVsCode('swap', false)).toBe(false)
  })
})

describe('shouldLaunchStudio', () => {
  it('launches only for a fresh serve of the main checkout', () => {
    expect(shouldLaunchStudio('start', true)).toBe(true)
  })

  it('never launches for worktree targets or already-running serves', () => {
    expect(shouldLaunchStudio('start', false)).toBe(false)
    expect(shouldLaunchStudio('swap', true)).toBe(false)
    expect(shouldLaunchStudio('swap', false)).toBe(false)
    expect(shouldLaunchStudio('reuse', true)).toBe(false)
    expect(shouldLaunchStudio('reuse', false)).toBe(false)
  })
})
