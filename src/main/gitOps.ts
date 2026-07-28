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
 * Commit wally.lock once the first toolchain install produces it — the
 * bootstrap commit predates `wally install`, so the lockfile arrives after.
 * No-op when the file is absent, already committed, or gitignored (legacy
 * games — porcelain lists nothing for ignored paths, so `add` is never
 * reached). Pushes best-effort when an origin exists. True = a commit landed.
 */
export async function commitLockfile(repoPath: string): Promise<boolean> {
  if (!fs.existsSync(path.join(repoPath, 'wally.lock'))) return false
  const { stdout } = await git(repoPath, ['status', '--porcelain', '--', 'wally.lock'])
  if (stdout.trim() === '') return false
  await git(repoPath, ['add', 'wally.lock'])
  await git(repoPath, ['commit', '-m', 'chore: lock wally dependencies'])
  if (await remoteUrl(repoPath)) {
    try {
      await git(repoPath, ['push'])
    } catch {
      // Best-effort — the lockfile rides the next push otherwise.
    }
  }
  return true
}

/**
 * Delete the GitHub repository behind this game. Irreversible.
 *
 * `gh` needs the `delete_repo` scope, which is NOT in the default set — a
 * token minted for normal work will fail here, so the error says how to fix it
 * rather than surfacing gh's raw complaint.
 */
export async function deleteGithubRepo(repoPath: string): Promise<string> {
  const remote = await remoteUrl(repoPath)
  const key = normalizeRemoteKey(remote)
  if (!key) throw new Error('This game has no origin remote, so there is no GitHub repo to delete.')
  const slug = key.split('/').slice(1).join('/')
  try {
    await execFileAsync(ghExecutable(), ['repo', 'delete', slug, '--yes'], { windowsHide: true })
    return slug
  } catch (err) {
    const detail = ((err as { stderr?: string; message?: string }).stderr ?? '').trim()
    if (/delete_repo|scope/i.test(detail)) {
      throw new Error(
        `GitHub refused: your gh token lacks the delete_repo scope. Run "gh auth refresh -h github.com -s delete_repo", then try again. (${slug})`
      )
    }
    throw new Error(`Could not delete ${slug}: ${detail.slice(0, 200) || 'gh failed'}`)
  }
}

/** Toolchain output that must never reach a commit. */
const GENERATED_PATHS = ['Packages/', 'DevPackages/', 'sourcemap.json']

/**
 * Guarantee generated output is invisible to git, even in a repo whose
 * committed .gitignore predates it.
 *
 * This exists because it already went wrong: a game scaffolded before
 * `DevPackages/` was gitignored had 529 Wally files swept into a branch by an
 * automated `git add -A`, merged, and then blocked every later pull. A
 * committed .gitignore can't fix that retroactively for existing clones, and
 * `add -A` is only ever as safe as the ignore rules in force at that moment.
 *
 * `.git/info/exclude` is local-only, needs no commit, and is shared by every
 * worktree of the repo — so one write protects all agent workspaces at once.
 */
