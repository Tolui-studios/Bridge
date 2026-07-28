import fs from 'node:fs'
import path from 'node:path'
import type { AgentSessionSummary, AgentStreamItem } from '@shared/types'

interface PersistedFile {
  version: 1
  summary: AgentSessionSummary
  items: AgentStreamItem[]
}

interface IndexFile {
  version: 1
  summaries: AgentSessionSummary[]
}

const INDEX_NAME = 'index.json'

/**
 * Disk persistence for agent sessions: one JSON file per session under
 * `<rootDir>/<gameId>/<sessionId>.json`, plus a per-game `index.json` holding
 * summaries only. Startup reads just the indexes — parsing every transcript
 * synchronously grew into a multi-second stall at 50 sessions/game. A missing
 * or corrupt index self-heals from the legacy full-file scan. Transcripts
 * load lazily on demand. Electron-free for unit testing.
 */
export class SessionStore {
  /** gameId → sessionId → summary; mirrors index.json so saves don't re-read it. */
  private indexes = new Map<string, Map<string, AgentSessionSummary>>()

  constructor(private readonly rootDir: string) {}

  /** All persisted summaries across games (reads indexes, never transcripts). */
  loadAllSummaries(): AgentSessionSummary[] {
    const summaries: AgentSessionSummary[] = []
    let gameDirs: string[] = []
    try {
      gameDirs = fs.readdirSync(this.rootDir)
    } catch {
      return summaries
    }
    for (const gameId of gameDirs) {
      summaries.push(...this.gameIndex(gameId).values())
    }
    return summaries
  }

  loadItems(gameId: string, sessionId: string): AgentStreamItem[] | null {
    try {
      const data = JSON.parse(
        fs.readFileSync(this.file(gameId, sessionId), 'utf8')
      ) as PersistedFile
      return Array.isArray(data.items) ? data.items : []
    } catch {
      return null
    }
  }

  save(summary: AgentSessionSummary, items: AgentStreamItem[]): void {
    const dir = path.join(this.rootDir, summary.gameId)
    fs.mkdirSync(dir, { recursive: true })
    const file = this.file(summary.gameId, summary.id)
    const payload: PersistedFile = { version: 1, summary, items }
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    fs.renameSync(tmp, file)
    this.gameIndex(summary.gameId).set(summary.id, summary)
    this.writeIndex(summary.gameId)
  }

  /** Keep the newest `keep` session files for a game; returns removed session ids. */
  prune(gameId: string, keep: number): string[] {
    const dir = path.join(this.rootDir, gameId)
    let files: { name: string; mtime: number }[] = []
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json') && f !== INDEX_NAME)
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
    } catch {
      return []
    }
    files.sort((a, b) => b.mtime - a.mtime)
    const removed: string[] = []
    for (const file of files.slice(keep)) {
      try {
        fs.rmSync(path.join(dir, file.name), { force: true })
        removed.push(file.name.replace(/\.json$/, ''))
      } catch {
        // Best-effort.
      }
    }
    if (removed.length > 0) {
      const index = this.gameIndex(gameId)
      for (const id of removed) index.delete(id)
      this.writeIndex(gameId)
    }
    return removed
  }

  removeGame(gameId: string): void {
    this.indexes.delete(gameId)
    try {
      fs.rmSync(path.join(this.rootDir, gameId), { recursive: true, force: true })
    } catch {
      // Best-effort.
    }
  }

  private gameIndex(gameId: string): Map<string, AgentSessionSummary> {
    const cached = this.indexes.get(gameId)
    if (cached) return cached

    const map = new Map<string, AgentSessionSummary>()
    let healthy = false
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(this.rootDir, gameId, INDEX_NAME), 'utf8')
      ) as IndexFile
      if (data.version === 1 && Array.isArray(data.summaries)) {
        for (const summary of data.summaries) {
          if (summary?.id) map.set(summary.id, summary)
        }
        healthy = true
      }
    } catch {
      // Missing or corrupt index — rebuild from the session files below.
    }

    this.indexes.set(gameId, map)
    if (!healthy) {
      for (const summary of this.legacyScan(gameId)) map.set(summary.id, summary)
      // Self-healing migration: pay the full scan once, then never again.
      this.writeIndex(gameId)
    }
    return map
  }

  /** Pre-index layout: summaries only extractable by parsing whole session files. */
  private legacyScan(gameId: string): AgentSessionSummary[] {
    const dir = path.join(this.rootDir, gameId)
    const summaries: AgentSessionSummary[] = []
    let files: string[] = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== INDEX_NAME)
    } catch {
      return summaries
    }
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PersistedFile
        if (data.summary?.id) summaries.push(data.summary)
      } catch {
        // Skip corrupt session files; never block startup.
      }
    }
    return summaries
  }

  private writeIndex(gameId: string): void {
    const dir = path.join(this.rootDir, gameId)
    if (!fs.existsSync(dir)) return
    const index = this.indexes.get(gameId)
    if (!index) return
    const payload: IndexFile = { version: 1, summaries: [...index.values()] }
    const file = path.join(dir, INDEX_NAME)
    const tmp = `${file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      fs.renameSync(tmp, file)
    } catch {
      // Best-effort: a lost index rebuilds itself from session files.
    }
  }

  private file(gameId: string, sessionId: string): string {
    return path.join(this.rootDir, gameId, `${sessionId}.json`)
  }
}
