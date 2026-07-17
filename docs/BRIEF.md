# Bridge — Project Brief

> Seed brief handed to Claude Code on 2026-07-17. This is the archival source document; the distilled agent-facing rules live in the repo-root `CLAUDE.md`, and current status lives in `GOALS.md`.

---

## What Bridge is

Bridge is a **desktop mission-control app for a solo game studio**. It sits *above* a portfolio of Roblox games and gives one place to:

- switch between games,
- see each game's **current goal** and a **live progress/check-bar**,
- spawn and watch **Claude Code agents** working inside each game,
- keep every agent on-protocol without re-teaching it each session,
- draw on a single **Obsidian vault** as the studio-wide database of design, decisions, and reusable knowledge.

The operator (me) is the orchestrator. Each game is a semi-independent world Bridge stewards and reports on.

## The problem it solves

Three specific pains from the current workflow (2–4 agents across a Mac and a Windows PC, mostly Roblox/Luau/Rojo dev):

1. **Re-teaching protocol every session** — how agents should behave, Rojo/worktree conventions, "plan before executing," don't-touch rules.
2. **Agents losing the game's goals** — architectural intent decays as context fills; agents drift or contradict earlier design decisions.
3. **Everything scattered** — no single view of what each game is aiming at or how far along it is.

Bridge fixes all three with **layered memory + per-game status files + one dashboard**, rather than a heavyweight "agentic OS."

---

## Architecture

### Process model (Electron)

- **Main process (Node/TypeScript)** — owns agent orchestration. Imports the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) directly and drives it via the async `query()` loop. Also owns git/worktree management and `GOALS.md` writes.
- **Renderer (React + TS)** — the dashboard UI. Talks to the main process over IPC. Never spawns agents itself.

Electron is chosen over Tauri specifically because the Agent SDK is Node-native, keeping the whole app in one language with no Rust/sidecar seam at the exact spot Bridge does its core work.

### How an agent gets launched

