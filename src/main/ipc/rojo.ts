import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { isUnder } from '../worktrees'
import type { IpcContext } from './index'

export function registerRojoIpc(ctx: IpcContext): void {
  const { rojo } = ctx

  ipcMain.handle(IPC.RojoOpenBuild, (_event, gameId: string, targetPath?: string) => {
    const game = ctx.requireGame(gameId)
    // No target = the repo itself; otherwise it must be one of its worktrees.
    if (targetPath && targetPath !== game.repoPath && !isUnder(targetPath, game.worktreeRoot)) {
      throw new Error('That path is neither this game’s repo nor one of its worktrees.')
    }
    return rojo.openBuild(game, targetPath)
  })
  ipcMain.handle(IPC.RojoStop, (_event, gameId: string) => rojo.stop(gameId))
  ipcMain.handle(IPC.RojoStatus, (_event, gameId: string) => rojo.status(gameId))
}
