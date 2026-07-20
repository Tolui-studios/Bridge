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
import { isUnder } from './worktrees'
import type { ToolchainService } from './toolchain'
import { STUDIO_GITHUB_ORG } from '@shared/teamDefaults'
import {
  cloneRepo,
  commitAll,
  createGithubRepo,
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
import path from 'node:path'
import fs from 'node:fs'
import { scaffoldRobloxGame } from './robloxScaffold'
import { gameTooling } from './tooling'
import type { UpdaterService } from './updater'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Open a folder in VS Code. `code` is a `.cmd` shim on Windows (so it needs a
 * shell), and on macOS it only exists once the user has run "Shell Command:
 * Install 'code' command in PATH" — hence the `open -a` fallback there.
 *
 * `--disable-workspace-trust` skips the trust prompt, which would otherwise
 * appear for every freshly created `agent-<n>` directory. It affects only the
 * launched session, never the user's global trust settings — and a worktree is
 * a checkout of a repo they already own.
 */
async function openInVsCode(dir: string): Promise<void> {
  const flag = '--disable-workspace-trust'
  const attempts: [string, string[]][] =
    process.platform === 'win32'
      ? [['cmd', ['/c', 'code', flag, dir]]]
      : process.platform === 'darwin'
        ? [
            ['code', [flag, dir]],
            ['open', ['-a', 'Visual Studio Code', '--args', flag, dir]]
          ]
        : [['code', [flag, dir]]]

  let lastError: unknown = null
  for (const [command, args] of attempts) {
    try {
      await execFileAsync(command, args, { windowsHide: true })
      return
    } catch (err) {
      lastError = err
    }
  }
  const detail = lastError instanceof Error ? ` (${lastError.message.trim().slice(0, 120)})` : ''
  throw new Error(
    `Could not launch VS Code. Install it, then run "Shell Command: Install 'code' command in PATH" from its Command Palette so \`code\` is available.${detail}`
  )
}

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
    async (_event, gameId: string, worktreePath: string) => {
      const game = requireGame(gameId)
      if (!isUnder(worktreePath, game.worktreeRoot)) {
        throw new Error('That path is not one of this game’s worktrees.')
      }
      await openInVsCode(worktreePath)
    }
  )

  ipcMain.handle(IPC.UpdateGet, () => updater.get())

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
    await initRepo(dir)
    scaffoldRobloxGame(dir, name, slug)
    const result = registry.add({ name, repoPath: dir })
    goals.createTemplate(result.game.id)
    const warnings: string[] = []
    try {
      await commitAll(dir, `chore: bootstrap ${name} via Bridge`)
      try {
        await createGithubRepo(dir, STUDIO_GITHUB_ORG, slug)
      } catch (err) {
        warnings.push(
          `Created locally, but the GitHub repo was not created: ${err instanceof Error ? err.message : String(err)}. Install the GitHub CLI (winget install GitHub.cli, then gh auth login) or create ${STUDIO_GITHUB_ORG}/${slug} manually and add it as origin.`
        )
      }
    } catch (err) {
      warnings.push(
        `Repo initialized but the first commit failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    warnings.push(...(await toolchain.setupRepo(dir)))
    team.onGameAdded(result.game)
    broadcastRegistry()
    return { game: result.game, warnings }
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
      void toolchain.setupRepo(repoPath).then((notes) => {
        for (const note of notes) console.log('[toolchain]', teamGame.name, '-', note)
      })
      return result.game
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

  ipcMain.handle(IPC.GitMoveToOrg, async (_event, gameId: string) => {
    const game = requireGame(gameId)
    const url = await moveRepoToOrg(game, STUDIO_GITHUB_ORG, repoSlug(game.name))
    // The shared identity changed — re-key, re-register, and re-sync goals.
    await team.afterLink(game)
    return url
  })
}
