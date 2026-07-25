import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const EXE = process.platform === 'win32' ? '.exe' : ''
const ROKIT_RELEASES = 'https://api.github.com/repos/rojo-rbx/rokit/releases/latest'

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

/**
 * Owns the Roblox toolchain so neither operators nor agents run installs by
 * hand: finds (or bootstraps from official releases) Rokit itself, then per
 * repo runs `rokit install`, `wally install`, the Rojo sourcemap, and
 * wally-package-types. Everything is best-effort — failures come back as
 * notes, never throws. Called on game creation, team-game clone, and for
 * every agent worktree before launch.
 */
export class ToolchainService {
  private rokitPath: string | null | undefined
  private bootstrapping: Promise<string | null> | null = null

  async setupRepo(dir: string): Promise<string[]> {
    const notes: string[] = []
    const hasRokitManifest = fs.existsSync(path.join(dir, 'rokit.toml'))
    const hasWallyManifest = fs.existsSync(path.join(dir, 'wally.toml'))
    if (!hasRokitManifest && !hasWallyManifest) return notes

    const rokit = await this.ensureRokit(notes)
    if (!rokit) return notes

    const opts = { cwd: dir, env: rokitEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    const shim = rokitShim
    const fail = (label: string, err: unknown): void => {
      const anyErr = err as { stderr?: string; message?: string }
      notes.push(`${label} failed: ${(anyErr.stderr || anyErr.message || '').trim().slice(0, 200)}`)
    }

    const done: string[] = []

    if (hasRokitManifest) {
      try {
        // --no-trust-check keeps it non-interactive; older Rokit versions
        // without the flag fall back to a plain install.
        await execFileAsync(rokit, ['install', '--no-trust-check'], opts).catch(() =>
          execFileAsync(rokit, ['install'], opts)
        )
        done.push('rokit')
      } catch (err) {
        fail('rokit install', err)
      }
    }

    if (hasWallyManifest) {
      try {
        await execFileAsync(shim('wally'), ['install'], opts)
        const packagesDir = path.join(dir, 'Packages')
        let count = 0
        try {
          count = fs.readdirSync(packagesDir).filter((f) => f.endsWith('.lua') || f.endsWith('.luau')).length
        } catch {
          // Count is decoration only.
        }
        done.push(count > 0 ? `wally (${count} packages)` : 'wally')

        if (fs.existsSync(path.join(dir, 'default.project.json'))) {
          try {
            await execFileAsync(
              shim('rojo'),
              ['sourcemap', 'default.project.json', '-o', 'sourcemap.json'],
              opts
            )
            done.push('sourcemap')
            try {
              await execFileAsync(
                shim('wally-package-types'),
                ['--sourcemap', 'sourcemap.json', 'Packages'],
                opts
              )
              done.push('package types')
            } catch (err) {
              fail('wally-package-types', err)
            }
          } catch (err) {
            fail('rojo sourcemap', err)
          }
        }
      } catch (err) {
        fail('wally install', err)
      }
    }

    if (done.length > 0) notes.unshift(`toolchain ready: ${done.join(' · ')}`)
    return notes
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
      await execFileAsync(`rokit${EXE}`, ['--version'], { windowsHide: true })
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
        await execFileAsync(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmpDir}'`],
          { windowsHide: true }
        )
      } else {
        await execFileAsync('unzip', ['-o', zipPath, '-d', tmpDir])
      }
      const extracted = path.join(tmpDir, `rokit${EXE}`)
      if (!fs.existsSync(extracted)) throw new Error('rokit binary missing after extract')
      if (process.platform !== 'win32') fs.chmodSync(extracted, 0o755)
      await execFileAsync(extracted, ['self-install'], { windowsHide: true })

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
