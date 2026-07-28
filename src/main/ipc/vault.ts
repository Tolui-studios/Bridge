import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { IpcContext } from './index'

export function registerVaultIpc(ctx: IpcContext): void {
  const { registry, settings, vault } = ctx

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
