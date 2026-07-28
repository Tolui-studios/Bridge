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
- **Networking:** ByteNet namespaces defined in `src/shared/Remotes/` — raw RemoteEvents/Functions are banned. Full API reference below.
- **State/UI:** Reflex stores; React 17 (jsdotlua) mounted from a UI controller; stories for UI-Labs live in `src/stories/`.

## Networking (ByteNet 0.4.6)

Everything below is verified against the installed `Packages/_Index/ffrostflame_bytenet@0.4.6` source. Trust it over the official docs site, which is stale: the homepage's `ByteNet.dataTypes.vec3()` style was removed long ago, the `defineNamespace` API page is empty, and the `sendToAllExcept` example is missing its argument. The wally scope is `ffrostflame` (the author later renamed to `ffrostfall` on GitHub — same library). Do NOT target `master`/0.5.0 (`define_packet`, `ByteNet.t.*`): unreleased, not on wally, different API.

### Defining packets

One namespace module per feature in `src/shared/Remotes/`, returned from `ByteNet.defineNamespace(name, closure)` where the closure returns a dict of `ByteNet.definePacket` results. The same module must be required by BOTH sides: packet IDs come from a server-side counter replicated to clients, and the client's `defineNamespace` yields until the server has defined that namespace — if the server never requires the module, the client hangs forever.

`definePacket` props: `value` (required — the packet's data type; use `ByteNet.nothing` for empty packets) and `reliabilityType` (`"reliable"` — the default — or `"unreliable"`). The `callbackBehavior` field in the exported type is never read by 0.4.6 — dead, don't use it.

### Data types

| Kind | Types |
|---|---|
| Plain values (do NOT call) | `bool` `string` `buff` `inst` `unknown` `nothing` `uint8` `uint16` `uint32` `int8` `int16` `int32` `float32` `float64` `vec2` `vec3` `cframe` |
| Callables | `struct({...})` `array(t)` `optional(t)` `map(k, v)` |

That table is exhaustive. `color3` is NOT exported in 0.4.6 (the source file exists but `init.luau` never requires it) — send `struct{ r/g/b = uint8 }`. No `number` (pick an int/float width), no `enum`, no `uint64`.

- `struct`s must be created inside the namespace closure, and the closure must stay identical on server and client — struct identity is creation order within it.
- `array`/`map` use a uint16 length prefix: hard cap 65,536 entries; mixed tables are undefined behavior.
- Specials (`struct`/`array`/`optional`/`map`) cost 1–2 bytes each plus parse/memory overhead — fine normally, avoid in ultra-hot paths.
- Unreliable packets ride `UnreliableRemoteEvent`: ~900-byte payload limit, drops and reordering expected.

### Sending and receiving

Packets are closures, not objects: **always dot-call** — `pkt:sendTo(...)` passes the packet table as `data` and silently corrupts the payload. Where a player is a parameter it is always SECOND, data first (an intentional ByteNet design choice).

| Side | Calls |
|---|---|
| server | `pkt.sendTo(data, player)` · `pkt.sendToAll(data)` · `pkt.sendToList(data, players)` · `pkt.sendToAllExcept(data, exceptPlayer)` |
| client | `pkt.send(data)` — `send(nil)` for a `nothing` packet |
| both | `pkt.listen(cb)` — server cb `(data, player: Player?)` (nil-guard it), client cb `(data)` · `pkt.wait()` (yields for next receipt) · `pkt.getListeners()` (undocumented) |

- Wrong-context calls (`send` on the server, `sendTo` on the client) error as `attempt to call a nil value` — ByteNet's intended "You cannot use sendTo… on the client" guard has a broken `__index` signature and never fires. Recognize the cryptic form.
- **No request/response.** There is no invoke/RemoteFunction equivalent. Model RPC as two packets (request + response, with your own correlation id if concurrent); `pkt.wait()` has no correlation and is not a safe RPC.

### The join-time crash (the recurring agent bug)

`bufferWriter:148: attempt to index nil with 'size'` from a server `sendTo` means the target player's per-player send buffer doesn't exist yet. ByteNet creates it only inside its own `Players.PlayerAdded` connection (wired at require time — no lazy-create, no nil-guard). Your own `PlayerAdded` handler can fire before ByteNet's, and a `GetPlayers()` seed loop for already-present players definitely beats it.

1. **Never `sendTo`/`sendToList` a player from join-time code** — not from your `PlayerAdded` handler, not from a seed loop over existing players.
2. **Initial state is client-pull:** the client controller `send`s a `requestSync` packet from `:Start()`; the server replies inside that `listen` handler — a packet arriving FROM the player proves their buffer exists. Push deltas only to players that have completed that first sync (track a per-player `synced` flag).
3. Seed per-player rate-limit clocks with `-math.huge`, not `0` — an `os.clock()`-based limiter seeded at `0` swallows the player's very first sync request.
