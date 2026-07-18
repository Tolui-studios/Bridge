import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AddGameInput, AgentLaunchConfig, Game, GoalsMutation } from '@shared/types'
import type { GameRegistry } from './registry'
import type { GoalsService } from './goals'
import type { AgentService } from './agents'
import type { UsageService } from './usage'

export function registerIpc(
  registry: GameRegistry,
  goals: GoalsService,
  agents: AgentService,
  usage: UsageService
): void {
  const broadcastRegistry = (): void => {
    const games = registry.list()
    goals.syncWatchers(games)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.EvRegistryChanged, games)
    }
  }

  ipcMain.handle(IPC.GamesList, () => registry.list())

  ipcMain.handle(IPC.GamesAdd, (_event, input: AddGameInput) => {
    const result = registry.add(input)
    broadcastRegistry()
    return result
  })

  ipcMain.handle(IPC.GamesUpdate, (_event, game: Game) => {
    const result = registry.update(game)
    broadcastRegistry()
    return result
  })

  ipcMain.handle(IPC.GamesRemove, (_event, id: string) => {
    agents.removeForGame(id)
    registry.remove(id)
    broadcastRegistry()
  })

  ipcMain.handle(IPC.GoalsGet, (_event, gameId: string) => goals.readStateById(gameId))

  ipcMain.handle(IPC.GoalsCreateTemplate, (_event, gameId: string) => goals.createTemplate(gameId))

  ipcMain.handle(IPC.GoalsMutate, (_event, gameId: string, mutation: GoalsMutation) =>
    goals.mutate(gameId, mutation)
  )

  ipcMain.handle(IPC.ShellOpenRepo, async (_event, gameId: string) => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    const error = await shell.openPath(game.repoPath)
    if (error) throw new Error(`Could not open folder: ${error}`)
  })

  ipcMain.handle(IPC.DialogPickFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.AgentsStart, (_event, gameId: string, config: AgentLaunchConfig) => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    return agents.start(game, config)
  })

  ipcMain.handle(IPC.AgentsCancel, (_event, sessionId: string) => {
    agents.cancel(sessionId)
  })

  ipcMain.handle(IPC.AgentsReprompt, (_event, sessionId: string, text: string) => {
    agents.reprompt(sessionId, text)
  })

  ipcMain.handle(IPC.AgentsInterrupt, (_event, sessionId: string) => {
    agents.interrupt(sessionId)
  })

  ipcMain.handle(IPC.AgentsList, (_event, gameId: string) => agents.list(gameId))

  ipcMain.handle(IPC.AgentsTranscript, (_event, sessionId: string) => agents.transcript(sessionId))

  ipcMain.handle(IPC.UsageGet, () => usage.get())
}
