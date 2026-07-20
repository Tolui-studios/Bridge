import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AddGameInput,
  AgentEvent,
  AgentLaunchConfig,
  AgentPermissionMode,
  AppSettings,
  BridgeApi,
  Game,
  GoalsMutation,
  GoalsState,
  TeamConnectInput,
  TeamNoteState,
  UpdateState,
  TeamState,
  UsageSnapshot
} from '../shared/types'

function subscribe<T>(channel: string): (cb: (payload: T) => void) => () => void {
  return (cb) => {
    const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api: BridgeApi = {
  listGames: () => ipcRenderer.invoke(IPC.GamesList),
  addGame: (input: AddGameInput) => ipcRenderer.invoke(IPC.GamesAdd, input),
  createGame: (name: string) => ipcRenderer.invoke(IPC.GamesCreate, name),
  updateGame: (game: Game) => ipcRenderer.invoke(IPC.GamesUpdate, game),
  removeGame: (id: string) => ipcRenderer.invoke(IPC.GamesRemove, id),
  getGoals: (gameId: string) => ipcRenderer.invoke(IPC.GoalsGet, gameId),
  createGoalsTemplate: (gameId: string) => ipcRenderer.invoke(IPC.GoalsCreateTemplate, gameId),
  mutateGoals: (gameId: string, mutation: GoalsMutation) =>
    ipcRenderer.invoke(IPC.GoalsMutate, gameId, mutation),
  openRepo: (gameId: string) => ipcRenderer.invoke(IPC.ShellOpenRepo, gameId),
  pickFolder: () => ipcRenderer.invoke(IPC.DialogPickFolder),
  startAgent: (gameId: string, config: AgentLaunchConfig) =>
    ipcRenderer.invoke(IPC.AgentsStart, gameId, config),
  cancelAgent: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsCancel, sessionId),
  setAgentMode: (sessionId: string, mode: AgentPermissionMode) =>
    ipcRenderer.invoke(IPC.AgentsSetMode, sessionId, mode),
  setAgentModel: (sessionId: string, model: string) =>
    ipcRenderer.invoke(IPC.AgentsSetModel, sessionId, model),
  clearAgentTestSteps: (sessionId: string) =>
    ipcRenderer.invoke(IPC.AgentsClearTests, sessionId),
  repromptAgent: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC.AgentsReprompt, sessionId, text),
  interruptAgent: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsInterrupt, sessionId),
  listAgentSessions: (gameId: string) => ipcRenderer.invoke(IPC.AgentsList, gameId),
  getAgentTranscript: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsTranscript, sessionId),
  getUsage: () => ipcRenderer.invoke(IPC.UsageGet),
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  setVaultPath: (path: string | null) => ipcRenderer.invoke(IPC.SettingsSetVault, path),
  setGamesRoot: (path: string | null) => ipcRenderer.invoke(IPC.SettingsSetGamesRoot, path),
  openGamesRoot: () => ipcRenderer.invoke(IPC.SettingsOpenGamesRoot),
  listVaultNotes: (gameId: string) => ipcRenderer.invoke(IPC.VaultNotes, gameId),
  openVault: () => ipcRenderer.invoke(IPC.VaultOpen),
  logDecision: (gameId: string, title: string, body: string) =>
    ipcRenderer.invoke(IPC.VaultLogDecision, gameId, title, body),
  teamConnect: (input: TeamConnectInput) => ipcRenderer.invoke(IPC.TeamConnect, input),
  teamDisconnect: () => ipcRenderer.invoke(IPC.TeamDisconnect),
  getTeamState: () => ipcRenderer.invoke(IPC.TeamState),
  setTeamFocus: (gameId: string | null) => ipcRenderer.invoke(IPC.TeamFocus, gameId),
  linkTeamGame: (key: string, mode: 'locate' | 'clone', path: string) =>
    ipcRenderer.invoke(IPC.TeamLinkGame, key, mode, path),
  getTeamNote: (gameId: string) => ipcRenderer.invoke(IPC.TeamNoteGet, gameId),
  saveTeamNote: (gameId: string, content: string, baseVersion: number) =>
    ipcRenderer.invoke(IPC.TeamNoteSave, gameId, content, baseVersion),
  gitStatus: (gameId: string) => ipcRenderer.invoke(IPC.GitStatus, gameId),
  getTooling: (gameId: string) => ipcRenderer.invoke(IPC.GameTooling, gameId),
  gitPull: (gameId: string) => ipcRenderer.invoke(IPC.GitPull, gameId),
  listWorktrees: (gameId: string) => ipcRenderer.invoke(IPC.GitWorktrees, gameId),
  removeWorktree: (gameId: string, worktreePath: string, force: boolean) =>
    ipcRenderer.invoke(IPC.GitWorktreeRemove, gameId, worktreePath, force),
  createPr: (gameId: string, branch: string, worktreePath?: string) =>
    ipcRenderer.invoke(IPC.GitCreatePr, gameId, branch, worktreePath),
  moveToOrg: (gameId: string) => ipcRenderer.invoke(IPC.GitMoveToOrg, gameId),
  openInEditor: (gameId: string, targetPath?: string) =>
    ipcRenderer.invoke(IPC.GitWorktreeOpenEditor, gameId, targetPath),
  getUpdateState: () => ipcRenderer.invoke(IPC.UpdateGet),
  installUpdate: () => ipcRenderer.invoke(IPC.UpdateInstall),
  onGoalsChanged: subscribe<GoalsState>(IPC.EvGoalsChanged),
  onRegistryChanged: subscribe<Game[]>(IPC.EvRegistryChanged),
  onAgentEvent: subscribe<AgentEvent>(IPC.EvAgentEvent),
  onUsageChanged: subscribe<UsageSnapshot>(IPC.EvUsageChanged),
  onSettingsChanged: subscribe<AppSettings>(IPC.EvSettingsChanged),
  onTeamChanged: subscribe<TeamState>(IPC.EvTeamChanged),
  onTeamNote: subscribe<{ gameId: string; note: TeamNoteState }>(IPC.EvTeamNote),
  onUpdateChanged: subscribe<UpdateState>(IPC.EvUpdateChanged)
}

contextBridge.exposeInMainWorld('bridge', api)
