import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Game } from '@shared/types'
import {
  autoPullDefaultBranch,
  commitAll,
  initRepo,
  isNonFastForward,
  normalizeRemoteKey,
  parseAheadBehind,
  repoSlug,
  toWebUrl
} from './gitOps'

describe('isNonFastForward', () => {
  it('matches rejected-push stderr', () => {
    expect(
      isNonFastForward(
        'To github.com:org/repo.git\n ! [rejected]  agent-tofu-1 -> agent-tofu-1 (non-fast-forward)\nerror: failed to push some refs'
      )
    ).toBe(true)
    expect(isNonFastForward('hint: Updates were rejected. fetch first')).toBe(true)
    expect(isNonFastForward('stale info')).toBe(true)
  })

  it('ignores auth and network failures', () => {
    expect(isNonFastForward('fatal: Authentication failed for https://github.com/x/y')).toBe(false)
    expect(isNonFastForward('fatal: unable to access: Could not resolve host')).toBe(false)
    expect(isNonFastForward('')).toBe(false)
  })
})

describe('normalizeRemoteKey', () => {
  it('maps ssh and https forms of the same repo to one key', () => {
    const expected = 'github.com/tolui-studios/bridge'
    expect(normalizeRemoteKey('git@github.com:Tolui-studios/Bridge.git')).toBe(expected)
    expect(normalizeRemoteKey('https://github.com/Tolui-studios/Bridge.git')).toBe(expected)
    expect(normalizeRemoteKey('https://github.com/Tolui-studios/Bridge')).toBe(expected)
    expect(normalizeRemoteKey('ssh://git@github.com/Tolui-studios/Bridge.git')).toBe(expected)
  })

  it('returns null for missing or unusable urls', () => {
    expect(normalizeRemoteKey(null)).toBeNull()
    expect(normalizeRemoteKey('')).toBeNull()
  })
})

describe('remoteInOrg', () => {
  it('detects org vs personal vs none', async () => {
    const { remoteInOrg } = await import('./gitOps')
    expect(remoteInOrg('https://github.com/Tolui-studios/Bridge.git', 'Tolui-studios')).toBe(true)
    expect(remoteInOrg('https://github.com/tofulot/keyboard.git', 'Tolui-studios')).toBe(false)
    expect(remoteInOrg(null, 'Tolui-studios')).toBeNull()
  })
})

describe('toWebUrl', () => {
  it('builds an https url preserving repo casing', () => {
    expect(toWebUrl('git@github.com:Tolui-studios/Bridge.git')).toBe(
      'https://github.com/Tolui-studios/Bridge'
    )
    expect(toWebUrl('https://github.com/Tolui-studios/Bridge.git')).toBe(
      'https://github.com/Tolui-studios/Bridge'
    )
  })

  it('returns null when there is no remote', () => {
    expect(toWebUrl(null)).toBeNull()
  })
})

describe('parseAheadBehind', () => {
  it('parses left-right counts', () => {
    expect(parseAheadBehind('2\t5\n')).toEqual({ ahead: 2, behind: 5 })
    expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 })
    expect(parseAheadBehind('garbage')).toEqual({ ahead: 0, behind: 0 })
  })
})

describe('repoSlug', () => {
  it('produces GitHub-safe names', () => {
    expect(repoSlug('My Cool Game!')).toBe('My-Cool-Game')
    expect(repoSlug('  kingdom of ash  ')).toBe('kingdom-of-ash')
    expect(repoSlug('v2.0_beta')).toBe('v2.0_beta')
    expect(() => repoSlug('!!!')).toThrow()
  })
})

describe('initRepo + commitAll', () => {
  it('bootstraps a repo on main with an initial commit', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-init-')), 'new-game')
    await initRepo(dir)
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false'], { stdio: 'pipe' })
    fs.writeFileSync(path.join(dir, 'GOALS.md'), '# New Game — Current Goal\n')
    await commitAll(dir, 'bootstrap')
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: 'pipe'
    })
      .toString()
      .trim()
    expect(branch).toBe('main')
    try {
      fs.rmSync(path.dirname(dir), { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best-effort tmp cleanup
    }
  })
})

