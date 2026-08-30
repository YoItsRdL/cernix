import { app, BrowserWindow, Menu, protocol, net, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { config } from 'dotenv'
import { VolumeWatcher } from './services/volume-watcher'
import { FileSweeper } from './services/file-sweeper'
import { GoogleAuthManager } from './services/google-auth'
import { DriveUploadService } from './services/drive-upload'
import { DriveClient } from './services/drive-client'
import { SyncDatabase } from './services/sync-db'
import { DriveOrganizer } from './services/drive-organizer'
import { MetadataExtractor } from './services/metadata-extractor'
import { RatingStore } from './services/rating-store'
import { EditCache } from './services/edit-cache'
import { PresetStore } from './services/preset-store'
import { LogEntry } from '../shared/ipc-types'
import { THEME_META_KEY, WINDOW_BACKGROUND, type ThemeName } from './constants'
import { getThumbnail, UnthumbnailableError } from './services/thumbnail-cache'
import { registerDriveHandlers } from './ipc/drive-ipc'
import { registerSystemHandlers } from './ipc/system-ipc'
import { registerEditorHandlers } from './ipc/editor-ipc'
import { createPathGuard, type PathGuard } from './services/approved-paths'
import { buildContentSecurityPolicy } from './services/csp'
import { messageOf } from '../shared/errors'

// Fatal-error log, installed before anything else can throw. A packaged
// Windows app is GUI-subsystem: it has no console, so a crash during
// module evaluation exits silently with nothing written anywhere.
const CRASH_LOG = (() => {
  try {
    return path.join(app.getPath('userData'), 'startup-error.log')
  } catch {
    return path.join(os.tmpdir(), 'cernix-startup-error.log')
  }
})()

function recordFatal(kind: string, err: unknown): void {
  const stack = err instanceof Error ? (err.stack ?? err.message) : String(err)
  const entry = `[${new Date().toISOString()}] ${kind}\n${stack}\n\n`
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true })
    fs.appendFileSync(CRASH_LOG, entry)
  } catch { /* nothing left to try */ }
  console.error(`[Main] ${kind}:`, err)
}

process.on('uncaughtException', (err) => recordFatal('Uncaught exception', err))
process.on('unhandledRejection', (reason) => recordFatal('Unhandled rejection', reason))

// `config()` with no path resolves against `process.cwd()`, which is
// wherever the app was launched from. Resolve against this file instead:
// `__dirname` is `<project>/dist-electron` in development. A packaged
// build finds no file here by design: electron-builder excludes `.env`
// and release credentials arrive another way.
const ENV_PATH = path.join(__dirname, '..', '.env')
const envResult = config({ path: ENV_PATH })
if (envResult.error) {
  console.warn(`[Env] No .env at ${ENV_PATH} (${envResult.error.message})`)
}

