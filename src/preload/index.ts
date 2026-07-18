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
  GoalsState,
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
  repromptAgent: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC.AgentsReprompt, sessionId, text),
  interruptAgent: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsInterrupt, sessionId),
  listAgentSessions: (gameId: string) => ipcRenderer.invoke(IPC.AgentsList, gameId),
  getAgentTranscript: (sessionId: string) => ipcRenderer.invoke(IPC.AgentsTranscript, sessionId),
  getUsage: () => ipcRenderer.invoke(IPC.UsageGet),
  onGoalsChanged: subscribe<GoalsState>(IPC.EvGoalsChanged),
  onRegistryChanged: subscribe<Game[]>(IPC.EvRegistryChanged),
  onAgentEvent: subscribe<AgentEvent>(IPC.EvAgentEvent),
  onUsageChanged: subscribe<UsageSnapshot>(IPC.EvUsageChanged)
}

contextBridge.exposeInMainWorld('bridge', api)