describe('autoPullDefaultBranch', () => {
  function run(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim()
  }

  function configureIdentity(dir: string): void {
    run(dir, 'config', 'user.email', 't@t.t')
    run(dir, 'config', 'user.name', 'T')
    run(dir, 'config', 'commit.gpgsign', 'false')
  }

  function commitFile(dir: string, name: string, content: string): string {
    fs.writeFileSync(path.join(dir, name), content)
    run(dir, 'add', name)
    run(dir, 'commit', '-m', `add ${name}`)
    return run(dir, 'rev-parse', 'HEAD')
  }

  /** An upstream repo plus a clone of it wired with origin, both on main. */
  async function makePair(root: string): Promise<{ upstream: string; local: string; game: Game }> {
    const upstream = path.join(root, 'upstream')
    await initRepo(upstream)
    configureIdentity(upstream)
    commitFile(upstream, 'a.txt', 'v1')
    const local = path.join(root, 'local')
    execFileSync('git', ['clone', upstream, local], { stdio: 'pipe' })
    configureIdentity(local)
    const game: Game = {
      id: 'g',
      name: 'G',
      repoPath: local,
      defaultBranch: 'main',
      worktreeRoot: path.join(root, 'worktrees')
    }
    return { upstream, local, game }
  }

  function cleanup(root: string): void {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best-effort tmp cleanup
    }
  }

  it('skips non-repos and repos without an origin remote', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-autopull-'))
    const bare = path.join(root, 'plain')
    fs.mkdirSync(bare)
    const asGame = (repoPath: string): Game => ({
      id: 'g',
      name: 'G',
      repoPath,
      defaultBranch: 'main',
      worktreeRoot: path.join(root, 'wt')
    })
    expect(await autoPullDefaultBranch(asGame(bare))).toMatch(/not a git repo/)
    const norigin = path.join(root, 'norigin')
    await initRepo(norigin)
    expect(await autoPullDefaultBranch(asGame(norigin))).toMatch(/no origin remote/)
    cleanup(root)
  })

  it('fast-forwards a checked-out main and reports up to date on the second run', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-autopull-'))
    const { upstream, local, game } = await makePair(root)
    const tip = commitFile(upstream, 'b.txt', 'v2')
    expect(await autoPullDefaultBranch(game)).toMatch(/fast-forwarded main 1 commit/)
    expect(run(local, 'rev-parse', 'main')).toBe(tip)
    // The working tree moved too — main is the checked-out branch here.
    expect(fs.existsSync(path.join(local, 'b.txt'))).toBe(true)
    expect(await autoPullDefaultBranch(game)).toMatch(/already up to date/)
    cleanup(root)
  })

  it('moves the main ref without touching a checkout parked on another branch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-autopull-'))
    const { upstream, local, game } = await makePair(root)
    run(local, 'checkout', '-b', 'feature')
    const featureTip = run(local, 'rev-parse', 'HEAD')
    const tip = commitFile(upstream, 'b.txt', 'v2')
    expect(await autoPullDefaultBranch(game)).toMatch(/fast-forwarded main 1 commit/)
    expect(run(local, 'rev-parse', 'main')).toBe(tip)
    expect(run(local, 'rev-parse', 'HEAD')).toBe(featureTip)
    expect(run(local, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature')
    // The incoming file must NOT appear: only the ref moved.
    expect(fs.existsSync(path.join(local, 'b.txt'))).toBe(false)
    cleanup(root)
  })

  it('reports unpushed local commits instead of failing, and throws on divergence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-autopull-'))
    const { upstream, local, game } = await makePair(root)
    const localTip = commitFile(local, 'mine.txt', 'local work')
    expect(await autoPullDefaultBranch(game)).toMatch(/1 commit\(s\) ahead/)
    expect(run(local, 'rev-parse', 'main')).toBe(localTip)
    commitFile(upstream, 'theirs.txt', 'remote work')
    await expect(autoPullDefaultBranch(game)).rejects.toThrow(/diverged/)
    // A diverged branch is left exactly where it was.
    expect(run(local, 'rev-parse', 'main')).toBe(localTip)
    cleanup(root)
  })
})
