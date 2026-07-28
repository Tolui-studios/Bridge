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
  testSteps: [],
  pendingQuestion: null,
  pendingChoices: null,
  claudeSessionId: null
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

  it('loads summaries from the index without reading session bodies', () => {
    const writer = new SessionStore(path.join(root, 'e'))
    writer.save(summary('s1'), [item('s1', 'big transcript')])
    writer.save(summary('s2'), [])

    // Corrupt a session body AFTER the index was written — a fresh store must
    // still list it, proving startup never parses transcripts.
    fs.writeFileSync(path.join(root, 'e', 'game-a', 's1.json'), '{definitely not json', 'utf8')
    const reader = new SessionStore(path.join(root, 'e'))
    expect(reader.loadAllSummaries().map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('rebuilds a missing index from legacy session files (self-healing migration)', () => {
    const writer = new SessionStore(path.join(root, 'f'))
    writer.save(summary('s1'), [item('s1', 'x')])
    writer.save(summary('s2'), [])
    const indexFile = path.join(root, 'f', 'game-a', 'index.json')
    fs.rmSync(indexFile)

    const reader = new SessionStore(path.join(root, 'f'))
    expect(reader.loadAllSummaries().map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(fs.existsSync(indexFile)).toBe(true)
  })

  it('never counts index.json as a session when pruning', () => {
    const store = new SessionStore(path.join(root, 'g'))
    store.save(summary('s1'), [])
    store.save(summary('s2'), [])
    expect(store.prune('game-a', 2)).toEqual([])
    expect(fs.existsSync(path.join(root, 'g', 'game-a', 'index.json'))).toBe(true)
  })
})
