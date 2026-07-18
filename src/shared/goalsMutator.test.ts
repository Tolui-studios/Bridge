import { describe, expect, it } from 'vitest'
import { mutateGoalsContent } from './goalsMutator'
import { parseGoals } from './goalsParser'

const DOC = [
  '# Game — Current Goal',
  '',
  '> Old goal.',
  '',
  '## Phase: One',
  '',
  '## Checklist',
  '',
  '- [x] first',
  '- [ ] second <!-- in-progress -->',
  '- [ ] third',
  '',
  '## Notes',
  '',
  'Keep me intact.',
  ''
].join('\n')

function apply(raw: string, mutation: Parameters<typeof mutateGoalsContent>[1]): string {
  const result = mutateGoalsContent(raw, mutation)
  if (!result.ok) throw new Error(result.error)
  return result.content
}

describe('mutateGoalsContent items', () => {
  it('toggles an item done and strips its in-progress marker', () => {
    const content = apply(DOC, { kind: 'toggle-item', index: 1, expectText: 'second', done: true })
    const doc = parseGoals(content)
    expect(doc.items[1]).toEqual({ text: 'second', done: true, inProgress: false })
    expect(content).toContain('- [x] second')
  })

  it('toggles an item back to not done', () => {
    const content = apply(DOC, { kind: 'toggle-item', index: 0, expectText: 'first', done: false })
    expect(parseGoals(content).items[0].done).toBe(false)
  })

  it('rejects a mutation when expectText is stale', () => {
    const result = mutateGoalsContent(DOC, {
      kind: 'toggle-item',
      index: 0,
      expectText: 'renamed elsewhere',
      done: true
    })
    expect(result.ok).toBe(false)
  })

  it('edits item text while preserving marker and done state', () => {
    const content = apply(DOC, { kind: 'edit-item', index: 1, expectText: 'second', text: 'renamed' })
    const doc = parseGoals(content)
    expect(doc.items[1]).toEqual({ text: 'renamed', done: false, inProgress: true })
  })

  it('removes exactly the targeted item', () => {
    const content = apply(DOC, { kind: 'remove-item', index: 1, expectText: 'second' })
    const doc = parseGoals(content)
    expect(doc.items.map((i) => i.text)).toEqual(['first', 'third'])
    expect(content).toContain('Keep me intact.')
  })

  it('adds an item after the last existing item', () => {
    const content = apply(DOC, { kind: 'add-item', text: 'fourth' })
    const doc = parseGoals(content)
    expect(doc.items.map((i) => i.text)).toEqual(['first', 'second', 'third', 'fourth'])
  })

  it('adds an item into an empty checklist section', () => {
    const content = apply('## Checklist\n\n## Notes\n', { kind: 'add-item', text: 'only' })
    expect(parseGoals(content).items).toEqual([{ text: 'only', done: false, inProgress: false }])
  })

  it('creates the checklist section when missing', () => {
    const content = apply('# T\n\n> G\n', { kind: 'add-item', text: 'first ever' })
    const doc = parseGoals(content)
    expect(doc.items.map((i) => i.text)).toEqual(['first ever'])
    expect(doc.goal).toBe('G')
  })
})

describe('mutateGoalsContent in-progress marker', () => {
  it('moves the marker so exactly one item carries it', () => {
    const content = apply(DOC, { kind: 'set-in-progress', index: 2, expectText: 'third' })
    const doc = parseGoals(content)
    expect(doc.items.map((i) => i.inProgress)).toEqual([false, false, true])
  })

  it('clears all markers with index null', () => {
    const content = apply(DOC, { kind: 'set-in-progress', index: null })
    expect(parseGoals(content).items.every((i) => !i.inProgress)).toBe(true)
  })

  it('refuses to mark a done item in progress', () => {
    const result = mutateGoalsContent(DOC, {
      kind: 'set-in-progress',
      index: 0,
      expectText: 'first'
    })
    expect(result.ok).toBe(false)
  })
})

describe('mutateGoalsContent goal and phase', () => {
  it('replaces an existing goal line', () => {
    const content = apply(DOC, { kind: 'set-goal', goal: 'New goal.' })
    expect(parseGoals(content).goal).toBe('New goal.')
    expect(content).not.toContain('Old goal.')
  })

  it('inserts a goal after the title when none exists', () => {
    const content = apply('# T\n\n## Checklist\n- [ ] a\n', { kind: 'set-goal', goal: 'Fresh' })
    const doc = parseGoals(content)
    expect(doc.goal).toBe('Fresh')
    expect(doc.title).toBe('T')
    expect(doc.items).toHaveLength(1)
  })

  it('replaces and inserts the phase line', () => {
    expect(parseGoals(apply(DOC, { kind: 'set-phase', phase: 'Two' })).phase).toBe('Two')
    const inserted = apply('# T\n\n## Checklist\n- [ ] a\n', { kind: 'set-phase', phase: 'Zero' })
    const doc = parseGoals(inserted)
    expect(doc.phase).toBe('Zero')
    expect(doc.items).toHaveLength(1)
  })

  it('rejects empty goal, phase, and item text', () => {
    expect(mutateGoalsContent(DOC, { kind: 'set-goal', goal: '   ' }).ok).toBe(false)
    expect(mutateGoalsContent(DOC, { kind: 'set-phase', phase: '' }).ok).toBe(false)
    expect(mutateGoalsContent(DOC, { kind: 'add-item', text: ' ' }).ok).toBe(false)
  })
})

describe('mutateGoalsContent output hygiene', () => {
  it('normalizes CRLF input to LF output and preserves foreign sections', () => {
    const crlf = DOC.split('\n').join('\r\n')
    const content = apply(crlf, { kind: 'toggle-item', index: 2, expectText: 'third', done: true })
    expect(content).not.toContain('\r')
    expect(content).toContain('## Notes')
    expect(content).toContain('Keep me intact.')
    expect(content.endsWith('\n')).toBe(true)
    expect(content.endsWith('\n\n')).toBe(false)
  })
})
