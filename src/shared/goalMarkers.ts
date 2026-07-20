import type { ChecklistItem } from './types'

/**
 * The progress-reporting protocol agents use in their replies. Bridge scans
 * assistant text for these line-anchored markers and applies them to the
 * game's canonical GOALS.md through the single writer:
 *
 *   BRIDGE:START <item text>   — began working on a checklist item
 *   BRIDGE:DONE <item text>    — completed it
 *   BRIDGE:ADD <item text>     — record newly discovered work
 *   BRIDGE:TEST <step>         — one step for the operator to verify in Studio
 *   BRIDGE:ASK <question>      — blocked; needs an answer before continuing
 *
 * TEST and ASK never touch GOALS.md. Agents cannot run the game, so instead of
 * pretending to playtest they hand back steps for a human; and when a decision
 * is genuinely the operator's, they ask rather than guessing.
 */
export interface BridgeMarker {
  kind: 'done' | 'start' | 'add' | 'test' | 'ask'
  text: string
}

const MARKER_RE = /^\s*BRIDGE:(DONE|START|ADD|TEST|ASK)\s+(.+?)\s*$/gim

export function parseBridgeMarkers(text: string): BridgeMarker[] {
  const markers: BridgeMarker[] = []
  for (const match of text.matchAll(MARKER_RE)) {
    markers.push({
      kind: match[1].toLowerCase() as BridgeMarker['kind'],
      text: match[2].trim()
    })
  }
  return markers
}

export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.…!?]+$/, '')
    .trim()
}

/**
 * Find the checklist item a marker refers to. Tries exact text, then
 * normalized equality, then unique containment either way. Returns null when
 * nothing matches or the match is ambiguous — callers should report rather
 * than guess.
 */
export function matchChecklistItem(items: ChecklistItem[], text: string): number | null {
  const exact = items.findIndex((item) => item.text === text)
  if (exact !== -1) return exact

  const wanted = normalizeItemText(text)
  if (!wanted) return null

  const normalized = items.map((item) => normalizeItemText(item.text))
  const equal = normalized.findIndex((item) => item === wanted)
  if (equal !== -1) return equal

  const containing: number[] = []
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].includes(wanted) || wanted.includes(normalized[i])) containing.push(i)
  }
  return containing.length === 1 ? containing[0] : null
}
