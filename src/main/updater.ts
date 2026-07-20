import { app, webContents } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/ipc-channels'
import type { UpdateState } from '@shared/types'
import { UPDATE_REPO, UPDATE_TOKEN } from './updateToken'

// electron-updater is CommonJS; named imports don't survive the ESM interop.
const { autoUpdater } = electronUpdater

/**
 * Checks GitHub releases once per launch, downloads in the background, and
 * lets the new version apply on quit — an agent session mid-flight is never
 * interrupted by an update.
 *
 * Failure is always soft: no network, an expired token, or a release with no
 * `latest.yml` leaves Bridge running normally with a reason on the state.
 */
export class UpdaterService {
  /**
   * @param liveAgents Count of running agent sessions — an in-place restart
   * would kill them, so it is refused while any are alive.
   */
  constructor(private readonly liveAgents: () => number = () => 0) {}

  private state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    version: null,
    reason: null
  }

  get(): UpdateState {
    return { ...this.state }
  }

  start(): void {
    // Dev runs from source with no asar and no code signature — electron-updater
    // throws rather than no-ops, so keep it out of the dev loop entirely.
    if (!app.isPackaged) {
      this.set({ status: 'disabled', reason: 'Development build.' })
      return
    }
    if (!UPDATE_TOKEN) {
      this.set({ status: 'disabled', reason: 'No update token configured in this build.' })
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: UPDATE_REPO.owner,
      repo: UPDATE_REPO.repo,
      private: true,
      token: UPDATE_TOKEN
    })

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'current' }))
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'downloading', version: info.version })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'ready', version: info.version })
    )
    autoUpdater.on('error', (err) =>
      this.set({ status: 'error', reason: err instanceof Error ? err.message : String(err) })
    )

    // Never let an updater failure take down startup.
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      this.set({ status: 'error', reason: err instanceof Error ? err.message : String(err) })
    })
  }

  /**
   * Apply the downloaded update now and relaunch. Quitting normally already
   * installs it, but the installer takes a few seconds after the process
   * exits — reopening inside that window can still start the old build. This
   * makes "closed it, reopened it, it's updated" deterministic.
   */
  install(): void {
    if (this.state.status !== 'ready') {
      throw new Error('No update has finished downloading yet.')
    }
    const live = this.liveAgents()
    if (live > 0) {
      throw new Error(
        `${live} agent session${live > 1 ? 's are' : ' is'} still running and restarting would end ${live > 1 ? 'them' : 'it'}. Stop ${live > 1 ? 'them' : 'it'} first, or just close Bridge normally — the update applies on quit either way.`
      )
    }
    // Let the IPC reply reach the renderer before the app starts tearing down.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }

  private set(patch: Partial<UpdateState>): void {
    // Each transition replaces the whole state: an error reason from a failed
    // check must not linger once a later status supersedes it.
    this.state = {
      status: patch.status ?? this.state.status,
      // Constant for the life of the process — never cleared by a transition.
      currentVersion: this.state.currentVersion,
      version: patch.version ?? null,
      reason: patch.reason ?? null
    }
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send(IPC.EvUpdateChanged, this.get())
    }
  }
}
