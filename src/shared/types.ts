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
  onGoalsChanged(cb: (state: GoalsState) => void): () => void
  onRegistryChanged(cb: (games: Game[]) => void): () => void
}
