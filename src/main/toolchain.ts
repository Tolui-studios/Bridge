import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const EXE = process.platform === 'win32' ? '.exe' : ''
const ROKIT_RELEASES = 'https://api.github.com/repos/rojo-rbx/rokit/releases/latest'

/** Child-process runner, injectable so tests can record commands instead of spawning. */
export type ToolExec = (
  file: string,
  args: readonly string[],
  options?: object
) => Promise<{ stdout: string; stderr: string }>

const defaultExec = execFileAsync as unknown as ToolExec

function rokitBinDir(): string {
  return path.join(os.homedir(), '.rokit', 'bin')
}

/** Env with ~/.rokit/bin prepended, so rokit-managed tools resolve even when Bridge's PATH is stale. */
export function rokitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${rokitBinDir()}${path.delimiter}${process.env.PATH ?? ''}`
  }
}

/** Absolute rokit shim path for a tool when installed, else the bare name for PATH lookup. */
export function rokitShim(tool: string): string {
  const abs = path.join(rokitBinDir(), `${tool}${EXE}`)
  return fs.existsSync(abs) ? abs : tool
}

/** Match a Rokit release asset to this platform/arch (naming: rokit-<v>-<platform>-<arch>.zip). */
export function pickRokitAsset(
  assetNames: string[],
  platform: NodeJS.Platform,
  arch: string
): string | null {
  const plat = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  const cpu = arch === 'arm64' ? 'aarch64' : 'x86_64'
  return assetNames.find((a) => a.includes(plat) && a.includes(cpu) && a.endsWith('.zip')) ?? null
}

function dirKey(dir: string): string {
  return path.resolve(dir).toLowerCase()
}

function hashFile(file: string): string {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return ''
  }
}

function describeError(err: unknown): string {
  const anyErr = err as { stderr?: string; message?: string }
  return (anyErr.stderr || anyErr.message || String(err)).trim()
}

function elapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

export interface SetupFingerprint {
  wallyTomlHash: string
  rokitTomlHash: string
}

export interface SetupMarker extends SetupFingerprint {
  version: 1
  at: number
}

const MARKER_VERSION = 1

function markerPath(dir: string): string {
  return path.join(dir, 'Packages', '.bridge-setup.json')
}

/** Hashes of the manifests a setup run is (or was) built from. Missing file → ''. */
export function computeSetupFingerprint(dir: string): SetupFingerprint {
  return {
    wallyTomlHash: hashFile(path.join(dir, 'wally.toml')),
    rokitTomlHash: hashFile(path.join(dir, 'rokit.toml'))
  }
}

/**
 * The marker a fully successful setup leaves at `Packages/.bridge-setup.json`.
 * It lives INSIDE Packages/ on purpose: Packages/ is gitignored (so the marker
 * survives `git reset --hard` on worktree reuse) and deleting Packages/ takes
 * the marker with it, so the cache can never claim packages that are gone.
 */
export function readSetupMarker(dir: string): SetupMarker | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath(dir), 'utf8')) as Partial<SetupMarker>
    if (parsed.version !== MARKER_VERSION) return null
    if (typeof parsed.wallyTomlHash !== 'string' || typeof parsed.rokitTomlHash !== 'string') {
      return null
    }
    return {
      version: MARKER_VERSION,
      wallyTomlHash: parsed.wallyTomlHash,
      rokitTomlHash: parsed.rokitTomlHash,
      at: typeof parsed.at === 'number' ? parsed.at : 0
    }
  } catch {
    return null
  }
}

export function writeSetupMarker(dir: string, fingerprint: SetupFingerprint): void {
  const marker: SetupMarker = { version: MARKER_VERSION, ...fingerprint, at: Date.now() }
  fs.writeFileSync(markerPath(dir), JSON.stringify(marker), 'utf8')
}

function deleteSetupMarker(dir: string): void {
  try {
    fs.rmSync(markerPath(dir), { force: true })
  } catch {
    // Best-effort — a stale marker is only reachable if the delete AND the
    // subsequent install both fail, and the hash check still guards it.
  }
}

/**
 * `rokit install --no-trust-check` falls back to a plain `install` ONLY when
 * the flag itself is the problem (old Rokit). Any other failure — network,
 * genuine install error — must surface instead of silently doubling the work.
 */
export function shouldRetryWithoutTrustCheck(message: string): boolean {
  return /unexpected argument|unknown option|unrecognized|no-trust-check/i.test(message)
}

/**
 * Copy a game repo's installed Packages/ (and DevPackages/) into a fresh
 * worktree so the worktree skips its own `wally install`. Only fires when the
 * copy is provably current: the repo carries a setup marker whose wally.toml
 * hash matches the WORKTREE's wally.toml (the repo may sit on a different
 * commit than the worktree), and lockfiles agree when both sides have one.
 * Returns a note on success, null when seeding doesn't apply.
 */
export function seedPackagesFromRepo(repoDir: string, targetDir: string): string | null {
  const targetPackages = path.join(targetDir, 'Packages')
  try {
    const targetWally = path.join(targetDir, 'wally.toml')
    if (!fs.existsSync(targetWally) || fs.existsSync(targetPackages)) return null
    const repoPackages = path.join(repoDir, 'Packages')
    if (!fs.existsSync(repoPackages)) return null
    const marker = readSetupMarker(repoDir)
    if (!marker || marker.wallyTomlHash !== hashFile(targetWally)) return null
    const repoLock = path.join(repoDir, 'wally.lock')
    const targetLock = path.join(targetDir, 'wally.lock')
    if (fs.existsSync(repoLock) && fs.existsSync(targetLock)) {
      if (!fs.readFileSync(repoLock).equals(fs.readFileSync(targetLock))) return null
    }

    const startedAt = Date.now()
    fs.cpSync(repoPackages, targetPackages, { recursive: true })
    const repoDev = path.join(repoDir, 'DevPackages')
    if (fs.existsSync(repoDev)) {
      fs.cpSync(repoDev, path.join(targetDir, 'DevPackages'), { recursive: true })
    }
    return `seeded Packages/ from the game repo (${elapsed(startedAt)})`
  } catch {
    // A half-copied Packages/ would fool the marker cache — remove it so the
    // normal install path takes over cleanly.
    try {
      fs.rmSync(targetPackages, { recursive: true, force: true })
      fs.rmSync(path.join(targetDir, 'DevPackages'), { recursive: true, force: true })
    } catch {
      // Leave it to `wally install` to overwrite.
    }
    return null
  }
}

/**
 * Can this repo actually run rojo? Rokit shims are PROJECT-scoped: the shim
 * binary existing in ~/.rokit/bin is not enough — running it fails unless the
 * cwd's manifest chain pins the tool. So the probe runs `rojo --version` with
 * cwd inside the repo, memoized per-dir (cleared when a rokit install runs).
 */
const rojoProbes = new Map<string, Promise<boolean>>()

export function rojoAvailable(dir: string, exec: ToolExec = defaultExec): Promise<boolean> {
  const key = dirKey(dir)
  const pending = rojoProbes.get(key)
  if (pending) return pending
  const probe = exec(rokitShim('rojo'), ['--version'], {
    cwd: dir,
    env: rokitEnv(),
    windowsHide: true
  }).then(
    () => true,
    () => false
  )
  rojoProbes.set(key, probe)
  return probe
}

export function clearRojoAvailability(dir: string): void {
  rojoProbes.delete(dirKey(dir))
}

/**
 * Owns the Roblox toolchain so neither operators nor agents run installs by
 * hand: finds (or bootstraps from official releases) Rokit itself, then per
 * repo runs `rokit install`, `wally install`, the Rojo sourcemap, and
 * wally-package-types. Everything is best-effort — failures come back as
 * notes, never throws. Called on game creation, team-game clone, and for
 * every agent worktree before launch.
 *
 * Repeat calls are cheap: a fully successful run leaves a fingerprint marker
 * (see readSetupMarker) and later runs with unchanged manifests skip straight
 * to the sourcemap — the one output that legitimately goes stale when a
 * worktree's src/ moves. Concurrent calls on the same dir coalesce into one.
 */
export class ToolchainService {
  private rokitPath: string | null | undefined
  private bootstrapping: Promise<string | null> | null = null
  private inflight = new Map<string, Promise<string[]>>()
  /** dir key → rokit.toml hash of the last successful `rokit install` (covers wally-less repos). */
  private rokitFresh = new Map<string, string>()

  constructor(private readonly exec: ToolExec = defaultExec) {}

  async setupRepo(dir: string): Promise<string[]> {
    const key = dirKey(dir)
    const existing = this.inflight.get(key)
    if (existing) return existing
    const run = this.runSetup(dir, key).finally(() => this.inflight.delete(key))
    this.inflight.set(key, run)
    return run
  }

  /**
   * Worktree-aware setup: when the workspace is not the game repo itself, try
   * seeding Packages/ from the repo's installed copy first (waiting out any
   * in-flight setup on the repo), then run the normal per-dir setup — which
   * hits the marker cache when the seed landed.
   */
  async prepareWorkspace(dir: string, repoDir: string | null): Promise<string[]> {
    const notes: string[] = []
    if (repoDir && dirKey(repoDir) !== dirKey(dir)) {
      const repoPending = this.inflight.get(dirKey(repoDir))
      if (repoPending) await repoPending.catch(() => undefined)
      const seeded = seedPackagesFromRepo(repoDir, dir)
      if (seeded) notes.push(seeded)
    }
    notes.push(...(await this.setupRepo(dir)))
    return notes
  }

  private async runSetup(dir: string, key: string): Promise<string[]> {
    const notes: string[] = []
    const hasRokitManifest = fs.existsSync(path.join(dir, 'rokit.toml'))
    const hasWallyManifest = fs.existsSync(path.join(dir, 'wally.toml'))
    if (!hasRokitManifest && !hasWallyManifest) return notes

    const rokit = await this.ensureRokit(notes)
    if (!rokit) return notes

    const opts = { cwd: dir, env: rokitEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    const shim = rokitShim
    const fingerprint = computeSetupFingerprint(dir)
    const marker = readSetupMarker(dir)
    // Fresh-machine guard: a repo copied over with its marker intact must not
    // skip installs when the rokit-managed tools themselves are absent.
    const shimsPresent =
      !hasRokitManifest ||
      ['rojo', 'wally'].every((tool) => fs.existsSync(path.join(rokitBinDir(), `${tool}${EXE}`)))
    const cached =
      marker !== null &&
      shimsPresent &&
      marker.wallyTomlHash === fingerprint.wallyTomlHash &&
      marker.rokitTomlHash === fingerprint.rokitTomlHash

    let failed = false
    const fail = (label: string, err: unknown): void => {
      failed = true
      notes.push(`${label} failed: ${describeError(err).slice(0, 200)}`)
    }

    const done: string[] = []

    if (hasRokitManifest && !cached && this.rokitFresh.get(key) !== fingerprint.rokitTomlHash) {
      const startedAt = Date.now()
      try {
        try {
          await this.exec(rokit, ['install', '--no-trust-check'], opts)
        } catch (err) {
          // Only old Rokit without the flag falls back; real failures surface.
          if (!shouldRetryWithoutTrustCheck(describeError(err))) throw err
          await this.exec(rokit, ['install'], opts)
        }
        this.rokitFresh.set(key, fingerprint.rokitTomlHash)
        clearRojoAvailability(dir)
        done.push(`rokit (${elapsed(startedAt)})`)
      } catch (err) {
        fail('rokit install', err)
      }
    }

    let wallyOk = cached
    if (hasWallyManifest && !cached) {
      const startedAt = Date.now()
      try {
        // A failed install must not leave yesterday's marker claiming success.
        deleteSetupMarker(dir)
        await this.exec(shim('wally'), ['install'], opts)
        wallyOk = true
        let count = 0
        try {
          count = fs
            .readdirSync(path.join(dir, 'Packages'))
            .filter((f) => f.endsWith('.lua') || f.endsWith('.luau')).length
        } catch {
          // Count is decoration only.
        }
        done.push(
          count > 0
            ? `wally (${count} packages, ${elapsed(startedAt)})`
            : `wally (${elapsed(startedAt)})`
        )
        await this.adviseOnIgnoredLockfile(dir, notes)
      } catch (err) {
        fail('wally install', err)
      }
    }

    let sourcemapOk = false
    if (wallyOk && fs.existsSync(path.join(dir, 'default.project.json'))) {
      const startedAt = Date.now()
      try {
        await this.exec(
          shim('rojo'),
          ['sourcemap', 'default.project.json', '-o', 'sourcemap.json'],
          opts
        )
        sourcemapOk = true
        done.push(`sourcemap (${elapsed(startedAt)})`)
      } catch (err) {
        fail('rojo sourcemap', err)
      }
    }

    // Skipped on cache hits: package-types rewrites files inside Packages/,
    // which persisted along with the marker.
    if (hasWallyManifest && !cached && wallyOk && sourcemapOk) {
      const startedAt = Date.now()
      try {
        await this.exec(
          shim('wally-package-types'),
          ['--sourcemap', 'sourcemap.json', 'Packages'],
          opts
        )
        done.push(`package types (${elapsed(startedAt)})`)
      } catch (err) {
        fail('wally-package-types', err)
      }
    }

    if (hasWallyManifest && !cached && !failed && fs.existsSync(path.join(dir, 'Packages'))) {
      writeSetupMarker(dir, fingerprint)
    }

    if (done.length > 0 || cached) {
      const header = cached ? 'toolchain ready (cached)' : 'toolchain ready'
      notes.unshift(done.length > 0 ? `${header}: ${done.join(' · ')}` : header)
    }
    return notes
  }

  /**
   * Existing games scaffolded before wally.lock was committed still ignore it,
   * which costs every clone and worktree a full dependency resolve. Advisory
   * only — Bridge never edits a committed .gitignore behind the operator.
   */
  private async adviseOnIgnoredLockfile(dir: string, notes: string[]): Promise<void> {
    if (!fs.existsSync(path.join(dir, 'wally.lock'))) return
    const ignored = await this.exec('git', ['-C', dir, 'check-ignore', 'wally.lock'], {
      windowsHide: true
    }).then(
      () => true,
      () => false
    )
    if (ignored) {
      notes.push(
        'wally.lock is gitignored in this repo — remove it from .gitignore and commit it so every clone and worktree resolves identical package versions.'
      )
    }
  }

  /** Find Rokit, bootstrapping it from the official release if necessary. */
  private async ensureRokit(notes: string[]): Promise<string | null> {
    if (this.rokitPath !== undefined) return this.rokitPath
    const installed = path.join(rokitBinDir(), `rokit${EXE}`)
    if (fs.existsSync(installed)) {
      this.rokitPath = installed
      return installed
    }
    try {
      await this.exec(`rokit${EXE}`, ['--version'], { windowsHide: true })
      this.rokitPath = `rokit${EXE}`
      return this.rokitPath
    } catch {
      // Not on PATH either — bootstrap.
    }
    this.bootstrapping ??= this.bootstrapRokit(notes)
    this.rokitPath = await this.bootstrapping
    this.bootstrapping = null
    return this.rokitPath
  }

  private async bootstrapRokit(notes: string[]): Promise<string | null> {
    try {
      const res = await fetch(ROKIT_RELEASES, {
        headers: { 'User-Agent': 'bridge-app', Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) throw new Error(`GitHub API ${res.status}`)
      const release = (await res.json()) as {
        assets?: { name: string; browser_download_url: string }[]
      }
      const assets = release.assets ?? []
      const assetName = pickRokitAsset(
        assets.map((a) => a.name),
        process.platform,
        process.arch
      )
      const asset = assets.find((a) => a.name === assetName)
      if (!asset) throw new Error('no release asset for this platform')

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-rokit-'))
      const zipPath = path.join(tmpDir, asset.name)
      const download = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'bridge-app' }
      })
      if (!download.ok) throw new Error(`download ${download.status}`)
      fs.writeFileSync(zipPath, Buffer.from(await download.arrayBuffer()))

      if (process.platform === 'win32') {
        await this.exec(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmpDir}'`
          ],
          { windowsHide: true }
        )
      } else {
        await this.exec('unzip', ['-o', zipPath, '-d', tmpDir])
      }
      const extracted = path.join(tmpDir, `rokit${EXE}`)
      if (!fs.existsSync(extracted)) throw new Error('rokit binary missing after extract')
      if (process.platform !== 'win32') fs.chmodSync(extracted, 0o755)
      await this.exec(extracted, ['self-install'], { windowsHide: true })

      const installed = path.join(rokitBinDir(), `rokit${EXE}`)
      if (!fs.existsSync(installed)) throw new Error('self-install did not produce ~/.rokit/bin')
      notes.push('installed Rokit (toolchain manager) automatically')
      return installed
    } catch (err) {
      notes.push(
        `Rokit is not installed and auto-install failed (${err instanceof Error ? err.message : String(err)}). Install it from https://github.com/rojo-rbx/rokit and retry.`
      )
      return null
    }
  }
}
