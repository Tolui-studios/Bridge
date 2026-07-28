import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { GameRegistry } from './registry'
import { GoalsService } from './goals'
import { AgentService } from './agents'
import { WorktreeService } from './worktrees'
import { SessionStore } from './sessionStore'
import { UsageService } from './usage'
import { SettingsStore } from './settings'
import { VaultService } from './vault'
import { TeamSync } from './teamSync'
import { ToolchainService } from './toolchain'
import { McpInstaller } from './mcpInstall'
import { RojoService } from './rojo'
import { AutoPullService } from './autoPull'
import { autoPullDefaultBranch } from './gitOps'
import { UpdaterService } from './updater'
import { applyGoalMarker, buildTaskFooter } from './goalSync'
import { applyAgentNote } from './claudeNotes'
import { registerIpc } from './ipc'

const here = fileURLToPath(new URL('.', import.meta.url))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    title: 'Bridge',
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(here, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let goals: GoalsService | null = null
  let agents: AgentService | null = null
  let usage: UsageService | null = null
  let rojo: RojoService | null = null
  let autoPull: AutoPullService | null = null

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.toluistudios.bridge')

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const registry = new GameRegistry(join(app.getPath('userData'), 'registry.json'))
    goals = new GoalsService((id) => registry.get(id))
    usage = new UsageService()
    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    settings.ensureGamesRoot()
    const vault = new VaultService(() => settings.get().vaultPath)
    const goalsService = goals
    const userSlug = os.userInfo().username.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'user'
    const worktrees = new WorktreeService(`agent-${userSlug}`)
    let agentsRef: AgentService | null = null
    const team = new TeamSync({
      settings,
      authStorePath: join(app.getPath('userData'), 'team-auth.json'),
      listGames: () => registry.list(),
      getGame: (id) => registry.get(id),
      goals: goalsService,
      getLiveAgentCount: () => agentsRef?.liveCount() ?? 0
    })
    goalsService.onExternalEdit = (game, raw) => void team.pushLocalEdit(game, raw)
    const toolchain = new ToolchainService()
    const mcpInstaller = new McpInstaller(join(app.getPath('userData'), 'mcp'))
    // Warm the managed MCP install off the critical path — launches fall back
    // to npx until it's ready.
    void mcpInstaller.ensureInstalled()
    rojo = new RojoService((dir) => toolchain.setupRepo(dir))
    agents = new AgentService(worktrees, new SessionStore(join(app.getPath('userData'), 'sessions')), {
      onSettled: () => void usage?.refresh(),
      onStatus: (summary) => team.publishSession(summary),
      onRateLimit: (info) => usage?.ingestRateLimit(info),
      prepareWorkspace: (dir, game) => toolchain.prepareWorkspace(dir, game.repoPath),
      robloxMcpEntry: () => mcpInstaller.entryPath(),
      taskFooter: (gameId) => buildTaskFooter(goalsService, gameId),
      applyMarker: (gameId, marker) => applyGoalMarker(goalsService, gameId, marker),
      applyNote: (gameId, text) => {
        const game = registry.get(gameId)
        return game ? applyAgentNote(game.repoPath, text) : 'note skipped (unknown game)'
      },
      vaultContext: (_gameId, relPaths) => vault.buildContext(relPaths),
      onRunEnded: (summary, extras) => {
        const game = registry.get(summary.gameId)
        return game ? vault.appendRunSummary(game, summary, extras) : null
      }
    })
    agentsRef = agents
    const updater = new UpdaterService(() => agentsRef?.liveCount() ?? 0)
    registerIpc({ registry, goals, agents, usage, settings, vault, team, worktrees, toolchain, rojo, updater })
    goals.syncWatchers(registry.list())
    usage.start()
    void team.restore()

    // Agents only ever work on agent-* branches in worktrees, so the local
    // default branch of every game is safe to fast-forward frequently —
    // keeping the base that worktrees (and "Serve main") start from current.
    autoPull = new AutoPullService({
      listGames: () => registry.list(),
      pull: (game) => autoPullDefaultBranch(game),
      log: (line) => console.log(line)
    })
    autoPull.start()

    createWindow()
    // After the window exists, so the first state event has somewhere to land.
    updater.start()

    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows()
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    usage?.stop()
    autoPull?.stop()
    agents?.closeAll()
    rojo?.stopAllSync()
    void goals?.closeAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
