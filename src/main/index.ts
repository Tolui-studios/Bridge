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
import { applyGoalMarker, buildTaskFooter } from './goalSync'
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
    agents = new AgentService(worktrees, new SessionStore(join(app.getPath('userData'), 'sessions')), {
      onSettled: () => void usage?.refresh(),
      onStatus: (summary) => team.publishSession(summary),
      onRateLimit: (info) => usage?.ingestRateLimit(info),
      taskFooter: (gameId) => buildTaskFooter(goalsService, gameId),
      applyMarker: (gameId, marker) => applyGoalMarker(goalsService, gameId, marker),
      vaultContext: (_gameId, relPaths) => vault.buildContext(relPaths),
      onRunEnded: (summary, extras) => {
        const game = registry.get(summary.gameId)
        return game ? vault.appendRunSummary(game, summary, extras) : null
      }
    })
    agentsRef = agents
    registerIpc(registry, goals, agents, usage, settings, vault, team, worktrees)
    goals.syncWatchers(registry.list())
    usage.start()
    void team.restore()

    createWindow()

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
    agents?.closeAll()
    void goals?.closeAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
