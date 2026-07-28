import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type * as T from '../shared/types'

/*
 * One wrapper object per domain, spread into `api` at the bottom — mirrors
 * the domain interfaces in shared/types.ts and the channel blocks in
 * shared/ipc-channels.ts. Add new wrappers to the matching domain object,
 * never at the end of one big literal.
 */

function subscribe<P>(channel: string): (cb: (payload: P) => void) => () => void {
  return (cb) => {
    const listener = (_event: IpcRendererEvent, payload: P): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const gamesApi: T.GamesApi = {
  listGames: () => ipcRenderer.invoke(IPC.GamesList),
  addGame: (input: T.AddGameInput) => ipcRenderer.invoke(IPC.GamesAdd, input),
  createGame: (name: string) => ipcRenderer.invoke(IPC.GamesCreate, name),
  onGameCreateProgress: subscribe<T.GameCreateProgress>(IPC.EvGameCreateProgress),
  updateGame: (game: T.Game) => ipcRenderer.invoke(IPC.GamesUpdate, game),
  removeGame: (id: string) => ipcRenderer.invoke(IPC.GamesRemove, id),
  deleteGame: (id: string, targets: T.GameDeleteTargets) =>
    ipcRenderer.invoke(IPC.GamesDelete, id, targets),
  onRegistryChanged: subscribe<T.Game[]>(IPC.EvRegistryChanged)
}

const goalsApi: T.GoalsApi = {
  getGoals: (gameId: string) => ipcRenderer.invoke(IPC.GoalsGet, gameId),
  createGoalsTemplate: (gameId: string) => ipcRenderer.invoke(IPC.GoalsCreateTemplate, gameId),
  mutateGoals: (gameId: string, mutation: T.GoalsMutation) =>
    ipcRenderer.invoke(IPC.GoalsMutate, gameId, mutation),
  onGoalsChanged: subscribe<T.GoalsState>(IPC.EvGoalsChanged)
}

const shellApi: T.ShellApi = {
  openRepo: (gameId: string) => ipcRenderer.invoke(IPC.ShellOpenRepo, gameId),
  pickFolder: () => ipcRenderer.invoke(IPC.DialogPickFolder)
}

const agentsApi: T.AgentsApi = {
  startAgent: (gameId: string, config: T.AgentLaunchConfig) =>
    ipcRenderer.invoke(IPC.AgentsStart, gameId, config),
  cancelAgent: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsCancel, sessionId),
  repromptAgent: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC.AgentsReprompt, sessionId, text),
  setAgentMode: (sessionId: string, mode: T.AgentPermissionMode) =>
    ipcRenderer.invoke(IPC.AgentsSetMode, sessionId, mode),
  setAgentModel: (sessionId: string, model: string) =>
    ipcRenderer.invoke(IPC.AgentsSetModel, sessionId, model),
  setAgentTools: (sessionId: string, tools: string[]) =>
    ipcRenderer.invoke(IPC.AgentsSetTools, sessionId, tools),
  clearAgentTestSteps: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsClearTests, sessionId),
  interruptAgent: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsInterrupt, sessionId),
  answerAgentChoices: (sessionId: string, answers: Record<string, string | string[]>) =>
    ipcRenderer.invoke(IPC.AgentsAnswer, sessionId, answers),
  resumeAgent: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC.AgentsResume, sessionId, text),
  listAgentSessions: (gameId: string) => ipcRenderer.invoke(IPC.AgentsList, gameId),
  getAgentTranscript: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsTranscript, sessionId),
  onAgentEvent: subscribe<T.AgentEvent>(IPC.EvAgentEvent)
}

const usageApi: T.UsageApi = {
  getUsage: () => ipcRenderer.invoke(IPC.UsageGet),
  onUsageChanged: subscribe<T.UsageSnapshot>(IPC.EvUsageChanged)
}

const settingsApi: T.SettingsApi = {
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet),
  setVaultPath: (path: string | null) => ipcRenderer.invoke(IPC.SettingsSetVault, path),
  setGamesRoot: (path: string | null) => ipcRenderer.invoke(IPC.SettingsSetGamesRoot, path),
  openGamesRoot: () => ipcRenderer.invoke(IPC.SettingsOpenGamesRoot),
  onSettingsChanged: subscribe<T.AppSettings>(IPC.EvSettingsChanged)
}

