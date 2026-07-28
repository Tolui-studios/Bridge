import path from 'node:path'

/**
 * Pure serve-target logic for RojoService, kept electron-free so it is
 * vitest-coverable (precedent: rojoApi.ts). Bridge runs ONE rojo serve per
 * game at a time, retargetable between the repo checkout ("main") and any of
 * the game's agent worktrees — the swap model keeps port 34872 (the only port
 * the Studio plugin one-click-connects to) pointed at whatever the operator
 * is testing right now.
 */

export interface ServeTarget {
  path: string
  /** 'main' for the repo checkout, else the worktree folder name (agent-2). */
  label: string
  isMain: boolean
}

/** Case-insensitive on Windows, where casing differs between drive roots and user input. */
export function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  if (process.platform === 'win32') return na.toLowerCase() === nb.toLowerCase()
  return na === nb
}

export function resolveServeTarget(
  game: { repoPath: string },
  targetPath?: string
): ServeTarget {
  const resolved = path.resolve(targetPath ?? game.repoPath)
  const isMain = samePath(resolved, game.repoPath)
  return { path: resolved, label: isMain ? 'main' : path.basename(resolved), isMain }
}

export type ServeAction = 'start' | 'reuse' | 'swap'

/** What openBuild must do given what is currently served for this game. */
export function planServeAction(currentTargetPath: string | null, requested: string): ServeAction {
  if (currentTargetPath === null) return 'start'
  return samePath(currentTargetPath, requested) ? 'reuse' : 'swap'
}
