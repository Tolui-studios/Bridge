import fs from 'node:fs'
import path from 'node:path'

/**
 * Seed a brand-new game with the studio's Roblox project shape: Rojo project
 * file, Luau src tree (shared/server/client), a game CLAUDE.md wired to the
 * studio conventions, lint/format configs, and a Roblox .gitignore. Existing
 * files are never overwritten, so this is safe to run on partial folders.
 */
export function scaffoldRobloxGame(dir: string, name: string, slug: string): string[] {
  const created: string[] = []
  const write = (relPath: string, content: string): void => {
    const abs = path.join(dir, relPath)
    if (fs.existsSync(abs)) return
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
    created.push(relPath)
  }

  write(
    'default.project.json',
    `${JSON.stringify(
      {
        name: slug,
        tree: {
          $className: 'DataModel',
          ReplicatedStorage: { Shared: { $path: 'src/shared' } },
          ServerScriptService: { Server: { $path: 'src/server' } },
          StarterPlayer: {
            StarterPlayerScripts: { Client: { $path: 'src/client' } }
          }
        }
      },
      null,
      2
    )}\n`
  )

  write(
    '.gitignore',
    [
      '/sourcemap.json',
      '/*.rbxl',
      '/*.rbxl.lock',
      '/*.rbxlx',
      '/*.rbxlx.lock',
      '/Packages',
      '/ServerPackages',
      '/DevPackages',
      ''
    ].join('\n')
  )

  write(
    'stylua.toml',
    ['column_width = 100', 'indent_type = "Spaces"', 'indent_width = 4', 'quote_style = "AutoPreferDouble"', ''].join(
      '\n'
    )
  )

  write('selene.toml', 'std = "roblox"\n')

  write(
    'CLAUDE.md',
    [
      `# ${name}`,
      '',
      'Roblox game (Luau, Rojo-managed) in the Tolui Studios portfolio, worked on by Bridge-launched agents.',
      '',
      '- Studio-wide Luau/Rojo/agent conventions come from the global `~/.claude/CLAUDE.md` — they apply here in full (edit only `src/`, never touch Rojo, server owns state, `--!strict` everywhere).',
      '- Current goal + checklist: `GOALS.md`. Bridge owns that file — report progress with `BRIDGE:START/DONE/ADD <item>` markers, never edit it.',
      '- Deep design docs live in the studio Obsidian vault under this game’s folder; attached notes arrive in your prompt when relevant.',
      '',
      '## Structure',
      '',
      '| Folder | Mounts to | Runs on |',
      '|---|---|---|',
      '| `src/shared/` | `ReplicatedStorage.Shared` | both |',
      '| `src/server/` | `ServerScriptService.Server` | server |',
      '| `src/client/` | `StarterPlayer.StarterPlayerScripts.Client` | client |',
      '',
      'One system per module under `src/shared/systems/` with a `Config` module beside it.',
      '',
      '## Game rules',
      '',
      '_Fill in as design solidifies: core pillars, don’t-touch systems, naming specifics._',
      ''
    ].join('\n')
  )

  write(
    'src/shared/Hello.luau',
    [
      '--!strict',
      '-- Starter module proving the Rojo tree + strict Luau conventions.',
      '',
      'local Hello = {}',
      '',
      'function Hello.greet(who: string): string',
      '    return `Hello, {who}!`',
      'end',
      '',
      'return Hello',
      ''
    ].join('\n')
  )

  write(
    'src/server/init.server.luau',
    [
      '--!strict',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      '',
      'local Hello = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Hello"))',
      '',
      `print(Hello.greet("${name} server"))`,
      ''
    ].join('\n')
  )

  write(
    'src/client/init.client.luau',
    [
      '--!strict',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      '',
      'local Hello = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Hello"))',
      '',
      `print(Hello.greet("${name} client"))`,
      ''
    ].join('\n')
  )

  return created
}
