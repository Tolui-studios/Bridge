import fs from 'node:fs'
import path from 'node:path'
import type { AgentSessionSummary, Game, VaultNoteRef } from '@shared/types'
import type { RunExtras } from './agents'

const MAX_NOTES = 200
const MAX_WALK_DEPTH = 3
const MAX_NOTE_CHARS = 8000
const MAX_TOTAL_CHARS = 24000
const RUN_LOG_NOTE = 'Bridge Log.md'
const DECISIONS_NOTE = 'Decisions.md'

/**
 * The Obsidian vault integration: plain markdown on disk, no plugin or API.
 * Reads game-relevant notes (the game's folder plus shared knowledge
 * folders) for injection into agent prompts, and writes run summaries and
 * decisions back into per-game notes. Bridge writes the vault only through
 * this service; agents never write it. Electron-free for unit testing.
 */
export class VaultService {
  constructor(private readonly getVaultPath: () => string | null) {}

  /** Notes relevant to a game: its own top-level folder + shared knowledge folders. */
  notesForGame(game: Game): VaultNoteRef[] {
    const vault = this.getVaultPath()
    if (!vault || !fs.existsSync(vault)) return []
    const notes: VaultNoteRef[] = []
    for (const dir of this.relevantFolders(vault, game)) {
      this.walk(vault, path.join(vault, dir), 0, notes)
      if (notes.length >= MAX_NOTES) break
    }
    return notes.slice(0, MAX_NOTES)
  }

  /**
   * Build the prompt block for the selected notes. Paths are validated to
   * stay inside the vault; each note and the total are size-capped.
   */
  buildContext(relPaths: string[]): string {
    const vault = this.getVaultPath()
    if (!vault || relPaths.length === 0) return ''
    const sections: string[] = []
    let total = 0
    for (const relPath of relPaths) {
      const abs = this.safeJoin(vault, relPath)
      if (!abs) continue
      let content: string
      try {
        content = fs.readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      if (content.length > MAX_NOTE_CHARS) content = `${content.slice(0, MAX_NOTE_CHARS)}\n…(truncated)`
      if (total + content.length > MAX_TOTAL_CHARS) break
      total += content.length
      const name = path.basename(relPath, '.md')
      sections.push(`### Vault note: ${name} (${relPath})\n\n${content.trim()}`)
    }
    if (sections.length === 0) return ''
    return `\n\n---\nAttached design notes from the studio vault (read-only context — the vault is not yours to edit):\n\n${sections.join('\n\n')}`
  }

  /** Append a run summary to `<game folder>/Bridge Log.md`. Returns a transcript note, or null when no vault. */
  appendRunSummary(game: Game, summary: AgentSessionSummary, extras: RunExtras): string | null {
    const vault = this.getVaultPath()
    if (!vault || !fs.existsSync(vault)) return null
    const folder = this.gameFolderName(vault, game)
    const lines: string[] = []
    const cost = summary.costUsd !== null ? `$${summary.costUsd.toFixed(4)}` : 'cost n/a'
    const turns = summary.numTurns !== null ? `${summary.numTurns} turns` : 'turns n/a'
    const minutes = summary.endedAt ? Math.max(1, Math.round((summary.endedAt - summary.startedAt) / 60000)) : null
    const workspace = summary.cwd ? path.basename(summary.cwd) : null
    lines.push(`## ${formatStamp(summary.endedAt ?? Date.now())} — ${summary.status} — ${truncate(summary.task, 90)}`)
    lines.push(
      `- ${turns} · ${cost} · ${summary.model ?? 'session default'}${minutes ? ` · ${minutes}m` : ''}${workspace ? ` · ${workspace}` : ''}`
    )
    if (extras.goalNotes.length > 0) lines.push(`- check-bar: ${extras.goalNotes.join('; ')}`)
    if (extras.lastResult) lines.push(`- result: ${extras.lastResult}`)
    if (extras.lastText) lines.push(`- final note: ${truncate(extras.lastText.replace(/\s+/g, ' '), 300)}`)
    this.appendToNote(vault, folder, RUN_LOG_NOTE, `# Bridge Log — ${game.name}`, lines.join('\n'))
    return `vault: run summary → ${folder}/${RUN_LOG_NOTE}`
  }

  /** Append an operator decision to `<game folder>/Decisions.md`. */
  appendDecision(game: Game, title: string, body: string): string {
    const vault = this.getVaultPath()
    if (!vault || !fs.existsSync(vault)) throw new Error('No vault connected.')
    const trimmedTitle = title.trim()
    if (!trimmedTitle) throw new Error('Decision title is required.')
    const folder = this.gameFolderName(vault, game)
    const entry = `## ${formatStamp(Date.now())} — ${trimmedTitle}${body.trim() ? `\n\n${body.trim()}` : ''}`
    this.appendToNote(vault, folder, DECISIONS_NOTE, `# Decisions — ${game.name}`, entry)
    return `${folder}/${DECISIONS_NOTE}`
  }

  private relevantFolders(vault: string, game: Game): string[] {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(vault, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    const folders: string[] = []
    const wanted = normalizeName(game.name)
    for (const dir of dirs) {
      if (normalizeName(dir.name) === wanted) folders.push(dir.name)
    }
    for (const dir of dirs) {
      const normalized = normalizeName(dir.name)
      if (normalized === 'studio' || normalized === 'knowledge') {
        if (!folders.includes(dir.name)) folders.push(dir.name)
      }
    }
    return folders
  }

  private walk(vault: string, dir: string, depth: number, out: VaultNoteRef[]): void {
    if (depth > MAX_WALK_DEPTH || out.length >= MAX_NOTES) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_NOTES) return
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walk(vault, abs, depth + 1, out)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const relPath = path.relative(vault, abs)
        out.push({
          relPath,
          name: path.basename(entry.name, '.md'),
          folder: relPath.split(path.sep)[0] ?? '',
          size: safeSize(abs)
        })
      }
    }
  }

  private gameFolderName(vault: string, game: Game): string {
    try {
      const wanted = normalizeName(game.name)
      const match = fs
        .readdirSync(vault, { withFileTypes: true })
        .find((e) => e.isDirectory() && !e.name.startsWith('.') && normalizeName(e.name) === wanted)
      if (match) return match.name
    } catch {
      // Fall through.
    }
    return game.name
  }

  private appendToNote(
    vault: string,
    folder: string,
    noteName: string,
    header: string,
    entry: string
  ): void {
    const dir = this.safeJoin(vault, folder)
    if (!dir) throw new Error(`Invalid vault folder: ${folder}`)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, noteName)
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, `${header}\n\n${entry}\n`, 'utf8')
    } else {
      fs.appendFileSync(file, `\n${entry}\n`, 'utf8')
    }
  }

  private safeJoin(vault: string, relPath: string): string | null {
    const abs = path.resolve(vault, relPath)
    const root = path.resolve(vault)
    const rel = path.relative(root, abs)
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
    return abs
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, ' ').trim().replace(/^_+/, '')
}

function formatStamp(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}
