import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { ROBLOX_MCP_NAME, ROBLOX_MCP_PACKAGE, ROBLOX_MCP_VERSION } from '@shared/robloxMcp'

const execFileAsync = promisify(execFile)

type Exec = (
  file: string,
  args: readonly string[],
  options?: object
) => Promise<{ stdout: string; stderr: string }>

/**
 * Bridge-managed install of the Roblox Studio MCP server under
 * `<userData>/mcp`, so agent launches spawn `node <entry>` directly instead of
 * going through npx — npx sat on every launch's critical path (registry
 * resolution + cache bookkeeping, ~1.3–2s measured). The install runs once in
 * the background at app start; launches read the answer synchronously from
 * disk and fall back to the pinned npx command until it's ready.
 *
 * Electron-free (baseDir injected) so it stays unit-testable.
 */
export class McpInstaller {
  private installing: Promise<boolean> | null = null

  constructor(
    private readonly baseDir: string,
    private readonly exec: Exec = execFileAsync as unknown as Exec
  ) {}

  /** Entry point of a ready install of the PINNED version, else null. */
  entryPath(): string | null {
    const pkgDir = path.join(this.baseDir, 'node_modules', ...ROBLOX_MCP_NAME.split('/'))
    const entry = path.join(pkgDir, 'dist', 'index.js')
    try {
      if (!fs.existsSync(entry)) return null
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
        version?: string
      }
      // A stale version means the pin moved — treat as not installed so the
      // launch path uses npx while ensureInstalled() refreshes it.
      return pkg.version === ROBLOX_MCP_VERSION ? entry : null
    } catch {
      return null
    }
  }

  /** Install (or refresh) the pinned version; concurrent calls coalesce. */
  ensureInstalled(): Promise<boolean> {
    if (this.entryPath()) return Promise.resolve(true)
    this.installing ??= this.install().finally(() => {
      this.installing = null
    })
    return this.installing
  }

  private async install(): Promise<boolean> {
    try {
      fs.mkdirSync(this.baseDir, { recursive: true })
      const args = [
        'install',
        '--prefix',
        this.baseDir,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        ROBLOX_MCP_PACKAGE
      ]
      // npm is npm.cmd on Windows, which Node refuses to spawn directly since
      // the CVE-2024-27980 fix — route through cmd /c like the npx path does.
      if (process.platform === 'win32') {
        await this.exec('cmd', ['/c', 'npm', ...args], { windowsHide: true })
      } else {
        await this.exec('npm', args, { windowsHide: true })
      }
      return this.entryPath() !== null
    } catch {
      // Non-fatal by design: launches fall back to npx.
      return false
    }
  }
}
