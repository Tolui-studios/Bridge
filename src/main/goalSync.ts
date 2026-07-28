import { matchChecklistItem, normalizeItemText } from '@shared/goalMarkers'
import type { BridgeMarker } from '@shared/goalMarkers'
import type { GoalsMutation, GoalsState } from '@shared/types'

/** The slice of GoalsService this module needs — kept minimal for testing. */
export interface GoalsPort {
  readStateById(gameId: string): GoalsState
  mutate(gameId: string, mutation: GoalsMutation): GoalsState
}

/**
 * Apply one agent-reported progress marker to the game's canonical GOALS.md
 * (the repo copy Bridge watches — not the agent's worktree copy). Returns a
 * short transcript note describing what happened. Conservative: unmatched or
 * ambiguous item text is reported, never guessed.
 */
export function applyGoalMarker(goals: GoalsPort, gameId: string, marker: BridgeMarker): string {
  const state = goals.readStateById(gameId)
  if (state.status !== 'ok' || !state.doc) {
    return `check-bar update skipped (${marker.kind} '${marker.text}') — GOALS.md is not readable`
  }
  const items = state.doc.items

  if (marker.kind === 'add') {
    const wanted = normalizeItemText(marker.text)
    if (items.some((item) => normalizeItemText(item.text) === wanted)) {
      return `already on the checklist: '${marker.text}'`
    }
    goals.mutate(gameId, { kind: 'add-item', text: marker.text })
    return `+ added '${marker.text}'`
  }

  const index = matchChecklistItem(items, marker.text)
  if (index === null) return `no checklist match for '${marker.text}'`
  const item = items[index]

  if (marker.kind === 'done') {
    if (item.done) return `already done: '${item.text}'`
    goals.mutate(gameId, { kind: 'toggle-item', index, expectText: item.text, done: true })
    return `✓ ${item.text}`
  }

  if (item.done) return `not marking in progress (already done): '${item.text}'`
  goals.mutate(gameId, { kind: 'set-in-progress', index, expectText: item.text })
  return `→ in progress: ${item.text}`
}

/**
 * Protocol footer appended to each agent's initial task so it knows how to
 * report progress and what the checklist currently says (exact item text
 * makes marker matching reliable).
 */
export function buildTaskFooter(goals: GoalsPort, gameId: string): string {
  const protocol = [
    '',
    '---',
    'Bridge check-bar protocol: report checklist progress by writing marker lines in your replies, using exact item text:',
    'BRIDGE:START <item>   when you begin a checklist item',
    'BRIDGE:DONE <item>    when you complete one',
    'BRIDGE:ADD <item>     to record newly discovered work',
    'BRIDGE:NOTE <fact>    for a durable convention or gotcha you discovered — Bridge',
    'appends it to the game\'s CLAUDE.md for every future agent. Keep notes rare,',
    'one line, and general (a rule, not a work log entry).',
    'Do not edit GOALS.md yourself — Bridge owns that file.',
    'Markers are read only from YOUR top-level replies — a subagent\'s output is',
    'never scanned, so emit markers yourself.',
    '',
    'Testing: you cannot run or playtest the game, and you must not claim to have.',
    'Never state that you played, ran, or verified behaviour in-game.',
    'Instead, hand the operator the steps to verify it themselves, one per line:',
    'BRIDGE:TEST <a single concrete step, in the order it should be performed>',
    'Write each step so it can be followed without reading your reply: name the',
    'place/UI to open, the exact action, and the observable result that means it passed.',
    'Emit these near the end of your final message, after the work is complete.',
    '',
    'Questions: when a decision is genuinely the operator\'s — a design choice,',
    'which of two valid approaches to take, missing information you cannot infer',
    'from the repo — ask instead of guessing. When the question has 2-4 concrete',
    'options, use the AskUserQuestion tool: the operator answers with buttons and',
    'the answer returns as the tool result. For open-ended questions use:',
    'BRIDGE:ASK <your question, phrased so it can be answered in a sentence>',
    'Then STOP and end your turn; the answer arrives as your next message.',
    'Do not ask about things you can determine yourself, and do not ask for',
    'permission to do work already covered by the task.'
  ].join('\n')
  try {
    const state = goals.readStateById(gameId)
    if (state.status === 'ok' && state.doc && state.doc.items.length > 0) {
      const checklist = state.doc.items
        .map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
        .join('\n')
      return `${protocol}\nCurrent checklist:\n${checklist}`
    }
  } catch {
    // Fall through to the bare protocol.
  }
  return protocol
}
