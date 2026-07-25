import { spawn, spawnSync, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { webContents } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { Game, RojoOpenBuildResult, RojoServeStatus } from '@shared/types'
import { openInVsCode } from './editor'
import { rokitEnv, rokitShim } from './toolchain'
import { portFree, probeRojoApi } from './rojoApi'

const execFileAsync = promisify(execFile)

/**
 * 34872 is the Rojo Studio plugin's default port. Its sync-reminder polling
 * only probes the port in its UI field, so serving here is what makes Studio
 * pop the one-click "Connect?" toast — shift off it only when it's taken.
 */
const BASE_PORT = 34872
const PORT_SCAN = 10
const READY_TIMEOUT_MS = 10_000
const TAIL_LINES = 20

interface ServeEntry {
  gameId: string
  port: number
  /** null = attached to an external server Bridge didn't spawn and never kills. */
  child: ChildProcess | null
  reused: boolean
  startedAt: number
  /** Last stdout+stderr lines, for crash/startup error messages. */
  tail: string[]
  /** Intentional kill in progress — the exit handler stays quiet. */
  stopping: boolean
}

/**
 * Kill a serve we spawned. On Windows the rokit shim runs the real rojo.exe as
 * its own child — killing only the shim would orphan the server on the port,
 * so take down the whole tree. Synchronous so it also works from before-quit.
 */
function killChildTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 1500)
    timer.unref()
    child.once('exit', () => clearTimeout(timer))
  }
}

