import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VaultService } from './vault'
import type { AgentSessionSummary, Game } from '@shared/types'

let vaultDir: string

const game: Game = {
  id: 'g1',
  name: 'Sample Game',
  repoPath: 'C:\\nowhere',
  defaultBranch: 'main',
  worktreeRoot: 'C:\\nowhere-worktrees'
}

const summary: AgentSessionSummary = {
  id: 's1',
  gameId: 'g1',
  task: 'Build the coin pickup loop with sparkles',
  status: 'done',
  permissionMode: 'acceptEdits',
  allowedTools: ['Read'],
  model: 'claude-sonnet-5',
  cwd: 'C:\\worktrees\\agent-1',
  startedAt: 1000000,
  endedAt: 1180000,
  costUsd: 0.1234,
  numTurns: 7,
  error: null,
  testSteps: [],
  pendingQuestion: null,
  pendingChoices: null,
  claudeSessionId: null
}

beforeAll(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-vault-'))
  fs.mkdirSync(path.join(vaultDir, 'sample game'), { recursive: true })
  fs.writeFileSync(path.join(vaultDir, 'sample game', 'Design.md'), '# Design\nIsland loop.\n')
  fs.mkdirSync(path.join(vaultDir, 'sample game', 'systems'))
  fs.writeFileSync(path.join(vaultDir, 'sample game', 'systems', 'Coins.md'), 'coin rules\n')
  fs.mkdirSync(path.join(vaultDir, '_studio'))
  fs.writeFileSync(path.join(vaultDir, '_studio', 'Luau patterns.md'), 'patterns\n')
  fs.mkdirSync(path.join(vaultDir, 'Other Game'))
  fs.writeFileSync(path.join(vaultDir, 'Other Game', 'Secret.md'), 'not yours\n')
  fs.mkdirSync(path.join(vaultDir, '.obsidian'))
  fs.writeFileSync(path.join(vaultDir, '.obsidian', 'workspace.md'), 'internal\n')
})

afterAll(() => {
  try {
    fs.rmSync(vaultDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

function service(): VaultService {
  return new VaultService(() => vaultDir)
}

describe('VaultService.notesForGame', () => {
  it('finds the game folder case-insensitively plus shared knowledge folders, excluding dot-dirs and other games', () => {
    const notes = service().notesForGame(game)
    const names = notes.map((n) => n.name).sort()
    expect(names).toEqual(['Coins', 'Design', 'Luau patterns'])
    expect(notes.every((n) => !n.relPath.includes('.obsidian'))).toBe(true)
  })

  it('returns empty when no vault is configured', () => {
    expect(new VaultService(() => null).notesForGame(game)).toEqual([])
  })
})

describe('VaultService.buildContext', () => {
  it('injects note contents with headers and skips traversal attempts', () => {
    const notes = service().notesForGame(game)
    const design = notes.find((n) => n.name === 'Design')!
    const context = service().buildContext([design.relPath, path.join('..', 'evil.md')])
    expect(context).toContain('Vault note: Design')
    expect(context).toContain('Island loop.')
    expect(context).not.toContain('evil')
  })

  it('returns empty string for no selection', () => {
    expect(service().buildContext([])).toBe('')
  })
})

describe('VaultService write-backs', () => {
  it('creates Bridge Log.md with a header and appends subsequent runs', () => {
    const note = service().appendRunSummary(game, summary, {
      goalNotes: ['✓ Coin pickup loop'],
      lastText: 'All done, sparkles included.',
      lastResult: 'success · 7 turns · $0.1234 · 60.0s'
    })
    expect(note).toContain('Bridge Log.md')
    const file = path.join(vaultDir, 'sample game', 'Bridge Log.md')
    const first = fs.readFileSync(file, 'utf8')
    expect(first).toContain('# Bridge Log — Sample Game')
    expect(first).toContain('done — Build the coin pickup loop')
    expect(first).toContain('check-bar: ✓ Coin pickup loop')

    service().appendRunSummary(game, { ...summary, id: 's2', status: 'error' }, {
      goalNotes: [],
      lastText: null,
      lastResult: null
    })
    const second = fs.readFileSync(file, 'utf8')
    expect(second.match(/^## /gm)).toHaveLength(2)
    expect(second.indexOf('# Bridge Log')).toBe(0)
  })

  it('logs decisions to Decisions.md and requires a vault', () => {
    const rel = service().appendDecision(game, 'Use grid movement', 'Cheaper pathfinding.')
    expect(rel).toContain('Decisions.md')
    const content = fs.readFileSync(path.join(vaultDir, 'sample game', 'Decisions.md'), 'utf8')
    expect(content).toContain('# Decisions — Sample Game')
    expect(content).toContain('Use grid movement')
    expect(content).toContain('Cheaper pathfinding.')
    expect(() => new VaultService(() => null).appendDecision(game, 't', 'b')).toThrow('No vault connected')
  })

  it('falls back to the game name for the folder when none exists yet', () => {
    const other: Game = { ...game, id: 'g2', name: 'Brand New Game' }
    service().appendRunSummary(other, { ...summary, gameId: 'g2' }, { goalNotes: [], lastText: null, lastResult: null })
    expect(fs.existsSync(path.join(vaultDir, 'Brand New Game', 'Bridge Log.md'))).toBe(true)
  })
})