1. Operator picks a game and a task in the UI.
2. Main process resolves that game → its repo → a git **worktree** (create or reuse).
3. Calls `query()` with:
   - `cwd` set to the worktree path (this is what selects the "workspace" — Claude Code auto-loads `~/.claude/CLAUDE.md` + that repo's `CLAUDE.md`),
   - a `permissionMode` (`acceptEdits` for normal work; avoid `bypassPermissions` unless sandboxed),
   - an `allowedTools` whitelist so an agent physically can't act outside its lane.
4. Streams the agent's messages back to the renderer for live display.

### Memory layers (the anti-drift system)

- **Global** — `~/.claude/CLAUDE.md` (home dir, loads in *every* game). Holds Roblox/Luau/Rojo conventions, testing protocol, "plan before executing," global don't-touch rules.
- **Per-game** — `<repo>/CLAUDE.md`. Holds that game's design intent, core systems, current phase, game-specific rules. Overrides global on conflict.
- **Optional path-scoped** — `<repo>/.claude/rules/*.md` with `paths:` frontmatter, for rules that should only fire when an agent touches specific code (e.g. combat, terrain).
- Use `/memory` to verify what's loaded when behavior looks off.

### GOALS.md — the check-bar source

Each game has a `GOALS.md` describing the current goal + a checklist. It's the single source of truth for the progress bar.

**Single-writer rule:** Bridge's main process owns `GOALS.md`. Agents report status back through the SDK stream; the app updates the file. This avoids merge conflicts when multiple worktrees would otherwise each tick off the same file.

Suggested schema:

```markdown
# <Game> — Current Goal
> One-line statement of what we're building toward right now.

## Phase: <name>

## Checklist
- [x] Terrain generation
- [x] Fog of war
- [ ] Supply lines        <!-- in-progress -->
- [ ] Unit combat
- [ ] Main menu
```

Bridge parses `- [ ]` / `- [x]` for the progress bar and an optional `<!-- in-progress -->` marker for the active item.

### Worktree isolation

**One agent → one worktree → cwd set to that worktree.** Git worktrees give each agent a physically separate directory sharing one `.git`, eliminating file-stomping and `index.lock` contention between parallel agents. Committed files (`CLAUDE.md`, `GOALS.md`) check out into every worktree automatically.

⚠️ `CLAUDE.local.md` is gitignored, so it does **not** propagate into new worktrees — symlink/copy it in if any local overrides live there.

### Knowledge layer — Obsidian vault

A single **Obsidian vault is the studio-wide database** for everything that isn't the code itself: design docs, system architecture, decisions and their rationale, roadmaps, lore, and cross-game reusable knowledge (Luau patterns, conventions, Roblox gotchas). Obsidian is chosen because it's markdown-on-disk with backlinks and a graph view — so it layers directly on top of the files Bridge already uses, and the graph gives the "one database across all my projects" feel.

**How it relates to the agent-facing files (no duplicated truth):**

- The vault is the **human authoring layer** — deep and linked. The repo `CLAUDE.md` is the **distilled agent-facing pointer**: it summarizes or links to the relevant vault notes rather than restating them. You write design intent once in Obsidian; the per-game `CLAUDE.md` points agents at it.
- Structure the vault as the studio workspace: a folder per game plus a shared `/knowledge` (or `_studio`) folder for cross-game notes. Because it's all markdown, each repo's `CLAUDE.md`/`GOALS.md` are visible and editable inside the vault as normal notes — but they still physically live in their repos so worktrees and agents load them.
- `GOALS.md` stays the **single canonical source** for the check-bar (Bridge is still the only writer). The vault can *display* progress in a dashboard note, but it never becomes a second, conflicting checklist.

**Bridge integration:** Bridge reads and writes the vault as plain markdown files on disk — no plugin or API dependency, which keeps it robust. On demand it can pull a game's design notes into an agent's context, and write decisions or run summaries back into a vault note. (If you later want richer programmatic access, Obsidian has community REST-API / MCP options, but you don't need them to start.)

**Sync bonus:** the vault is a natural answer to the Mac↔PC problem — sync it once (Obsidian Sync, git, or a cloud folder) and both machines share one source of truth for design, decisions, and progress.

---

## MVP feature set

1. **Game registry** — list of games (name, repo path, default branch, worktree dir).
2. **Game switcher** — pick a game; view loads its goal + progress + active agents.
3. **Per-game panel** — current goal, checklist/progress bar (from `GOALS.md`), list of running/finished agents.
4. **Spawn agent** — enter a task, Bridge creates/reuses a worktree, sets cwd, launches via SDK.
5. **Live stream** — real-time agent output per session.
6. **Agent config** — permission mode + tool allowlist per launch.

Post-MVP: `GOALS.md` auto-updates from agent stream; multi-agent-per-game; cross-machine state sync.

---

## Data model (sketch)

- **Game**: `{ id, name, repoPath, defaultBranch, worktreeRoot }`
- **GoalsDoc** (parsed): `{ goal, phase, items: [{ text, done, inProgress }] }`
- **AgentSession**: `{ id, gameId, worktreePath, task, status, startedAt, messages[] }`

Registry can live in a simple JSON/SQLite store in the app's user-data dir.

---

## Cross-platform requirements (Mac + Windows 10)

Electron runs on both (Windows 10+ and macOS Monterey+). *Bridge's* platform risk is the CLI/process/path layer, not Electron itself:

- **Paths** — always `path.join`/`path.resolve` + `os.homedir()`. Never hardcode `/` or `\` or assume `~`.
- **CLI resolution** — on Windows the `claude` binary often resolves as `claude.cmd`; `spawn` quoting/PATH differs. Expect a small platform branch at the launch site.
- **Line endings** — normalize on read when parsing `GOALS.md`; add `.gitattributes` pinning `GOALS.md` to LF so it doesn't churn across machines.
- **Case sensitivity** — both default case-*insensitive*; keep game-dir names canonical to avoid `Kingdom` vs `kingdom` path bugs.
- **Note:** Windows 10 hit end-of-life Oct 2025 — fine to build on now, plan to move to Win 11.

## Roblox-specific notes

- Games are Luau. Agents edit the `src` (Luau) tree **only** — they never touch Rojo. Rojo is just the VS Code ↔ Roblox Studio sync layer; it needs no agent interaction and shouldn't be in scope for any agent.
- Anything that isn't code — Studio-side operations, assets, instances, non-script changes — goes through the **Roblox Studio MCP**, not Rojo.
- Put Luau conventions in the **global** `~/.claude/CLAUDE.md` so every game inherits them.
- Don't assume a generic web/backend repo layout anywhere in Bridge's worktree/path logic — this is the exact thing generic agent tooling gets wrong.

## Tech stack

- **Electron** + `electron-vite`, packaged with `electron-builder` (build installers per-platform).
- **TypeScript** end to end.
- **React** for the renderer.
- **`@anthropic-ai/claude-agent-sdk`** for agent orchestration (the older `@anthropic-ai/claude-code` name is deprecated).
- Git via `child_process` or a wrapper like `simple-git`.

## Billing caveat

Programmatic SDK / `claude -p` usage currently draws from the Claude subscription — a planned split onto a separate credit pool was announced then **paused** before launch. Since it's been floated once, verify current billing before wiring up lots of unattended agent runs.

---

## Build roadmap

1. **Scaffold + registry** — Electron+Vite+React skeleton; add/list games; read and display each game's `GOALS.md` (goal + progress bar). No agents yet.
2. **Single agent** — spawn one agent into a game's worktree via the SDK; stream output to the UI; permission mode + allowedTools config.
3. **Worktree management** — create/reuse worktrees per agent; handle the `CLAUDE.local.md` propagation gotcha; run 2–4 in parallel cleanly.
4. **Live check-bar** — parse agent stream for completed items; Bridge (single writer) updates `GOALS.md`; progress bar reflects real work.
5. **Vault integration** — read game design notes from the Obsidian vault into agent context on demand; write decisions / run summaries back into vault notes.
6. **Cross-machine** — sync the vault (Obsidian Sync, git, or cloud folder) so Mac and PC share one source of truth for design, goals, and progress.

## Open decisions

- **Cross-machine sync** — how Mac and PC stay consistent on goals/progress. Likely solved by syncing the Obsidian vault (Obsidian Sync, git, or a cloud folder), since it already holds design + progress.
- **Permission strictness** — default to `acceptEdits` + tight allowlist; only reach for `bypassPermissions` if agents run in containers.
- **GitHub org** — ~~undecided~~ resolved: **Tolui-studios** holds the games + Bridge (this repo's remote is `Tolui-studios/Bridge`).
