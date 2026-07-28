import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ToolchainService,
  clearRojoAvailability,
  computeSetupFingerprint,
  pickRokitAsset,
  readSetupMarker,
  rojoAvailable,
  seedPackagesFromRepo,
  shouldRetryWithoutTrustCheck,
  writeSetupMarker,
  type ToolExec
} from './toolchain'

const ASSETS = [
  'rokit-1.2.0-linux-aarch64.zip',
  'rokit-1.2.0-linux-x86_64.zip',
  'rokit-1.2.0-macos-aarch64.zip',
  'rokit-1.2.0-macos-x86_64.zip',
  'rokit-1.2.0-windows-aarch64.zip',
  'rokit-1.2.0-windows-x86_64.zip'
]

describe('pickRokitAsset', () => {
  it('matches windows x64', () => {
    expect(pickRokitAsset(ASSETS, 'win32', 'x64')).toBe('rokit-1.2.0-windows-x86_64.zip')
  })

  it('matches apple silicon and intel macs', () => {
    expect(pickRokitAsset(ASSETS, 'darwin', 'arm64')).toBe('rokit-1.2.0-macos-aarch64.zip')
    expect(pickRokitAsset(ASSETS, 'darwin', 'x64')).toBe('rokit-1.2.0-macos-x86_64.zip')
  })

  it('returns null when nothing fits', () => {
    expect(pickRokitAsset(['rokit-1.2.0-linux-x86_64.zip'], 'win32', 'x64')).toBeNull()
    expect(pickRokitAsset([], 'darwin', 'arm64')).toBeNull()
  })
})

describe('shouldRetryWithoutTrustCheck', () => {
  it('retries only when the flag itself is rejected', () => {
    expect(shouldRetryWithoutTrustCheck("error: unexpected argument '--no-trust-check' found")).toBe(true)
    expect(shouldRetryWithoutTrustCheck('Unknown option: --no-trust-check')).toBe(true)
    expect(shouldRetryWithoutTrustCheck('failed to download tool: connection timed out')).toBe(false)
    expect(shouldRetryWithoutTrustCheck('')).toBe(false)
  })
})

/**
 * Records every exec call as "<basename-without-exe> <args...>" so assertions
 * are stable whether shims resolve to absolute paths (dev machine) or bare
 * names (CI). The rokit-on-PATH version probe is filtered out for the same
 * reason — it only happens on machines without ~/.rokit.
 */
function recorder(behavior?: {
  reject?: (cmd: string) => boolean
  onRun?: (cmd: string) => void
}): { exec: ToolExec; commands: () => string[] } {
  const all: string[] = []
  const exec: ToolExec = (file, args) => {
    const cmd = `${path.basename(String(file)).replace(/\.exe$/i, '')} ${args.join(' ')}`.trim()
    all.push(cmd)
    if (behavior?.reject?.(cmd)) {
      return Promise.reject(new Error(`simulated failure: ${cmd}`))
    }
    behavior?.onRun?.(cmd)
    return Promise.resolve({ stdout: '', stderr: '' })
  }
  return { exec, commands: () => all.filter((c) => !c.includes('--version')) }
}

const tmpDirs: string[] = []
function makeGameDir(withProjectJson = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-toolchain-'))
  tmpDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'wally.toml'), '[package]\nname = "t/t"\nversion = "0.1.0"\n')
  if (withProjectJson) fs.writeFileSync(path.join(dir, 'default.project.json'), '{}')
  return dir
}

/** Simulates wally actually producing a Packages/ directory. */
function wallyCreatesPackages(dir: string): (cmd: string) => void {
  return (cmd) => {
    if (cmd.startsWith('wally install')) {
      fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'Packages', 'Signal.lua'), 'return {}')
    }
  }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('computeSetupFingerprint', () => {
  it('changes when a manifest changes and is empty-string for missing files', () => {
    const dir = makeGameDir(false)
    const before = computeSetupFingerprint(dir)
    expect(before.wallyTomlHash).not.toBe('')
    expect(before.rokitTomlHash).toBe('')
    fs.appendFileSync(path.join(dir, 'wally.toml'), '\n[dependencies]\n')
    const after = computeSetupFingerprint(dir)
    expect(after.wallyTomlHash).not.toBe(before.wallyTomlHash)
  })
})