// ── Protocol Registration ──
protocol.registerSchemesAsPrivileged([
  { scheme: 'cernix-media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
])

/** Owns the window, the services and the IPC registration. */
class CernixApp {
  private window: BrowserWindow | null = null
  /** Absolute paths the user approved through an OS dialog this
   *  session. cernix-media://local honours these on top of the static
   *  roots, so a file picked outside edit-cache, staging or a removable
   *  volume still loads. Not persisted, by design. */
  private userApprovedPaths = new Set<string>()
  private pathGuard: PathGuard | null = null
  private volumeWatcher!: VolumeWatcher
  private fileSweeper!: FileSweeper
  private authManager!: GoogleAuthManager
  private driveUploader!: DriveUploadService
  private driveClient!: DriveClient
  private syncDb!: SyncDatabase
  private driveOrganizer!: DriveOrganizer
  private metadataExtractor!: MetadataExtractor
  private ratingStore!: RatingStore
  private editCache!: EditCache
  private presetStore!: PresetStore

  constructor() {
    this.setupErrorHandling()
  }

  public async initialize(): Promise<void> {
    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'cernix-v1.db')

    this.syncDb = new SyncDatabase(dbPath)
    this.ratingStore = new RatingStore(path.join(userDataPath, 'cernix-ratings.db'))
    this.presetStore = new PresetStore(userDataPath)

    this.volumeWatcher = new VolumeWatcher({ intervalMs: 2000 })
    this.fileSweeper = new FileSweeper(this.syncDb)
    this.authManager = new GoogleAuthManager()
    const getToken = async () => this.authManager.getAccessToken() ?? null
    this.driveClient = new DriveClient(getToken, {
      get: () => this.syncDb.getMeta('drive_root_folder_id'),
      set: (id) => this.syncDb.setMeta('drive_root_folder_id', id),
    })
    this.driveUploader = new DriveUploadService(getToken, this.driveClient)
    this.editCache = new EditCache(this.driveClient, path.join(userDataPath, 'edit-cache'))
    this.editCache.on('progress', (p) => this.sendToRenderer('editor:cache-progress', p))

    // Drive library organiser (date foldering + empty-folder pruning).
    this.driveOrganizer = new DriveOrganizer()
    this.driveOrganizer.setDriveService(this.driveClient)
    this.metadataExtractor = new MetadataExtractor()

    this.registerIpcHandlers()
    this.registerServiceEvents()
    this.setupMediaProtocol()
    this.setupSecurityPolicy()
    this.setupLifecycle()

    try {
      await this.authManager.initialize()
      this.volumeWatcher.start()
    } catch (err) {
      console.error('[Main] Service Boot Error:', err)
    }

    console.log('[Main] Station Core Active.')
  }

  private setupSecurityPolicy(): void {
    // The policy itself is in services/csp.ts, pure and parameterised,
    // so what the packaged app allows can be asserted rather than read.
    const policy = buildContentSecurityPolicy(app.isPackaged)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [policy],
        },
      })
    })
  }

  /**
   * The stored interface theme, defaulting to light.
   *
   * Read from the local app_meta store. It is a per-machine display
   * preference: it never goes near Drive and never leaves the device.
   */
  public getTheme(): ThemeName {
    return this.syncDb?.getMeta(THEME_META_KEY) === 'dark' ? 'dark' : 'light'
  }

  public createWindow(): void {
    const DIST = path.join(__dirname, '../dist')
    const theme = this.getTheme()

    // A packaged build takes its icon from the executable. In dev there
    // is no executable, so without this the window and taskbar show the
    // default Electron icon.
    //
    // Linux cannot read an .ico: the window manager wants a raster it can
    // scale, and hands back the Electron default rather than an error if
    // it gets anything else. Both files come out of `npm run icons`.
    const devIcon = path.join(
      __dirname,
      process.platform === 'win32'
        ? '../build-resources/icon.ico'
        : '../build-resources/icon.png',
    )

    this.window = new BrowserWindow({
      width: 1400,
      height: 900,
      ...(app.isPackaged ? {} : { icon: devIcon }),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        // The theme has to reach the preload before the page runs, so
        // the class is on <html> before first paint. An IPC round trip
        // after load would show a frame of the wrong theme.
        additionalArguments: [`--cernix-theme=${theme}`],
      },
      // Just the name. The frame is hidden, so this surfaces only on the
      // taskbar button and the alt-tab card, both of which truncate. The
      // landing page's <title> carries the sentence.
      title: 'Cernix',
      // The app's own 48px top row is the title bar. Windows cannot
      // recolour the native caption at all. The DWM attribute for it is
      // Windows 11 only, so matching the theme means not using it.
      //
      // No `titleBarOverlay` either: it takes a colour at construction
      // and knows nothing about the tokens, so the strip stayed light
      // over a dark app. components/WindowControls draws the three
      // buttons instead.
      //
      // `titleBarStyle` is a Windows and macOS option: Linux ignores it
      // and keeps its decorations, which would leave the window manager's
      // buttons above the app's own row of three. `frame: false` is how
      // Linux is asked the same question. Both leave the renderer drawing
      // the caption, so WindowControls is right on either.
      //
      // On macOS `hidden` still draws the traffic lights, so a mac target
      // wants `hiddenInset` and a WindowControls that renders nothing.
      ...(process.platform === 'linux'
        ? { frame: false }
        : { titleBarStyle: 'hidden' as const }),
      // Painted before the renderer draws anything, so launch does not
      // flash a colour the theme never uses.
      backgroundColor: WINDOW_BACKGROUND[theme],
    })

    this.window.on('ready-to-show', () => {
      this.window?.show()
    })

    // The renderer draws the maximise button, so it has to hear about
    // maximising by any other route (double-click, Win+Up, a snap) or
    // the glyph offers to maximise a window that already is.
    this.window.on('maximize', () => this.sendToRenderer('window:maximized', true))
    this.window.on('unmaximize', () => this.sendToRenderer('window:maximized', false))

    // The default menu carried devtools and reload, and removing it took
    // both accelerators. Re-bound here, and only here, so they cannot
    // reach a packaged build.
    if (!app.isPackaged) {
      this.window.webContents.on('before-input-event', (_event, input) => {
        if (input.type !== 'keyDown') return
        const key = input.key.toLowerCase()
        if (key === 'f12' || (input.control && input.shift && key === 'i')) {
          this.window?.webContents.toggleDevTools()
        } else if (key === 'f5' || (input.control && key === 'r')) {
          this.window?.webContents.reload()
        }
      })
    }

    // The window hosts one document and never navigates away from it.
    // Without these, anything that sets `location` in the renderer gets
    // that page reloaded in this window, with preload.js re-run and the
    // whole electronAPI bridge handed to it: trash, Drive mutation,
    // exports. The dev server is the one origin allowed to navigate,
    // because Vite reloads through it.
    const devOrigin = process.env['VITE_DEV_SERVER_URL']
    this.window.webContents.on('will-navigate', (event, url) => {
      if (devOrigin && url.startsWith(devOrigin)) return
      event.preventDefault()
      console.warn('[window] Blocked navigation to', url)
    })

    // Links open in the user's browser rather than a second Electron
    // window that would inherit the same bridge.
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    if (devOrigin) {
      this.window.loadURL(devOrigin)
    } else {
      this.window.loadFile(path.join(DIST, 'index.html'))
    }
  }

  private setupMediaProtocol(): void {
    const isAllowed = this.pathGuard ?? (this.pathGuard = createPathGuard({
      approved: this.userApprovedPaths,
      volumeRoots: () => this.volumeWatcher.getVolumes().map(v => v.path),
    }))

    protocol.handle('cernix-media', async (request) => {
      const url = new URL(request.url)

      if (url.host === 'local') {
        const filePath = decodeURIComponent(url.pathname.slice(1))
        if (!isAllowed(filePath)) {
          return new Response('Forbidden', { status: 403 })
        }

        // `?thumb=N` returns a small JPEG from the OS thumbnailer cache,
        // so the grid never decodes a 4-5 MB original to draw a 200px
        // tile.
        const thumbParam = url.searchParams.get('thumb')
        if (thumbParam) {
          const maxEdge = Math.min(2048, Math.max(64, parseInt(thumbParam, 10) || 256))
          try {
            const { buffer, mime } = await getThumbnail(filePath, maxEdge)
            // The strict TS lib will not take a Node `Buffer` as
            // BodyInit. A fresh `Uint8Array` also drops the reference to
            // the larger pool buffer.
            const body = new Uint8Array(buffer.byteLength)
            body.set(buffer)
            return new Response(body, {
              headers: {
                'Content-Type': mime,
                // Lets a tile re-render on scroll without another round
                // trip. `mtime` keys the main-side cache, so a generous
                // max-age cannot serve a stale thumbnail.
                'Cache-Control': 'public, max-age=3600',
              },
            })
          } catch (err) {
            if (err instanceof UnthumbnailableError) {
              // Video or unsupported format. 404 lets the renderer's
              // <img> onError fall through to its own frame extraction.
              return new Response('No server-side thumbnail', { status: 404 })
            }
            console.warn(`[Protocol] thumbnail failed for ${filePath}:`, messageOf(err))
            return new Response('Thumbnail failed', { status: 500 })
          }
        }

        try {
          return net.fetch(pathToFileURL(filePath).toString())
        } catch {
          return new Response('File not found', { status: 404 })
        }
      }

      // Handle Drive Files: cernix-media://drive/[FILE_ID]
      if (url.host === 'drive') {
        const fileId = url.pathname.slice(1)
        const token = await this.authManager.getAccessToken()
        if (!token) return new Response('Unauthorized', { status: 401 })

        try {
          // Forward the caller's Range header so `preload="metadata"` and
          // the thumbnail extractor fetch only the bytes they need rather
          // than streaming a whole video per tile.
          const upstreamHeaders: Record<string, string> = { Authorization: `Bearer ${token}` }
          const rangeHeader = request.headers.get('range')
          if (rangeHeader) upstreamHeaders.Range = rangeHeader

          const driveRes = await net.fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: upstreamHeaders,
          })

          return driveRes
        } catch (err) {
          console.error(`[Protocol] Drive fetch failed: ${fileId}`, err)
          return new Response(messageOf(err), { status: 500 })
        }
      }

      return new Response('Invalid Host', { status: 400 })
    })
  }

  private registerServiceEvents(): void {
    this.volumeWatcher.on('volume:detected', (vol) => this.sendToRenderer('volume:detected', vol))
    this.volumeWatcher.on('volume:removed', (vol) => this.sendToRenderer('volume:removed', vol))
    this.fileSweeper.on('sweep:started', (s) => {
      this.sendToRenderer('sweep:started', s)
      this.sendToRenderer('sys:log', { level: 'info', source: 'sweep', message: `Session ${s.sessionId} started - ${s.totalFiles} files queued for staging.` })
    })
    this.fileSweeper.on('sweep:progress', (p) => this.sendToRenderer('sweep:progress', p))

    // Local staging finishing is what starts the Drive upload; the two
    // halves of ingest are joined here and nowhere else.
    this.fileSweeper.on('sweep:complete', async (session) => {
      // Always forward the completion event to the renderer for UI update
      this.sendToRenderer('sweep:complete', session)

      // Only upload if files were actually copied and we're authenticated
      if (session.status !== 'complete' || session.processedFiles === 0) {
        console.log('[Main] Sweep complete but no files staged - skipping Drive upload.')
        return
      }

      const token = await this.authManager.getAccessToken()
      if (!token) {
        // Auth missing or refresh failed. Without this branch no upload
        // event ever arrives and the renderer sits in `sweeping` on the
        // last percentage forever, so it goes out as a sweep:error.
        const msg = 'Google Drive isn\'t connected: your files are staged locally. Reconnect Drive in Settings to upload.'
        console.log('[Main] No auth token - skipping Drive upload.')
        this.sendToRenderer('sys:log', { level: 'warn', source: 'upload', message: msg })
        this.sendToRenderer('sweep:error', { sessionId: session.sessionId, error: msg })
        return
      }

      console.log(`[Main] Staging complete (${session.processedFiles} files). Initiating Drive upload...`)
      this.sendToRenderer('sys:log', { level: 'info', source: 'upload', message: `Staging complete. Initiating Drive upload for ${session.processedFiles} files...` })

      try {
        // Fall back to today's date for the folder name since camera clocks may be incorrect
        const folderDate = new Date().toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        })
        const driveFolderName = session.customFolder || `Cernix · ${folderDate}`

        await this.driveUploader.uploadSession({
          sessionId: session.sessionId,
          stagingPath: session.stagingPath,
          driveFolderName,
          filterFiles: session.addedFiles,
        })
      } catch (err) {
        console.error('[Main] Drive upload failed:', messageOf(err))
        this.sendToRenderer('sys:log', { level: 'error', source: 'upload', message: `Drive upload failed: ${messageOf(err)}` })
        this.sendToRenderer('sweep:error', { sessionId: session.sessionId, error: messageOf(err) })
      }
    })

    this.fileSweeper.on('sweep:error', (e) => this.sendToRenderer('sweep:error', e))
    this.authManager.on('auth:status', (s) => this.sendToRenderer('auth:status', s))
    this.authManager.on('auth:error', (e) => this.sendToRenderer('auth:error', e))
    this.driveUploader.on('upload:started', (s) => this.sendToRenderer('upload:started', s))
    this.driveUploader.on('upload:progress', (p) => this.sendToRenderer('upload:progress', p))
    this.driveUploader.on('upload:file-done', (job) => {
      this.syncDb.recordUpload(job.fileName, job.sizeBytes, job.driveFileId)
    })
    this.driveUploader.on('upload:complete', (s) => this.sendToRenderer('upload:complete', s))
    this.driveOrganizer.on('log', (entry: LogEntry) => this.sendToRenderer('sys:log', entry))
  }

  private registerIpcHandlers(): void {
    // Built before any registration that needs it. The sweep handlers
    // take the same guard the editor handlers do, so "may the renderer
    // name this path?" has one answer across the whole IPC surface.
    this.pathGuard ??= createPathGuard({
      approved: this.userApprovedPaths,
      volumeRoots: () => this.volumeWatcher.getVolumes().map(v => v.path),
    })
    registerSystemHandlers(this.window, this.volumeWatcher, this.authManager, this.fileSweeper, this.syncDb, this.driveClient, this.userApprovedPaths, this.pathGuard, this.sendToRenderer.bind(this))
    registerDriveHandlers(this.window, this.driveClient, this.driveOrganizer, this.sendToRenderer.bind(this))
    registerEditorHandlers(this.window, this.ratingStore, this.editCache, this.presetStore, this.driveClient, this.pathGuard, this.sendToRenderer.bind(this))

    // Both run in the background at startup, and in this order: the
    // rename has to land before anything resolves the shared root by
    // name, or a second empty one gets created beside the real one.
    this.rebuildLedgerIfNeeded()
  }

  private setupLifecycle(): void {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        this.destroy()
        app.quit()
      }
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow()
      }
    })
  }


  private setupErrorHandling(): void {
    // Handlers are installed at module scope so they cover crashes that
    // happen before this class exists; nothing more to do here.
  }

  /**
   * Reconcile the local ledger against Drive: when it is empty, and again
   * when the last reconciliation has gone stale.
   *
   * Empty-only made it a bootstrap rather than a reconciliation. After
   * the first upload it never ran again, so anything this machine had not
   * personally uploaded stayed invisible. On this install that was 109
   * records against 5632 files actually in Drive.
   *
   * Twelve hours is about one working session: soon enough that another
   * machine's uploads appear the same day, rare enough that it is not a
   * full listing on every launch.
   */
  private async rebuildLedgerIfNeeded(): Promise<void> {
    const LAST_SYNC = 'ledger_synced_at'
    const TWELVE_HOURS = 12 * 60 * 60 * 1000

    const lastSync = Number(this.syncDb.getMeta(LAST_SYNC) ?? 0)
    const stale = Date.now() - lastSync > TWELVE_HOURS
    if (this.syncDb.getSyncRecordCount() > 0 && !stale) return

    try {
      console.log('[Main] Reconciling sync ledger against Drive in background...')
      const count = await this.driveClient.rebuildCloudLedger(this.syncDb)
      this.syncDb.setMeta(LAST_SYNC, String(Date.now()))
      console.log(`[Main] Ledger reconciled: ${count} files.`)
      this.sendToRenderer('sys:log', { level: 'info', source: 'system', message: `Sync ledger reconciled: ${count} files from Drive.` })
    } catch {
      // An unreachable Drive is not a reason to discard what the ledger
      // knows, and the stale timestamp makes the next launch retry.
      console.log('[Main] Ledger reconcile skipped (not authenticated or offline).')
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    this.window?.webContents.send(channel, ...args)
  }

  private destroy(): void {
    this.volumeWatcher?.stop()
    this.syncDb?.close()
  }
}

