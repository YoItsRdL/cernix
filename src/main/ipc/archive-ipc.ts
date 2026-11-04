import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import nodePath from 'node:path'
import type { FileSweeper } from '../services/file-sweeper'
import type { DriveUploadService } from '../services/drive-upload'
import { listArchive, checkDestination, moveArchive, ArchiveMoveError } from '../services/archive-mover'
import { tooBroadToApprove } from '../services/approved-paths'
import { startPath, rememberPick } from '../services/dialog-folders'
import { messageOf } from '../../shared/errors'

/**
 * Choosing a new place for the Local Archive, and moving it there
 * (decision 20; the moving itself is `services/archive-mover.ts`).
 *
 * The renderer never names the destination. It asks for a folder to be
 * picked, is told what that would mean (how many files, how many bytes),
 * and then asks for "the move" to happen; the folder in between is held
 * here. A compromised renderer therefore cannot point the archive, or a
 * delete, at a path of its own choosing.
 */
export function registerArchiveHandlers(
  window: BrowserWindow | null,
  fileSweeper: FileSweeper,
  uploader: DriveUploadService,
  sendToRenderer: (channel: string, ...args: unknown[]) => void,
) {
  /** The destination offered by the last pick, awaiting confirmation. */
  let pending: string | null = null
  let moving = false
  let cancelled = false

  ipcMain.handle('archive:pick-destination', async () => {
    if (moving) return { error: 'The archive is already being moved.' }
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Choose where to keep the archive',
      defaultPath: startPath('archive-move'),
    }
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const }
    const picked = result.filePaths[0]
    rememberPick('archive-move', picked)

    if (tooBroadToApprove(picked, app.getPath('home'), nodePath.parse(app.getPath('userData')).root)) {
      return { error: 'That folder is too broad. Choose a folder for photographs, on a disk with room for them.' }
    }
    // A folder of its own inside the pick, so the pick can already hold
    // other things and the archive is never mixed into them.
    const destination = nodePath.join(picked, 'Cernix Archive')
    try {
      const from = fileSweeper.getLibraryRoot()
      const files = await listArchive(from)
      const bytes = files.reduce((n, f) => n + f.size, 0)
      await checkDestination(from, destination, bytes)
      pending = destination
      return { destination, from, files: files.length, bytes }
    } catch (err) {
      pending = null
      return { error: messageOf(err) }
    }
  })

  ipcMain.handle('archive:move', async () => {
    const to = pending
    pending = null
    if (!to) return { error: 'Choose a folder first.' }
    if (moving) return { error: 'The archive is already being moved.' }
    if (fileSweeper.isBusy() || uploader.isBusy()) {
      return { error: 'An import or an upload is still running. Move the archive when it has finished.' }
    }
    moving = true
    cancelled = false
    fileSweeper.freeze(true)
    const from = fileSweeper.getLibraryRoot()
    let lastSent = 0
    try {
      const done = await moveArchive({
        from,
        to,
        shouldCancel: () => cancelled,
        commit: () => fileSweeper.setLibraryRoot(to),
        onProgress: (p) => {
          const now = Date.now()
          if (now - lastSent < 100 && p.done !== p.total) return
          lastSent = now
          sendToRenderer('archive:progress', p)
        },
      })
      sendToRenderer('sys:log', {
        level: done.leftovers.length ? 'warn' : 'info', source: 'system',
        message: `Archive moved to ${to}: ${done.files} files.${done.leftovers.length ? ` ${done.leftovers.length} old files could not be removed and are still in ${from}.` : ''}`,
      })
      return { ok: true as const, path: to, ...done }
    } catch (err) {
      const message = err instanceof ArchiveMoveError ? err.message : `The archive could not be moved (${messageOf(err)}). Nothing was changed.`
      sendToRenderer('sys:log', { level: 'warn', source: 'system', message: `Archive move not done: ${message}` })
      return { error: message }
    } finally {
      moving = false
      fileSweeper.freeze(false)
    }
  })

  ipcMain.handle('archive:move-cancel', () => { cancelled = true })
}
