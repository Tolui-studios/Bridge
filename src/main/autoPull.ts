import type { Game } from '@shared/types'

/**
 * Background freshness for every game's MAIN checkout. Agents never commit to
 * the local default branch — they work on agent-* branches in worktrees — so
 * a frequent fast-forward-only pull is always safe and keeps the base that
 * new worktrees are created from (and that "Serve main" serves) current
 * without the operator ever pressing Pull.
 *
 * Electron-free so it is vitest-coverable (precedent: rojoTarget.ts,
 * worktrees.ts). All pulls go through gitOps.autoPullDefaultBranch, which is
 * ff-only, touches only the default branch, and bounds the network fetch.
 */

export const AUTO_PULL_INTERVAL_MS = 5 * 60_000
/** First sweep waits for startup (registry load, first window) to settle. */
export const AUTO_PULL_INITIAL_DELAY_MS = 30_000

interface AutoPullDeps {
  listGames: () => Game[]
  pull: (game: Game) => Promise<string>
  intervalMs?: number
  initialDelayMs?: number
  log?: (line: string) => void
}

export class AutoPullService {
  private kickoff: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false
  /** Last note or error per game id — for logs/diagnosis; the RepoBar's own polling shows the effect. */
  readonly lastResults = new Map<string, string>()

  constructor(private readonly deps: AutoPullDeps) {}

  start(): void {
    if (this.kickoff || this.timer) return
    const initial = this.deps.initialDelayMs ?? AUTO_PULL_INITIAL_DELAY_MS
    const interval = this.deps.intervalMs ?? AUTO_PULL_INTERVAL_MS
    this.kickoff = setTimeout(() => void this.sweep(), initial)
    this.kickoff.unref?.()
    this.timer = setInterval(() => void this.sweep(), interval)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.kickoff) clearTimeout(this.kickoff)
    if (this.timer) clearInterval(this.timer)
    this.kickoff = null
    this.timer = null
  }

  /**
   * Pull every registered game once, sequentially — parallel git across many
   * (OneDrive-synced) repos thrashes, and a launch-time auto-pull may already
   * be running for one of them. Failures (offline, diverged, dirty checkout
   * in the way) are recorded, never thrown: background freshness must not
   * interrupt anything.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      for (const game of this.deps.listGames()) {
        try {
          const note = await this.deps.pull(game)
          this.lastResults.set(game.id, note)
          if (!/already up to date|skipped/i.test(note)) {
            this.deps.log?.(`[auto-pull] ${game.name}: ${note}`)
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          this.lastResults.set(game.id, detail)
          this.deps.log?.(`[auto-pull] ${game.name}: ${detail}`)
        }
      }
    } finally {
      this.sweeping = false
    }
  }
}
