import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { IPC } from '@shared/ipc-channels'
import type { AddGameInput, Game, GameDeleteTargets } from '@shared/types'
import { STUDIO_GITHUB_ORG } from '@shared/teamDefaults'
import {
  commitAll,
  commitLockfile,
  createGithubRepo,
  deleteGithubRepo,
  ensureOnGithub,
  initRepo,
  repoSlug
} from '../gitOps'
import { createGame } from '../gameCreate'
import { scaffoldRobloxGame } from '../robloxScaffold'
import type { IpcContext } from './index'

export function registerGamesIpc(ctx: IpcContext): void {
  const { registry, goals, agents, settings, team, toolchain, rojo } = ctx

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
    ctx.broadcastRegistry()
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
      broadcastRegistry: ctx.broadcastRegistry,
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
    ctx.broadcastRegistry()
    return result
  })

  ipcMain.handle(IPC.GamesRemove, (_event, id: string) => {
    agents.removeForGame(id)
    rojo.removeForGame(id)
    registry.remove(id)
    ctx.broadcastRegistry()
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
      const game = ctx.requireGame(gameId)
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
      ctx.broadcastRegistry()

      const parts = [`Removed “${game.name}” from Bridge.`]
      if (done.length) parts.push(`Also deleted: ${done.join(', ')}.`)
      if (failed.length) parts.push(`Not deleted — ${failed.join('; ')}`)
      return parts.join(' ')
    }
  )
}
