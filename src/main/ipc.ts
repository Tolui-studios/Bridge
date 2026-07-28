import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  AddGameInput,
  AgentLaunchConfig,
  AgentPermissionMode,
  Game,
  GameDeleteTargets,
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
import { isUnder } from './worktrees'
import type { ToolchainService } from './toolchain'
import { STUDIO_GITHUB_ORG } from '@shared/teamDefaults'
import {
  cloneRepo,
  commitAll,
  commitLockfile,
  createGithubRepo,
  deleteGithubRepo,
  ensureOnGithub,
  initRepo,
  moveRepoToOrg,
  normalizeRemoteKey,
  pull,
  pushBranchForPr,
  remoteUrl,
  repoSlug,
  repoStatus
} from './gitOps'
import { createGame } from './gameCreate'
import path from 'node:path'
import fs from 'node:fs'
import { scaffoldRobloxGame } from './robloxScaffold'
import { gameTooling } from './tooling'
import type { UpdaterService } from './updater'
import type { RojoService } from './rojo'
import { openInVsCode } from './editor'

export function registerIpc(
  registry: GameRegistry,
  goals: GoalsService,
  agents: AgentService,
  usage: UsageService,
  settings: SettingsStore,
  vault: VaultService,
  team: TeamSync,
  worktrees: WorktreeService,
  toolchain: ToolchainService,
  rojo: RojoService,
  updater: UpdaterService
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

  ipcMain.handle(
    IPC.GitWorktreeOpenEditor,
    async (_event, gameId: string, targetPath?: string) => {
      const game = requireGame(gameId)
      // No target = the repo itself; otherwise it must be one of its worktrees.
      const dir = targetPath ?? game.repoPath
      if (dir !== game.repoPath && !isUnder(dir, game.worktreeRoot)) {
        throw new Error('That path is neither this game’s repo nor one of its worktrees.')
      }
      await openInVsCode(dir)
    }
  )

  ipcMain.handle(IPC.UpdateGet, () => updater.get())
  ipcMain.handle(IPC.UpdateInstall, () => updater.install())

  ipcMain.handle(IPC.GamesList, () => registry.list())

  ipcMain.handle(IPC.GamesAdd, async (_event, input: AddGameInput) => {
    // Get the folder GitHub-ready BEFORE registering, so the registry's
    // ".git missing" validation warning never fires for a repo we just made.
    let ghNotes: string[] = []
    const trimmedPath = (input.repoPath ?? '').trim()
    if (trimmedPath) {
      ghNotes = await ensureOnGithub(path.resolve(trimmedPath), input.name ?? '', STUDIO_GITHUB_ORG)
    }
    const result = registry.add(input)
    result.warnings.push(...ghNotes)
    // Same self-setup as GamesCreate — an added repo is otherwise unservable
    // until something else happens to install its toolchain and Packages/.
    result.warnings.push(...(await toolchain.setupRepo(result.game.repoPath)))
    team.onGameAdded(result.game)
    broadcastRegistry()
    return result
  })

  ipcMain.handle(IPC.GamesCreate, async (_event, rawName: string) => {
    const name = rawName.trim()
    if (!name) throw new Error('Game name is required.')
    const slug = repoSlug(name)
    const dir = path.join(settings.ensureGamesRoot(), slug)
    if (fs.existsSync(dir)) {
      throw new Error(`${dir} already exists — pick a different name or add it as an existing project.`)
    }
    // Resolves after the local bootstrap; GitHub + toolchain continue in the
    // background and stream EvGameCreateProgress events to the modal.
    const run = await createGame(name, slug, dir, {
      initRepo,
      scaffold: scaffoldRobloxGame,
      register: (gameName, repoPath) => registry.add({ name: gameName, repoPath }),
      createGoalsTemplate: (gameId) => void goals.createTemplate(gameId),
      broadcastRegistry,
      commitAll,
      createGithubRepo: (repoDir, repoSlugName) =>
        createGithubRepo(repoDir, STUDIO_GITHUB_ORG, repoSlugName),
      setupToolchain: (repoDir) => toolchain.setupRepo(repoDir),
      commitLockfile,
      onGameAdded: (game) => team.onGameAdded(game),
      emit: (progress) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.EvGameCreateProgress, progress)
        }
      },
      org: STUDIO_GITHUB_ORG
    })
    void run.settled
    return { game: run.game, warnings: run.warnings }
  })

  ipcMain.handle(IPC.GamesUpdate, (_event, game: Game) => {
    const result = registry.update(game)
    broadcastRegistry()
    return result
  })

  ipcMain.handle(IPC.GamesRemove, (_event, id: string) => {
    agents.removeForGame(id)
    rojo.removeForGame(id)
    registry.remove(id)
    broadcastRegistry()
  })

  /**
   * Delete a game beyond Bridge's registry. Every target is opt-in and every
   * one is irreversible, so each is attempted independently and reported —
   * a failure to reach GitHub must not leave the local folder half-deleted
   * with no explanation.
   *
   * Order matters: remote targets first, local files last. A local delete
   * destroys the git remote reference the other two need to identify the game.
   */
  ipcMain.handle(
    IPC.GamesDelete,
    async (_event, gameId: string, targets: GameDeleteTargets) => {
      const game = requireGame(gameId)
      const done: string[] = []
      const failed: string[] = []

      agents.removeForGame(gameId)
      // Before any local deletion — a live serve's cwd would block rmSync on Windows.
      rojo.removeForGame(gameId)

      if (targets.team) {
        try {
          await team.deleteGame(game)
          done.push('team server')
        } catch (err) {
          failed.push(`team server: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      if (targets.github) {
        try {
          done.push(`GitHub (${await deleteGithubRepo(game.repoPath)})`)
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err))
        }
      }

      if (targets.local) {
        // Worktrees are separate checkouts outside the repo — remove them or
        // they are orphaned on disk with no repo to prune them.
        for (const dir of [game.worktreeRoot, game.repoPath]) {
          try {
            if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
          } catch (err) {
            failed.push(
              `could not delete ${dir}: ${err instanceof Error ? err.message : String(err)} (something may still have it open)`
            )
          }
        }
        if (!failed.some((f) => f.includes('could not delete'))) done.push('local files')
      }

      registry.remove(gameId)
      broadcastRegistry()

      const parts = [`Removed “${game.name}” from Bridge.`]
      if (done.length) parts.push(`Also deleted: ${done.join(', ')}.`)
      if (failed.length) parts.push(`Not deleted — ${failed.join('; ')}`)
      return parts.join(' ')
    }
  )

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
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: settings.ensureGamesRoot()
    })
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
    const game = requireGame(agents.summaryOf(sessionId).gameId)
    return agents.resume(game, sessionId, text)
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
      broadcastRegistry()
      const warnings = await toolchain.setupRepo(repoPath)
      return { game: result.game, warnings }
    }
  )

  ipcMain.handle(IPC.GitStatus, (_event, gameId: string) => repoStatus(requireGame(gameId)))
  ipcMain.handle(IPC.GameTooling, (_event, gameId: string) =>
    gameTooling(requireGame(gameId).repoPath)
  )
  ipcMain.handle(IPC.GitPull, (_event, gameId: string) => pull(requireGame(gameId)))
  ipcMain.handle(IPC.GitWorktrees, (_event, gameId: string) =>
    worktrees.listWithUsage(requireGame(gameId))
  )
  ipcMain.handle(IPC.GitWorktreeChanges, (_event, gameId: string) =>
    worktrees.changesForGame(requireGame(gameId))
  )
  ipcMain.handle(
    IPC.GitWorktreeRemove,
    (_event, gameId: string, worktreePath: string, force: boolean) => {
      // A serve targeting this worktree holds its cwd open — stop it first or
      // removal hits the Windows file-lock error.
      rojo.stopIfServingPath(gameId, worktreePath)
      return worktrees.remove(requireGame(gameId), worktreePath, force)
    }
  )
  ipcMain.handle(
    IPC.GitCreatePr,
    async (_event, gameId: string, branch: string, worktreePath?: string) => {
      const game = requireGame(gameId)
      if (worktreePath && !isUnder(worktreePath, game.worktreeRoot)) {
        throw new Error('That path is not one of this game’s worktrees.')
      }
      // Describe the PR from the run that produced it, so reviewers get the
      // task and the verification steps instead of "chore: work in progress".
      const session = worktreePath ? agents.findByWorktree(gameId, worktreePath) : null
      const message = session
        ? {
            title: session.task.split(/\r?\n/)[0].trim().slice(0, 72) || branch,
            body: [
              '## Task',
              session.task.trim(),
              ...(session.testSteps.length > 0
                ? ['', '## How to test in Studio', ...session.testSteps.map((s) => `- [ ] ${s}`)]
                : []),
              '',
              `_Opened by Bridge from \`${branch}\`._`
            ].join('\n')
          }
        : undefined
      const url = await pushBranchForPr(game, branch, worktreePath, message)
      void shell.openExternal(url)
      return url
    }
  )

  ipcMain.handle(IPC.RojoOpenBuild, (_event, gameId: string, targetPath?: string) => {
    const game = requireGame(gameId)
    // No target = the repo itself; otherwise it must be one of its worktrees.
    if (targetPath && targetPath !== game.repoPath && !isUnder(targetPath, game.worktreeRoot)) {
      throw new Error('That path is neither this game’s repo nor one of its worktrees.')
    }
    return rojo.openBuild(game, targetPath)
  })
  ipcMain.handle(IPC.RojoStop, (_event, gameId: string) => rojo.stop(gameId))
  ipcMain.handle(IPC.RojoStatus, (_event, gameId: string) => rojo.status(gameId))

  ipcMain.handle(IPC.GitMoveToOrg, async (_event, gameId: string) => {
    const game = requireGame(gameId)
    const url = await moveRepoToOrg(game, STUDIO_GITHUB_ORG, repoSlug(game.name))
    // The shared identity changed — re-key, re-register, and re-sync goals.
    await team.afterLink(game)
    return url
  })
}
