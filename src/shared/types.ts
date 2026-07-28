export interface Game {
  id: string
  name: string
  repoPath: string
  defaultBranch: string
  worktreeRoot: string
}

export interface AddGameInput {
  name: string
  repoPath: string
  defaultBranch?: string
  worktreeRoot?: string
}

export interface GameMutationResult {
  game: Game
  warnings: string[]
}

export interface ChecklistItem {
  text: string
  done: boolean
  inProgress: boolean
}

export interface GoalsDoc {
  title: string | null
  goal: string | null
  phase: string | null
  items: ChecklistItem[]
}

export type GoalsStatus = 'ok' | 'missing' | 'unreadable'

export interface GoalsState {
  gameId: string
  status: GoalsStatus
  doc: GoalsDoc | null
  /** Absolute path of the GOALS.md this state was read from. */
  path: string
  /** Epoch ms when the read happened. */
  updatedAt: number
}

export interface Progress {
  done: number
  total: number
  pct: number
}

/**
 * Surgical edits to a GOALS.md, applied line-by-line by the main process so
 * any content outside the known sections survives untouched. Item mutations
 * carry `expectText` (the parsed text the UI acted on) as a compare-and-swap
 * guard against the file having changed on disk since the UI last read it.
 */
export type GoalsMutation =
  | { kind: 'set-goal'; goal: string }
  | { kind: 'set-phase'; phase: string }
  | { kind: 'add-item'; text: string }
  | { kind: 'toggle-item'; index: number; expectText: string; done: boolean }
  | { kind: 'edit-item'; index: number; expectText: string; text: string }
  | { kind: 'remove-item'; index: number; expectText: string }
  | { kind: 'set-in-progress'; index: number | null; expectText?: string }

/** Permission modes Bridge exposes; `bypassPermissions` is deliberately excluded. */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk'

export interface AgentLaunchConfig {
  task: string
  permissionMode: AgentPermissionMode
  /** Tools auto-allowed without prompting; everything else is denied headlessly. */
  allowedTools: string[]
  /** Model id override; undefined = the machine's Claude Code session default. */
  model?: string
  /** Vault-relative note paths whose content is injected into the task. */
  vaultNotes?: string[]
}

/** 'idle' = the session is alive and waiting for a follow-up prompt. */
export type AgentStatus = 'running' | 'idle' | 'done' | 'error' | 'cancelled'

export interface AgentSessionSummary {
  id: string
  gameId: string
  task: string
  status: AgentStatus
  permissionMode: AgentPermissionMode
  allowedTools: string[]
  model: string | null
  /** Directory the agent actually runs in (worktree path, or repo on fallback). */
  cwd: string | null
  startedAt: number
  endedAt: number | null
  costUsd: number | null
  numTurns: number | null
  error: string | null
  /**
   * Steps the operator should perform in Studio to verify this run, reported
   * by the agent via `BRIDGE:TEST`. Agents cannot playtest, so this is how a
   * run hands verification back to a human.
   */
  testSteps: string[]
  /**
   * A question the agent is waiting on, reported via `BRIDGE:ASK`. Cleared as
   * soon as the operator replies — the reply is the agent's next message.
   */
  pendingQuestion: string | null
}

export type AgentStreamKind =
  | 'system'
  | 'user'
  | 'text'
  | 'tool'
  | 'tool-result'
  | 'denied'
  | 'result'
  | 'stderr'
  /** Outcome of a BRIDGE:DONE/START/ADD progress marker applied to GOALS.md. */
  | 'goal'

export interface AgentStreamItem {
  id: string
  sessionId: string
  gameId: string
  ts: number
  kind: AgentStreamKind
  text: string
}

export type AgentEvent =
  | { type: 'status'; session: AgentSessionSummary }
  | { type: 'item'; item: AgentStreamItem }

export interface AppSettings {
  /** Absolute path of the studio Obsidian vault; null = not connected. */
  vaultPath: string | null
  /** Whether vaultPath currently exists on disk (computed at read time). */
  vaultExists: boolean
  /** The folder all games live in (clones land here; pickers start here). */
  gamesRoot: string
  /** Team sync (Supabase) config presence — the key itself never leaves main. */
  teamConfigured: boolean
  teamUrl: string | null
  teamEmail: string | null
}

export interface TeamConnectInput {
  /** Optional overrides; omitted = stored config, then the baked-in studio defaults. */
  url?: string
  anonKey?: string
  email: string
  password: string
}

export type TeamStatus = 'off' | 'connecting' | 'online' | 'error'

/** green = connected + recently active; yellow = connected, idle 10m+; red = disconnected or idle 2h+. */
export type TeamActivity = 'active' | 'idle' | 'away'

