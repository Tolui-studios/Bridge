# Bridge

Desktop mission-control app for a solo Roblox game studio (org: **Tolui-studios**). One dashboard to
switch between game repos, see each game's current goal + a live progress bar parsed from that
repo's `GOALS.md`, and (in later phases) spawn and stream Claude Code agents into per-game git
worktrees via `@anthropic-ai/claude-agent-sdk` from the Electron main process.

- Full product brief and roadmap: `docs/BRIEF.md`
- Current phase + live checklist: `GOALS.md` (repo root — Bridge dogfoods its own check-bar)
- **Phase status: Phase 6 shipped (multi-operator team sync via Supabase — presence, canonical
  goals, team notes, session mirroring, git/worktree UI). Awaiting live verification against a real
  Supabase project (see docs/TEAM-SYNC.md for setup).**

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
| Main | `src/main/` | All fs/process/SDK work — one module per concern, see "Main process modules" below. |
| Preload | `src/preload/` | `contextBridge` exposure of `window.bridge` only — typed wrappers, zero logic. |
| Renderer | `src/renderer/` | React 19 + Tailwind v4 dashboard. Never touches Node APIs; talks only through `window.bridge`. |
| Shared | `src/shared/` | Types (`types.ts`), IPC channel constants (`ipc-channels.ts`), pure GOALS.md parser (`goalsParser.ts`, vitest-covered). |

### Main process modules

One bullet per module. When you add or change a module, edit its bullet (or add one) — do not
widen another module's bullet or a table row.

- `index.ts` — app lifecycle: constructs every service, wires `AgentServiceHooks`, registers IPC.
- `registry.ts` — game registry JSON store.
- `goals.ts` — GOALS.md read/parse/watch/mutate/template (`GoalsService`).
- `agents.ts` — agent sessions via `@anthropic-ai/claude-agent-sdk`: streaming-input interactive
  sessions (follow-ups, interrupt, idle; runtime mode/model/tool switches); games run parallel
  sessions, one worktree each.
- `agentTools.ts` — pure tool-allowlist helpers: sanitize + permission-rule building for the
  runtime tool switch (see hard rule "Runtime tool allowlist"). Vitest-covered.
- `worktrees.ts` — git worktree pool. Electron-free, vitest-covered; `agent-<n>` dirs+branches
  under `worktreeRoot`; copies gitignored `CLAUDE.local.md` in; `changesForGame` snapshots every
  tree's changed files for the overlap UI.
- `gitOps.ts` — repo/GitHub lifecycle: status, pull, clone, org moves, `pushBranchForPr`,
  `autoPullDefaultBranch`, remote-key normalization.
- `prMessage.ts` — pure PR title/body builder (task first line word-truncated to 72 chars,
  commit list, Studio test steps, diffstat), vitest-covered. `pushBranchForPr` always sends a
  written message — never gh's `--fill`, which titles PRs after the last commit ("chore: …
  work in progress").
- `autoPull.ts` — background freshness sweep (`AutoPullService`, electron-free,
  vitest-covered): every 5 minutes ff-only pulls each registered game's default branch via
  `autoPullDefaultBranch`. Safe because agents only commit on agent-* branches in worktrees;
  failures are recorded, never surfaced as errors.
- `usage.ts` — Claude usage polling (see hard rule "Usage meter").
- `rojo.ts` — dev-loop launcher ("Open Build": VS Code + per-game `rojo serve` child process +
  Roblox Studio). ONE serve per game, retargetable: `openBuild(game, targetPath?)` serve-swaps
  between the repo and any agent worktree so port 34872 (the only port the Studio plugin's
  sync-reminder polling offers one-click Connect for) stays pointed at what's being tested.
  Shifts on port conflict; attaches to same-project external servers (main target only — a
  worktree serve never adopts); self-heals a missing toolchain/`Packages/` via
  `ToolchainService.setupRepo` before serving. Launches Studio only on a fresh main-checkout
  serve (never on swap, never for worktree targets — those just note "hit Connect") and skips
  the VS Code launch for worktree targets AND for swaps ("Serve main" while a worktree is
  served just retargets the serve; the editor opens only on a fresh/reused main-checkout
  Open Build). `taskkill /T` on Windows because the rokit shim's real rojo.exe is a grandchild.
- `rojoTarget.ts` — electron-free target/swap logic, vitest-covered.
- `rojoApi.ts` — electron-free /api/rojo probe; msgpack for Rojo 7.7+, JSON for older;
  vitest-covered.
- `ipc/` — ipcMain handlers, one file per domain (`games`, `agents`, `git`, `rojo`, …) registered
  through `registerIpc(deps)`; dialogs and `shell.openPath` live here.