export function ensureGeneratedIgnored(repoPath: string): void {
  try {
    const dir = path.join(repoPath, '.git', 'info')
    if (!fs.existsSync(path.join(repoPath, '.git'))) return
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'exclude')
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const lines = current.split(/\r?\n/).map((line) => line.trim())
    const missing = GENERATED_PATHS.filter((p) => !lines.includes(p))
    if (missing.length === 0) return
    const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(file, `${prefix}# Added by Bridge: generated toolchain output\n${missing.join('\n')}\n`)
  } catch {
    // Best-effort hardening — never block a run over it.
  }
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
    // --untracked-files=all is what makes this number mean something: the
    // default collapses an untracked DIRECTORY into a single line, so a new
    // folder holding 200 files counted as "1 uncommitted".
    const { stdout } = await git(game.repoPath, [
      'status',
      '--porcelain',
      '--untracked-files=all'
    ])
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
  // Without an upstream, `git pull` fails with a multi-paragraph hint that
  // reads like a crash. Say the one useful sentence instead.
  try {
    await git(game.repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  } catch {
    const branch = (await git(game.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
    throw new Error(
      `${branch || 'This branch'} isn't tracking anything on origin, so there is nothing to pull. Push it once with \`git push -u origin ${branch || '<branch>'}\` and Pull will work from then on.`
    )
  }
  try {
    const { stdout, stderr } = await git(game.repoPath, ['pull', '--ff-only'])
    return (stdout + stderr).trim() || 'Already up to date.'
  } catch (err) {
    const anyErr = err as { stderr?: string; stdout?: string; message?: string }
    const raw = (anyErr.stderr || anyErr.stdout || anyErr.message || 'git pull failed').trim()

    // Incoming commits add files that already exist here untracked. For these
    // repos that is almost always generated output (Wally's Packages/ and
    // DevPackages/, sourcemaps) sitting in a repo whose .gitignore predates
    // it. git's own message is a wall of paths with no advice.
    if (/untracked working tree files would be overwritten/i.test(raw)) {
      const paths = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[\w.@-]+[\\/]/.test(line))
      const roots = [...new Set(paths.map((p) => p.split(/[\\/]/)[0]))]
      const generated = roots.filter((r) => /^(Packages|DevPackages|sourcemap)/i.test(r))
      const hint = generated.length
        ? `${generated.join(', ')} is generated output — delete it and re-run the toolchain (wally install) to restore it, then pull again.`
        : 'Move or delete those files, then pull again.'
      return Promise.reject(
        new Error(
          `Pull blocked: the incoming commits add ${paths.length || 'some'} file(s) that already exist here as untracked${roots.length ? ` (under ${roots.join(', ')})` : ''}. ${hint}`
        )
      )
    }
    throw new Error(raw.slice(0, 400))
  }
}

/**
 * Take an agent's worktree from "has changes" to "PR is open", in one press:
 * commit anything pending, push the branch, then create the PR with `gh`.
 *
 * Returns the PR URL. If `gh` is unavailable or unauthenticated it falls back
 * to GitHub's compare page, which is the old behaviour — degraded, not broken.
 */
export interface PrMessage {
  title: string
  body: string
}

export async function pushBranchForPr(
  game: Game,
  branch: string,
  worktreePath?: string,
  message?: PrMessage
): Promise<string> {
  const remote = await remoteUrl(game.repoPath)
  const webUrl = toWebUrl(remote)
  if (!webUrl) throw new Error('This repo has no recognizable origin remote.')

  if (worktreePath) {
    // Before any `add -A`: never let toolchain output into the branch.
    ensureGeneratedIgnored(game.repoPath)
    try {
      const { stdout } = await git(worktreePath, ['status', '--porcelain'])
      if (stdout.trim() !== '') {
        await commitAll(worktreePath, `chore: ${branch} work in progress`)
      }
    } catch (err) {
      const anyErr = err as { stderr?: string; message?: string }
      throw new Error(
        `Could not commit the pending changes in this worktree: ${(anyErr.stderr || anyErr.message || 'git failed').trim().slice(0, 300)}`
      )
    }
  }

  let ahead = '0'
  try {
    const { stdout } = await git(game.repoPath, [
      'rev-list',
      '--count',
      `${game.defaultBranch}..${branch}`
    ])
    ahead = stdout.trim()
  } catch {
    // Unknown branch or missing base — let the push surface the real error.
    ahead = '1'
  }
  if (ahead === '0') {
    throw new Error(
      `${branch} is identical to ${game.defaultBranch} and has no pending changes, so there is nothing to open a pull request for.`
    )
  }

  try {
    await git(game.repoPath, ['push', '-u', 'origin', `${branch}:${branch}`])
  } catch (err) {
    const anyErr = err as { stderr?: string; message?: string }
    throw new Error((anyErr.stderr || anyErr.message || 'git push failed').trim().slice(0, 400))
  }

  const compareUrl = `${webUrl}/compare/${encodeURIComponent(game.defaultBranch)}...${encodeURIComponent(branch)}?expand=1`
  return (await openPrWithGh(game, branch, message)) ?? compareUrl
}

/**
 * Create the pull request itself with `gh`, returning its URL — or null to
 * fall back to the compare page.
 *
 * The compare page is only a pre-filled form: it still has to be submitted by
 * hand, and a second click just opens the same form again. `gh` creates the
 * real PR, titles it from the commits (`--fill`), and can hand back the URL of
 * an existing PR instead of erroring on the second press.
 *
 * Run from the repo directory so gh resolves owner/repo from origin itself.
 */
async function openPrWithGh(
  game: Game,
  branch: string,
  message?: PrMessage
): Promise<string | null> {
  const gh = ghExecutable()
  const opts = { cwd: game.repoPath, windowsHide: true }
  // A written title/body beats --fill, which would otherwise title the PR
  // after a generated commit message like "chore: <branch> work in progress".
  const describe = message
    ? ['--title', message.title, '--body', message.body]
    : ['--fill']
  try {
    const { stdout } = await execFileAsync(
      gh,
      ['pr', 'create', '--head', branch, '--base', game.defaultBranch, ...describe],
      opts
    )
    const url = /https:\/\/\S+/.exec(stdout)?.[0]
    return url ?? null
  } catch (err) {
    const detail = ((err as { stderr?: string; message?: string }).stderr ?? '').trim()
    // Already open: hand back the existing PR rather than reporting a failure.
    if (/already exists/i.test(detail)) {
      try {
        const { stdout } = await execFileAsync(
          gh,
          ['pr', 'view', branch, '--json', 'url', '--jq', '.url'],
          opts
        )
        const url = stdout.trim()
        if (url.startsWith('https://')) return url
      } catch {
        // Fall through to the compare page.
      }
    }
    // gh missing, unauthenticated, or anything else — the compare page still
    // works, so never fail the whole action over it.
    return null
  }
}