export interface TeamUserPresence {
  name: string
  /** Present in the realtime presence channel right now. */
  online: boolean
  activity: TeamActivity
  /** Epoch ms of their last recorded action, null if unknown. */
  lastActiveAt: number | null
  /** Hostnames of the machines this user is currently connected from. */
  machines: string[]
  /** Local game id the user is focused on (resolved per machine), null if unknown here. */
  gameId: string | null
  /** Raw shared game key (normalized remote URL) for cross-machine identity. */
  gameKey: string | null
  /** Count of live agent sessions that user is running. */
  agents: number
}

export interface TeamRemoteSession {
  id: string
  gameId: string | null
  gameKey: string
  owner: string
  task: string
  status: AgentStatus
  numTurns: number | null
  costUsd: number | null
  updatedAt: number
}

export interface TeamGameRef {
  /** Normalized remote URL — the shared identity. */
  key: string
  name: string
  /** Whether this machine has a local registry entry for it. */
  linked: boolean
  gameId: string | null
}

export interface TeamState {
  status: TeamStatus
  reason: string | null
  me: string | null
  users: TeamUserPresence[]
  sessions: TeamRemoteSession[]
  /** Every game the team has registered anywhere, with local link status. */
  games: TeamGameRef[]
}

export interface TeamNoteState {
  content: string
  version: number
  updatedBy: string | null
  updatedAt: number | null
}

export interface ToolingTool {
  name: string
  spec: string
}

export interface ToolingPackage {
  name: string
  spec: string
  comment: string | null
  dev: boolean
  /** Present in wally.toml but commented out (per-genre opt-in). */
  optional: boolean
}

export interface ToolingReport {
  tools: ToolingTool[]
  packages: ToolingPackage[]
  configs: string[]
}

/** Live `rojo serve` state for one game, pushed via EvRojoChanged. */
export interface RojoServeStatus {
  gameId: string
  running: boolean
  /** Listening port when running; 34872 preferred so the Studio plugin auto-detects it. */
  port: number | null
  /** True when Bridge attached to an already-running server for this project instead of spawning. */
  reused: boolean
  startedAt: number | null
  /** Directory being served — the repo checkout or one of the game's worktrees. */
  targetPath: string | null
  /** 'main' for the repo checkout, else the worktree folder name (agent-2). */
  targetLabel: string | null
  /** Why the last serve ended when not running (crash/exit); cleared on the next start. */
  note: string | null
}

export interface RojoOpenBuildResult {
  status: RojoServeStatus
  /** Non-fatal step failures: VS Code missing, Studio not found, reused-server notice. */
  notes: string[]
}

export interface GitRepoStatus {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
  dirtyFiles: number
  /** Epoch ms of the last fetch/pull (FETCH_HEAD mtime), null if never. */
  lastPulledAt: number | null
  remoteUrl: string | null
  webUrl: string | null
  /** true = origin is in the studio org; false = elsewhere; null = no remote. */
  inStudioOrg: boolean | null
}

/** What a game deletion should destroy, beyond Bridge's own registry. */
export interface GameDeleteTargets {
  /** The repo folder and its worktrees on this machine. */
  local: boolean
  /** The GitHub repository. */
  github: boolean
  /** Goals, notes, and mirrored sessions on the team server. */
  team: boolean
}

export interface WorktreeRow {
  path: string
  name: string
  branch: string | null
  inUse: boolean
  /**
   * Commits on this branch that aren't on the default branch. Zero means
   * there is nothing to open a pull request for.
   */
  ahead: number
}

export interface VaultNoteRef {
  /** Path relative to the vault root (native separators). */
  relPath: string
  /** Note name without the .md extension. */
  name: string
  /** Top-level vault folder the note lives in. */
  folder: string
  size: number
}

export interface UsageWindow {
  key: string
  label: string
  /** 0–100. */
  percent: number
  severity: string
  resetsAt: string | null
  active: boolean
}

export interface UsageSnapshot {
  status: 'ok' | 'unavailable'
  plan: string | null
  windows: UsageWindow[]
  fetchedAt: number
  reason: string | null
  /** True when showing last-known data because the usage API is rate-limiting us. */
  stale: boolean
}

/**
 * Auto-update progress for this launch. `ready` means the download finished
 * and the new version applies the next time Bridge quits.
 */
export interface UpdateState {
  status: 'idle' | 'disabled' | 'checking' | 'current' | 'downloading' | 'ready' | 'error'
  /** The version running right now — what the sidebar shows. */
  currentVersion: string
  /** The version waiting to install, when one is. */
  version: string | null
  reason: string | null
}

