import fs from 'node:fs'
import path from 'node:path'

/**
 * Seed a brand-new game with the studio's real Roblox stack: Rokit toolchain
 * pins, Wally packages, the Rojo tree (client/server/shared/stories), the
 * hand-rolled Init/Start bootstrap,
 * and a per-game CLAUDE.md wired to the studio conventions. Canonical stack
 * reference: docs/ROBLOX-STACK.md. Existing files are never overwritten.
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

  const wallyName = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'game'

  write(
    'rokit.toml',
    [
      '[tools]',
      'rojo = "rojo-rbx/rojo@7.7.0"',
      'lune = "lune-org/lune@0.10.4"',
      'wally = "UpliftGames/wally@0.3.2"',
      'wally-package-types = "JohnnyMorganz/wally-package-types@1.6.2"',
      'selene = "Kampfkarren/selene@0.29.0"',
      ''
    ].join('\n')
  )

  write(
    'wally.toml',
    [
      '[package]',
      `name = "tolui-studios/${wallyName}"`,
      'version = "0.1.0"',
      'registry = "https://github.com/UpliftGames/wally-index"',
      'realm = "shared"',
      '',
      '[place]',
      'shared-packages = "game.ReplicatedStorage.Packages"',
      '',
      '[dependencies]',
      '# CORE',
      'ProfileStore = "vyon/profilestore@1.0.3"          # data persistence (session-locked)',
      'ByteNet = "ffrostflame/bytenet@0.4.6"             # client<->server networking',
      'Replica = "stargamesstudio/replica@0.2.0"         # server->client state replication',
      'Signal = "sleitnick/signal@2.0.3"                 # events',
      'Trove = "sleitnick/trove@1.8.0"                   # cleanup',
      'Observers = "sleitnick/observers@0.4.0"           # player/tag/attribute observation',
      'PartCache = "4igz/partcache@1.0.1"                # pooled parts',
      'CameraShaker = "encrxyptedethan/camerashaker@1.0.0" # camera shake',
      'Cmdr = "evaera/cmdr@1.12.0"                       # admin command bar',
      'QuickZone = "ldgerrits/quickzone@1.0.0"           # zone detection',
      'UI-Labs = "pepeeltoro41/ui-labs@2.4.2"            # in-Studio UI browser',
      '',
      '# UI',
      'React = "jsdotlua/react@17.2.1"',
      'React-Roblox = "jsdotlua/react-roblox@17.2.1"',
      'Ripple = "littensy/ripple@0.10.2"                 # React animation',
      'TopBarPlus = "1foreverhd/topbarplus@3.4.0"        # top-bar UI',
      '',
      '# STATE',
      'Reflex = "littensy/reflex@4.3.1"                  # state management',
      'React-Reflex = "littensy/react-reflex@0.3.6"',
      '',
      '# OPTIONAL (uncomment per genre)',
      '# FastCast = "megamonsta2/fastcast@1.0.0"         # projectile raycasting',
      '# RoQuest = "prooheckcp/roquest@0.1.6"            # quests',
      '# BTrees = "onv-il/btreesv5@5.0.18"               # AI behavior trees',
      '',
      '[dev-dependencies]',
      'Jest = "jsdotlua/jest@3.10.0"',
      'JestGlobals = "jsdotlua/jest-globals@3.10.0"',
      ''
    ].join('\n')
  )

  write(
    'default.project.json',
    `${JSON.stringify(
      {
        name,
        tree: {
          $className: 'DataModel',
          ReplicatedStorage: {
            Shared: { $path: 'src/shared' },
            Packages: { $path: 'Packages' }
          },
          ServerScriptService: {
            Server: { $path: 'src/server' }
          },
          ServerStorage: {
            Stories: { $path: 'src/stories' }
          },
          StarterPlayer: {
            StarterPlayerScripts: {
              Client: { $path: 'src/client' }
            }
          }
        }
      },
      null,
      2
    )}\n`
  )

  // DevPackages/ is Wally's [dev-dependencies] output. Leaving it untracked
  // makes every worktree permanently "dirty": `git worktree remove` refuses,
  // the uncommitted count is inflated by hundreds of files, and a commit-all
  // would sweep the whole vendored tree into the branch.
  // wally.lock is deliberately NOT ignored: committing it pins resolved
  // package versions for every clone and agent worktree, and toolchain.ts
  // uses lockfile equality to validate seeding Packages/ into worktrees.
  write(
    '.gitignore',
    ['Packages/', 'DevPackages/', 'sourcemap.json', '.env.local', ''].join('\n')
  )
  write('selene.toml', "std = 'roblox'\n")
  write(
    'stylua.toml',
    ['column_width = 100', 'indent_type = "Spaces"', 'indent_width = 4', 'quote_style = "AutoPreferDouble"', ''].join(
      '\n'
    )
  )
  write('.luaurc', `${JSON.stringify({ aliases: { lune: '~/.lune/.typedefs/0.10.4/' } }, null, 2)}\n`)

  write(
    'CLAUDE.md',
    [
      `# ${name}`,
      '',
      'Roblox game (Luau, Rojo-managed) in the Tolui Studios portfolio, worked on by Bridge-launched agents. The studio-wide conventions from the global `~/.claude/CLAUDE.md` apply in full; the stack reference lives in the Bridge repo at `docs/ROBLOX-STACK.md`.',
      '',
      '- `GOALS.md` is Bridge-owned: report progress with `BRIDGE:START/DONE/ADD <item>` markers, never edit it.',
      '- Deep design docs live in the studio Obsidian vault under this game’s folder.',
      '',
      '## Architecture (named)',
      '',
      '- **Bootstrap:** hand-rolled Init/Start singleton loader (no Knit/Flamework). `init.server.luau` loads every ModuleScript in `Services/`; `init.client.luau` loads `Controllers/`. Each exposes optional `:Init()` (setup, no cross-talk) then `:Start()` (wiring). Add a system = drop a module in the right folder.',
      '- **Data:** ProfileStore (session-locked profiles) behind `server/Managers/DataManager`, replicated with Replica via `server/Managers/ReplicaManager`.',
      '- **Networking:** ByteNet namespaces in `src/shared/Remotes/` — never raw RemoteEvents/RemoteFunctions.',
      '- **State/UI:** Reflex stores; React + React-Roblox 17 under `client/UI/` (App.luau + Components/Context/Hooks/Theme/Views); Ripple for animation; UI-Labs stories in `src/stories/`.',
      '- **Utilities:** Trove for cleanup, Signal for events, Observers for player/tag observation, Cmdr commands in `server/Commands/`.',
      '- **3D models:** when `mcp__robloxstudio__*` tools are in your session, use the `generate-3d-model` skill for meshes/props (persist via CreateAssetAsync — see global conventions); simple shapes are part-builds. The toolchain (selene/stylua/lune) is on your PATH for verification.',
      '',
      '## Tree',
      '',
      '| Folder | Mounts to |',
      '|---|---|',
      '| `src/client/` (Controllers, Managers, Signals, UI) | `StarterPlayer.StarterPlayerScripts.Client` |',
      '| `src/server/` (Services, Managers, Commands, SETTINGS) | `ServerScriptService.Server` |',
      '| `src/shared/` (Config, Data, Enums, Types, Utils, Remotes) | `ReplicatedStorage.Shared` |',
      '| `src/stories/` | `ServerStorage.Stories` |',
      '| `Packages/` (gitignored — wally install output) | `ReplicatedStorage.Packages` |',
      '',
      'Note: `Packages/` may be absent in agent worktrees (gitignored). Trust `wally.toml` for what exists; require packages as `ReplicatedStorage.Packages.<Name>`.',
      '',
      '## Game rules',
      '',
      '_Fill in as design solidifies: core pillars, don’t-touch systems, naming specifics._',
      ''
    ].join('\n')
  )

  write(
    'src/server/init.server.luau',
    [
      '--!strict',
      '-- Bootstrap: require every Service, :Init() all, then :Start() all.',
      '-- Add gameplay systems as ModuleScripts under Services/ — never here.',
      '',
      'local services: { [string]: any } = {}',
      '',
      'for _, child in script.Services:GetChildren() do',
      '    if child:IsA("ModuleScript") then',
      '        services[child.Name] = require(child) :: any',
      '    end',
      'end',
      '',
      'for _, service in services do',
      '    if typeof(service.Init) == "function" then',
      '        service:Init()',
      '    end',
      'end',
      '',
      'for _, service in services do',
      '    if typeof(service.Start) == "function" then',
      '        task.spawn(function()',
      '            service:Start()',
      '        end)',
      '    end',
      'end',
      '',
      'print("[Server] booted")',
      ''
    ].join('\n')
  )

  write(
    'src/server/SETTINGS.luau',
    [
      '--!strict',
      '-- Server-wide tunables. Systems read from here; no inline magic numbers.',
      '',
      'return table.freeze({',
      '    VERSION = "0.1.0",',
      '})',
      ''
    ].join('\n')
  )

  write(
    'src/server/Services/ExampleService.luau',
    [
      '--!strict',
      '-- Template Service showing the shape the bootstrap expects. Delete when',
      '-- the first real Service lands.',
      '',
      'local ExampleService = {}',
      '',
      'function ExampleService:Init()',
      '    -- Resolve references and build internal state. No cross-service calls yet.',
      'end',
      '',
      'function ExampleService:Start()',
      '    -- Everything has Init()ed — safe to talk to other services here.',
      'end',
      '',
      'return ExampleService',
      ''
    ].join('\n')
  )

  write(
    'src/client/init.client.luau',
    [
      '--!strict',
      '-- Bootstrap: require every Controller, :Init() all, then :Start() all.',
      '-- UI mounting belongs in a Controller (see UI/App.luau).',
      '',
      'local controllers: { [string]: any } = {}',
      '',
      'for _, child in script.Controllers:GetChildren() do',
      '    if child:IsA("ModuleScript") then',
      '        controllers[child.Name] = require(child) :: any',
      '    end',
      'end',
      '',
      'for _, controller in controllers do',
      '    if typeof(controller.Init) == "function" then',
      '        controller:Init()',
      '    end',
      'end',
      '',
      'for _, controller in controllers do',
      '    if typeof(controller.Start) == "function" then',
      '        task.spawn(function()',
      '            controller:Start()',
      '        end)',
      '    end',
      'end',
      '',
      'print("[Client] booted")',
      ''
    ].join('\n')
  )

  write(
    'src/client/Controllers/ExampleController.luau',
    [
      '--!strict',
      '-- Template Controller showing the shape the bootstrap expects. Delete when',
      '-- the first real Controller lands.',
      '',
      'local ExampleController = {}',
      '',
      'function ExampleController:Init()',
      '    -- Resolve references and build internal state. No cross-controller calls yet.',
      'end',
      '',
      'function ExampleController:Start()',
      '    -- Everything has Init()ed — safe to talk to other controllers here.',
      'end',
      '',
      'return ExampleController',
      ''
    ].join('\n')
  )

  write(
    'src/client/UI/App.luau',
    [
      '--!strict',
      '-- Root React component. Mounted by a UI controller via React-Roblox.',
      '',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      '',
      'local React = require(ReplicatedStorage.Packages.React)',
      '',
      'local function App()',
      '    return React.createElement("ScreenGui", {',
      '        ResetOnSpawn = false,',
      '        IgnoreGuiInset = true,',
      '    }, {})',
      'end',
      '',
      'return App',
      ''
    ].join('\n')
  )

  const keepDirs = [
    'src/client/Managers',
    'src/client/Signals',
    'src/client/UI/Components',
    'src/client/UI/Context',
    'src/client/UI/Hooks',
    'src/client/UI/Theme',
    'src/client/UI/Views',
    'src/server/Managers',
    'src/server/Commands',
    'src/shared/Config',
    'src/shared/Data',
    'src/shared/Enums',
    'src/shared/Types',
    'src/shared/Utils',
    'src/shared/Remotes',
    'src/stories'
  ]
  for (const dirPath of keepDirs) {
    write(path.join(dirPath, '.gitkeep'), '')
  }

  return created
}
