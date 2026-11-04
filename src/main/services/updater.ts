/**
 * Telling an installed Cernix about a new release, and installing it.
 *
 * Wraps `electron-updater`, which reads the manifest published beside
 * each GitHub release (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`)
 * and compares its version with this build's. The only request it makes
 * is for that manifest and, when it is newer, the installer. GitHub sees
 * the address, the version and the platform; nothing else is sent. The
 * user can turn it off in Settings, and then nothing is requested at all.
 *
 * Windows and Linux download in the background and install on a restart
 * the user chooses: `quitAndInstall(true, true)` runs the NSIS update
 * without its wizard and starts the app again (without those two flags
 * the wizard appears and the app does not come back, which is how
 * updates "did not apply" in the app this was modelled on).
 *
 * macOS only announces. Squirrel.Mac refuses a replacement not signed
 * with a Developer ID, and Cernix is ad-hoc signed by decision, so the
 * Mac build never downloads and the user is sent to the release page.
 *
 * A restart is refused while something a restart would cut short is
 * running: a sweep, an upload, an export, a change to Drive.
 */
import type { UpdateState, UpdateStatus } from '../../shared/ipc-types'
import { RELEASES_URL } from '../constants'

/** The part of electron-updater's `autoUpdater` this uses. */
export interface UpdaterEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterDeps {
  engine: UpdaterEngine
  /** A dev build has no manifest to compare against and nothing to replace. */
  packaged: boolean
  platform: NodeJS.Platform
  readEnabled(): boolean
  writeEnabled(enabled: boolean): void
  /** What is running that a restart would cut short, or null. */
  busy(): string | null
  /** Tells the renderer. */
  send(status: UpdateStatus): void
  log(message: string): void
}

/** Every six hours: a long session still hears about a release the same day. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export class UpdateService {
  private state: UpdateState = { kind: 'idle' }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: UpdaterDeps) {
    const { engine } = deps
    engine.autoDownload = this.installsInPlace
    // A downloaded update also installs when the user quits normally.
    engine.autoInstallOnAppQuit = this.installsInPlace

    engine.on('checking-for-update', () => this.set({ kind: 'checking' }))
    engine.on('update-not-available', (info) => this.set({ kind: 'current', version: info.version }))
    engine.on('update-available', (info) => {
      this.deps.log(`Update: ${info.version} is available.`)
      this.set(this.installsInPlace
        ? { kind: 'downloading', version: info.version, percent: 0 }
        : { kind: 'available', version: info.version, releaseUrl: `${RELEASES_URL}/tag/v${info.version}` })
    })
    engine.on('download-progress', (p) => {
      if (this.state.kind === 'downloading') {
        this.set({ ...this.state, percent: Math.round(p.percent) })
      }
    })
    engine.on('update-downloaded', (info) => {
      this.deps.log(`Update: ${info.version} is downloaded and installs on restart.`)
      this.set({ kind: 'ready', version: info.version })
    })
    engine.on('error', (err) => {
      // The raw message (a URL, an HTTP status) goes to the log; the
      // user gets a sentence. A failed check is not worth more than that:
      // the next one comes on its own.
      this.deps.log(`Update check failed: ${err.message}`)
      this.set({ kind: 'error', message: 'Could not reach GitHub to check for updates.' })
    })
  }

  /** False on macOS, which announces a release instead of installing it. */
  get installsInPlace(): boolean {
    return this.deps.platform !== 'darwin'
  }

  status(): UpdateStatus {
    return {
      enabled: this.deps.readEnabled(),
      supported: this.deps.packaged,
      installsInPlace: this.installsInPlace,
      state: this.state,
    }
  }

  /** At launch: check now, then on an interval, if the user allows it. */
  start(): void {
    if (!this.deps.packaged || !this.deps.readEnabled() || this.timer) return
    void this.check()
    this.timer = setInterval(() => {
      // Once an update is waiting there is nothing more to find out.
      if (this.state.kind !== 'ready') void this.check()
    }, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  setEnabled(enabled: boolean): UpdateStatus {
    this.deps.writeEnabled(enabled)
    if (enabled) this.start()
    else {
      this.stop()
      if (this.state.kind !== 'ready') this.set({ kind: 'idle' })
    }
    return this.status()
  }

  /** "Check now". Does nothing when off or in a dev build. */
  async check(): Promise<UpdateStatus> {
    if (!this.deps.packaged || !this.deps.readEnabled()) return this.status()
    if (this.state.kind === 'downloading' || this.state.kind === 'ready') return this.status()
    try {
      await this.deps.engine.checkForUpdates()
    } catch {
      // Reported through the engine's 'error' event, which has set the state.
    }
    return this.status()
  }

  /** "Restart to update". Refused while a restart would cut something short. */
  install(): { ok: true } | { ok: false; reason: string } {
    if (this.state.kind !== 'ready') return { ok: false, reason: 'No update is ready to install.' }
    const busy = this.deps.busy()
    if (busy) return { ok: false, reason: `Cernix is ${busy}. Restart when it has finished.` }
    this.deps.log(`Update: restarting into ${this.state.version}.`)
    this.deps.engine.quitAndInstall(true, true)
    return { ok: true }
  }

  private set(next: UpdateState): void {
    this.state = next
    this.deps.send(this.status())
  }
}