/** Launch Roblox Studio with no place argument. Returns a note on failure, null on success. */
async function launchRobloxStudio(): Promise<string | null> {
  const missing =
    'Roblox Studio not found — install it from create.roblox.com, then open your place and let the Rojo plugin connect.'

  if (process.platform === 'darwin') {
    for (const name of ['RobloxStudio', 'Roblox Studio']) {
      try {
        await execFileAsync('open', ['-a', name])
        return null
      } catch {
        // Try the alternate app name.
      }
    }
    return missing
  }

  // Studio's bootstrapper installs versioned folders; the newest exe is the live one.
  const roots = [
    process.env.LOCALAPPDATA,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles
  ].filter((r): r is string => Boolean(r))
  let newest: { exe: string; mtime: number } | null = null
  for (const root of roots) {
    const versionsDir = path.join(root, 'Roblox', 'Versions')
    let entries: string[] = []
    try {
      entries = fs.readdirSync(versionsDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const exe = path.join(versionsDir, entry, 'RobloxStudioBeta.exe')
      try {
        const mtime = fs.statSync(exe).mtimeMs
        if (!newest || mtime > newest.mtime) newest = { exe, mtime }
      } catch {
        // Not a Studio version folder.
      }
    }
  }
  if (!newest) return missing
  try {
    spawn(newest.exe, [], { detached: true, stdio: 'ignore' }).unref()
    return null
  } catch (err) {
    return `Could not launch Roblox Studio: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Owns per-game `rojo serve` processes — Bridge's dev-loop launcher. One serve
 * per game, port 34872 preferred (see BASE_PORT), an already-running server
 * for the same project is attached to rather than duplicated, and every
 * spawned serve dies with its game (stop, removal) or with Bridge itself.
 */
export class RojoService {
  private serves = new Map<string, ServeEntry>()
  private pending = new Map<string, Promise<RojoOpenBuildResult>>()
  private lastNotes = new Map<string, string>()

  /** One click: VS Code + rojo serve + Roblox Studio. Only the serve step is fatal. */
  async openBuild(game: Game): Promise<RojoOpenBuildResult> {
    const inFlight = this.pending.get(game.id)
    if (inFlight) return inFlight
    const run = this.doOpenBuild(game).finally(() => this.pending.delete(game.id))
    this.pending.set(game.id, run)
    return run
  }

  private async doOpenBuild(game: Game): Promise<RojoOpenBuildResult> {
    const projectFile = path.join(game.repoPath, 'default.project.json')
    if (!fs.existsSync(projectFile)) {
      throw new Error(
        `${game.name} is not a Rojo project — no default.project.json in ${game.repoPath}.`
      )
    }
    let projectName: string | null = null
    try {
      const parsed = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name.trim()) projectName = parsed.name.trim()
    } catch {
      // Unparseable project file — rojo serve's own stderr is the better message.
    }

    const notes: string[] = []
    try {
      await openInVsCode(game.repoPath)
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err))
    }

    const status = await this.ensureServe(game, projectName)
    if (status.reused) {
      notes.push(`Attached to a rojo serve already running for this project on :${status.port}.`)
    }

    const studioNote = await launchRobloxStudio()
    if (studioNote) notes.push(studioNote)

    return { status, notes }
  }

  private async ensureServe(game: Game, projectName: string | null): Promise<RojoServeStatus> {
    const existing = this.serves.get(game.id)
    if (existing) {
      // Spawned child still tracked = still alive (exit handler untracks it).
      if (existing.child) return this.status(game.id)
      // External server — re-check it before claiming it's still serving.
      if (await probeRojoApi(existing.port)) return this.status(game.id)
      this.serves.delete(game.id)
      this.broadcast(game.id)
    }

    for (let port = BASE_PORT; port < BASE_PORT + PORT_SCAN; port++) {
      if ([...this.serves.values()].some((e) => e.port === port)) continue

      const info = await probeRojoApi(port)
      if (info) {
        if (projectName && info.projectName === projectName) {
          this.serves.set(game.id, {
            gameId: game.id,
            port,
            child: null,
            reused: true,
            startedAt: Date.now(),
            tail: [],
            stopping: false
          })
          this.lastNotes.delete(game.id)
          this.broadcast(game.id)
          return this.status(game.id)
        }
        continue // Some other project's server owns this port.
      }

      if (!(await portFree(port))) continue // Bound by something that isn't answering HTTP.

      await this.spawnServe(game, port)
      return this.status(game.id)
    }

    throw new Error(
      `No free port between ${BASE_PORT} and ${BASE_PORT + PORT_SCAN - 1} — stop one of the running rojo servers and retry.`
    )
  }

  private spawnServe(game: Game, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        rokitShim('rojo'),
        ['serve', 'default.project.json', '--port', String(port)],
        { cwd: game.repoPath, env: rokitEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const entry: ServeEntry = {
        gameId: game.id,
        port,
        child,
        reused: false,
        startedAt: Date.now(),
        tail: [],
        stopping: false
      }
      const pushTail = (chunk: Buffer): void => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (!line.trim()) continue
          entry.tail.push(line.trim())
          if (entry.tail.length > TAIL_LINES) entry.tail.shift()
        }
      }
      child.stdout?.on('data', pushTail)
      child.stderr?.on('data', pushTail)
      const tailText = (): string => (entry.tail.length ? ` — ${entry.tail.slice(-6).join(' · ')}` : '')

      let settled = false
      const fail = (message: string): void => {
        if (settled) return
        settled = true
        clearInterval(pollTimer)
        reject(new Error(message))
      }
      const succeed = (): void => {
        if (settled) return
        settled = true
        clearInterval(pollTimer)
        this.serves.set(game.id, entry)
        this.lastNotes.delete(game.id)
        this.broadcast(game.id)
        resolve()
      }

      child.once('error', (err) => {
        const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
        fail(
          enoent
            ? 'rojo not found — open the game once so Bridge installs the toolchain, or run "rokit install" in the repo.'
            : `Could not start rojo serve: ${err.message}`
        )
      })

      child.on('exit', (code) => {
        if (!settled) {
          fail(`rojo serve exited during startup (code ${code ?? 'unknown'})${tailText()}`)
          return
        }
        // Post-startup exit: a crash unless Bridge killed it itself.
        if (this.serves.get(game.id) !== entry || entry.stopping) return
        this.serves.delete(game.id)
        this.lastNotes.set(
          game.id,
          `rojo serve stopped unexpectedly (code ${code ?? 'unknown'})${tailText()}`
        )
        this.broadcast(game.id)
      })

      const deadline = Date.now() + READY_TIMEOUT_MS
      const pollTimer = setInterval(() => {
        void probeRojoApi(port).then((info) => {
          if (settled) return
          if (info) {
            succeed()
          } else if (Date.now() > deadline) {
            entry.stopping = true
            killChildTree(child)
            fail(`rojo serve did not become ready within ${READY_TIMEOUT_MS / 1000}s${tailText()}`)
          }
        })
      }, 250)
    })
  }

  /** Stop a spawned serve, or detach from an external one (never kill a pid Bridge doesn't own). */
  stop(gameId: string): string | null {
    const entry = this.serves.get(gameId)
    if (!entry) return null
    entry.stopping = true
    this.serves.delete(gameId)
    this.lastNotes.delete(gameId)
    this.broadcast(gameId)
    if (!entry.child) {
      return 'Detached — that rojo serve was started outside Bridge and is still running.'
    }
    killChildTree(entry.child)
    return null
  }

  status(gameId: string): RojoServeStatus {
    const entry = this.serves.get(gameId)
    if (entry) {
      return {
        gameId,
        running: true,
        port: entry.port,
        reused: entry.reused,
        startedAt: entry.startedAt,
        note: null
      }
    }
    return {
      gameId,
      running: false,
      port: null,
      reused: false,
      startedAt: null,
      note: this.lastNotes.get(gameId) ?? null
    }
  }

  /** A deleted game's serve would hold its repoPath cwd and block folder removal. */
  removeForGame(gameId: string): void {
    this.stop(gameId)
    this.lastNotes.delete(gameId)
  }

  stopAllSync(): void {
    for (const entry of this.serves.values()) {
      entry.stopping = true
      if (entry.child) killChildTree(entry.child)
    }
    this.serves.clear()
  }

  private broadcast(gameId: string): void {
    const status = this.status(gameId)
    for (const wc of webContents.getAllWebContents()) {
      wc.send(IPC.EvRojoChanged, status)
    }
  }
}
