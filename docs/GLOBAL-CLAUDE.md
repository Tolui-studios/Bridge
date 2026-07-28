# Tolui Studios — Global Agent Conventions

> Canonical copy lives in the Bridge repo (`docs/GLOBAL-CLAUDE.md`). Install on every dev machine as `~/.claude/CLAUDE.md` so ALL agents in ALL game repos inherit it — Bridge-launched agents load it automatically. When you improve it, update the repo copy and re-copy to each machine.

You are working in a Roblox game repo (Luau, synced to Roblox Studio via Rojo) belonging to Tolui Studios, usually launched and supervised by Bridge, the studio's mission-control app.

## Hard boundaries

1. **Edit only the Luau source tree (`src/`).** Never touch the Rojo layer: no `rojo` commands, no edits to `default.project.json` or sourcemaps. Rojo is the operator's VS Code ↔ Studio sync; it needs nothing from you.
2. **Studio-side work goes through the Roblox Studio MCP, never through this repo.** If `mcp__robloxstudio__*` tools are present in your session, you can do instance/asset work with them (see "3D models & Studio-side work" below). If they are not present, say clearly in your final message what Studio-side work is needed — never fake instances in code or pretend placement happened.
3. **Never edit GOALS.md.** Bridge owns it. Report progress with the marker lines Bridge teaches you (`BRIDGE:START/DONE/ADD <item>`).
4. **Plan before executing.** Read the systems you'll touch first, state a short plan, then implement. Don't restructure systems you weren't asked to touch.
5. Don't add external dependencies (Wally packages, etc.) without being asked.

## The studio stack (use these, don't reinvent)

Full reference with pins: `docs/ROBLOX-STACK.md` in the Bridge repo. Toolchain: Rokit → Rojo, Lune, Wally, Selene.

- **Bootstrap:** hand-rolled Init/Start singleton loader — **never introduce Knit or Flamework**. Server systems are ModuleScripts in `src/server/Services/`, client ones in `src/client/Controllers/`; the init scripts auto-require them, call `:Init()` on all (setup, no cross-system calls), then `:Start()` on all (wiring). Adding a system = adding a module there; never edit the init scripts for that.
- **Data:** ProfileStore (session-locked) behind `server/Managers/DataManager` — all persistence goes through it. Replicate to clients with **Replica** (`server/Managers/ReplicaManager`), not hand-rolled remotes.
- **Networking:** **ByteNet namespaces in `src/shared/Remotes/`**. Raw RemoteEvents/RemoteFunctions are banned. Exact API + the join-time trap: see "ByteNet — exact API" below.
- **State/UI:** Reflex for state; React + React-Roblox 17 (jsdotlua) under `client/UI/` — App.luau plus Components/Context/Hooks/Theme/Views; Ripple for animation; UI-Labs stories in `src/stories/`.
- **Utilities:** Trove for lifetime cleanup (one Trove per system, `:Clean()` on teardown), Signal for events, Observers for player/tag/attribute observation, Cmdr for admin commands (`server/Commands/`).
- Packages come from Wally (`wally.toml`) and mount at `ReplicatedStorage.Packages`. Bridge installs the toolchain and `Packages/` into your workspace before you start. If `Packages/` is missing anyway, say so instead of guessing package APIs.
- **The toolchain is on your PATH** (via Rokit): `selene`, `stylua`, `lune`, `wally`, `rojo`. USE them for verification — `selene src` and `stylua --check src` before finishing; `lune` for running Luau scripts/tests outside Studio. You may add a Wally dependency when the task clearly needs one (prefer the standard set first; call out any addition in your final message). Still never run `rojo serve`/`build` or edit `default.project.json` — sync stays operator-owned.

## ByteNet — exact API (pinned 0.4.6)

Wally pin `ffrostflame/bytenet@0.4.6`; `local ByteNet = require(ReplicatedStorage.Packages.ByteNet)`. `Packages/` may be absent in your worktree — trust this reference over guessing, and never use the unreleased 0.5.0 API (`define_packet`, `ByteNet.t.*`) or the doc site's dead `ByteNet.dataTypes.*()` style.

One namespace module per feature in `src/shared/Remotes/`, required by BOTH server and client — the client's `defineNamespace` yields until the server has defined the same namespace, so the server must always require it too:

```lua
--!strict
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ByteNet = require(ReplicatedStorage.Packages.ByteNet)

return ByteNet.defineNamespace("damage", function()
    return {
        -- client -> server
        requestSetEnabled = ByteNet.definePacket({ value = ByteNet.bool }),
        requestSync = ByteNet.definePacket({ value = ByteNet.nothing }),
        -- server -> client
        stateChanged = ByteNet.definePacket({
            value = ByteNet.struct({ enabled = ByteNet.bool, count = ByteNet.uint16 }),
            reliabilityType = "reliable", -- the default; or "unreliable"
        }),
    }
end)
```

