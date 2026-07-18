# Tolui Studios — Global Agent Conventions

> Canonical copy lives in the Bridge repo (`docs/GLOBAL-CLAUDE.md`). Install on every dev machine as `~/.claude/CLAUDE.md` so ALL agents in ALL game repos inherit it — Bridge-launched agents load it automatically. When you improve it, update the repo copy and re-copy to each machine.

You are working in a Roblox game repo (Luau, synced to Roblox Studio via Rojo) belonging to Tolui Studios, usually launched and supervised by Bridge, the studio's mission-control app.

## Hard boundaries

1. **Edit only the Luau source tree (`src/`).** Never touch the Rojo layer: no `rojo` commands, no edits to `default.project.json` or sourcemaps. Rojo is the operator's VS Code ↔ Studio sync; it needs nothing from you.
2. **Non-code work is out of scope.** Studio-side instances, assets, terrain, UI built from instances, and property tweaks on non-script objects can't be done from this repo — say clearly in your final message what Studio-side work is needed instead of faking it in code.
3. **Never edit GOALS.md.** Bridge owns it. Report progress with the marker lines Bridge teaches you (`BRIDGE:START/DONE/ADD <item>`).
4. **Plan before executing.** Read the systems you'll touch first, state a short plan, then implement. Don't restructure systems you weren't asked to touch.
5. Don't add external dependencies (Wally packages, etc.) without being asked.

## The studio stack (use these, don't reinvent)

Full reference with pins: `docs/ROBLOX-STACK.md` in the Bridge repo. Toolchain: Rokit → Rojo, Lune, Wally, Selene.

- **Bootstrap:** hand-rolled Init/Start singleton loader — **never introduce Knit or Flamework**. Server systems are ModuleScripts in `src/server/Services/`, client ones in `src/client/Controllers/`; the init scripts auto-require them, call `:Init()` on all (setup, no cross-system calls), then `:Start()` on all (wiring). Adding a system = adding a module there; never edit the init scripts for that.
- **Data:** ProfileStore (session-locked) behind `server/Managers/DataManager` — all persistence goes through it. Replicate to clients with **Replica** (`server/Managers/ReplicaManager`), not hand-rolled remotes.
- **Networking:** **ByteNet namespaces in `src/shared/Remotes/`**. Raw RemoteEvents/RemoteFunctions are banned.
- **State/UI:** Reflex for state; React + React-Roblox 17 (jsdotlua) under `client/UI/` — App.luau plus Components/Context/Hooks/Theme/Views; Ripple for animation; UI-Labs stories in `src/stories/`.
- **Utilities:** Trove for lifetime cleanup (one Trove per system, `:Clean()` on teardown), Signal for events, Observers for player/tag/attribute observation, Cmdr for admin commands (`server/Commands/`).
- Packages come from Wally (`wally.toml`) and mount at `ReplicatedStorage.Packages`. Bridge installs the toolchain and `Packages/` into your workspace before you start — you never run `rokit`/`wally` yourself. If `Packages/` is missing anyway, say so instead of guessing package APIs. Add new Wally dependencies only when asked.

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
| `src/replicated-first/` | `ReplicatedFirst` |
| `src/stories/` | `ServerStorage.Stories` |
| `src/lighting/` | `Lighting` |
| `Packages/` (gitignored, Wally output) | `ReplicatedStorage.Packages` |

## Verification

You cannot run the game. Verify what you can: `selene src` and `stylua --check src` when available (configs are in the repo; tools via Rokit), require-graph sanity (no cycles, no client requiring server modules), and strict-mode type discipline. Jest (jsdotlua) specs exist for pure shared logic where the game has them. Say plainly what could only be verified in Studio.
