# Tolui Studios — Global Agent Conventions

> Canonical copy lives in the Bridge repo (`docs/GLOBAL-CLAUDE.md`). Install on every dev machine as `~/.claude/CLAUDE.md` so ALL agents in ALL game repos inherit it — Bridge-launched agents load it automatically. When you improve it, update the repo copy and re-copy to each machine.

You are working in a Roblox game repo (Luau, synced to Roblox Studio via Rojo) belonging to Tolui Studios, usually launched and supervised by Bridge, the studio's mission-control app.

## Hard boundaries

1. **Edit only the Luau source tree (`src/`).** Never touch the Rojo layer: no `rojo` commands, no edits to `default.project.json` or sourcemaps. Rojo is the operator's VS Code ↔ Studio sync; it needs nothing from you.
2. **Non-code work is out of scope.** Studio-side instances, assets, terrain, UI built from instances, and property tweaks on non-script objects can't be done from this repo — say clearly in your final message what Studio-side work is needed instead of faking it in code.
3. **Never edit GOALS.md.** Bridge owns it. Report progress with the marker lines Bridge teaches you (`BRIDGE:START/DONE/ADD <item>`).
4. **Plan before executing.** Read the systems you'll touch first, state a short plan, then implement. Don't restructure systems you weren't asked to touch.
5. Don't add external dependencies (Wally packages, etc.) without being asked.

## Luau conventions

- `--!strict` at the top of every file. Type public function signatures and module APIs; avoid `any` — infer or annotate.
- One system per module under `src/shared/systems/` (or the game's documented layout). Modules return a table; **no side effects at require time** — expose `init()` (and `step(dt)` if the system ticks).
- All tunable numbers live in a `Config` module beside the system, never inline magic numbers.
- Services once at the top: `local Players = game:GetService("Players")` — never `game.Players`.
- Naming: PascalCase for modules/types/services, camelCase for locals and functions, SCREAMING_SNAKE for constants.
- Modern task library only: `task.spawn`/`task.defer`/`task.wait` — never legacy `spawn`, `delay`, or global `wait`.
- Events over polling: never drive gameplay logic from `RenderStepped`/`Heartbeat` loops when a signal, event, or property-changed connection works.
- Every connection gets cleaned up: systems own their connections and disconnect them in `destroy()` (Maid/Janitor-style bookkeeping is fine).
- Guard clauses and early returns over deep nesting.

## Client/server rules

- **The server owns all state that matters.** The client renders and requests; it never decides outcomes (damage, currency, unlocks, spawns).
- Validate every RemoteEvent/RemoteFunction input server-side: types, ranges, rate, and whether that player may do that thing right now. Assume the client is hostile.
- Never store secrets or authoritative data in ReplicatedStorage.
- Remotes live in a defined folder with typed wrapper modules — no raw `FireServer` scattered through gameplay code.

## Repo layout (Rojo standard here)

| Folder | Mounts to | Runs on |
|---|---|---|
| `src/shared/` | `ReplicatedStorage.Shared` | both |
| `src/server/` | `ServerScriptService.Server` | server |
| `src/client/` | `StarterPlayer.StarterPlayerScripts.Client` | client |

## Verification

You cannot run the game. Verify what you can: `stylua --check src` and `selene src` when available (configs are in the repo), require-graph sanity (no cycles, no client requiring server modules), and strict-mode type discipline. Say plainly what could only be verified in Studio.