- `editor.ts` — VS Code launch.
- `teamSync.ts` — Supabase team sync (see hard rule "Team sync").
- `sessionStore.ts` — session persistence (see hard rule "Session history").
- `settings.ts` — per-machine settings JSON store.
- `vault.ts` — Obsidian vault access (see hard rule "Vault").
- `goalSync.ts` / `claudeNotes.ts` — apply BRIDGE markers to canonical GOALS.md / CLAUDE.md
  (see hard rule "Check-bar protocol").

Data flow: renderer → `window.bridge.*` → `ipcRenderer.invoke` → `ipcMain.handle` in
`src/main/ipc/` → registry/goals modules. Push path: chokidar watcher in main →
`bridge:event:goals-changed` / `bridge:event:registry-changed` → preload subscription → renderer
hooks (`useGames`, `useGoals`).

Registry lives at `%APPDATA%\Bridge\registry.json` (`app.getPath('userData')`), schema
`{ version: 1, games: [] }`, atomic tmp+rename writes.

## Hard rules

1. **Single-writer:** only the Electron main process writes any `GOALS.md` (Bridge's or a game's).
   Renderer and agents never write it — agents report over the SDK stream and Bridge updates the
   file. Every UI-driven write goes through `GoalsService.mutate` → the pure `goalsMutator`
   (surgical line edits with `expectText` compare-and-swap; foreign markdown content is preserved
   verbatim).
2. **Renderer purity:** no `fs`, no `child_process`, no Node APIs in `src/renderer/`. If the UI
   needs something new from the system, add an IPC channel — every piece goes into its domain's
   existing block, never appended at the end of a file: channel constant in its domain block in
   `src/shared/ipc-channels.ts` → method on the domain interface in `src/shared/types.ts` →
   handler in `src/main/ipc/<domain>.ts` → wrapper in the domain literal in
   `src/preload/index.ts`.
3. **Parser stays pure and total:** `parseGoals` never throws, never touches fs; every behavior
   change gets a vitest case in `goalsParser.test.ts`.
4. **Cross-platform paths:** always `node:path` joins, never hardcoded `/` or `\`, never `~`.
   GOALS.md is pinned LF via `.gitattributes`; the parser still normalizes CRLF on read.
5. **ESM specifics:** preload must be referenced as `../preload/index.mjs` and requires
   `sandbox: false`; `contextIsolation` stays `true`, `nodeIntegration` stays `false`. Do not
   "fix" these.
6. **Agent SDK stays external:** `@anthropic-ai/claude-agent-sdk` is listed in
   `rollupOptions.external` for the main build (it spawns its CLI relative to its own package
   path — inlining breaks it) and in electron-builder `asarUnpack`. The SDK spawns `node` from
   PATH; `bypassPermissions` is never exposed in the UI. Agent runs cost real money — the launch
   form defaults to Opus 5 (`claude-opus-5`, $5/$25 per MTok — half of Fable 5) rather than
   session default, because a session-default run can land on the most expensive tier (~$0.50 for
   a trivial Fable-5 turn, measured). Smoke checks: `scripts/agent-smoke.mjs` (one turn),
   `scripts/agent-smoke-interactive.mjs` (two turns, one session, Haiku),
   `scripts/agent-smoke-choices.mjs` (AskUserQuestion round-trip through canUseTool, Haiku), and
   `scripts/agent-smoke-tools.mjs` (runtime allowlist add/remove via applyFlagSettings, Haiku).
7. **Roblox layers:** studio-wide Luau/Rojo agent conventions are canonical in
   `docs/GLOBAL-CLAUDE.md` and must be installed as `~/.claude/CLAUDE.md` on every dev machine
   (agents load it via `settingSources`). New games are scaffolded Roblox-native by
   `src/main/robloxScaffold.ts` (Rojo `default.project.json`, strict-Luau `src/` tree, per-game
   CLAUDE.md, StyLua/Selene configs, Roblox .gitignore) — never-overwrite semantics. Update the
   canonical doc, not per-machine copies.
8. **Agent workspace rules:** every agent gets a worktree under the game's `worktreeRoot`
   (sibling of the repo — never inside it) via `WorktreeService`; non-git game dirs fall back to
   the repo dir with a transcript note. Fresh launches first auto-pull the game's default branch
   (`gitOps.autoPullDefaultBranch` — fetch origin, then ff-only merge when the branch is checked
   out, ref move when it isn't) so worktrees never start from a stale base; failures downgrade to
   a transcript warning, and resume never pulls. `AutoPullService` additionally sweeps every
   game with the same ff-only pull every 5 minutes in the background, so the base is fresh even
   between launches. `settingSources: ['user', 'project']` must stay
   in the query options — the SDK loads NO CLAUDE.md layers without it. Note the sample fixture
   sits inside Bridge's own repo, so Claude Code resolves Bridge as its project; real game repos
   (own `.git`) get their own workspace identity.
9. **Check-bar protocol (Phase 4):** each launch appends a footer telling the agent to report
   progress with line-anchored markers — `BRIDGE:START <item>`, `BRIDGE:DONE <item>`,
   `BRIDGE:ADD <item>` (exact checklist text; current checklist included in the footer).
   `agents.ts` parses assistant text (`@shared/goalMarkers`), and `goalSync.ts` applies matches
   to the CANONICAL repo GOALS.md via `GoalsService.mutate` — single-writer preserved; the
   agent's worktree copy is never the source of truth. Matching is conservative (exact →
   normalized → unique containment; ambiguous = reported, not guessed). `BRIDGE:NOTE <fact>` is
   the same shape for the game's CLAUDE.md: `claudeNotes.ts` (pure mutator + atomic writer,
   vitest-covered) appends it under `## Agent notes` in the CANONICAL repo CLAUDE.md — never the
   worktree copy, and never through teamSync (CLAUDE.md is git-tracked and rides normal push/PR
   flow). Markers are only parsed from top-level assistant text — subagent output is never
   scanned; the footer says so.
