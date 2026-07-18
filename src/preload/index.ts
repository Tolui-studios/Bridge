import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AddGameInput,
  AgentEvent,
  AgentLaunchConfig,
  BridgeApi,
  Game,
  GoalsMutation,
  GoalsState
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
  listAgentSessions: (gameId: string) => ipcRenderer.invoke(IPC.AgentsList, gameId),
  getAgentTranscript: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsTranscript, sessionId),
  onGoalsChanged: subscribe<GoalsState>(IPC.EvGoalsChanged),
  onRegistryChanged: subscribe<Game[]>(IPC.EvRegistryChanged),
  onAgentEvent: subscribe<AgentEvent>(IPC.EvAgentEvent)
}

contextBridge.exposeInMainWorld('bridge', api)
