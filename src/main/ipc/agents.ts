import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AgentLaunchConfig, AgentPermissionMode } from '@shared/types'
import type { IpcContext } from './index'

export function registerAgentsIpc(ctx: IpcContext): void {
  const { registry, agents } = ctx

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

  ipcMain.handle(
    IPC.AgentsSetMode,
    (_event, sessionId: string, mode: AgentPermissionMode) =>
      agents.setPermissionMode(sessionId, mode)
  )

  ipcMain.handle(IPC.AgentsSetModel, (_event, sessionId: string, model: string) =>
    agents.setModel(sessionId, model)
  )

  ipcMain.handle(IPC.AgentsSetTools, (_event, sessionId: string, tools: string[]) =>
    agents.setTools(sessionId, tools)
  )

  ipcMain.handle(IPC.AgentsClearTests, (_event, sessionId: string) => {
    agents.clearTestSteps(sessionId)
  })

  ipcMain.handle(
    IPC.AgentsAnswer,
    (_event, sessionId: string, answers: Record<string, string | string[]>) => {
      agents.answerChoices(sessionId, answers)
    }
  )

  ipcMain.handle(IPC.AgentsResume, (_event, sessionId: string, text: string) => {
    const game = ctx.requireGame(agents.summaryOf(sessionId).gameId)
    return agents.resume(game, sessionId, text)
  })

  ipcMain.handle(IPC.AgentsList, (_event, gameId: string) => agents.list(gameId))

  ipcMain.handle(IPC.AgentsTranscript, (_event, sessionId: string) => agents.transcript(sessionId))
}
