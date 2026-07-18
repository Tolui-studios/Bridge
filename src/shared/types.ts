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
}

export type AgentStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface AgentSessionSummary {
  id: string
  gameId: string
  task: string
  status: AgentStatus
  permissionMode: AgentPermissionMode
  allowedTools: string[]
  model: string | null
  startedAt: number
  endedAt: number | null
  costUsd: number | null
  numTurns: number | null
  error: string | null
}

export type AgentStreamKind =
  | 'system'
  | 'text'
  | 'tool'
  | 'tool-result'
  | 'denied'
  | 'result'
  | 'stderr'

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
  listAgentSessions(gameId: string): Promise<AgentSessionSummary[]>
  getAgentTranscript(sessionId: string): Promise<AgentStreamItem[]>
  onGoalsChanged(cb: (state: GoalsState) => void): () => void
  onRegistryChanged(cb: (games: Game[]) => void): () => void
  onAgentEvent(cb: (event: AgentEvent) => void): () => void
}
