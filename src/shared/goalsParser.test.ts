import { describe, expect, it } from 'vitest'
import { parseGoals, progressOf } from './goalsParser'

const BOM = '﻿'

const GOLDEN_LF = [
  '# Sample Game — Current Goal',
  '',
  '> Ship the first playable island loop.',
  '',
  '## Phase: Greybox',
  '',
  '## Checklist',
  '',
  '- [x] Terrain blockout',
  '- [x] Spawn + checkpoint flow',
  '- [ ] Coin pickup loop <!-- in-progress -->',
  '- [ ] First boss arena',
  '- [ ] Playtest with 3 friends',
  ''
].join('\n')

const GOLDEN_CRLF = GOLDEN_LF.split('\n').join('\r\n')

describe('parseGoals', () => {
  it('parses the golden doc written with CRLF endings', () => {
    const doc = parseGoals(GOLDEN_CRLF)
    expect(doc.title).toBe('Sample Game — Current Goal')
    expect(doc.goal).toBe('Ship the first playable island loop.')
    expect(doc.phase).toBe('Greybox')
    expect(doc.items).toHaveLength(5)
    expect(doc.items.map((i) => i.done)).toEqual([true, true, false, false, false])
    expect(doc.items[2].inProgress).toBe(true)
    expect(doc.items.filter((i) => i.inProgress)).toHaveLength(1)
  })

  it('produces identical results for LF and CRLF input', () => {
    expect(parseGoals(GOLDEN_CRLF)).toEqual(parseGoals(GOLDEN_LF))
  })

  it('treats uppercase [X] as done', () => {
    const doc = parseGoals('## Checklist\n- [X] shouty item\n')
    expect(doc.items).toEqual([{ text: 'shouty item', done: true, inProgress: false }])
  })

  it('returns phase null when the Phase section is missing', () => {
    const doc = parseGoals('# T\n\n> G\n\n## Checklist\n- [ ] a\n')
    expect(doc.phase).toBeNull()
    expect(doc.title).toBe('T')
    expect(doc.goal).toBe('G')
    expect(doc.items).toHaveLength(1)
  })

  it('returns empty items when there is no Checklist section', () => {
    const doc = parseGoals('# T\n\n> G\n\n## Phase: One\n\n- [ ] stray checkbox outside checklist\n')
    expect(doc.items).toEqual([])
    expect(doc.phase).toBe('One')
  })

  it('never throws on empty, whitespace-only, or BOM-prefixed input', () => {
    for (const input of ['', '   \n  \n', BOM]) {
      const doc = parseGoals(input)
      expect(doc).toEqual({ title: null, goal: null, phase: null, items: [] })
    }
    expect(parseGoals(`${BOM}# Bommed`).title).toBe('Bommed')
  })

  it('parses goal and checklist even when the # title is missing', () => {
    const doc = parseGoals('> Just a goal\n\n## Checklist\n- [ ] a\n')
    expect(doc.title).toBeNull()
    expect(doc.goal).toBe('Just a goal')
    expect(doc.items).toHaveLength(1)
  })

  it('strips the in-progress marker including extra padding', () => {
    const doc = parseGoals('## Checklist\n- [ ] Task   <!--  in-progress  -->   \n')
    expect(doc.items).toEqual([{ text: 'Task', done: false, inProgress: true }])
  })

  it('only takes the first blockquote line as the goal', () => {
    const doc = parseGoals('> first\n> second\n')
    expect(doc.goal).toBe('first')
  })

  it('stops collecting items at the next ## heading', () => {
    const doc = parseGoals('## Checklist\n- [ ] inside\n\n## Notes\n- [ ] outside\n')
    expect(doc.items).toEqual([{ text: 'inside', done: false, inProgress: false }])
  })

  it('skips malformed lines but keeps empty-bracket items', () => {
    const doc = parseGoals(
      ['## Checklist', '-[ ] a', '- [y] b', '- plain bullet', '- [] d'].join('\n')
    )
    expect(doc.items).toEqual([{ text: 'd', done: false, inProgress: false }])
  })
})

describe('progressOf', () => {
  it('handles null and empty docs', () => {
    expect(progressOf(null)).toEqual({ done: 0, total: 0, pct: 0 })
    expect(progressOf({ title: null, goal: null, phase: null, items: [] })).toEqual({
      done: 0,
      total: 0,
      pct: 0
    })
  })

  it('rounds percentages from done/total', () => {
    const item = (done: boolean) => ({ text: 'x', done, inProgress: false })
    expect(
      progressOf({ title: null, goal: null, phase: null, items: [item(true), item(false), item(false)] })
    ).toEqual({ done: 1, total: 3, pct: 33 })
  })
})
