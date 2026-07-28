import { dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { IpcContext } from './index'

/** Shell, dialog, usage-meter, and auto-update handlers — the one-offs. */
export function registerMiscIpc(ctx: IpcContext): void {
  const { registry, settings, usage, updater } = ctx

  ipcMain.handle(IPC.ShellOpenRepo, async (_event, gameId: string) => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    const error = await shell.openPath(game.repoPath)
    if (error) throw new Error(`Could not open folder: ${error}`)
  })

  ipcMain.handle(IPC.DialogPickFolder, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: settings.ensureGamesRoot()
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.UsageGet, () => usage.get())

  ipcMain.handle(IPC.UpdateGet, () => updater.get())
  ipcMain.handle(IPC.UpdateInstall, () => updater.install())
}
