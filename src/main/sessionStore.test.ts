import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionStore } from './sessionStore'
import type { AgentSessionSummary, AgentStreamItem } from '@shared/types'

let root: string

const summary = (id: string, gameId = 'game-a'): AgentSessionSummary => ({
  id,
  gameId,
  task: `task ${id}`,
  status: 'done',
  permissionMode: 'acceptEdits',
  allowedTools: ['Read'],
  model: null,
  cwd: null,
  startedAt: 1000,
  endedAt: 2000,
  costUsd: 0.01,
  numTurns: 1,
  error: null,
  testSteps: []
})

const item = (sessionId: string, text: string): AgentStreamItem => ({
  id: `${sessionId}-${text}`,
  sessionId,
  gameId: 'game-a',
  ts: 1500,
  kind: 'text',
  text
})

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sessions-'))
})

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('SessionStore', () => {
  it('round-trips summaries and lazily loads items', () => {
    const store = new SessionStore(path.join(root, 'a'))
    store.save(summary('s1'), [item('s1', 'hello'), item('s1', 'world')])
    store.save(summary('s2', 'game-b'), [])

    const summaries = store.loadAllSummaries()
    expect(summaries.map((s) => s.id).sort()).toEqual(['s1', 's2'])

    const items = store.loadItems('game-a', 's1')
    expect(items?.map((i) => i.text)).toEqual(['hello', 'world'])
    expect(store.loadItems('game-a', 'missing')).toBeNull()
  })

  it('is resilient to corrupt files and empty roots', () => {
    const store = new SessionStore(path.join(root, 'b'))
    expect(store.loadAllSummaries()).toEqual([])
    store.save(summary('ok'), [])
    fs.writeFileSync(path.join(root, 'b', 'game-a', 'broken.json'), '{nope', 'utf8')
    expect(store.loadAllSummaries().map((s) => s.id)).toEqual(['ok'])
  })

  it('prunes oldest files beyond the keep limit and reports removed ids', () => {
    const store = new SessionStore(path.join(root, 'c'))
    for (let i = 1; i <= 5; i++) {
      store.save(summary(`s${i}`), [])
      const file = path.join(root, 'c', 'game-a', `s${i}.json`)
      fs.utimesSync(file, new Date(2000, 0, i), new Date(2000, 0, i))
    }
    const removed = store.prune('game-a', 3)
    expect(removed.sort()).toEqual(['s1', 's2'])
    expect(store.loadAllSummaries().map((s) => s.id).sort()).toEqual(['s3', 's4', 's5'])
  })

  it('removes a whole game directory', () => {
    const store = new SessionStore(path.join(root, 'd'))
    store.save(summary('s1'), [])
    store.removeGame('game-a')
    expect(store.loadAllSummaries()).toEqual([])
  })
})