export interface BridgeApi {
  listGames(): Promise<Game[]>
  addGame(input: AddGameInput): Promise<GameMutationResult>
  /** Create a brand-new game: folder in the games root, git init, GOALS.md, GitHub org repo. */
  createGame(name: string): Promise<GameMutationResult>
  updateGame(game: Game): Promise<GameMutationResult>
  removeGame(id: string): Promise<void>
  /** Delete a game beyond the registry. Every target is irreversible. */
  deleteGame(id: string, targets: GameDeleteTargets): Promise<string>
  getGoals(gameId: string): Promise<GoalsState>
  createGoalsTemplate(gameId: string): Promise<GoalsState>
  mutateGoals(gameId: string, mutation: GoalsMutation): Promise<GoalsState>
  openRepo(gameId: string): Promise<void>
  pickFolder(): Promise<string | null>
  startAgent(gameId: string, config: AgentLaunchConfig): Promise<AgentSessionSummary>
  cancelAgent(sessionId: string): Promise<void>
  repromptAgent(sessionId: string, text: string): Promise<void>
  /** Change a live session's permission mode without restarting it. */
  setAgentMode(sessionId: string, mode: AgentPermissionMode): Promise<void>
  /** Change a live session's model without restarting it ('' = default). */
  setAgentModel(sessionId: string, model: string): Promise<void>
  /** Drop a session's test steps once they've all been verified. */
  clearAgentTestSteps(sessionId: string): Promise<void>
  interruptAgent(sessionId: string): Promise<void>
  listAgentSessions(gameId: string): Promise<AgentSessionSummary[]>
  getAgentTranscript(sessionId: string): Promise<AgentStreamItem[]>
  getUsage(): Promise<UsageSnapshot>
  getSettings(): Promise<AppSettings>
  setVaultPath(path: string | null): Promise<AppSettings>
  /** null = reset to the default (~/BridgeGames). */
  setGamesRoot(path: string | null): Promise<AppSettings>
  openGamesRoot(): Promise<void>
  listVaultNotes(gameId: string): Promise<VaultNoteRef[]>
  openVault(): Promise<void>
  logDecision(gameId: string, title: string, body: string): Promise<void>
  teamConnect(input: TeamConnectInput): Promise<TeamState>
  teamDisconnect(): Promise<TeamState>
  getTeamState(): Promise<TeamState>
  setTeamFocus(gameId: string | null): Promise<void>
  /** Adopt a team game on this machine: 'locate' an existing clone, or 'clone' fresh into a parent dir. */
  linkTeamGame(
    key: string,
    mode: 'locate' | 'clone',
    path: string
  ): Promise<{ game: Game; warnings: string[] }>
  getTeamNote(gameId: string): Promise<TeamNoteState | null>
  saveTeamNote(gameId: string, content: string, baseVersion: number): Promise<TeamNoteState>
  gitStatus(gameId: string): Promise<GitRepoStatus>
  getTooling(gameId: string): Promise<ToolingReport>
  /** Create the org repo, repoint origin, push. Returns the new web URL. */
  moveToOrg(gameId: string): Promise<string>
  gitPull(gameId: string): Promise<string>
  listWorktrees(gameId: string): Promise<WorktreeRow[]>
  removeWorktree(gameId: string, worktreePath: string, force: boolean): Promise<void>
  /** Commits pending changes in `worktreePath` (if any), pushes, opens the PR. */
  createPr(gameId: string, branch: string, worktreePath?: string): Promise<string>
  onGoalsChanged(cb: (state: GoalsState) => void): () => void
  onRegistryChanged(cb: (games: Game[]) => void): () => void
  onAgentEvent(cb: (event: AgentEvent) => void): () => void
  onUsageChanged(cb: (snapshot: UsageSnapshot) => void): () => void
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  onTeamChanged(cb: (state: TeamState) => void): () => void
  onTeamNote(cb: (payload: { gameId: string; note: TeamNoteState }) => void): () => void
  /** Open a folder in VS Code — the repo itself, or one of its worktrees. */
  openInEditor(gameId: string, targetPath?: string): Promise<void>
  /** One click: VS Code + rojo serve (reuse or spawn on 34872+) + Roblox Studio. */
  rojoOpenBuild(gameId: string, targetPath?: string): Promise<RojoOpenBuildResult>
  /** Stop or detach the tracked serve. Returns an info message when there is one. */
  rojoStop(gameId: string): Promise<string | null>
  rojoStatus(gameId: string): Promise<RojoServeStatus>
  onRojoChanged(cb: (status: RojoServeStatus) => void): () => void
  getUpdateState(): Promise<UpdateState>
  /** Install the downloaded update now and relaunch. */
  installUpdate(): Promise<void>
  onUpdateChanged(cb: (state: UpdateState) => void): () => void
}
