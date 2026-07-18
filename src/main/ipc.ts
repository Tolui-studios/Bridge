import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  AddGameInput,
  AgentLaunchConfig,
  Game,
  GoalsMutation,
  TeamConnectInput
} from '@shared/types'
import type { GameRegistry } from './registry'
import type { GoalsService } from './goals'
import type { AgentService } from './agents'
import type { UsageService } from './usage'
import type { SettingsStore } from './settings'
import type { VaultService } from './vault'
import type { TeamSync } from './teamSync'
import type { WorktreeService } from './worktrees'
import { cloneRepo, normalizeRemoteKey, pull, pushBranchForPr, remoteUrl, repoStatus } from './gitOps'

export function registerIpc(
  registry: GameRegistry,
  goals: GoalsService,
  agents: AgentService,
  usage: UsageService,
  settings: SettingsStore,
  vault: VaultService,
  team: TeamSync,
  worktrees: WorktreeService
): void {
  const requireGame = (gameId: string): Game => {
    const game = registry.get(gameId)
    if (!game) throw new Error('Unknown game id.')
    return game
  }
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
    team.onGameAdded(result.game)
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

  ipcMain.handle(IPC.GoalsMutate, async (_event, gameId: string, mutation: GoalsMutation) => {
    const game = requireGame(gameId)
    // Team-synced games route through the shared canonical copy; otherwise
    // the local single writer applies the edit directly.
    const synced = await team.mutateGoals(game, mutation)
    return synced ?? goals.mutate(gameId, mutation)
  })

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

  ipcMain.handle(IPC.TeamConnect, (_event, input: TeamConnectInput) => team.connect(input))
  ipcMain.handle(IPC.TeamDisconnect, () => team.disconnect())
  ipcMain.handle(IPC.TeamState, () => team.state())
  ipcMain.handle(IPC.TeamFocus, (_event, gameId: string | null) => team.setFocus(gameId))
  ipcMain.handle(IPC.TeamNoteGet, (_event, gameId: string) => team.getNote(requireGame(gameId)))
  ipcMain.handle(IPC.TeamNoteSave, (_event, gameId: string, content: string, baseVersion: number) =>
    team.saveNote(requireGame(gameId), content, baseVersion)
  )

  ipcMain.handle(
    IPC.TeamLinkGame,
    async (_event, key: string, mode: 'locate' | 'clone', pickedPath: string) => {
      const teamGame = team.getTeamGame(key)
      if (!teamGame) throw new Error('Unknown team game.')
      let repoPath = pickedPath
      if (mode === 'clone') {
        const folderName = key.split('/').pop() ?? teamGame.name
        repoPath = await cloneRepo(`https://${key}.git`, pickedPath, folderName)
      }
      const actualKey = normalizeRemoteKey(await remoteUrl(repoPath))
      if (actualKey !== key) {
        throw new Error(
          `That folder's origin remote (${actualKey ?? 'none'}) doesn't match this team game (${key}).`
        )
      }
      const result = registry.add({ name: teamGame.name, repoPath })
      await team.afterLink(result.game)
      broadcastRegistry()
      return result.game
    }
  )

  ipcMain.handle(IPC.GitStatus, (_event, gameId: string) => repoStatus(requireGame(gameId)))
  ipcMain.handle(IPC.GitPull, (_event, gameId: string) => pull(requireGame(gameId)))
  ipcMain.handle(IPC.GitWorktrees, (_event, gameId: string) =>
    worktrees.listWithUsage(requireGame(gameId))
  )
  ipcMain.handle(
    IPC.GitWorktreeRemove,
    (_event, gameId: string, worktreePath: string, force: boolean) =>
      worktrees.remove(requireGame(gameId), worktreePath, force)
  )
  ipcMain.handle(IPC.GitCreatePr, async (_event, gameId: string, branch: string) => {
    const url = await pushBranchForPr(requireGame(gameId), branch)
    void shell.openExternal(url)
    return url
  })
}