- **Dot-calls only, data first, player second.** Packets are closures, not objects — `pkt:sendTo(...)` silently corrupts the payload. Server: `sendTo(data, player)`, `sendToAll(data)`, `sendToList(data, players)`, `sendToAllExcept(data, exceptPlayer)`. Client: `send(data)` — `send(nil)` for a `nothing` packet. Both: `listen(callback)` (server callback gets `(data, player: Player?)` — nil-guard it; client callback gets `(data)`) and `wait()`.
- **Types.** Plain values, do NOT call them: `bool` `string` `buff` `inst` `unknown` `nothing` `uint8` `uint16` `uint32` `int8` `int16` `int32` `float32` `float64` `vec2` `vec3` `cframe`. Callables: `struct({...})`, `array(t)`, `optional(t)`, `map(k, v)`. Nothing else exists — no `color3` (send `struct{ r/g/b = uint8 }`), no `number` (pick a width), no `enum`, no `uint64`. In `definePacket`, only `value` (required) and `reliabilityType` (optional, default `"reliable"`) do anything.
- Create `struct`s only INSIDE the namespace closure, and keep the closure identical on both sides — struct identity is creation order within it.
- **No request/response.** ByteNet has no invoke/RemoteFunction equivalent — model RPC as two packets. `wait()` has no correlation; it is not a safe RPC.
- Calling a wrong-context method (`send` on the server, `sendTo` on the client) errors as `attempt to call a nil value` — ByteNet's own guard message is broken, so recognize that cryptic form.
- **The join-time crash (agents keep shipping this):** `bufferWriter:148: attempt to index nil with 'size'` from `sendTo` means the target player's ByteNet send buffer doesn't exist yet. ByteNet creates it only in its own `Players.PlayerAdded` connection — your own `PlayerAdded` handler can run first, and a `GetPlayers()` seed loop for already-present players definitely does. **Never push to a player at join time.** Initial state is client-pull: the client controller `send`s a `requestSync` packet from `:Start()`, the server replies inside that `listen` handler (a packet arriving from the player proves their buffer exists), and pushes deltas only to players that have completed that first sync. Seed per-player rate-limit clocks with `-math.huge`, not `0`, or the first sync request gets swallowed.

## 3D models & Studio-side work

When your session has the `mcp__robloxstudio__*` tools, you can create real, **persistent** 3D content — and there is a dedicated skill for it: **invoke the `generate-3d-model` skill** whenever asked to create/generate a model, mesh, prop, or asset. Follow it exactly; the failure modes are silent. The non-negotiables it enforces:

- Generated meshes are **runtime-only and vanish on Studio restart** until uploaded: fork-verify the geometry is alive, then persist with `AssetService:CreateAssetAsync` (mesh + texture) in the same session, rebuild via `CreateMeshPartAsync`, and confirm `MeshContent.SourceType == "Uri"` — only then is it real, replicating, and restart-proof.
- Generate **serially, never in parallel** — parallel calls return fake successes with dead geometry.
- **Subagents don't lift the serial rule.** One subagent per model is fine (good context hygiene — each runs the full generate→verify→persist pipeline for its model), but generation stays strictly serial *machine-wide*: never two `generate_model` calls in flight at once, across subagents AND across sessions. Every agent's MCP server funnels into ONE local bridge (port 58741) and ONE Studio GenerationService — parallel calls are exactly the fake-success/dead-geometry failure above. Also: BRIDGE markers are only read from the top-level agent's replies — a subagent's output is never scanned, so report progress yourself.
- Simple shapes (crates, walls, ramps) are part-builds (`create_object`), not generation; Creator Store search is another fallback.
- **Never place assets inside Rojo-managed `$path` folders** — sync reconciliation can delete them. Use sibling containers Rojo doesn't own (check `default.project.json`).
- Verify visually with screenshots (edit mode AND playtest client) and report asset IDs, master location, and placements.

## Luau conventions

- `--!strict` at the top of every file. Type public function signatures and module APIs; avoid `any` — infer or annotate.
- Modules return a table; **no side effects at require time** — work happens in `:Init()`/`:Start()`.
- All tunable numbers live in `src/shared/Config/` (or `server/SETTINGS.luau` for server-wide knobs), never inline.
- Services once at the top: `local Players = game:GetService("Players")` — never `game.Players`.
- Naming: PascalCase for modules/types/services, camelCase for locals and functions, SCREAMING_SNAKE for constants.
- Modern task library only: `task.spawn`/`task.defer`/`task.wait` — never legacy `spawn`, `delay`, or global `wait`.
- Events over polling: never drive gameplay logic from `RenderStepped`/`Heartbeat` loops when a signal, event, or Observer works.
- Every connection lives in the system's Trove and dies with it.
- Guard clauses and early returns over deep nesting.

## Client/server rules

- **The server owns all state that matters.** The client renders and requests; it never decides outcomes (damage, currency, unlocks, spawns).
- Validate every ByteNet packet server-side: types, ranges, rate, and whether that player may do that thing right now. Assume the client is hostile.
- Never store secrets or authoritative data in ReplicatedStorage.

## Repo layout (every game is scaffolded like this)

| Folder | Mounts to |
|---|---|
| `src/client/` (Controllers, Managers, Signals, UI) | `StarterPlayer.StarterPlayerScripts.Client` |
| `src/server/` (Services, Managers, Commands, SETTINGS) | `ServerScriptService.Server` |
| `src/shared/` (Config, Data, Enums, Types, Utils, Remotes) | `ReplicatedStorage.Shared` |
| `src/stories/` | `ServerStorage.Stories` |
| `Packages/` (gitignored, Wally output) | `ReplicatedStorage.Packages` |

## Verification

You cannot run the game. Verify what you can: `selene src` and `stylua --check src` when available (configs are in the repo; tools via Rokit), require-graph sanity (no cycles, no client requiring server modules), and strict-mode type discipline. Jest (jsdotlua) specs exist for pure shared logic where the game has them. Say plainly what could only be verified in Studio.
