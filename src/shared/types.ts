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
  /** Team sync (Supabase) config presence — the key itself never leaves main. */
  teamConfigured: boolean
  teamUrl: string | null
  teamEmail: string | null
}

export interface TeamConnectInput {
  url: string
  anonKey: string
  email: string
  password: string
}

export type TeamStatus = 'off' | 'connecting' | 'online' | 'error'

export interface TeamUserPresence {
  name: string
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

export interface TeamState {
  status: TeamStatus
  reason: string | null
  me: string | null
  users: TeamUserPresence[]
  sessions: TeamRemoteSession[]
}

export interface TeamNoteState {
  content: string
  version: number
  updatedBy: string | null
  updatedAt: number | null
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
}

export interface WorktreeRow {
  path: string
  name: string
  branch: string | null
  inUse: boolean
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

export interface BridgeApi {
  listGames(): Promise<Game[]>
  addGame(input: AddGameInput): Promise<GameMutationResult>
  updateGame(game: Game): Promise<GameMutationResult>
  removeGame(id: string): Promise<void>
  getGoals(gameId: string): Promise<GoalsState>
  createGoalsTemplate(gameId: string): Promise<GoalsState>
  mutateGoals(gameId: string, mutation: GoalsMutation): Promise<GoalsState>
  openRepo(gameId: string): Promise<void>
  pickFolder(): Promise<string | null>
  startAgent(gameId: string, config: AgentLaunchConfig): Promise<AgentSessionSummary>
  cancelAgent(sessionId: string): Promise<void>
  repromptAgent(sessionId: string, text: string): Promise<void>
  interruptAgent(sessionId: string): Promise<void>
  listAgentSessions(gameId: string): Promise<AgentSessionSummary[]>
  getAgentTranscript(sessionId: string): Promise<AgentStreamItem[]>
  getUsage(): Promise<UsageSnapshot>
  getSettings(): Promise<AppSettings>
  setVaultPath(path: string | null): Promise<AppSettings>
  listVaultNotes(gameId: string): Promise<VaultNoteRef[]>
  openVault(): Promise<void>
  logDecision(gameId: string, title: string, body: string): Promise<void>
  teamConnect(input: TeamConnectInput): Promise<TeamState>
  teamDisconnect(): Promise<TeamState>
  getTeamState(): Promise<TeamState>
  setTeamFocus(gameId: string | null): Promise<void>
  getTeamNote(gameId: string): Promise<TeamNoteState | null>
  saveTeamNote(gameId: string, content: string, baseVersion: number): Promise<TeamNoteState>
  gitStatus(gameId: string): Promise<GitRepoStatus>
  gitPull(gameId: string): Promise<string>
  listWorktrees(gameId: string): Promise<WorktreeRow[]>
  removeWorktree(gameId: string, worktreePath: string, force: boolean): Promise<void>
  createPr(gameId: string, branch: string): Promise<string>
  onGoalsChanged(cb: (state: GoalsState) => void): () => void
  onRegistryChanged(cb: (games: Game[]) => void): () => void
  onAgentEvent(cb: (event: AgentEvent) => void): () => void
  onUsageChanged(cb: (snapshot: UsageSnapshot) => void): () => void
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  onTeamChanged(cb: (state: TeamState) => void): () => void
  onTeamNote(cb: (payload: { gameId: string; note: TeamNoteState }) => void): () => void
}
