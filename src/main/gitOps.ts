import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { STUDIO_GITHUB_ORG } from '@shared/teamDefaults'
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

/** Is this remote inside the studio's GitHub org? null = no/unparseable remote. */
export function remoteInOrg(url: string | null, org: string): boolean | null {
  const key = normalizeRemoteKey(url)
  if (!key) return null
  const owner = key.split('/')[1]
  return owner === org.toLowerCase()
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

/**
 * Locate the GitHub CLI from its standard install locations before falling
 * back to PATH — a long-running Electron process inherits a PATH captured at
 * launch, so a gh installed later is invisible to plain `execFile('gh')`.
 */
export function ghExecutable(): string {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'GitHub CLI', 'gh.exe')
        ]
      : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return 'gh'
}

/** Create the private org repo, wire it as origin, and push (needs gh CLI, authed). */
export async function createGithubRepo(repoPath: string, org: string, slug: string): Promise<void> {
  try {
    await execFileAsync(
      ghExecutable(),
      ['repo', 'create', `${org}/${slug}`, '--private', '--source', repoPath, '--remote', 'origin', '--push'],
      { windowsHide: true }
    )
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string; code?: string }
    const detail =
      anyErr.code === 'ENOENT'
        ? 'the GitHub CLI (gh) is not installed (checked Program Files and PATH)'
        : (anyErr.stderr || anyErr.message || 'gh failed').trim().slice(0, 300)
    throw new Error(detail)
  }
}

/**
 * Make an existing local project shareable: init git if needed, guarantee a
 * first commit, and create + push the private org repo — unless it already
 * has an origin remote, in which case nothing is touched. Never throws;
 * everything it did (or couldn't do) comes back as user-facing notes.
 */
export async function ensureOnGithub(
  dir: string,
  displayName: string,
  org: string
): Promise<string[]> {
  const notes: string[] = []
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return notes
    if (!fs.existsSync(path.join(dir, '.git'))) {
      await execFileAsync('git', ['init', '-b', 'main', dir], { windowsHide: true })
      notes.push('Initialized a git repo in this folder.')
    }
    const existingRemote = await remoteUrl(dir)
    if (existingRemote) {
      // Existing remotes are never rewired automatically — but say so when
      // the repo lives outside the org, since teammates cannot see it there.
      if (remoteInOrg(existingRemote, org) === false) {
        notes.push(
          `This project's GitHub remote is ${existingRemote} — outside ${org}, so teammates won't see it in Team games. Use "Move to studio org" in the repo bar to re-home it.`
        )
      }
      return notes
    }
    try {
      await git(dir, ['add', '-A'])
      await git(dir, ['commit', '--allow-empty', '-m', 'chore: initial commit via Bridge'])
    } catch (err) {
      const anyErr = err as { stderr?: string; message?: string }
      const detail = (anyErr.stderr || anyErr.message || '').trim().slice(0, 200)
      // "nothing to commit" is fine (repo already had commits); anything else matters.
      if (!/nothing to commit/i.test(detail)) {
        notes.push(`Could not commit before uploading: ${detail}`)
        return notes
      }
    }
    const slug = repoSlug(displayName.trim() || path.basename(dir))
    try {
      await createGithubRepo(dir, org, slug)
      notes.push(`Uploaded to GitHub: ${org}/${slug} (private). Teammates can now clone it from Team games.`)
    } catch (err) {
      notes.push(
        `Not uploaded to GitHub: ${err instanceof Error ? err.message : String(err)}. Create ${org}/${slug} manually and add it as origin, or fix gh and re-add.`
      )
    }
  } catch (err) {
    notes.push(`GitHub upload skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  return notes
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
    inStudioOrg: null,
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
    webUrl: toWebUrl(remote),
    inStudioOrg: remoteInOrg(remote, STUDIO_GITHUB_ORG)
  }
}

/**
 * Re-home a repo whose origin lives outside the studio org: create the
 * private org repo, repoint origin, push the current branch. The old remote
 * repo keeps existing on GitHub (delete it there manually if unwanted).
 */
export async function moveRepoToOrg(game: Game, org: string, slug: string): Promise<string> {
  const gh = ghExecutable()
  try {
    await execFileAsync(gh, ['repo', 'create', `${org}/${slug}`, '--private'], { windowsHide: true })
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string; code?: string }
    const detail =
      anyErr.code === 'ENOENT'
        ? 'the GitHub CLI (gh) is not installed (checked Program Files and PATH)'
        : (anyErr.stderr || anyErr.message || 'gh failed').trim().slice(0, 300)
    throw new Error(`Could not create ${org}/${slug}: ${detail}`)
  }
  const newUrl = `https://github.com/${org}/${slug}.git`
  await git(game.repoPath, ['remote', 'set-url', 'origin', newUrl])
  // An unborn HEAD (repo with a remote but zero commits) has nothing to
  // push — commit whatever is in the tree first.
  try {
    await git(game.repoPath, ['rev-parse', 'HEAD'])
  } catch {
    await git(game.repoPath, ['add', '-A'])
    await git(game.repoPath, ['commit', '--allow-empty', '-m', 'chore: initial commit via Bridge'])
  }
  try {
    await git(game.repoPath, ['push', '-u', 'origin', 'HEAD'])
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string }
    throw new Error(
      `Repo created and origin repointed, but the push failed: ${(anyErr.stderr || anyErr.message || '').trim().slice(0, 300)}`
    )
  }
  return `https://github.com/${org}/${slug}`
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
  // GitHub has nothing to show for a branch identical to its base, so the
  // compare page comes up empty and the PR can't be opened. Say why here
  // rather than pushing a pointless branch and handing over a dead link.
  try {
    const { stdout } = await git(game.repoPath, [
      'rev-list',
      '--count',
      `${game.defaultBranch}..${branch}`
    ])
    if (stdout.trim() === '0') {
      throw new Error(
        `${branch} has no commits that aren't already on ${game.defaultBranch}, so there is nothing to open a pull request for. The agent likely never committed its work — open the worktree and commit first.`
      )
    }
  } catch (err) {
    // Only swallow the rev-list failing (e.g. unknown branch); surface ours.
    if (err instanceof Error && err.message.includes('nothing to open a pull request')) throw err
  }
  try {
    await git(game.repoPath, ['push', '-u', 'origin', `${branch}:${branch}`])
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string }
    throw new Error((anyErr.stderr || anyErr.message || 'git push failed').trim().slice(0, 400))
  }
  return `${webUrl}/compare/${encodeURIComponent(game.defaultBranch)}...${encodeURIComponent(branch)}?expand=1`
}
