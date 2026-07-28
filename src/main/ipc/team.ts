import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { TeamConnectInput } from '@shared/types'
import { cloneRepo, normalizeRemoteKey, remoteUrl } from '../gitOps'
import type { IpcContext } from './index'

export function registerTeamIpc(ctx: IpcContext): void {
  const { registry, settings, team, toolchain } = ctx

  ipcMain.handle(IPC.TeamConnect, (_event, input: TeamConnectInput) => team.connect(input))
  ipcMain.handle(IPC.TeamDisconnect, () => team.disconnect())
  ipcMain.handle(IPC.TeamState, () => team.state())
  ipcMain.handle(IPC.TeamFocus, (_event, gameId: string | null) => team.setFocus(gameId))
  ipcMain.handle(IPC.TeamNoteGet, (_event, gameId: string) => team.getNote(ctx.requireGame(gameId)))
  ipcMain.handle(IPC.TeamNoteSave, (_event, gameId: string, content: string, baseVersion: number) =>
    team.saveNote(ctx.requireGame(gameId), content, baseVersion)
  )

  ipcMain.handle(
    IPC.TeamLinkGame,
    async (_event, key: string, mode: 'locate' | 'clone', pickedPath: string) => {
      const teamGame = team.getTeamGame(key)
      if (!teamGame) throw new Error('Unknown team game.')
      let repoPath = pickedPath
      if (mode === 'clone') {
        const folderName = key.split('/').pop() ?? teamGame.name
        const parentDir = pickedPath.trim() || settings.ensureGamesRoot()
        repoPath = await cloneRepo(`https://${key}.git`, parentDir, folderName)
      }
      const actualKey = normalizeRemoteKey(await remoteUrl(repoPath))
      if (actualKey !== key) {
        throw new Error(
          `That folder's origin remote (${actualKey ?? 'none'}) doesn't match this team game (${key}).`
        )
      }
      const result = registry.add({ name: teamGame.name, repoPath })
      await team.afterLink(result.game)
      ctx.broadcastRegistry()
      const warnings = await toolchain.setupRepo(repoPath)
      return { game: result.game, warnings }
    }
  )
}
