# Bridge

Desktop mission-control app for a solo Roblox game studio (org: **Tolui-studios**). One dashboard to switch between game repos, see each game's current goal + a live progress bar parsed from that repo's `GOALS.md`, and (in later phases) spawn and stream Claude Code agents into per-game git worktrees via `@anthropic-ai/claude-agent-sdk` from the Electron main process.

- Full product brief and roadmap: `docs/BRIEF.md`
- Current phase + live checklist: `GOALS.md` (repo root — Bridge dogfoods its own check-bar)
- **Phase status: Phase 4 shipped (persistent session history + agents auto-update the check-bar via the BRIDGE marker protocol). Next: Phase 5 — Obsidian vault integration (read design notes into agent context, write decisions/run summaries back).**

## Commands

```
npm run dev          # electron-vite dev with HMR (opens the app window)
npm run test         # vitest — parser unit tests
npm run typecheck    # tsc over both projects (node + web)
npm run build        # typecheck + electron-vite build → out/
npm run build:win    # NSIS installer → dist/
```

## Architecture

Electron, ESM end-to-end (`"type": "module"`).

| Layer | Path | Responsibility |
|---|---|---|
| Main | `src/main/` | App lifecycle (`index.ts`), game registry JSON store (`registry.ts`), GOALS.md read/parse/watch/mutate/template (`goals.ts`), agent sessions via `@anthropic-ai/claude-agent-sdk` (`agents.ts` — streaming-input interactive sessions: follow-ups, interrupt, idle; games run parallel sessions, one worktree each), git worktree pool (`worktrees.ts` — electron-free, vitest-covered, `agent-<n>` dirs+branches under `worktreeRoot`, copies gitignored `CLAUDE.local.md` in), Claude usage polling (`usage.ts`), IPC handlers + dialogs + shell.openPath (`ipc.ts`). Owns ALL fs/process/SDK work. |
| Preload | `src/preload/` | `contextBridge` exposure of `window.bridge` only — typed wrappers, zero logic. |
| Renderer | `src/renderer/` | React 19 + Tailwind v4 dashboard. Never touches Node APIs; talks only through `window.bridge`. |
| Shared | `src/shared/` | Types (`types.ts`), IPC channel constants (`ipc-channels.ts`), pure GOALS.md parser (`goalsParser.ts`, vitest-covered). |

Data flow: renderer → `window.bridge.*` → `ipcRenderer.invoke` → `ipcMain.handle` in `src/main/ipc.ts` → registry/goals modules. Push path: chokidar watcher in main → `bridge:event:goals-changed` / `bridge:event:registry-changed` → preload subscription → renderer hooks (`useGames`, `useGoals`).

Registry lives at `%APPDATA%\Bridge\registry.json` (`app.getPath('userData')`), schema `{ version: 1, games: [] }`, atomic tmp+rename writes.

## Hard rules