describe('ToolchainService.setupRepo caching', () => {
  it('runs the full sequence on a cache miss and leaves a marker', async () => {
    const dir = makeGameDir()
    const { exec, commands } = recorder({ onRun: wallyCreatesPackages(dir) })
    const notes = await new ToolchainService(exec).setupRepo(dir)

    expect(commands()).toEqual([
      'wally install',
      'rojo sourcemap default.project.json -o sourcemap.json',
      'wally-package-types --sourcemap sourcemap.json Packages'
    ])
    expect(notes[0]).toMatch(/^toolchain ready: wally \(1 packages?, [\d.]+s\)/)
    expect(readSetupMarker(dir)).not.toBeNull()
  })

  it('skips installs on a cache hit and only refreshes the sourcemap', async () => {
    const dir = makeGameDir()
    const first = recorder({ onRun: wallyCreatesPackages(dir) })
    await new ToolchainService(first.exec).setupRepo(dir)

    // A NEW service instance proves the cache survives app restarts (it lives
    // on disk in the marker, not in process state).
    const second = recorder()
    const notes = await new ToolchainService(second.exec).setupRepo(dir)
    expect(second.commands()).toEqual(['rojo sourcemap default.project.json -o sourcemap.json'])
    expect(notes[0]).toMatch(/^toolchain ready \(cached\)/)
  })

  it('re-runs the full sequence after the manifest changes', async () => {
    const dir = makeGameDir()
    const first = recorder({ onRun: wallyCreatesPackages(dir) })
    await new ToolchainService(first.exec).setupRepo(dir)

    fs.appendFileSync(path.join(dir, 'wally.toml'), '\n[dev-dependencies]\n')
    const second = recorder({ onRun: wallyCreatesPackages(dir) })
    await new ToolchainService(second.exec).setupRepo(dir)
    expect(second.commands()[0]).toBe('wally install')
  })

  it('leaves no marker when the install fails', async () => {
    const dir = makeGameDir()
    const { exec } = recorder({ reject: (cmd) => cmd.startsWith('wally install') })
    const notes = await new ToolchainService(exec).setupRepo(dir)
    expect(notes.join('\n')).toContain('wally install failed')
    expect(readSetupMarker(dir)).toBeNull()
  })

  it('leaves no marker when a later step fails, so the next run retries fully', async () => {
    const dir = makeGameDir()
    const { exec } = recorder({
      onRun: wallyCreatesPackages(dir),
      reject: (cmd) => cmd.startsWith('wally-package-types')
    })
    await new ToolchainService(exec).setupRepo(dir)
    expect(readSetupMarker(dir)).toBeNull()
  })

  it('coalesces concurrent calls on the same dir into one run', async () => {
    const dir = makeGameDir()
    const { exec, commands } = recorder({ onRun: wallyCreatesPackages(dir) })
    const service = new ToolchainService(exec)
    const a = service.setupRepo(dir)
    const b = service.setupRepo(dir)
    await Promise.all([a, b])
    expect(commands().filter((c) => c.startsWith('wally install'))).toHaveLength(1)
  })
})

describe('seedPackagesFromRepo', () => {
  function makePair(): { repo: string; worktree: string } {
    const repo = makeGameDir()
    const worktree = makeGameDir()
    // Same manifest contents in both, as a checkout of the same commit would have.
    fs.copyFileSync(path.join(repo, 'wally.toml'), path.join(worktree, 'wally.toml'))
    fs.mkdirSync(path.join(repo, 'Packages'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'Packages', 'Signal.lua'), 'return {}')
    writeSetupMarker(repo, computeSetupFingerprint(repo))
    return { repo, worktree }
  }

  it('copies Packages (marker included) when the repo copy matches the worktree manifest', () => {
    const { repo, worktree } = makePair()
    const note = seedPackagesFromRepo(repo, worktree)
    expect(note).toMatch(/^seeded Packages\//)
    expect(fs.existsSync(path.join(worktree, 'Packages', 'Signal.lua'))).toBe(true)
    expect(readSetupMarker(worktree)).not.toBeNull()
  })

  it('after seeding, setupRepo hits the cache and only refreshes the sourcemap', async () => {
    const { repo, worktree } = makePair()
    // Manifest fingerprints must match what the marker recorded — the pair
    // helper wrote the repo fingerprint, which includes rokitTomlHash ''.
    seedPackagesFromRepo(repo, worktree)
    const { exec, commands } = recorder()
    const notes = await new ToolchainService(exec).setupRepo(worktree)
    expect(commands()).toEqual(['rojo sourcemap default.project.json -o sourcemap.json'])
    expect(notes[0]).toMatch(/^toolchain ready \(cached\)/)
  })

  it('skips when the worktree manifest differs from what the repo Packages were built from', () => {
    const { repo, worktree } = makePair()
    fs.appendFileSync(path.join(worktree, 'wally.toml'), '\n[dependencies]\nExtra = "x/y@1"\n')
    expect(seedPackagesFromRepo(repo, worktree)).toBeNull()
    expect(fs.existsSync(path.join(worktree, 'Packages'))).toBe(false)
  })

  it('skips when the repo has no marker, no Packages, or the target already has Packages', () => {
    const { repo, worktree } = makePair()
    fs.rmSync(path.join(repo, 'Packages', '.bridge-setup.json'))
    expect(seedPackagesFromRepo(repo, worktree)).toBeNull()

    const pair2 = makePair()
    fs.mkdirSync(path.join(pair2.worktree, 'Packages'))
    expect(seedPackagesFromRepo(pair2.repo, pair2.worktree)).toBeNull()
  })

  it('skips when lockfiles disagree', () => {
    const { repo, worktree } = makePair()
    fs.writeFileSync(path.join(repo, 'wally.lock'), 'a')
    fs.writeFileSync(path.join(worktree, 'wally.lock'), 'b')
    expect(seedPackagesFromRepo(repo, worktree)).toBeNull()
  })

  it('is wired through prepareWorkspace ahead of the per-dir setup', async () => {
    const { repo, worktree } = makePair()
    const { exec, commands } = recorder()
    const notes = await new ToolchainService(exec).prepareWorkspace(worktree, repo)
    expect(notes[0]).toMatch(/^seeded Packages\//)
    expect(commands()).toEqual(['rojo sourcemap default.project.json -o sourcemap.json'])
  })
})

describe('rojoAvailable', () => {
  it('memoizes per dir until cleared', async () => {
    const dir = makeGameDir(false)
    let calls = 0
    const exec: ToolExec = () => {
      calls++
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    expect(await rojoAvailable(dir, exec)).toBe(true)
    expect(await rojoAvailable(dir, exec)).toBe(true)
    expect(calls).toBe(1)

    clearRojoAvailability(dir)
    const failing: ToolExec = () => Promise.reject(new Error('no rojo'))
    expect(await rojoAvailable(dir, failing)).toBe(false)
  })
})
