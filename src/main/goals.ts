import { webContents } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc-channels'
import { parseGoals } from '@shared/goalsParser'
import { mutateGoalsContent } from '@shared/goalsMutator'
import type { Game, GoalsMutation, GoalsState } from '@shared/types'

const template = (name: string): string =>
  [
    `# ${name} — Current Goal`,
    '',
    '> Describe the current goal in one line.',
    '',
    '## Phase: Unnamed',
    '',
    '## Checklist',
    '',
    '- [ ] First task',
    ''
  ].join('\n')

/**
 * Owns everything GOALS.md in the main process: reading + parsing state,
 * the create-from-template write (the ONLY GOALS.md write in Phase 1 —
 * single-writer rule), and one chokidar watcher per registered game that
 * pushes fresh state to all renderer windows.
 *
 * This is the Phase 2 seam: per-game main-process resources keyed by game
 * id, the same shape agent sessions and worktrees will use later.
 */
export class GoalsService {
  private watchers = new Map<string, FSWatcher>()
  private debounces = new Map<string, NodeJS.Timeout>()
  /** Last content this process wrote per game — used to detect external edits. */
  private lastWritten = new Map<string, string>()
  /** Set by team sync: called when GOALS.md changed on disk from outside Bridge. */
  onExternalEdit: ((game: Game, raw: string) => void) | null = null

  constructor(private readonly getGame: (id: string) => Game | undefined) {}

  goalsPath(game: Game): string {
    return path.join(game.repoPath, 'GOALS.md')
  }

  readState(game: Game): GoalsState {
    const filePath = this.goalsPath(game)
    const base = { gameId: game.id, path: filePath, updatedAt: Date.now() }
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return { ...base, status: 'ok', doc: parseGoals(raw) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return { ...base, status: code === 'ENOENT' ? 'missing' : 'unreadable', doc: null }
    }
  }

  readStateById(gameId: string): GoalsState {
    return this.readState(this.requireGame(gameId))
  }

  createTemplate(gameId: string): GoalsState {
    const game = this.requireGame(gameId)
    const filePath = this.goalsPath(game)
    if (!fs.existsSync(filePath)) {
      this.atomicWrite(filePath, template(game.name))
    }
    return this.readState(game)
  }

  /** Apply one UI-driven edit to GOALS.md (single-writer: only this process writes it). */
  mutate(gameId: string, mutation: GoalsMutation): GoalsState {
    const game = this.requireGame(gameId)
    const filePath = this.goalsPath(game)
    let raw: string
    try {
      raw = fs.readFileSync(filePath, 'utf8')
    } catch {
      throw new Error('GOALS.md does not exist yet. Create it from the template first.')
    }
    const result = mutateGoalsContent(raw, mutation)
    if (!result.ok) throw new Error(result.error)
    this.lastWritten.set(game.id, result.content)
    this.atomicWrite(filePath, result.content)
    return this.readState(game)
  }

  /** Overwrite the local GOALS.md with team-canonical content (sync projection). */
  writeProjection(game: Game, content: string): GoalsState {
    this.lastWritten.set(game.id, content)
    this.atomicWrite(this.goalsPath(game), content)
    return this.readState(game)
  }

  readRaw(game: Game): string | null {
    try {
      return fs.readFileSync(this.goalsPath(game), 'utf8')
    } catch {
      return null
    }
  }

  private atomicWrite(filePath: string, content: string): void {
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, filePath)
  }

  /** Reconcile the watcher set against the current game list. */
  syncWatchers(games: Game[]): void {
    const wanted = new Map(games.map((g) => [g.id, g]))
    for (const [id, watcher] of this.watchers) {
      if (!wanted.has(id)) {
        void watcher.close()
        this.watchers.delete(id)
      }
    }
    for (const [id, game] of wanted) {
      if (!this.watchers.has(id)) {
        this.watchers.set(id, this.createWatcher(game))
      }
    }
  }

  private createWatcher(game: Game): FSWatcher {
    // Watch the repo dir (depth 0), not the file: editors that save via
    // tmp-file + rename would otherwise detach a file-level watcher.
    const watcher = watch(game.repoPath, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      usePolling: process.env['BRIDGE_WATCH_POLL'] === '1'
    })
    const onFsEvent = (filePath: string): void => {
      if (path.basename(filePath).toLowerCase() !== 'goals.md') return
      this.scheduleBroadcast(game.id)
    }
    watcher.on('add', onFsEvent)
    watcher.on('change', onFsEvent)
    watcher.on('unlink', onFsEvent)
    watcher.on('error', (err) => console.warn(`[goals] watcher error for ${game.name}:`, err))
    return watcher
  }

  private scheduleBroadcast(gameId: string): void {
    const prev = this.debounces.get(gameId)
    if (prev) clearTimeout(prev)
    this.debounces.set(
      gameId,
      setTimeout(() => {
        this.debounces.delete(gameId)
        const game = this.getGame(gameId)
        if (!game) return
        const state = this.readState(game)
        for (const wc of webContents.getAllWebContents()) {
          wc.send(IPC.EvGoalsChanged, state)
        }
        if (this.onExternalEdit) {
          const raw = this.readRaw(game)
          if (raw !== null && raw !== this.lastWritten.get(game.id)) {
            this.onExternalEdit(game, raw)
          }
        }
      }, 100)
    )
  }

  async closeAll(): Promise<void> {
    for (const timer of this.debounces.values()) clearTimeout(timer)
    this.debounces.clear()
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
  }

  private requireGame(gameId: string): Game {
    const game = this.getGame(gameId)
    if (!game) throw new Error('Unknown game id.')
    return game
  }
}
