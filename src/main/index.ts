import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { GameRegistry } from './registry'
import { GoalsService } from './goals'
import { AgentService } from './agents'
import { WorktreeService } from './worktrees'
import { UsageService } from './usage'
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
    agents = new AgentService(new WorktreeService(), () => void usage?.refresh())
    registerIpc(registry, goals, agents, usage)
    goals.syncWatchers(registry.list())
    usage.start()

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
