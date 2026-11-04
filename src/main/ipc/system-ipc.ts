import { ipcMain, dialog, BrowserWindow, shell, app, nativeTheme } from 'electron'
import nodePath from 'node:path'
import nodeFs from 'node:fs/promises'
import { VolumeWatcher } from '../services/volume-watcher'
import { GoogleAuthManager } from '../services/google-auth'
import { FileSweeper } from '../services/file-sweeper'
import { SyncDatabase } from '../services/sync-db'
import { DriveClient } from '../services/drive-client'
import { SCAN_TIMEOUT_MS, SUPPORT_URL, THEME_META_KEY, WINDOW_BACKGROUND, type ThemeName } from '../constants'
import { messageOf } from '../../shared/errors'
import { tooBroadToApprove, type PathGuard } from '../services/approved-paths'
import { classifyTrashError, forbiddenTrash, type TrashFailure } from '../../shared/trash-report'
import { startPath, rememberPick } from '../services/dialog-folders'
import { pathListArg } from './args'
import { parsePreference, effectiveTheme } from '../services/theme'

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
      defaultPath: startPath('import-folder'),
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    // Approving a folder approves everything under it, trash included, so
    // the system drive and the profile are not offered as a source.
    if (tooBroadToApprove(result.filePaths[0], app.getPath('home'), nodePath.parse(app.getPath('userData')).root)) {
      const notice = {
        type: 'info' as const,
        message: 'That folder is too broad to import from.',
        detail: 'It holds most of what is on this computer. Choose the folder with the photographs in it, or a card.',
      }
      if (parent) await dialog.showMessageBox(parent, notice)
      else await dialog.showMessageBox(notice)
      return null
    }
    rememberPick('import-folder', result.filePaths[0])
    // The pick is the consent the sweep gate asks for. Without this the
    // gate refused every folder imported through this very dialog, and
    // the user was told it held no media.
    userApprovedPaths.add(nodePath.resolve(result.filePaths[0]))
    return result.filePaths[0]
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
      defaultPath: startPath('open-image'),
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic'] },
      ],
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    rememberPick('open-image', path)
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
  // Shows one file in the system file manager. Only for a path the guard
  // admits, and only a real file: the manager opens on whatever it is given.
  ipcMain.handle('media:reveal', async (_, raw: unknown) => {
    if (typeof raw !== 'string' || !isAllowedPath(raw)) throw new Error('Cernix may not show that file.')
    const st = await nodeFs.lstat(raw).catch(() => null)
    if (!st?.isFile()) throw new Error('That file is no longer there.')
    shell.showItemInFolder(raw)
  })

  ipcMain.handle('media:trash', async (_, rawPaths: unknown) => {
    // A string here was iterated character by character.
    const paths = pathListArg(rawPaths)
    const trashedPaths: string[] = []
    const missingPaths: string[] = []
    const failures: TrashFailure[] = []
    // Sequential: parallel `shell.trashItem` calls have hit
    // intermittent COM failures on Windows when many files dispatch
    // at once. Sequential is slower but reliable, and the user is
    // already past a destructive-confirmation gate by this point.
    for (const p of paths) {
      if (!isAllowedPath(p)) {
        failures.push(forbiddenTrash(p))
      } else {
        try {
          // Files only. The guard admits a root itself, and trashItem on
          // a directory recycles all of it: one call could take the
          // whole Local Archive or a card. A path that is already gone
          // has no stat and falls through to be counted as such.
          const st = await nodeFs.lstat(p).catch(() => null)
          if (st && !st.isFile()) {
            failures.push(forbiddenTrash(p))
          } else {
            await shell.trashItem(p)
            trashedPaths.push(p)
          }
        } catch (err) {
          // The platform's message names nothing; whether the file is
          // still there is what tells "already gone" from "refused".
          const stillExists = await nodeFs.access(p).then(() => true, () => false)
          const verdict = classifyTrashError(p, stillExists)
          if (verdict.missing) missingPaths.push(p)
          else {
            failures.push(verdict.failure)
            sendToRenderer('sys:log', { level: 'warn', source: 'system', message: `Trash refused ${p}: ${messageOf(err) ?? 'no reason given'}` })
          }
        }
      }
      sendToRenderer('trash:progress', {
        done: trashedPaths.length + missingPaths.length, total: paths.length, failed: failures.length,
      })
    }
    sendToRenderer('sys:log', {
      level: failures.length > 0 ? 'warn' : 'info',
      source: 'system',
      message: `Trash: ${trashedPaths.length} moved${missingPaths.length > 0 ? `, ${missingPaths.length} already gone` : ''}${failures.length > 0 ? `, ${failures.length} failed` : ''}`,
    })
    return { trashedPaths, missingPaths, failures }
  })

  ipcMain.handle('auth:connect', () => authManager.connect())
  ipcMain.handle('auth:status', () => authManager.getStatus())
  // Revokes the grant at Google and deletes the token file. Revoking at
  // Google alone left the file on disk.
  ipcMain.handle('auth:disconnect', () => authManager.disconnect())

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
  // Synchronous: the preload needs it before the page's first paint.
  ipcMain.on('theme:get', (event) => {
    event.returnValue = effectiveTheme(parsePreference(syncDb.getMeta(THEME_META_KEY)), nativeTheme.shouldUseDarkColors)
  })

  ipcMain.handle('theme:preference', () => parsePreference(syncDb.getMeta(THEME_META_KEY)))

  ipcMain.handle('theme:set', (event, theme: unknown) => {
    const choice = parsePreference(typeof theme === 'string' ? theme : null)
    syncDb.setMeta(THEME_META_KEY, choice)
    // The system is asked from here on in terms of the choice, so
    // `shouldUseDarkColors` and the native widgets follow it.
    nativeTheme.themeSource = choice
    const effective: ThemeName = effectiveTheme(choice, nativeTheme.shouldUseDarkColors)
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(WINDOW_BACKGROUND[effective])
    return { ok: true as const, effective }
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

  // Where the photographs Cernix has copied live. Settings never said:
  // the privacy page told people to copy them out before deleting the
  // folder, and nothing showed which folder. Main names the path, so the
  // renderer cannot ask for any other to be opened.
  ipcMain.handle('archive:info', () => ({ path: fileSweeper.getLibraryRoot() }))
  ipcMain.handle('archive:open', async () => {
    const root = fileSweeper.getLibraryRoot()
    await nodeFs.mkdir(root, { recursive: true })
    const failure = await shell.openPath(root)
    return failure ? { ok: false as const, reason: failure } : { ok: true as const }
  })

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
