import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { GoalsMutation } from '@shared/types'
import type { IpcContext } from './index'

export function registerGoalsIpc(ctx: IpcContext): void {
  const { goals, team } = ctx

  ipcMain.handle(IPC.GoalsGet, (_event, gameId: string) => goals.readStateById(gameId))

  ipcMain.handle(IPC.GoalsCreateTemplate, (_event, gameId: string) => goals.createTemplate(gameId))

  ipcMain.handle(IPC.GoalsMutate, async (_event, gameId: string, mutation: GoalsMutation) => {
    const game = ctx.requireGame(gameId)
    // Team-synced games route through the shared canonical copy; otherwise
    // the local single writer applies the edit directly.
    const synced = await team.mutateGoals(game, mutation)
    return synced ?? goals.mutate(gameId, mutation)
  })
}
