import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AddGameInput, Game, GameMutationResult } from '@shared/types'

interface RegistryFile {
  version: 1
  games: Game[]
}

/**
 * Versioned JSON store for the game list, kept in the app's userData dir.
 * All writes are atomic (tmp file + rename). A corrupt file is moved aside
 * rather than deleted so nothing is ever silently lost.
 */
export class GameRegistry {
  private games: Game[] = []

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const data = JSON.parse(raw) as RegistryFile
      if (Array.isArray(data.games)) {
        this.games = data.games
      }
    } catch (err) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`
      try {
        fs.renameSync(this.filePath, backup)
      } catch {
        // If even the rename fails, start empty; the bad file stays in place.
      }
      console.warn(`[registry] corrupt registry moved to ${backup}`, err)
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const payload: RegistryFile = { version: 1, games: this.games }
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }

  list(): Game[] {
    return [...this.games]
  }

  get(id: string): Game | undefined {
    return this.games.find((g) => g.id === id)
  }

  add(input: AddGameInput): GameMutationResult {
    const { name, repoPath, warnings } = this.validate(input.name, input.repoPath)
    if (this.games.some((g) => samePath(g.repoPath, repoPath))) {
      throw new Error('A game with this repo path is already registered.')
    }
    const game: Game = {
      id: randomUUID(),
      name,
      repoPath,
      defaultBranch: input.defaultBranch?.trim() || 'main',
      worktreeRoot: input.worktreeRoot?.trim() || `${repoPath}-worktrees`
    }
    this.games.push(game)
    this.save()
    return { game, warnings }
  }

  update(updated: Game): GameMutationResult {
    const idx = this.games.findIndex((g) => g.id === updated.id)
    if (idx === -1) throw new Error('Unknown game id.')
    const { name, repoPath, warnings } = this.validate(updated.name, updated.repoPath)
    if (this.games.some((g) => g.id !== updated.id && samePath(g.repoPath, repoPath))) {
      throw new Error('A game with this repo path is already registered.')
    }
    const game: Game = {
      ...updated,
      name,
      repoPath,
      defaultBranch: updated.defaultBranch.trim() || 'main',
      worktreeRoot: updated.worktreeRoot.trim() || `${repoPath}-worktrees`
    }
    this.games[idx] = game
    this.save()
    return { game, warnings }
  }

  remove(id: string): void {
    this.games = this.games.filter((g) => g.id !== id)
    this.save()
  }

  private validate(
    rawName: string,
    rawRepoPath: string
  ): { name: string; repoPath: string; warnings: string[] } {
    const name = (rawName ?? '').trim()
    if (!name) throw new Error('Game name is required.')
    const trimmedPath = (rawRepoPath ?? '').trim()
    if (!trimmedPath) throw new Error('Repo path is required.')
    const repoPath = path.resolve(trimmedPath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(repoPath)
    } catch {
      throw new Error(`Repo path does not exist: ${repoPath}`)
    }
    if (!stat.isDirectory()) {
      throw new Error(`Repo path is not a directory: ${repoPath}`)
    }
    const warnings: string[] = []
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      warnings.push(
        'No .git found here. Fine for Phase 1, but agents and worktrees (later phases) need a real git repo.'
      )
    }
    if (!fs.existsSync(path.join(repoPath, 'GOALS.md'))) {
      warnings.push('No GOALS.md yet. You can create one from the template in the game panel.')
    }
    return { name, repoPath, warnings }
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}