/**
 * Tell Chromium which Linux keyring to use, when it would not work it out.
 *
 * `safeStorage` encrypts the Drive tokens with a key from the OS keystore.
 * Chromium picks the backend from XDG_CURRENT_DESKTOP, and recognises the
 * big desktops by name: anything else — Hyprland, sway, i3, a bare
 * compositor — falls through to `basic_text`, which is not encryption. It
 * is a hardcoded key, in the source, the same on every machine.
 *
 * The Secret Service API is what libsecret speaks and gnome-keyring is
 * only its most common implementation, so this hint is worth making on
 * any unrecognised desktop rather than a GNOME-shaped one. If nothing
 * answers on the bus Chromium falls back exactly as it does today, so the
 * hint can only improve the outcome.
 *
 * KDE is left alone: it is recognised, and it has KWallet, which this
 * would override with something worse.
 *
 * An explicit `--password-store` on the command line always wins. That is
 * the documented Chromium switch, and someone passing it has decided.
 *
 * Whatever backend is chosen, `google-auth` checks the result before it
 * writes a token to disk. This improves the odds; it is not the guarantee.
 */
if (process.platform === 'linux') {
  const chosenByUser = process.argv.some(a => a.startsWith('--password-store'))
  const desktop = (process.env['XDG_CURRENT_DESKTOP'] ?? '').toUpperCase()
  const recognised = /KDE|GNOME|UNITY|CINNAMON|MATE/.test(desktop)
  if (!chosenByUser && !recognised) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  }
}

// Electron's default menu was never this app's. On Windows and Linux it
// is drawn inside the client area, which is now the app's caption strip.
// macOS keeps it: the menu lives in the system bar there, and removing it
// would take cut, copy and paste with it.
if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

app.whenReady().then(async () => {
  try {
    const cernix = new CernixApp()
    await cernix.initialize()
    cernix.createWindow()
  } catch (err) {
    console.error('[Main] FATAL RECOVERY:', err)
  }
})
