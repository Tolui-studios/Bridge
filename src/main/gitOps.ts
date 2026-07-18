import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, GitRepoStatus } from '@shared/types'

const execFileAsync = promisify(execFile)

function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', repoPath, ...args], { windowsHide: true })
}

/**
 * Normalize a git remote URL into a shared team identity key, so the same
 * repo cloned to different local paths on different machines maps to one
 * game. `git@github.com:Org/Repo.git` and `https://github.com/org/repo`
 * both become `github.com/org/repo`.
 */
export function normalizeRemoteKey(url: string | null): string | null {
  if (!url) return null
  let cleaned = url.trim()
  const ssh = /^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/i.exec(
    cleaned.replace(/^https?:\/\//i, '')
  )
  if (!ssh) return null
  const host = ssh[1].toLowerCase()
  let repo = ssh[2].replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  repo = repo.replace(/^\/+/, '')
  if (!repo) return null
  return `${host}/${repo}`
}

/** Best-effort https web URL for a remote (GitHub-style hosts). */
export function toWebUrl(url: string | null): string | null {
  const key = normalizeRemoteKey(url)
  if (!key) return null
  // Preserve original casing of the repo path when we can.
  const original = url ?? ''
  const match = /[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(original)
  const repoPart = match ? match[1] : key.slice(key.indexOf('/') + 1)
  const host = key.slice(0, key.indexOf('/'))
  return `https://${host}/${repoPart}`
}

export function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const match = /^(\d+)\s+(\d+)/.exec(output.trim())
  if (!match) return { ahead: 0, behind: 0 }
  return { ahead: Number(match[1]), behind: Number(match[2]) }
}

export async function remoteUrl(game: Game): Promise<string | null> {
  try {
    const { stdout } = await git(game.repoPath, ['remote', 'get-url', 'origin'])
    const url = stdout.trim()
    return url || null
  } catch {
    return null
  }
}

export async function repoStatus(game: Game): Promise<GitRepoStatus> {
  const none: GitRepoStatus = {
    isRepo: false,
    branch: null,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    dirtyFiles: 0,
    lastPulledAt: null,
    remoteUrl: null,
    webUrl: null
  }
  if (!fs.existsSync(path.join(game.repoPath, '.git'))) return none

  let branch: string | null = null
  try {
    branch = (await git(game.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || null
  } catch {
    // Unborn branch (no commits) — leave null.
  }

  let ahead = 0
  let behind = 0
  let hasUpstream = false
  try {
    const { stdout } = await git(game.repoPath, [
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...@{upstream}'
    ])
    const parsed = parseAheadBehind(stdout)
    ahead = parsed.ahead
    behind = parsed.behind
    hasUpstream = true
  } catch {
    // No upstream configured.
  }

  let dirtyFiles = 0
  try {
    const { stdout } = await git(game.repoPath, ['status', '--porcelain'])
    dirtyFiles = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
  } catch {
    // Ignore.
  }

  let lastPulledAt: number | null = null
  try {
    lastPulledAt = fs.statSync(path.join(game.repoPath, '.git', 'FETCH_HEAD')).mtimeMs
  } catch {
    // Never fetched.
  }

  const remote = await remoteUrl(game)
  return {
    isRepo: true,
    branch,
    ahead,
    behind,
    hasUpstream,
    dirtyFiles,
    lastPulledAt,
    remoteUrl: remote,
    webUrl: toWebUrl(remote)
  }
}

/** Fast-forward pull; throws with git's message when it cannot fast-forward. */
export async function pull(game: Game): Promise<string> {
  try {
    const { stdout, stderr } = await git(game.repoPath, ['pull', '--ff-only'])
    return (stdout + stderr).trim() || 'Already up to date.'
  } catch (err) {
    const anyErr = err as { stderr?: string; stdout?: string; message?: string }
    throw new Error(
      (anyErr.stderr || anyErr.stdout || anyErr.message || 'git pull failed').trim().slice(0, 400)
    )
  }
}

/** Push a branch and return the GitHub compare URL for opening a PR. */
export async function pushBranchForPr(game: Game, branch: string): Promise<string> {
  const remote = await remoteUrl(game)
  const webUrl = toWebUrl(remote)
  if (!webUrl) throw new Error('This repo has no recognizable origin remote.')
  try {
    await git(game.repoPath, ['push', '-u', 'origin', `${branch}:${branch}`])
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string }
    throw new Error((anyErr.stderr || anyErr.message || 'git push failed').trim().slice(0, 400))
  }
  return `${webUrl}/compare/${encodeURIComponent(game.defaultBranch)}...${encodeURIComponent(branch)}?expand=1`
}
