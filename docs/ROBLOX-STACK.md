# Tolui Studios — Roblox Stack Reference

The canonical description of how every studio game is built. `Create new game` in Bridge scaffolds exactly this; agents get the summarized rules via the global conventions (`docs/GLOBAL-CLAUDE.md`).

## Toolchain (rokit.toml)

| Tool | Pin | What it is |
|---|---|---|
| Rokit | — | toolchain manager |
| Rojo | 7.7.0 | file ↔ Roblox sync/build |
| Lune | 0.10.4 | Luau task runtime |
| Wally | 0.3.2 | package manager |
| wally-package-types | 1.6.2 | LSP types for packages |
| Selene | 0.29.0 | linter |

## Packages (wally.toml)

Registry: `https://github.com/UpliftGames/wally-index` · realm shared · Packages mount at `game.ReplicatedStorage.Packages`.

**Core:** ProfileStore 1.0.3 (session-locked data persistence) · ByteNet 0.4.6 (client↔server networking) · Replica 0.2.0 (server→client state replication) · Signal 2.0.3 (events) · Trove 1.8.0 (cleanup) · Observers 0.4.0 (player/tag/attribute observation) · PartCache 1.0.1 (pooled parts) · CameraShaker 1.0.0 · Cmdr 1.12.0 (admin command bar) · QuickZone 1.0.0 (zone detection) · UI-Labs 2.4.2 (in-Studio UI browser)

**UI:** React + React-Roblox 17.2.1 · Ripple 0.10.2 (animation) · TopBarPlus 3.4.0

**State:** Reflex 4.3.1 · React-Reflex 0.3.6

**Optional per genre:** FastCast 1.0.0 (projectile raycasting) · RoQuest 0.1.6 (quests) · BTrees 5.0.18 (AI behavior trees)

**Dev:** Jest + JestGlobals 3.10.0 (jsdotlua)

## Folder structure

```
src/
  client/            -> StarterPlayer.StarterPlayerScripts.Client
    init.client.luau      (Init/Start bootstrap over Controllers/)
    Controllers/  Managers/  Signals/
    UI/                 App.luau + Components/ Context/ Hooks/ Theme/ Views/
  server/            -> ServerScriptService.Server
    init.server.luau      (Init/Start bootstrap over Services/)
    SETTINGS.luau
    Services/  Managers/ (DataManager, ReplicaManager)  Commands/
  shared/            -> ReplicatedStorage.Shared
    Config/  Data/  Enums/  Types/  Utils/
    Remotes/            (ByteNet namespaces)
  stories/           -> ServerStorage.Stories (UI-Labs)
Packages/            -> ReplicatedStorage.Packages (Wally output, gitignored)
```

## Config files

- `selene.toml`: `std = 'roblox'`
- `stylua.toml`: 100 cols, 4-space indent, prefer double quotes
- `.luaurc`: `{ "aliases": { "lune": "~/.lune/.typedefs/0.10.4/" } }`
- `.gitignore`: `Packages/`, `sourcemap.json`, `wally.lock`, `.env.local`

## The architecture, named

- **Bootstrap:** a hand-rolled Init/Start singleton loader — **no Knit, no Flamework**. The init scripts require every ModuleScript in `Services/` (server) / `Controllers/` (client), call `:Init()` on all (setup, no cross-talk), then `:Start()` on all (wiring). Adding a system = dropping a module in the folder.
- **Data:** ProfileStore behind `server/Managers/DataManager`; replicated to clients with Replica via `server/Managers/ReplicaManager`.
- **Networking:** ByteNet namespaces defined in `src/shared/Remotes/` — raw RemoteEvents/Functions are banned.
- **State/UI:** Reflex stores; React 17 (jsdotlua) mounted from a UI controller; stories for UI-Labs live in `src/stories/`.
