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

export interface BridgeApi {
  listGames(): Promise<Game[]>
  addGame(input: AddGameInput): Promise<GameMutationResult>
  updateGame(game: Game): Promise<GameMutationResult>
  removeGame(id: string): Promise<void>
  getGoals(gameId: string): Promise<GoalsState>
  createGoalsTemplate(gameId: string): Promise<GoalsState>
  pickFolder(): Promise<string | null>
  onGoalsChanged(cb: (state: GoalsState) => void): () => void
  onRegistryChanged(cb: (games: Game[]) => void): () => void
}
