import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scaffoldRobloxGame } from './robloxScaffold'

let root: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-scaffold-'))
})

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

describe('scaffoldRobloxGame', () => {
  it('creates the full Rojo project shape', () => {
    const dir = path.join(root, 'fresh')
    fs.mkdirSync(dir)
    const created = scaffoldRobloxGame(dir, 'Kingdom of Ash', 'Kingdom-of-Ash')

    expect(created).toContain('default.project.json')
    const project = JSON.parse(fs.readFileSync(path.join(dir, 'default.project.json'), 'utf8'))
    expect(project.name).toBe('Kingdom-of-Ash')
    expect(project.tree.ReplicatedStorage.Shared.$path).toBe('src/shared')
    expect(project.tree.ServerScriptService.Server.$path).toBe('src/server')

    for (const file of [
      'CLAUDE.md',
      '.gitignore',
      'stylua.toml',
      'selene.toml',
      'src/shared/Hello.luau',
      'src/server/init.server.luau',
      'src/client/init.client.luau'
    ]) {
      expect(fs.existsSync(path.join(dir, file))).toBe(true)
    }

    const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('# Kingdom of Ash')
    expect(claude).toContain('BRIDGE:START/DONE/ADD')
    const hello = fs.readFileSync(path.join(dir, 'src/shared/Hello.luau'), 'utf8')
    expect(hello).toContain('--!strict')
    expect(hello).toContain('`Hello, {who}!`')
  })

  it('never overwrites existing files', () => {
    const dir = path.join(root, 'partial')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'my own rules\n')
    const created = scaffoldRobloxGame(dir, 'Partial', 'Partial')
    expect(created).not.toContain('CLAUDE.md')
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('my own rules\n')
    expect(fs.existsSync(path.join(dir, 'default.project.json'))).toBe(true)
  })
})
