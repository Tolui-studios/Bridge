import fs from 'node:fs'
import path from 'node:path'
import type { AgentSessionSummary, AgentStreamItem } from '@shared/types'

interface PersistedFile {
  version: 1
  summary: AgentSessionSummary
  items: AgentStreamItem[]
}

/**
 * Disk persistence for agent sessions: one JSON file per session under
 * `<rootDir>/<gameId>/<sessionId>.json`. Summaries load eagerly at startup;
 * transcripts load lazily on demand. Electron-free for unit testing.
 */
export class SessionStore {
  constructor(private readonly rootDir: string) {}

  /** All persisted summaries across games (transcripts are NOT loaded). */
  loadAllSummaries(): AgentSessionSummary[] {
    const summaries: AgentSessionSummary[] = []
    let gameDirs: string[] = []
    try {
      gameDirs = fs.readdirSync(this.rootDir)
    } catch {
      return summaries
    }
    for (const gameId of gameDirs) {
      const dir = path.join(this.rootDir, gameId)
      let files: string[] = []
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      } catch {
        continue
      }
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PersistedFile
          if (data.summary?.id) summaries.push(data.summary)
        } catch {
          // Skip corrupt session files; never block startup.
        }
      }
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
  }

  /** Keep the newest `keep` session files for a game; returns removed session ids. */
  prune(gameId: string, keep: number): string[] {
    const dir = path.join(this.rootDir, gameId)
    let files: { name: string; mtime: number }[] = []
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
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
    return removed
  }

  removeGame(gameId: string): void {
    try {
      fs.rmSync(path.join(this.rootDir, gameId), { recursive: true, force: true })
    } catch {
      // Best-effort.
    }
  }

  private file(gameId: string, sessionId: string): string {
    return path.join(this.rootDir, gameId, `${sessionId}.json`)
  }
}
