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
  it('creates the full studio stack shape', () => {
    const dir = path.join(root, 'fresh')
    fs.mkdirSync(dir)
    scaffoldRobloxGame(dir, 'Kingdom of Ash', 'Kingdom-of-Ash')

    const project = JSON.parse(fs.readFileSync(path.join(dir, 'default.project.json'), 'utf8'))
    expect(project.name).toBe('Kingdom of Ash')
    expect(project.tree.ReplicatedStorage.Shared.$path).toBe('src/shared')
    expect(project.tree.ReplicatedStorage.Packages.$path).toEqual({ optional: 'Packages' })
    expect(project.tree.ServerStorage.Stories.$path).toBe('src/stories')
    expect(project.tree.Lighting).toBeUndefined()
    expect(project.tree.ReplicatedFirst).toBeUndefined()

    const rokit = fs.readFileSync(path.join(dir, 'rokit.toml'), 'utf8')
    expect(rokit).toContain('rojo-rbx/rojo@7.7.0')
    expect(rokit).toContain('Kampfkarren/selene@0.29.0')
    expect(rokit).toContain('JohnnyMorganz/StyLua@2.5.2')

    const wally = fs.readFileSync(path.join(dir, 'wally.toml'), 'utf8')
    expect(wally).toContain('name = "tolui-studios/kingdom-of-ash"')
    expect(wally).toContain('vyon/profilestore@1.0.3')
    expect(wally).toContain('ffrostflame/bytenet@0.4.6')
    expect(wally).toContain('jsdotlua/react@17.2.1')
    expect(wally).toContain('# FastCast')

    for (const file of [
      'CLAUDE.md',
      '.gitignore',
      '.luaurc',
      'selene.toml',
      'stylua.toml',
      'src/server/init.server.luau',
      'src/server/SETTINGS.luau',
      'src/server/Services/ExampleService.luau',
      'src/client/init.client.luau',
      'src/client/Controllers/ExampleController.luau',
      'src/client/UI/App.luau',
      'src/shared/Remotes/.gitkeep',
      'src/stories/.gitkeep'
    ]) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true)
    }

    for (const gone of ['src/lighting', 'src/replicated-first']) {
      expect(fs.existsSync(path.join(dir, gone)), gone).toBe(false)
    }

    const bootstrap = fs.readFileSync(path.join(dir, 'src/server/init.server.luau'), 'utf8')
    expect(bootstrap).toContain('--!strict')
    expect(bootstrap).toContain('script.Services:GetChildren()')
    expect(bootstrap).toContain('service:Init()')
    expect(bootstrap).toContain('service:Start()')

    const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('# Kingdom of Ash')
    expect(claude).toContain('BRIDGE:START/DONE/ADD')
    expect(claude).toContain('ByteNet')
    expect(claude).toContain('no Knit/Flamework')

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('Packages/')
    expect(gitignore).toContain('DevPackages/')
    // wally.lock is committed on purpose — locked resolution for every clone
    // and worktree, and the seed-check signal for toolchain Packages reuse.
    expect(gitignore).not.toContain('wally.lock')
  })

  it('never overwrites existing files', () => {
    const dir = path.join(root, 'partial')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'my own rules\n')
    const created = scaffoldRobloxGame(dir, 'Partial', 'Partial')
    expect(created).not.toContain('CLAUDE.md')
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('my own rules\n')
    expect(fs.existsSync(path.join(dir, 'wally.toml'))).toBe(true)
  })
})
