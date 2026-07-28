import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
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
