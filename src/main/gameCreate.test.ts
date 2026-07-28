import { describe, expect, it } from 'vitest'
import { createGame, type GameCreateDeps } from './gameCreate'
import type { Game, GameCreateProgress } from '@shared/types'

const GAME: Game = {
  id: 'g1',
  name: 'Kingdom of Ash',
  repoPath: 'C:/games/Kingdom-of-Ash',
  defaultBranch: 'main',
  worktreeRoot: 'C:/games/Kingdom-of-Ash-worktrees'
}

interface Harness {
  deps: GameCreateDeps
  calls: string[]
  events: GameCreateProgress[]
}

function harness(overrides: Partial<GameCreateDeps> = {}): Harness {
  const calls: string[] = []
  const events: GameCreateProgress[] = []
  const deps: GameCreateDeps = {
    initRepo: async () => {
      calls.push('initRepo')
    },
    scaffold: () => {
      calls.push('scaffold')
    },
    register: () => {
      calls.push('register')
      return { game: GAME, warnings: [] }
    },
    createGoalsTemplate: () => {
      calls.push('goals')
    },
    broadcastRegistry: () => {
      calls.push('broadcast')
    },
    commitAll: async () => {
      calls.push('commit')
    },
    createGithubRepo: async () => {
      calls.push('github')
    },
    setupToolchain: async () => {
      calls.push('toolchain')
      return ['toolchain ready: wally (17 packages, 2.8s)']
    },
    commitLockfile: async () => {
      calls.push('lockfile')
      return true
    },
    onGameAdded: () => {
      calls.push('onGameAdded')
    },
    emit: (p) => events.push(p),
    org: 'Tolui-studios',
    ...overrides
  }
  return { deps, calls, events }
}

const steps = (events: GameCreateProgress[]): string[] =>
  events.map((e) => `${e.step}:${e.state}`)

describe('createGame', () => {
  it('broadcasts the registry before any slow work and resolves before background finishes', async () => {
    let releaseToolchain!: (notes: string[]) => void
    const gate = new Promise<string[]>((resolve) => {
      releaseToolchain = resolve
    })
    const { deps, calls, events } = harness({
      setupToolchain: async () => {
        calls.push('toolchain')
        return gate
      }
    })

    const run = await createGame('Kingdom of Ash', 'Kingdom-of-Ash', GAME.repoPath, deps)

    // Resolved while the toolchain is still installing.
    expect(calls.slice(0, 6)).toEqual([
      'initRepo',
      'scaffold',
      'register',
      'goals',
      'broadcast',
      'commit'
    ])
    expect(run.game.id).toBe('g1')
    expect(run.warnings).toEqual([])
    expect(calls).not.toContain('onGameAdded')

    releaseToolchain(['toolchain ready (cached)'])
    const finalWarnings = await run.settled
    expect(finalWarnings).toContain('toolchain ready (cached)')
    expect(calls).toContain('onGameAdded')
    expect(steps(events)).toEqual([
      'scaffold:ok',
      'commit:start',
      'commit:ok',
      'github:start',
      'toolchain:start',
      'github:ok',
      'toolchain:ok',
      'lockfile:ok',
      'done:ok'
    ])
  })

  it('keeps running the toolchain when GitHub fails, and reports the gh hint', async () => {
    const { deps, calls, events } = harness({
      createGithubRepo: async () => {
        throw new Error('gh not installed')
      }
    })
    const run = await createGame('Kingdom of Ash', 'Kingdom-of-Ash', GAME.repoPath, deps)
    const warnings = await run.settled
    expect(calls).toContain('toolchain')
    expect(warnings.join('\n')).toContain('GitHub repo was not created')
    expect(warnings.join('\n')).toContain('Tolui-studios/Kingdom-of-Ash')
    expect(steps(events)).toContain('github:warn')
    expect(steps(events)).toContain('toolchain:ok')
  })

  it('keeps GitHub when the toolchain fails', async () => {
    const { deps, events } = harness({
      setupToolchain: async () => {
        throw new Error('wally exploded')
      }
    })
    const run = await createGame('Kingdom of Ash', 'Kingdom-of-Ash', GAME.repoPath, deps)
    const warnings = await run.settled
    expect(warnings.join('\n')).toContain('Toolchain setup failed: wally exploded')
    expect(steps(events)).toContain('github:ok')
    expect(steps(events)).toContain('toolchain:warn')
  })

  it('skips GitHub and the lockfile commit when the bootstrap commit fails', async () => {
    const { deps, calls, events } = harness({
      commitAll: async () => {
        throw new Error('no git user configured')
      }
    })
    const run = await createGame('Kingdom of Ash', 'Kingdom-of-Ash', GAME.repoPath, deps)
    expect(run.warnings.join('\n')).toContain('first commit failed')
    await run.settled
    expect(calls).not.toContain('github')
    expect(calls).not.toContain('lockfile')
    expect(calls).toContain('toolchain')
    expect(steps(events)).toContain('commit:warn')
  })

  it('emits no lockfile event when there was nothing to commit', async () => {
    const { deps, events } = harness({
      commitLockfile: async () => false
    })
    const run = await createGame('Kingdom of Ash', 'Kingdom-of-Ash', GAME.repoPath, deps)
    await run.settled
    expect(steps(events)).not.toContain('lockfile:ok')
    expect(steps(events)).toContain('done:ok')
  })
})
