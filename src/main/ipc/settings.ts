import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { IpcContext } from './index'

export function registerSettingsIpc(ctx: IpcContext): void {
  const { settings } = ctx

  ipcMain.handle(IPC.SettingsGet, () => settings.get())

  ipcMain.handle(IPC.SettingsSetVault, (_event, vaultPath: string | null) => {
    const next = settings.setVaultPath(vaultPath)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.EvSettingsChanged, next)
    }
    return next
  })

  ipcMain.handle(IPC.SettingsSetGamesRoot, (_event, gamesRoot: string | null) => {
    const next = settings.setGamesRoot(gamesRoot)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.EvSettingsChanged, next)
    }
    return next
  })

  ipcMain.handle(IPC.SettingsOpenGamesRoot, async () => {
    const error = await shell.openPath(settings.ensureGamesRoot())
    if (error) throw new Error(`Could not open games folder: ${error}`)
  })
}
