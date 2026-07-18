import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AddGameInput, AgentLaunchConfig, Game, GoalsMutation } from '@shared/types'
import type { GameRegistry } from './registry'
import type { GoalsService } from './goals'
import type { AgentService } from './agents'
import type { UsageService } from './usage'
import type { SettingsStore } from './settings'
import type { VaultService } from './vault'

export function registerIpc(
  registry: GameRegistry,
  goals: GoalsService,
  agents: AgentService,
  usage: UsageService,
  settings: SettingsStore,
  vault: VaultService
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

  ipcMain.handle(IPC.SettingsGet, () => settings.get())

  ipcMain.handle(IPC.SettingsSetVault, (_event, vaultPath: string | null) => {
    const next = settings.setVaultPath(vaultPath)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.EvSettingsChanged, next)
    }
    return next
  })

  ipcMain.handle(IPC.VaultNotes, (_event, gameId: string) => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    return vault.notesForGame(game)
  })

  ipcMain.handle(IPC.VaultOpen, async () => {
    const { vaultPath } = settings.get()
    if (!vaultPath) throw new Error('No vault connected.')
    const error = await shell.openPath(vaultPath)
    if (error) throw new Error(`Could not open vault: ${error}`)
  })

  ipcMain.handle(IPC.VaultLogDecision, (_event, gameId: string, title: string, body: string) => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    vault.appendDecision(game, title, body)
  })
}
