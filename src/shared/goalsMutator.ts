import {
  BOM_RE,
  CHECKLIST_HEADING_RE,
  GOAL_RE,
  IN_PROGRESS_RE,
  ITEM_RE,
  PHASE_RE,
  SECTION_HEADING_RE,
  TITLE_RE
} from './goalsParser'
import type { GoalsMutation } from './types'

export type MutateResult = { ok: true; content: string } | { ok: false; error: string }

const IN_PROGRESS_MARKER = '<!-- in-progress -->'
const STALE_ERROR = 'GOALS.md changed on disk since it was last read. Refresh and try again.'

interface ChecklistSection {
  /** Line index of the `## Checklist` heading. */
  heading: number
  /** Exclusive end: index of the next `## ` heading, or lines.length. */
  end: number
}

interface ItemLine {
  lineIndex: number
  done: boolean
  /** Parsed display text: marker stripped, trimmed — what the UI shows. */
  text: string
  hadMarker: boolean
  /** Raw capture after the brackets (marker included if present). */
  after: string
}

/**
 * Apply one surgical mutation to raw GOALS.md content. Pure: never touches
 * fs, never throws. Only the targeted lines change; everything else in the
 * document (extra sections, notes, spacing) is preserved verbatim.
 * Output always uses LF line endings and ends with a single newline.
 */
export function mutateGoalsContent(raw: string, mutation: GoalsMutation): MutateResult {
  const lines = raw.replace(BOM_RE, '').split(/\r?\n/)

  switch (mutation.kind) {
    case 'set-goal':
      return setGoal(lines, mutation.goal)
    case 'set-phase':
      return setPhase(lines, mutation.phase)
    case 'add-item':
      return addItem(lines, mutation.text)
    case 'toggle-item':
      return withItem(lines, mutation.index, mutation.expectText, (item) => {
        const after = mutation.done ? stripMarker(item.after) : item.after
        lines[item.lineIndex] = `- [${mutation.done ? 'x' : ' '}] ${after.trim()}`
        return done(lines)
      })
    case 'edit-item':
      return withItem(lines, mutation.index, mutation.expectText, (item) => {
        const text = singleLine(mutation.text)
        if (!text) return { ok: false, error: 'Item text is required.' }
        const suffix = item.hadMarker ? ` ${IN_PROGRESS_MARKER}` : ''
        lines[item.lineIndex] = `- [${item.done ? 'x' : ' '}] ${text}${suffix}`
        return done(lines)
      })
    case 'remove-item':
      return withItem(lines, mutation.index, mutation.expectText, (item) => {
        lines.splice(item.lineIndex, 1)
        return done(lines)
      })
    case 'set-in-progress':
      return setInProgress(lines, mutation.index, mutation.expectText)
  }
}

function setGoal(lines: string[], rawGoal: string): MutateResult {
  const goal = singleLine(rawGoal)
  if (!goal) return { ok: false, error: 'Goal text is required.' }
  const section = findChecklist(lines)
  const existing = findOutsideChecklist(lines, section, GOAL_RE)
  if (existing !== null) {
    lines[existing] = `> ${goal}`
    return done(lines)
  }
  const title = findOutsideChecklist(lines, section, TITLE_RE)
  if (title !== null) {
    lines.splice(title + 1, 0, '', `> ${goal}`)
  } else {
    lines.unshift(`> ${goal}`, '')
  }
  return done(lines)
}

function setPhase(lines: string[], rawPhase: string): MutateResult {
  const phase = singleLine(rawPhase)
  if (!phase) return { ok: false, error: 'Phase text is required.' }
  const section = findChecklist(lines)
  const existing = findOutsideChecklist(lines, section, PHASE_RE)
  if (existing !== null) {
    lines[existing] = `## Phase: ${phase}`
    return done(lines)
  }
  if (section) {
    lines.splice(section.heading, 0, `## Phase: ${phase}`, '')
  } else {
    lines.push('', `## Phase: ${phase}`)
  }
  return done(lines)
}

function addItem(lines: string[], rawText: string): MutateResult {
  const text = singleLine(rawText)
  if (!text) return { ok: false, error: 'Item text is required.' }
  const newLine = `- [ ] ${text}`
  const section = findChecklist(lines)
  if (!section) {
    lines.push('', '## Checklist', '', newLine)
    return done(lines)
  }
  const items = itemLines(lines, section)
  if (items.length > 0) {
    lines.splice(items[items.length - 1].lineIndex + 1, 0, newLine)
  } else {
    let at = section.heading + 1
    if (at < section.end && lines[at] === '') at++
    lines.splice(Math.min(at, section.end), 0, newLine)
  }
  return done(lines)
}

function setInProgress(
  lines: string[],
  index: number | null,
  expectText: string | undefined
): MutateResult {
  const section = findChecklist(lines)
  if (!section) return { ok: false, error: 'GOALS.md has no checklist section.' }
  for (const item of itemLines(lines, section)) {
    if (item.hadMarker) {
      lines[item.lineIndex] = `- [${item.done ? 'x' : ' '}] ${stripMarker(item.after).trim()}`
    }
  }
  if (index === null) return done(lines)
  // Re-scan: stripping markers does not move lines, but re-parse for safety.
  const items = itemLines(lines, section)
  const target = items[index]
  if (!target || (expectText !== undefined && target.text !== expectText)) {
    return { ok: false, error: STALE_ERROR }
  }
  if (target.done) return { ok: false, error: 'A completed item cannot be in progress.' }
  lines[target.lineIndex] = `- [ ] ${target.text} ${IN_PROGRESS_MARKER}`
  return done(lines)
}

function withItem(
  lines: string[],
  index: number,
  expectText: string,
  apply: (item: ItemLine) => MutateResult
): MutateResult {
  const section = findChecklist(lines)
  if (!section) return { ok: false, error: 'GOALS.md has no checklist section.' }
  const items = itemLines(lines, section)
  const item = items[index]
  if (!item || item.text !== expectText) return { ok: false, error: STALE_ERROR }
  return apply(item)
}

function findChecklist(lines: string[]): ChecklistSection | null {
  const heading = lines.findIndex((line) => CHECKLIST_HEADING_RE.test(line))
  if (heading === -1) return null
  let end = lines.length
  for (let i = heading + 1; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) {
      end = i
      break
    }
  }
  return { heading, end }
}

function itemLines(lines: string[], section: ChecklistSection): ItemLine[] {
  const items: ItemLine[] = []
  for (let i = section.heading + 1; i < section.end; i++) {
    const m = ITEM_RE.exec(lines[i])
    if (!m) continue
    const after = m[2]
    const hadMarker = IN_PROGRESS_RE.test(after)
    items.push({
      lineIndex: i,
      done: m[1].toLowerCase() === 'x',
      text: stripMarker(after).trim(),
      hadMarker,
      after
    })
  }
  return items
}

function findOutsideChecklist(
  lines: string[],
  section: ChecklistSection | null,
  re: RegExp
): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (section && i > section.heading && i < section.end) continue
    if (re.test(lines[i])) return i
  }
  return null
}

function stripMarker(text: string): string {
  return text.replace(IN_PROGRESS_RE, '')
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function done(lines: string[]): MutateResult {
  return { ok: true, content: lines.join('\n').replace(/\n*$/, '\n') }
}
