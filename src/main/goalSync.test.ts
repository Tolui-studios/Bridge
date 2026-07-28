import { describe, expect, it } from 'vitest'
import { applyGoalMarker, buildTaskFooter, type GoalsPort } from './goalSync'
import { parseGoals } from '@shared/goalsParser'
import { mutateGoalsContent } from '@shared/goalsMutator'
import type { GoalsMutation, GoalsState } from '@shared/types'

const DOC = [
  '# Game — Current Goal',
  '',
  '> Ship it.',
  '',
  '## Checklist',
  '',
  '- [x] Terrain generation',
  '- [ ] Supply lines <!-- in-progress -->',
  '- [ ] Unit combat',
  ''
].join('\n')

/** In-memory GoalsPort backed by the real parser and mutator. */
class FakeGoals implements GoalsPort {
  constructor(public content: string) {}

  readStateById(gameId: string): GoalsState {
    return {
      gameId,
      status: 'ok',
      doc: parseGoals(this.content),
      path: 'GOALS.md',
      updatedAt: 0
    }
  }

  mutate(gameId: string, mutation: GoalsMutation): GoalsState {
    const result = mutateGoalsContent(this.content, mutation)
    if (!result.ok) throw new Error(result.error)
    this.content = result.content
    return this.readStateById(gameId)
  }
}

describe('applyGoalMarker', () => {
  it('ticks an item done and strips its in-progress marker', () => {
    const goals = new FakeGoals(DOC)
    const note = applyGoalMarker(goals, 'g', { kind: 'done', text: 'supply lines' })
    expect(note).toBe('✓ Supply lines')
    const doc = parseGoals(goals.content)
    expect(doc.items[1]).toEqual({ text: 'Supply lines', done: true, inProgress: false })
  })

  it('moves the in-progress marker on START', () => {
    const goals = new FakeGoals(DOC)
    const note = applyGoalMarker(goals, 'g', { kind: 'start', text: 'Unit combat' })
    expect(note).toBe('→ in progress: Unit combat')
    const doc = parseGoals(goals.content)
    expect(doc.items.map((i) => i.inProgress)).toEqual([false, false, true])
  })

  it('adds new items and refuses duplicates', () => {
    const goals = new FakeGoals(DOC)
    expect(applyGoalMarker(goals, 'g', { kind: 'add', text: 'Main menu' })).toBe("+ added 'Main menu'")
    expect(parseGoals(goals.content).items).toHaveLength(4)
    expect(applyGoalMarker(goals, 'g', { kind: 'add', text: 'main menu.' })).toContain('already on the checklist')
    expect(parseGoals(goals.content).items).toHaveLength(4)
  })

  it('reports instead of guessing on unknown items and no-ops on already-done', () => {
    const goals = new FakeGoals(DOC)
    expect(applyGoalMarker(goals, 'g', { kind: 'done', text: 'Netcode' })).toContain('no checklist match')
    expect(applyGoalMarker(goals, 'g', { kind: 'done', text: 'Terrain generation' })).toContain('already done')
    expect(applyGoalMarker(goals, 'g', { kind: 'start', text: 'Terrain generation' })).toContain('already done')
    expect(goals.content).toBe(DOC)
  })
})

describe('buildTaskFooter', () => {
  it('includes the protocol and the current checklist with exact text', () => {
    const footer = buildTaskFooter(new FakeGoals(DOC), 'g')
    expect(footer).toContain('BRIDGE:DONE')
    expect(footer).toContain('BRIDGE:START')
    expect(footer).toContain('BRIDGE:ADD')
    expect(footer).toContain('BRIDGE:NOTE')
    expect(footer).toContain("subagent's output is")
    expect(footer).toContain('- [x] Terrain generation')
    expect(footer).toContain('- [ ] Supply lines')
  })

  it('falls back to the bare protocol when goals are unavailable', () => {
    const broken: GoalsPort = {
      readStateById: () => {
        throw new Error('nope')
      },
      mutate: () => {
        throw new Error('nope')
      }
    }
    const footer = buildTaskFooter(broken, 'g')
    expect(footer).toContain('BRIDGE:DONE')
    expect(footer).not.toContain('Current checklist')
  })
})
