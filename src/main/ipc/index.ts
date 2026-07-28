import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { Game } from '@shared/types'
import type { GameRegistry } from '../registry'
import type { GoalsService } from '../goals'
import type { AgentService } from '../agents'
import type { UsageService } from '../usage'
import type { SettingsStore } from '../settings'
import type { VaultService } from '../vault'
import type { TeamSync } from '../teamSync'
import type { WorktreeService } from '../worktrees'
import type { ToolchainService } from '../toolchain'
import type { RojoService } from '../rojo'
import type { UpdaterService } from '../updater'
import { registerGamesIpc } from './games'
import { registerGoalsIpc } from './goals'
import { registerAgentsIpc } from './agents'
import { registerTeamIpc } from './team'
import { registerGitIpc } from './git'
import { registerRojoIpc } from './rojo'
import { registerSettingsIpc } from './settings'
import { registerVaultIpc } from './vault'
import { registerMiscIpc } from './misc'

/**
 * Everything the IPC layer talks to, as one named bag — adding a service is
 * a new key here plus a key at the call site in main/index.ts, never a new
 * positional parameter rippling through every registrar.
 */
export interface IpcDeps {
  registry: GameRegistry
  goals: GoalsService
  agents: AgentService
  usage: UsageService
  settings: SettingsStore
  vault: VaultService
  team: TeamSync
  worktrees: WorktreeService
  toolchain: ToolchainService
  rojo: RojoService
  updater: UpdaterService
}

/** Deps plus the helpers shared by every domain registrar. */
export interface IpcContext extends IpcDeps {
  /** Resolve a game id or throw the standard unknown-game error. */
  requireGame(gameId: string): Game
  /** Push the current registry to every window and re-sync goal watchers. */
  broadcastRegistry(): void
}

/**
 * Registers every ipcMain handler. Handlers live in one file per domain
 * (./games, ./git, …) so parallel branches adding handlers to different
 * domains never edit the same file.
 */
export function registerIpc(deps: IpcDeps): void {
  const ctx: IpcContext = {
    ...deps,
    requireGame: (gameId: string): Game => {
      const game = deps.registry.get(gameId)
      if (!game) throw new Error('Unknown game id.')
      return game
    },
    broadcastRegistry: (): void => {
      const games = deps.registry.list()
      deps.goals.syncWatchers(games)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.EvRegistryChanged, games)
      }
    }
  }

  registerGamesIpc(ctx)
  registerGoalsIpc(ctx)
  registerAgentsIpc(ctx)
  registerTeamIpc(ctx)
  registerGitIpc(ctx)
  registerRojoIpc(ctx)
  registerSettingsIpc(ctx)
  registerVaultIpc(ctx)
  registerMiscIpc(ctx)
}
