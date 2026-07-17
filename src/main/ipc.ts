import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AddGameInput, Game } from '@shared/types'
import type { GameRegistry } from './registry'
import type { GoalsService } from './goals'

export function registerIpc(registry: GameRegistry, goals: GoalsService): void {
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
    registry.remove(id)
    broadcastRegistry()
  })

  ipcMain.handle(IPC.GoalsGet, (_event, gameId: string) => goals.readStateById(gameId))

  ipcMain.handle(IPC.GoalsCreateTemplate, (_event, gameId: string) => goals.createTemplate(gameId))

  ipcMain.handle(IPC.DialogPickFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