10. **Session history:** finished sessions persist to `%APPDATA%\Bridge\sessions\<gameId>\<sessionId>.json`
    via `sessionStore.ts` (summaries load at startup, transcripts lazily, newest 50 kept per
    game, dir deleted when a game is removed). Sessions found live on startup are coerced to
    `cancelled`. Any finished session with a `claudeSessionId` (persisted from the init message)
    can be REOPENED with its old context: `AgentService.resume` revives the record in place (same
    Bridge id, SDK `resume:` option, cost/turn bases accumulate) and re-leases the session's
    ORIGINAL worktree via `WorktreeService.acquireAt` — no reset, no substitute dir, because the
    SDK's conversation JSONL is keyed by the cwd it ran in. Resume sends no footer (the protocol
    is already in the resumed context).
11. **Team sync (Phase 6):** `teamSync.ts` connects to a Supabase project (config in settings;
    setup SQL in `docs/TEAM-SYNC.md`). Games are identified across machines by normalized
    `origin` URL (`gitOps.normalizeRemoteKey`); games without a remote stay local-only. When
    online, the single-writer rule moves to the server: `GoalsMutate` routes through
    `TeamSync.mutateGoals` (optimistic-concurrency CAS on a version column) and the local
    GOALS.md becomes a projection written via `GoalsService.writeProjection`; external file edits
    push back up via the `onExternalEdit` hook. Occupancy is SOFT — banners and chips, never hard
    locks. Session mirroring sends summaries only, never transcripts. Worktree branches are
    prefixed `agent-<username>-N` so pushes don't collide across operators. Everything degrades
    to local behavior when offline/unconfigured — team failures must never block local work.
12. **Vault (Phase 5):** the Obsidian vault path is a per-machine setting (`settings.ts` →
    `%APPDATA%\Bridge\settings.json`). `vault.ts` is the ONLY writer of vault files (run
    summaries → `<game folder>/Bridge Log.md`, decisions → `Decisions.md`; folders matched to
    `game.name` case-insensitively, created if missing). Agents never get write access to the
    vault — selected notes are injected into the prompt as read-only content (8KB/note, 24KB
    total caps), sourced from the game's folder plus shared `knowledge`/`_studio` folders. All
    vault paths go through the traversal guard; `.obsidian` and dot-folders are excluded.
    `fixtures/demo-vault` exists for demos/tests.