const vaultApi: T.VaultApi = {
  listVaultNotes: (gameId: string) => ipcRenderer.invoke(IPC.VaultNotes, gameId),
  openVault: () => ipcRenderer.invoke(IPC.VaultOpen),
  logDecision: (gameId: string, title: string, body: string) =>
    ipcRenderer.invoke(IPC.VaultLogDecision, gameId, title, body)
}

const teamApi: T.TeamApi = {
  teamConnect: (input: T.TeamConnectInput) => ipcRenderer.invoke(IPC.TeamConnect, input),
  teamDisconnect: () => ipcRenderer.invoke(IPC.TeamDisconnect),
  getTeamState: () => ipcRenderer.invoke(IPC.TeamState),
  setTeamFocus: (gameId: string | null) => ipcRenderer.invoke(IPC.TeamFocus, gameId),
  linkTeamGame: (key: string, mode: 'locate' | 'clone', path: string) =>
    ipcRenderer.invoke(IPC.TeamLinkGame, key, mode, path),
  getTeamNote: (gameId: string) => ipcRenderer.invoke(IPC.TeamNoteGet, gameId),
  saveTeamNote: (gameId: string, content: string, baseVersion: number) =>
    ipcRenderer.invoke(IPC.TeamNoteSave, gameId, content, baseVersion),
  onTeamChanged: subscribe<T.TeamState>(IPC.EvTeamChanged),
  onTeamNote: subscribe<{ gameId: string; note: T.TeamNoteState }>(IPC.EvTeamNote)
}

const gitApi: T.GitApi = {
  gitStatus: (gameId: string) => ipcRenderer.invoke(IPC.GitStatus, gameId),
  getTooling: (gameId: string) => ipcRenderer.invoke(IPC.GameTooling, gameId),
  moveToOrg: (gameId: string) => ipcRenderer.invoke(IPC.GitMoveToOrg, gameId),
  gitPull: (gameId: string) => ipcRenderer.invoke(IPC.GitPull, gameId),
  listWorktrees: (gameId: string) => ipcRenderer.invoke(IPC.GitWorktrees, gameId),
  worktreeChanges: (gameId: string) => ipcRenderer.invoke(IPC.GitWorktreeChanges, gameId),
  removeWorktree: (gameId: string, worktreePath: string, force: boolean) =>
    ipcRenderer.invoke(IPC.GitWorktreeRemove, gameId, worktreePath, force),
  createPr: (gameId: string, branch: string, worktreePath?: string) =>
    ipcRenderer.invoke(IPC.GitCreatePr, gameId, branch, worktreePath),
  openInEditor: (gameId: string, targetPath?: string) =>
    ipcRenderer.invoke(IPC.GitWorktreeOpenEditor, gameId, targetPath)
}

const rojoApi: T.RojoApi = {
  rojoOpenBuild: (gameId: string, targetPath?: string) =>
    ipcRenderer.invoke(IPC.RojoOpenBuild, gameId, targetPath),
  rojoStop: (gameId: string) => ipcRenderer.invoke(IPC.RojoStop, gameId),
  rojoStatus: (gameId: string) => ipcRenderer.invoke(IPC.RojoStatus, gameId),
  onRojoChanged: subscribe<T.RojoServeStatus>(IPC.EvRojoChanged)
}

const updateApi: T.UpdateApi = {
  getUpdateState: () => ipcRenderer.invoke(IPC.UpdateGet),
  installUpdate: () => ipcRenderer.invoke(IPC.UpdateInstall),
  onUpdateChanged: subscribe<T.UpdateState>(IPC.EvUpdateChanged)
}

const api: T.BridgeApi = {
  ...gamesApi,
  ...goalsApi,
  ...shellApi,
  ...agentsApi,
  ...usageApi,
  ...settingsApi,
  ...vaultApi,
  ...teamApi,
  ...gitApi,
  ...rojoApi,
  ...updateApi
}

contextBridge.exposeInMainWorld('bridge', api)
