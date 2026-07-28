import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { STUDIO_GITHUB_ORG } from '@shared/teamDefaults'
import { moveRepoToOrg, pull, pushBranchForPr, repoSlug, repoStatus } from '../gitOps'
import { isUnder } from '../worktrees'
import { gameTooling } from '../tooling'
import { openInVsCode } from '../editor'
import type { IpcContext } from './index'

export function registerGitIpc(ctx: IpcContext): void {
  const { agents, team, worktrees, rojo } = ctx

  ipcMain.handle(IPC.GitStatus, (_event, gameId: string) => repoStatus(ctx.requireGame(gameId)))
  ipcMain.handle(IPC.GameTooling, (_event, gameId: string) =>
    gameTooling(ctx.requireGame(gameId).repoPath)
  )
  ipcMain.handle(IPC.GitPull, (_event, gameId: string) => pull(ctx.requireGame(gameId)))
  ipcMain.handle(IPC.GitWorktrees, (_event, gameId: string) =>
    worktrees.listWithUsage(ctx.requireGame(gameId))
  )
  ipcMain.handle(IPC.GitWorktreeChanges, (_event, gameId: string) =>
    worktrees.changesForGame(ctx.requireGame(gameId))
  )
  ipcMain.handle(
    IPC.GitWorktreeRemove,
    (_event, gameId: string, worktreePath: string, force: boolean) => {
      // A serve targeting this worktree holds its cwd open — stop it first or
      // removal hits the Windows file-lock error.
      rojo.stopIfServingPath(gameId, worktreePath)
      return worktrees.remove(ctx.requireGame(gameId), worktreePath, force)
    }
  )

  ipcMain.handle(
    IPC.GitWorktreeOpenEditor,
    async (_event, gameId: string, targetPath?: string) => {
      const game = ctx.requireGame(gameId)
      // No target = the repo itself; otherwise it must be one of its worktrees.
      const dir = targetPath ?? game.repoPath
      if (dir !== game.repoPath && !isUnder(dir, game.worktreeRoot)) {
        throw new Error('That path is neither this game’s repo nor one of its worktrees.')
      }
      await openInVsCode(dir)
    }
  )

  ipcMain.handle(
    IPC.GitCreatePr,
    async (_event, gameId: string, branch: string, worktreePath?: string) => {
      const game = ctx.requireGame(gameId)
      if (worktreePath && !isUnder(worktreePath, game.worktreeRoot)) {
        throw new Error('That path is not one of this game’s worktrees.')
      }
      // Describe the PR from the run that produced it — prMessage.ts builds
      // the title/body from the task, the branch's commits, and the test
      // steps, so even a branch whose session is gone gets a real description.
      const session = worktreePath ? agents.findByWorktree(gameId, worktreePath) : null
      const url = await pushBranchForPr(
        game,
        branch,
        worktreePath,
        session ? { task: session.task, testSteps: session.testSteps } : undefined
      )
      void shell.openExternal(url)
      return url
    }
  )

  ipcMain.handle(IPC.GitMoveToOrg, async (_event, gameId: string) => {
    const game = ctx.requireGame(gameId)
    const url = await moveRepoToOrg(game, STUDIO_GITHUB_ORG, repoSlug(game.name))
    // The shared identity changed — re-key, re-register, and re-sync goals.
    await team.afterLink(game)
    return url
  })
}
