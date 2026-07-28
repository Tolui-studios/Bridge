import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@shared/types'
import { AutoPullService } from './autoPull'

function game(id: string): Game {
  return {
    id,
    name: id,
    repoPath: `/games/${id}`,
    worktreeRoot: `/games/${id}-worktrees`,
    defaultBranch: 'main'
  } as Game
}

describe('AutoPullService.sweep', () => {
  it('pulls every registered game sequentially and records the notes', async () => {
    const order: string[] = []
    const service = new AutoPullService({
      listGames: () => [game('a'), game('b')],
      pull: async (g) => {
        order.push(g.id)
        return `auto-pull: ${g.id} already up to date`
      }
    })
    await service.sweep()
    expect(order).toEqual(['a', 'b'])
    expect(service.lastResults.get('a')).toContain('up to date')
    expect(service.lastResults.get('b')).toContain('up to date')
  })

  it('continues past a failing game and records the error instead of throwing', async () => {
    const pulled: string[] = []
    const service = new AutoPullService({
      listGames: () => [game('bad'), game('good')],
      pull: async (g) => {
        pulled.push(g.id)
        if (g.id === 'bad') throw new Error('could not fetch origin/main: offline')
        return 'auto-pull: fast-forwarded main 2 commit(s) to match origin'
      }
    })
    await expect(service.sweep()).resolves.toBeUndefined()
    expect(pulled).toEqual(['bad', 'good'])
    expect(service.lastResults.get('bad')).toContain('offline')
    expect(service.lastResults.get('good')).toContain('fast-forwarded')
  })

  it('does not start a second sweep while one is in flight', async () => {
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = new AutoPullService({
      listGames: () => [game('a')],
      pull: async () => {
        calls++
        await gate
        return 'ok'
      }
    })
    const first = service.sweep()
    const second = service.sweep() // overlaps — must be a no-op
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
  })

  it('logs pulls that changed something but stays quiet about no-ops', async () => {
    const lines: string[] = []
    const notes: Record<string, string> = {
      quiet: 'auto-pull: main already up to date',
      skipped: 'auto-pull skipped: no origin remote',
      moved: 'auto-pull: fast-forwarded main 3 commit(s) to match origin'
    }
    const service = new AutoPullService({
      listGames: () => [game('quiet'), game('skipped'), game('moved')],
      pull: async (g) => notes[g.id],
      log: (line) => lines.push(line)
    })
    await service.sweep()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('moved')
  })
})

describe('AutoPullService timers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sweeps once after the initial delay and again every interval', async () => {
    let calls = 0
    const service = new AutoPullService({
      listGames: () => [game('a')],
      pull: async () => {
        calls++
        return 'ok'
      },
      initialDelayMs: 1000,
      intervalMs: 5000
    })
    service.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(2)
    service.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toBe(2)
  })

  it('start is idempotent', async () => {
    let calls = 0
    const service = new AutoPullService({
      listGames: () => [game('a')],
      pull: async () => {
        calls++
        return 'ok'
      },
      initialDelayMs: 1000,
      intervalMs: 60_000
    })
    service.start()
    service.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(1)
    service.stop()
  })
})
