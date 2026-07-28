import fs from 'node:fs'
import path from 'node:path'

/**
 * BRIDGE:NOTE handler — appends one-line agent learnings to the game's
 * CLAUDE.md so what one agent discovers reaches every future agent without
 * waiting on a PR merge. Same single-writer shape as GOALS.md markers: the
 * main process writes the CANONICAL `<repoPath>/CLAUDE.md`, never an agent's
 * worktree copy.
 *
 * Team mode: unlike GOALS.md (which routes through the Supabase CAS writer),
 * CLAUDE.md is an ordinary git-tracked file — the local canonical write is
 * correct and rides normal git push/PR flow. Do not wire this into teamSync.
 */

export const AGENT_NOTES_HEADING = '## Agent notes'
export const MAX_NOTE_LENGTH = 300

const BOM_RE = /^\uFEFF/
const SECTION_HEADING_RE = /^##\s/

export interface AppendNoteResult {
  content: string
  changed: boolean
  /** The normalized note actually recorded (single-lined, capped). */
  note: string
}

/**
 * Pure: content in → content out. Appends `- <note>` under the Agent notes
 * section, creating the section at the end when missing. The note is
 * collapsed to a single line and capped at MAX_NOTE_LENGTH; exact-duplicate
 * bullets (trimmed compare) are skipped. Everything else in the document is
 * preserved verbatim. Output always ends with a single LF newline.
 */
export function appendAgentNote(raw: string, rawNote: string): AppendNoteResult {
  const note = singleLine(rawNote).slice(0, MAX_NOTE_LENGTH).trim()
  if (!note) return { content: raw, changed: false, note }

  const lines = raw.replace(BOM_RE, '').split(/\r?\n/)
  const bullet = `- ${note}`

  const heading = lines.findIndex((line) => line.trim() === AGENT_NOTES_HEADING)
  if (heading === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(AGENT_NOTES_HEADING, '', bullet)
    return { content: finish(lines), changed: true, note }
  }

  let end = lines.length
  for (let i = heading + 1; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) {
      end = i
      break
    }
  }

  let lastBullet = -1
  for (let i = heading + 1; i < end; i++) {
    if (!lines[i].startsWith('- ')) continue
    if (lines[i].trim() === bullet) return { content: raw, changed: false, note }
    lastBullet = i
  }

  if (lastBullet !== -1) {
    lines.splice(lastBullet + 1, 0, bullet)
  } else {
    let at = heading + 1
    if (at < end && lines[at] === '') at++
    lines.splice(Math.min(at, end), 0, bullet)
  }
  return { content: finish(lines), changed: true, note }
}

/**
 * Impure wrapper — main process only, always against the canonical
 * `<repoPath>/CLAUDE.md`. Creates the file (heading + section) when missing.
 * Atomic tmp+rename write. Never throws; returns the transcript line.
 */
export function applyAgentNote(repoPath: string, rawNote: string): string {
  try {
    const file = path.join(repoPath, 'CLAUDE.md')
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const result = appendAgentNote(raw, rawNote)
    if (!result.note) return 'note skipped (empty)'
    if (!result.changed) return `already noted: '${result.note}'`
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, result.content, 'utf8')
    fs.renameSync(tmp, file)
    return `noted in CLAUDE.md: '${result.note}'`
  } catch (err) {
    return `note failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function finish(lines: string[]): string {
  return lines.join('\n').replace(/\n*$/, '\n')
}
