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

export async function remoteUrl(repoPath: string): Promise<string | null> {
  // Only a repo ROOT has an identity of its own. Without this guard, git -C
  // walks up ancestor directories, so a plain folder nested inside another
  // repo (like the sample fixture inside Bridge) would inherit the parent's
  // remote and collide with it in the team's shared game index.
  if (!fs.existsSync(path.join(repoPath, '.git'))) return null
  try {
    const { stdout } = await git(repoPath, ['remote', 'get-url', 'origin'])
    const url = stdout.trim()
    return url || null
  } catch {
    return null
  }
}

/** GitHub-safe repo name from a display name: 'My Cool Game!' -> 'My-Cool-Game'. */
export function repoSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('Game name must contain letters or numbers.')
  return slug
}

export async function initRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  await execFileAsync('git', ['init', '-b', 'main', dir], { windowsHide: true })
}

export async function commitAll(repoPath: string, message: string): Promise<void> {
  await git(repoPath, ['add', '-A'])
  await git(repoPath, ['commit', '-m', message])
}

/** Create the private org repo, wire it as origin, and push (needs gh CLI, authed). */
export async function createGithubRepo(repoPath: string, org: string, slug: string): Promise<void> {
  try {
    await execFileAsync(
      'gh',
      ['repo', 'create', `${org}/${slug}`, '--private', '--source', repoPath, '--remote', 'origin', '--push'],
      { windowsHide: true }
    )
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string; code?: string }
    const detail =
      anyErr.code === 'ENOENT'
        ? 'the GitHub CLI (gh) is not installed'
        : (anyErr.stderr || anyErr.message || 'gh failed').trim().slice(0, 300)
    throw new Error(detail)
  }
}

/** Clone `url` into `<parentDir>/<folderName>`; returns the new repo path. */
export async function cloneRepo(url: string, parentDir: string, folderName: string): Promise<string> {
  const dest = path.join(parentDir, folderName)
  if (fs.existsSync(dest)) {
    throw new Error(`Folder already exists: ${dest} — use Locate to link it instead.`)
  }
  try {
    await execFileAsync('git', ['clone', url, dest], { windowsHide: true })
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string }
    throw new Error((anyErr.stderr || anyErr.message || 'git clone failed').trim().slice(0, 400))
  }
  return dest
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

  const remote = await remoteUrl(game.repoPath)
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
  const remote = await remoteUrl(game.repoPath)
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
