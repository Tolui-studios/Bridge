import type { ChecklistItem, GoalsDoc, Progress } from './types'

// Shared with goalsMutator so parsing and mutating can never disagree on
// what counts as a title/goal/phase/item line.
export const TITLE_RE = /^#\s+(.+)$/
export const GOAL_RE = /^>\s?(.*)$/
export const PHASE_RE = /^##\s*Phase:\s*(.+)$/i
export const CHECKLIST_HEADING_RE = /^##\s*Checklist\b/i
export const SECTION_HEADING_RE = /^##\s/
export const ITEM_RE = /^-\s+\[\s*([xX]?)\s*\]\s*(.*)$/
export const IN_PROGRESS_RE = /<!--\s*in-progress\s*-->\s*$/i
export const BOM_RE = /^﻿/

/**
 * Parse a GOALS.md document. Pure and total: never throws, tolerates
 * missing/malformed sections, normalizes CRLF and a leading BOM.
 */
export function parseGoals(markdown: string): GoalsDoc {
  const lines = markdown.replace(BOM_RE, '').split(/\r?\n/)

  let title: string | null = null
  let goal: string | null = null
  let phase: string | null = null
  const items: ChecklistItem[] = []

  let inChecklist = false
  for (const line of lines) {
    if (CHECKLIST_HEADING_RE.test(line)) {
      inChecklist = true
      continue
    }
    if (inChecklist && SECTION_HEADING_RE.test(line)) {
      inChecklist = false
    }

    if (inChecklist) {
      const m = ITEM_RE.exec(line)
      if (m) {
        const done = m[1].toLowerCase() === 'x'
        let text = m[2]
        const inProgress = IN_PROGRESS_RE.test(text)
        if (inProgress) {
          text = text.replace(IN_PROGRESS_RE, '')
        }
        items.push({ text: text.trim(), done, inProgress })
      }
      continue
    }

    if (title === null) {
      const m = TITLE_RE.exec(line)
      if (m) {
        title = m[1].trim()
        continue
      }
    }
    if (goal === null) {
      const m = GOAL_RE.exec(line)
      if (m) {
        goal = m[1].trim()
        continue
      }
    }
    if (phase === null) {
      const m = PHASE_RE.exec(line)
      if (m) {
        phase = m[1].trim()
      }
    }
  }

  return { title, goal, phase, items }
}

export function progressOf(doc: GoalsDoc | null): Progress {
  const total = doc?.items.length ?? 0
  const done = doc?.items.filter((item) => item.done).length ?? 0
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, total, pct }
}