1. **Single-writer:** only the Electron main process writes any `GOALS.md` (Bridge's or a game's). Renderer and agents never write it — agents report over the SDK stream and Bridge updates the file. Every UI-driven write goes through `GoalsService.mutate` → the pure `goalsMutator` (surgical line edits with `expectText` compare-and-swap; foreign markdown content is preserved verbatim).
2. **Renderer purity:** no `fs`, no `child_process`, no Node APIs in `src/renderer/`. If the UI needs something new from the system, add an IPC channel: constant in `src/shared/ipc-channels.ts` → types in `src/shared/types.ts` (extend `BridgeApi`) → handler in `src/main/ipc.ts` → wrapper in `src/preload/index.ts`.
3. **Parser stays pure and total:** `parseGoals` never throws, never touches fs; every behavior change gets a vitest case in `goalsParser.test.ts`.
4. **Cross-platform paths:** always `node:path` joins, never hardcoded `/` or `\`, never `~`. GOALS.md is pinned LF via `.gitattributes`; the parser still normalizes CRLF on read.
5. **ESM specifics:** preload must be referenced as `../preload/index.mjs` and requires `sandbox: false`; `contextIsolation` stays `true`, `nodeIntegration` stays `false`. Do not "fix" these.
6. **Agent SDK stays external:** `@anthropic-ai/claude-agent-sdk` is listed in `rollupOptions.external` for the main build (it spawns its CLI relative to its own package path — inlining breaks it) and in electron-builder `asarUnpack`. The SDK spawns `node` from PATH; `bypassPermissions` is never exposed in the UI. Agent runs cost real money — the launch form defaults to Sonnet 5 because a session-default run can land on the most expensive tier (~$0.50 for a trivial Fable-5 turn, measured). Smoke checks: `scripts/agent-smoke.mjs` (one turn) and `scripts/agent-smoke-interactive.mjs` (two turns, one session, Haiku).
7. **Agent workspace rules:** every agent gets a worktree under the game's `worktreeRoot` (sibling of the repo — never inside it) via `WorktreeService`; non-git game dirs fall back to the repo dir with a transcript note. `settingSources: ['user', 'project']` must stay in the query options — the SDK loads NO CLAUDE.md layers without it. Note the sample fixture sits inside Bridge's own repo, so Claude Code resolves Bridge as its project; real game repos (own `.git`) get their own workspace identity.
8. **Check-bar protocol (Phase 4):** each launch appends a footer telling the agent to report progress with line-anchored markers — `BRIDGE:START <item>`, `BRIDGE:DONE <item>`, `BRIDGE:ADD <item>` (exact checklist text; current checklist included in the footer). `agents.ts` parses assistant text (`@shared/goalMarkers`), and `goalSync.ts` applies matches to the CANONICAL repo GOALS.md via `GoalsService.mutate` — single-writer preserved; the agent's worktree copy is never the source of truth. Matching is conservative (exact → normalized → unique containment; ambiguous = reported, not guessed).
9. **Session history:** finished sessions persist to `%APPDATA%\Bridge\sessions\<gameId>\<sessionId>.json` via `sessionStore.ts` (summaries load at startup, transcripts lazily, newest 50 kept per game, dir deleted when a game is removed). Sessions found live on startup are coerced to `cancelled`.
8. **Usage meter:** `usage.ts` polls `api.anthropic.com/api/oauth/usage` (the same unofficial endpoint the CLI's /usage screen uses) with the machine's Claude Code OAuth token, parsing the `limits[]` array. It's not a public API — if it changes shape or 401s, the bar degrades to a reason string; never let it break anything else.

## Version pins — do not casually upgrade

- `vite` stays **7.x** and `@vitejs/plugin-react` stays **5.x**: electron-vite 5 supports vite ^5–^7 only. Upgrading either to latest (vite 8 / plugin-react 6) breaks the build. Revisit only when electron-vite declares vite 8 support.
- `typescript` stays 5.x (TS 7 native compiler not yet adopted here).
- Node >= 22.12 required (Node 24 LTS is the dev machine target).

## Environment notes

- Dev machines: Windows 10 (PowerShell) + macOS. This repo lives inside OneDrive on the PC — if `npm install` hits EPERM/locked-file errors, pause OneDrive sync and retry; keep the repo folder marked "Always keep on this device".
- File-watch escape hatch: `BRIDGE_WATCH_POLL=1` switches chokidar to polling if change events ever go missing (OneDrive placeholder edge cases).

## Later phases (context, not scope)

Phase 2: spawn one agent per game via Agent SDK (`query()`, `cwd` = worktree, `permissionMode: 'acceptEdits'`, `allowedTools` whitelist), stream to UI. Phase 3: worktree create/reuse (`worktreeRoot` field already stored per game). Phase 4: agent stream → GOALS.md auto-updates through the single writer. Phase 5: Obsidian vault read/write. Phase 6: cross-machine sync. The games themselves are Roblox/Luau repos — game agents edit Luau `src` only and never touch Rojo; that constraint lives in the games' own CLAUDE.md files, not here.
