import type { Game, GameCreateProgress, GameMutationResult } from '@shared/types'

/**
 * Everything createGame needs from the outside world, injected so the
 * orchestration (ordering, parallelism, progress events) is unit-testable
 * without electron, git, gh, or the network.
 */
export interface GameCreateDeps {
  initRepo: (dir: string) => Promise<void>
  scaffold: (dir: string, name: string, slug: string) => void
  register: (name: string, dir: string) => GameMutationResult
  createGoalsTemplate: (gameId: string) => void
  broadcastRegistry: () => void
  commitAll: (dir: string, message: string) => Promise<void>
  createGithubRepo: (dir: string, slug: string) => Promise<void>
  setupToolchain: (dir: string) => Promise<string[]>
  /** Commits wally.lock when the toolchain run produced one; true = committed. */
  commitLockfile: (dir: string) => Promise<boolean>
  onGameAdded: (game: Game) => void
  emit: (progress: GameCreateProgress) => void
  /** Studio GitHub org, for the create-it-manually fallback message. */
  org: string
}

export interface GameCreateRun {
  game: Game
  /** Warnings accumulated by the time the invoke resolves (fast path only). */
  warnings: string[]
  /** Settles when background setup (GitHub + toolchain + lockfile) finishes, with the final warnings. */
  settled: Promise<string[]>
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Create-a-game pipeline, restructured for perceived speed:
 *
 * 1. The cheap local steps (git init, scaffold, register, GOALS.md) run
 *    first and `broadcastRegistry` fires IMMEDIATELY — the game appears in
 *    the sidebar within ~200ms instead of after the network work.
 * 2. The returned promise resolves right after the bootstrap commit, so the
 *    modal unblocks in under a second.
 * 3. `gh repo create --push` and the toolchain install are independent
 *    (gh pushes the commit that already exists; the toolchain writes only
 *    ignored files plus wally.lock, committed separately afterwards) — they
 *    run in the background IN PARALLEL, streaming progress events the modal
 *    renders as a live checklist.
 */
export async function createGame(
  name: string,
  slug: string,
  dir: string,
  deps: GameCreateDeps
): Promise<GameCreateRun> {
  await deps.initRepo(dir)
  deps.scaffold(dir, name, slug)
  const result = deps.register(name, dir)
  const game = result.game
  deps.createGoalsTemplate(game.id)
  deps.broadcastRegistry()

  const warnings = [...result.warnings]
  const report = (
    step: GameCreateProgress['step'],
    state: GameCreateProgress['state'],
    message: string | null = null
  ): void => {
    deps.emit({ gameId: game.id, name, step, state, message, warnings: [...warnings] })
  }
  report('scaffold', 'ok')

  report('commit', 'start')
  let committed = false
  try {
    await deps.commitAll(dir, `chore: bootstrap ${name} via Bridge`)
    committed = true
    report('commit', 'ok')
  } catch (err) {
    warnings.push(`Repo initialized but the first commit failed: ${msg(err)}`)
    report('commit', 'warn', msg(err))
  }

  const settled = (async (): Promise<string[]> => {
    const jobs: Promise<void>[] = []
    if (committed) {
      report('github', 'start')
      jobs.push(
        deps.createGithubRepo(dir, slug).then(
          () => report('github', 'ok'),
          (err: unknown) => {
            warnings.push(
              `Created locally, but the GitHub repo was not created: ${msg(err)}. Install the GitHub CLI (winget install GitHub.cli, then gh auth login) or create ${deps.org}/${slug} manually and add it as origin.`
            )
            report('github', 'warn', msg(err))
          }
        )
      )
    }
    report('toolchain', 'start')
    jobs.push(
      deps.setupToolchain(dir).then(
        (notes) => {
          warnings.push(...notes)
          report('toolchain', 'ok', notes[0] ?? null)
        },
        (err: unknown) => {
          warnings.push(`Toolchain setup failed: ${msg(err)}`)
          report('toolchain', 'warn', msg(err))
        }
      )
    )
    // Both jobs carry their own handlers, so this never rejects.
    await Promise.all(jobs)

    // Lockfile last: it needs wally.lock (toolchain) and, for the push, the
    // origin remote (github).
    if (committed) {
      try {
        if (await deps.commitLockfile(dir)) report('lockfile', 'ok')
      } catch (err) {
        warnings.push(`Could not commit wally.lock: ${msg(err)}`)
        report('lockfile', 'warn', msg(err))
      }
    }

    // Team registration keys games by origin remote — after github, not before.
    deps.onGameAdded(game)
    report('done', 'ok')
    return [...warnings]
  })()

  return { game, warnings: [...warnings], settled }
}
