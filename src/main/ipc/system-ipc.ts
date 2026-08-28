import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import nodePath from 'node:path'
import nodeFs from 'node:fs/promises'
import { VolumeWatcher } from '../services/volume-watcher'
import { GoogleAuthManager } from '../services/google-auth'
import { FileSweeper } from '../services/file-sweeper'
import { SyncDatabase } from '../services/sync-db'
import { DriveClient } from '../services/drive-client'
import { SCAN_TIMEOUT_MS, SUPPORT_URL, THEME_META_KEY, WINDOW_BACKGROUND, type ThemeName } from '../constants'
import { messageOf } from '../../shared/errors'
import type { PathGuard } from '../services/approved-paths'

export function registerSystemHandlers(
  window: BrowserWindow | null,
  volumeWatcher: VolumeWatcher,
  authManager: GoogleAuthManager,
  fileSweeper: FileSweeper,
  syncDb: SyncDatabase,
  driveClient: DriveClient,
  userApprovedPaths: Set<string>,
  isAllowedPath: PathGuard,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
) {
  /**
   * The consent gate for a renderer-named sweep root.
   *
   * The interface always picks a folder through `dialog:open-folder`
   * first, and that dialog is what fills `userApprovedPaths`, but the
   * IPC contract never required it, so a compromised renderer could
   * name any directory and have it recursively scanned, staged, and
   * uploaded to the user's Drive under the guise of an ordinary import.
   *
   * The guard consults `volumeWatcher.getVolumes()` on every call
   * rather than caching, because a card inserted after startup is a
   * legitimate root that no dialog pick will ever cover.
   *
   * Rejection is reported, not swallowed: a silent no-op looks
   * identical to an empty card.
   */
  const refuseUnapprovedPath = (scanPath: unknown): string | null => {
    if (typeof scanPath === 'string' && isAllowedPath(scanPath)) return null
    const message = 'That folder was not chosen through the import dialog, so it was not scanned.'
    sendToRenderer('sys:log', { level: 'error', source: 'system', message: `Refused unapproved sweep path: ${String(scanPath)}` })
    sendToRenderer('sweep:error', { sessionId: '', error: message })
    return message
  }

  ipcMain.handle('dialog:open-folder', async () => {
    // `window` parameter was captured at registration time before
    // createWindow ran. See the dialog:open-image handler below for
    // the same pattern. Use the live focused window at invoke time.
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const opts = {
      properties: ['openDirectory' as const],
      title: 'Select folder to import',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    return result.canceled ? null : result.filePaths[0]
  })

  // Open a single image file from disk for direct editing. Bypasses
  // the Drive-backed library entirely. The renderer treats the
  // returned descriptor like a regular EditorFile (the editor reads
  // params and renders from `path`); no upload, no sync, no library
  // entry. Filter list mirrors what the WebGL pipeline can decode.
  //
  // Uses `BrowserWindow.getFocusedWindow()` at invoke time rather than
  // the `window` parameter captured at registration: registerIpcHandlers
  // runs before createWindow, so the captured value is permanently null.
  ipcMain.handle('dialog:open-image', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const opts = {
      properties: ['openFile' as const],
      title: 'Open image for editing',
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic'] },
      ],
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    // Approve this path for the cernix-media://local protocol.
    // The static allowlist (edit-cache / staging / removable volumes)
    // doesn't cover arbitrary user picks; this Set is the per-session
    // gate. Path is normalised by nodePath.resolve to match the same
    // form the protocol handler compares against.
    userApprovedPaths.add(nodePath.resolve(path))
    const stat = await nodeFs.stat(path)
    return {
      path,
      name: nodePath.basename(path),
      modifiedTime: stat.mtime.toISOString(),
    }
  })

  ipcMain.handle('volume:list', () => volumeWatcher.getVolumes())

  ipcMain.handle('sweep:scan', async (_, scanPath) => {
    if (refuseUnapprovedPath(scanPath)) return []
    const SCAN_TIMEOUT = SCAN_TIMEOUT_MS
    sendToRenderer('sys:log', { level: 'info', source: 'system', message: `Scanning: ${scanPath}` })
    
    // Safety: use Promise.race to ensure huge directories don't hang the IPC main thread
    const files = await Promise.race([
      fileSweeper.scan(scanPath),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Scan timed out after 120s')), SCAN_TIMEOUT))
    ])
    
    const synced = files.filter(f => f.isUploaded).length
    sendToRenderer('sys:log', { level: 'info', source: 'system', message: `Scan complete: ${files.length} files (${synced} synced, ${files.length - synced} new)` })
    return files
  })

  ipcMain.handle('sweep:start', (_, path, selected, customFolder) => {
    if (refuseUnapprovedPath(path)) return null
    return fileSweeper.sweep(path, selected, customFolder)
  })

  /**
   * Abort the in-flight sweep ("Terminate Protocol" in the UI).
   *
   * Without this the renderer's reset only cleared its own state
   * while main kept copying, and the sweep's eventual
   * `sweep:complete` dragged the UI straight back into the
   * "Importing Media…" overlay. The click looked like a no-op.
   */
  ipcMain.handle('sweep:cancel', () => {
    const cancelled = fileSweeper.cancelAll()
    sendToRenderer('sys:log', {
      level: 'info',
      source: 'sweep',
      message: cancelled > 0
        ? `Ingest terminated by user: ${cancelled} session(s) cancelled.`
        : 'Terminate requested but no sweep was in flight.',
    })
    return { cancelled }
  })

  // Move selected source files to the OS trash. Defence-in-depth on
  // the path allowlist mirrors the `cernix-media://` protocol
  // handler. Only files under our app-owned dirs (edit-cache,
  // staging) or a currently-mounted removable volume are allowed
  // through. Anything else returns a per-path `forbidden` failure
  // rather than touching `shell.trashItem`.
  // Trash used to carry its own copy of the root check: the same
  // static roots, the same volume lookup, the same trailing-separator
  // handling, re-derived. That is the duplication `createPathGuard` was
  // extracted to end, and a second copy is a second thing to forget to
  // fix. It now asks the same guard every other handler asks.
  ipcMain.handle('media:trash', async (_, paths: string[]) => {
    const trashedPaths: string[] = []
    const failures: string[] = []
    // Sequential: parallel `shell.trashItem` calls have hit
    // intermittent COM failures on Windows when many files dispatch
    // at once. Sequential is slower but reliable, and the user is
    // already past a destructive-confirmation gate by this point.
    for (const p of paths) {
      if (!isAllowedPath(p)) {
        failures.push(`forbidden:${p}`)
        continue
      }
      try {
        await shell.trashItem(p)
        trashedPaths.push(p)
      } catch (err) {
        failures.push(`${p}: ${messageOf(err) ?? 'trash failed'}`)
      }
    }
    sendToRenderer('sys:log', {
      level: failures.length > 0 ? 'warn' : 'info',
      source: 'system',
      message: `Trash: ${trashedPaths.length} moved${failures.length > 0 ? `, ${failures.length} failed` : ''}`,
    })
    return { trashedPaths, failures }
  })

  ipcMain.handle('auth:connect', () => authManager.connect())
  ipcMain.handle('auth:status', () => authManager.getStatus())

  /**
   * Persist the interface theme and recolour the window frame.
   *
   * The window comes from the event sender, not the captured `window`
   * argument: handlers are registered during initialize(), before
   * createWindow() runs, so that argument is still null here.
   *
   * The renderer has already applied the class by the time this is
   * called. Preload does that synchronously so the switch is
   * instant. This only writes it down and fixes the frame.
   */
  ipcMain.handle('theme:set', (event, theme: 'light' | 'dark') => {
    const next: ThemeName = theme === 'dark' ? 'dark' : 'light'
    syncDb.setMeta(THEME_META_KEY, next)
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(WINDOW_BACKGROUND[next])
    return { ok: true as const }
  })

  /**
   * The caption buttons.
   *
   * The window's frame is hidden so the top row can be painted in the
   * app's own tokens, which makes minimise, maximise and close the
   * renderer's to ask for. Three operations, no arguments. There is
   * nothing to validate and nothing widened: a renderer that can call
   * these could already close its own window with `window.close()`.
   *
   * They act on the window that sent the message rather than a captured
   * one, for the same reason the dialog handlers above do: handlers are
   * registered before createWindow runs.
   */
  const sender = (event: Electron.IpcMainInvokeEvent) =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle('window:minimize', (event) => {
    sender(event)?.minimize()
    return { ok: true as const }
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = sender(event)
    if (!win) return { maximized: false }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return { maximized: win.isMaximized() }
  })

  ipcMain.handle('window:close', (event) => {
    sender(event)?.close()
    return { ok: true as const }
  })

  /**
   * Asked once on mount. The glyph has to be right from the first
   * paint. A window restored from a maximised session shows the
   * restore icon, not the maximise one, and after that the
   * `window:maximized` event keeps it current.
   */
  ipcMain.handle('window:is-maximized', (event) => ({
    maximized: sender(event)?.isMaximized() ?? false,
  }))

  /**
   * The running version, for the user to quote in a bug report.
   *
   * `app.getVersion()` reads what the build was stamped with, which
   * comes from package.json, so there is one source and nothing to keep
   * in step. Until this existed the issue template told people to look
   * in the installer filename or Add/Remove Programs, which is a
   * workaround for the app not saying.
   */
  ipcMain.handle('system:version', () => app.getVersion())

  ipcMain.handle('support:open', async () => {
    await shell.openExternal(SUPPORT_URL)
    return { ok: true as const }
  })

  ipcMain.handle('auth:rebuild-ledger', async () => {
    sendToRenderer('sys:log', { level: 'info', source: 'system', message: 'Rebuilding cloud ledger...' })
    const count = await driveClient.rebuildCloudLedger(syncDb)
    // Stamped here too, so asking for a rebuild by hand also resets the
    // staleness clock that schedules the automatic one.
    syncDb.setMeta('ledger_synced_at', String(Date.now()))
    return { count }
  })



}
