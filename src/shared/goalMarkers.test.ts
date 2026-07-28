import { describe, expect, it } from 'vitest'
import { matchChecklistItem, parseBridgeMarkers } from './goalMarkers'
import type { ChecklistItem } from './types'

const item = (text: string, done = false): ChecklistItem => ({ text, done, inProgress: false })

describe('parseBridgeMarkers', () => {
  it('parses markers anywhere in a multi-line reply', () => {
    const text = [
      'I finished the terrain work.',
      'BRIDGE:DONE Terrain blockout',
      'Moving on now.',
      '  BRIDGE:START Coin pickup loop  ',
      'bridge:add Boss arena lighting',
      'BRIDGE:NOTE Boss arenas must use the shared ArenaService, never bespoke spawn logic'
    ].join('\n')
    expect(parseBridgeMarkers(text)).toEqual([
      { kind: 'done', text: 'Terrain blockout' },
      { kind: 'start', text: 'Coin pickup loop' },
      { kind: 'add', text: 'Boss arena lighting' },
      {
        kind: 'note',
        text: 'Boss arenas must use the shared ArenaService, never bespoke spawn logic'
      }
    ])
  })

  it('ignores inline mentions that are not line-anchored markers', () => {
    expect(parseBridgeMarkers('I will use BRIDGE:DONE x later in this sentence')).toEqual([
      // line-anchored with leading text before BRIDGE: is not a marker
    ])
    expect(parseBridgeMarkers('no markers here')).toEqual([])
  })
})

describe('matchChecklistItem', () => {
  const items = [item('Terrain blockout', true), item('Coin pickup loop'), item('First boss arena')]

  it('matches exact text first', () => {
    expect(matchChecklistItem(items, 'Coin pickup loop')).toBe(1)
  })

  it('matches case-insensitively with collapsed whitespace and trailing punctuation', () => {
    expect(matchChecklistItem(items, 'coin  PICKUP loop.')).toBe(1)
  })

  it('matches by unique containment in either direction', () => {
    expect(matchChecklistItem(items, 'boss arena')).toBe(2)
    expect(matchChecklistItem(items, 'the First boss arena work')).toBe(2)
  })

  it('returns null for ambiguous or unknown text', () => {
    const ambiguous = [item('Polish menu'), item('Polish menu icons')]
    expect(matchChecklistItem(ambiguous, 'Polish')).toBeNull()
    expect(matchChecklistItem(items, 'Multiplayer netcode')).toBeNull()
    expect(matchChecklistItem(items, '   ')).toBeNull()
  })
})