13. **Usage meter:** `usage.ts` polls `api.anthropic.com/api/oauth/usage` (the same unofficial
    endpoint the CLI's /usage screen uses) with the machine's Claude Code OAuth token, parsing
    the `limits[]` array. **Rate-limit rules (claude-code issues #30930/#31021): the endpoint
    buckets by User-Agent — always send `User-Agent: claude-code/<version>` or you get a
    ~5-request per-token budget with a lying `retry-after: 0`.** Bridge additionally enforces a
    15s minimum between calls, a 5-minute cooldown after any 429 (serving the last snapshot
    marked `stale`), and harvests `rate_limit_event` messages from agent streams as a zero-cost
    secondary source. If the endpoint changes shape or 401s, degrade to a reason string; never
    let it break anything else.
14. **Agent questions:** two channels. Open-ended → `BRIDGE:ASK` marker → `pendingQuestion`
    (reply = next message). Multiple-choice → the SDK's AskUserQuestion tool intercepted by
    `canUseTool` in `agents.ts`: validated by the pure `agentChoices.ts` (vitest-covered),
    surfaced as `pendingChoices` buttons, answered via `AgentsAnswer` with
    `{ behavior:'allow', updatedInput:{ questions: <raw echo>, answers } }`.
    **`AskUserQuestion` must never be added to the tool allowlist** — an allow rule bypasses
    `canUseTool` and the tool runs with no answers (`agentTools.sanitizeToolList` strips it on
    both the launch and runtime paths).
    `canUseTool` must never resolve `null` (SDK fails closed, tool parks forever), and every
    other tool name is denied there to preserve headless auto-deny; denied `toolUseID`s are
    remembered so `system/permission_denied` events aren't double-rendered.
15. **Runtime tool allowlist:** a session's allowlist is enforced as permission allow-rules in
    the SDK's DYNAMIC flag-settings layer: `Query.applyFlagSettings` right after `query()` for
    the launch set (the initial prompt is pushed only after the rules land, so turn 1 can't race
    them), and again — replacing the layer wholesale — in `AgentService.setTools`. It must NOT
    ride the `allowedTools` query option (launch-frozen) or the inline `settings` option (its
    rules persist BENEATH the dynamic layer, so a runtime removal can never win — measured).
    This is what lets the operator add AND remove tools on a live session (`AgentsSetTools` IPC,
    tool pills in `AgentsSection`) with no restart and no lost context; rule building is the pure
    `agentTools.ts` (vitest-covered; MCP globs also emit the bare-server rule form). Two caveats,
    both pre-existing semantics: the permission mode still wins where it auto-allows
    (`acceptEdits` keeps approving edits with Edit off the list), and enabling Studio tools
    mid-session cannot spawn the MCP server (it only starts at query start — resume
    re-evaluates). Verified end-to-end by `scripts/agent-smoke-tools.mjs`.

## Editing conventions (parallel agents)

Multiple agents work in this repo at once, each in its own worktree, merged as separate PRs.
Shape your edits so disjoint work stays on disjoint lines:

- Add new IPC surface into the matching domain block in all four files (rule 2) — never append
  at the end of a list, interface, or object literal.
- One module per concern in `src/main/`; document it as its own bullet under "Main process
  modules", never by widening another bullet or a table row.
- In this file, keep lines wrapped at ~100 cols and touch only the bullets/rules your change is
  actually about.
- Prefer adding a new file or a self-contained section over editing shared lines in hot files.
- Declare conflict-prone shared files you intend to edit with `BRIDGE:CLAIM <paths>` (comma
  separated, repo-relative) as soon as you know them; claims expire with your session and show
  up in other agents' launch context and the worktree panel.
- Before finishing, `git fetch origin && git merge origin/<default branch>` in your worktree and
  resolve any conflicts yourself, then re-run typecheck + tests.
- Operator practice: merge agent PRs one at a time — fresh launches auto-pull the default
  branch, so the next agent branches from the merged result.

## Version pins — do not casually upgrade

- `vite` stays **7.x** and `@vitejs/plugin-react` stays **5.x**: electron-vite 5 supports vite
  ^5–^7 only. Upgrading either to latest (vite 8 / plugin-react 6) breaks the build. Revisit only
  when electron-vite declares vite 8 support.
- `typescript` stays 5.x (TS 7 native compiler not yet adopted here).
- Node >= 22.12 required (Node 24 LTS is the dev machine target).

## Environment notes

- Dev machines: Windows 10 (PowerShell) + macOS. This repo lives inside OneDrive on the PC — if
  `npm install` hits EPERM/locked-file errors, pause OneDrive sync and retry; keep the repo
  folder marked "Always keep on this device".
- File-watch escape hatch: `BRIDGE_WATCH_POLL=1` switches chokidar to polling if change events
  ever go missing (OneDrive placeholder edge cases).

## Later phases (context, not scope)

Phase 2: spawn one agent per game via Agent SDK (`query()`, `cwd` = worktree,
`permissionMode: 'acceptEdits'`, `allowedTools` whitelist), stream to UI. Phase 3: worktree
create/reuse (`worktreeRoot` field already stored per game). Phase 4: agent stream → GOALS.md
auto-updates through the single writer. Phase 5: Obsidian vault read/write. Phase 6:
cross-machine sync. The games themselves are Roblox/Luau repos — game agents edit Luau `src`
only and never touch Rojo; that constraint lives in the games' own CLAUDE.md files, not here.
