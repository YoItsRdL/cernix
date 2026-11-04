import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import { unlink } from 'node:fs/promises'
import { safeJoin, downloadName, claimFreePath } from '../services/approved-paths'
import { DriveClient } from '../services/drive-client'
import { DriveOrganizer } from '../services/drive-organizer'
import { startPath, rememberPick } from '../services/dialog-folders'
import { tracked } from '../services/work-in-progress'

export function registerDriveHandlers(
  window: BrowserWindow | null,
  driveClient: DriveClient,
  driveOrganizer: DriveOrganizer,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
) {
  /** Writes a Drive file into `dir` under a free name; returns the path written. */
  async function downloadInto(dir: string, f: { id: string; name: string }): Promise<string> {
    const dest = await claimFreePath(dir, downloadName(f.name, f.id))
    try {
      await driveClient.downloadFileToPath(f.id, dest)
    } catch (err) {
      // The claimed name is an empty file until the download lands.
      await unlink(dest).catch(() => {})
      throw err
    }
    return dest
  }

  ipcMain.handle('drive:get-root-id', async () => {
    return driveClient.getRootFolderId()
  })

  ipcMain.handle('drive:list-contents', async (_, folderId) => {
    return driveClient.listFolderContents(folderId)
  })

  ipcMain.handle('drive:rename-file', async (_, fileId, newName) => {
    return driveClient.renameFile(fileId, newName)
  })

  ipcMain.handle('drive:create-folder', async (_, parentId, name) => {
    return driveClient.createSubfolder(parentId, name)
  })

  ipcMain.handle('drive:set-public', async (_, folderId) => {
    return driveClient.setPublic(folderId)
  })

  ipcMain.handle('drive:get-thumbnail', async (_, url) => {
    return driveClient.getThumbnailBase64(url)
  })

  ipcMain.handle('drive:organize-by-date', tracked('organising Drive by date', async (_, folderId: string) => {
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: 'Organizing all files by date...' })
    const result = await driveOrganizer.executeOrganizeByDate(folderId, true, true, true)
    if (result.movedCount > 0) {
      const cleanup = await driveOrganizer.executeRemoveEmptyFolders(folderId)
      sendToRenderer('sys:log', { level: 'info', source: 'drive', message: result.summary })
      return { ...result, cleanup: cleanup.summary }
    }
    return result
  }))

  ipcMain.handle('drive:remove-empty-folders', tracked('removing empty folders', async (_, folderId: string) => {
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: 'Removing empty folders...' })
    const result = await driveOrganizer.executeRemoveEmptyFolders(folderId)
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: result.summary })
    return result
  }))

  ipcMain.handle('drive:download-batch', tracked('downloading from Drive', async (_, files: { id: string; name: string }[]) => {
    if (files.length === 0) return { saved: 0 }
    // Captured `window` was null at registration time. See
    // dialog:open-image in system-ipc.ts for the same fix.
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      defaultPath: startPath('download'),
      title: `Choose a folder to download ${files.length} file(s)`,
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { saved: 0 }
    const dir = result.filePaths[0]
    rememberPick('download', dir)

    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Downloading ${files.length} file(s) to ${dir}...` })
    let done = 0, failed = 0
    const CONCURRENCY = 4
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(async f => {
        // `f.name` comes from the renderer, `dir` from the user's
        // dialog pick. Joining them raw let a name walk out of the
        // folder the user chose; writing over a file already there
        // lost it.
        await downloadInto(dir, f)
      }))
      for (const r of results) {
        if (r.status === 'fulfilled') done++
        else failed++
      }
      sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Download progress: ${done}/${files.length}${failed > 0 ? ` (${failed} failed)` : ''}` })
      sendToRenderer('download:progress', { done, total: files.length, failed })
    }
    return { saved: done, failed, total: files.length, dir }
  }))

  ipcMain.handle('drive:trash-batch', tracked('moving files to the Drive trash', async (_, fileIds: string[]) => {
    const total = fileIds.length
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Trashing ${total} file(s)...` })

    const CONCURRENCY = 8
    let done = 0
    let failed = 0

    for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
      const chunk = fileIds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(id => driveClient.trashFile(id)))
      for (const r of results) {
        if (r.status === 'fulfilled') done++
        else {
          failed++
          sendToRenderer('sys:log', { level: 'error', source: 'drive', message: r.reason instanceof Error ? r.reason.message : String(r.reason) })
        }
      }
      sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Trash progress: ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}` })
      sendToRenderer('trash:progress', { done, total, failed })
    }

    return { done, failed, total }
  }))

  /**
   * Move items to another folder.
   *
   * Drive models a move as swapping parents, so the source folder has to
   * be named as well. `removeParents` without it would add the new
   * parent and leave the old one, and the item would appear in both.
   *
   * Chunked like trash-batch, and settled rather than raced so one
   * rejected id does not abandon the rest. A move that partially fails
   * still reports what landed.
   */
  ipcMain.handle('drive:move-batch', tracked('moving files in Drive', async (_, ids: string[], targetId: string, sourceParentId: string) => {
    const total = ids.length
    if (total === 0) return { done: 0, failed: 0, total: 0 }
    if (targetId === sourceParentId) return { done: 0, failed: 0, total }

    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Moving ${total} item(s)...` })

    const CONCURRENCY = 8
    let done = 0
    let failed = 0

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = ids.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map(id => driveClient.moveFile(id, targetId, sourceParentId)),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') done++
        else failed++
      }
      sendToRenderer('sys:log', {
        level: failed > 0 ? 'warn' : 'info',
        source: 'drive',
        message: `Move progress: ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}`,
      })
    }

    return { done, failed, total }
  }))

  /**
   * Restore trashed items. The undo half of drive:trash-batch, and
   * deliberately the same shape so one can reverse the other without a
   * translation step.
   */
  ipcMain.handle('drive:untrash-batch', tracked('restoring files from the Drive trash', async (_, fileIds: string[]) => {
    const total = fileIds.length
    if (total === 0) return { done: 0, failed: 0, total: 0 }
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Restoring ${total} item(s)...` })

    const CONCURRENCY = 8
    let done = 0
    let failed = 0
    for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
      const chunk = fileIds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(id => driveClient.untrashFile(id)))
      for (const r of results) {
        if (r.status === 'fulfilled') done++
        else failed++
      }
    }
    sendToRenderer('sys:log', {
      level: failed > 0 ? 'warn' : 'info',
      source: 'drive',
      message: `Restored ${done}/${total}${failed > 0 ? ` (${failed} failed)` : ''}`,
    })
    return { done, failed, total }
  }))

  ipcMain.handle('drive:cancel-organize', () => {
    driveOrganizer.cancelOrganize()
  })

  ipcMain.handle('drive:stage-for-editing', tracked('downloading files to edit', async (_, files: { id: string; name: string }[]) => {
    if (files.length === 0) return { saved: 0 }
    // Captured `window` was null at registration time. See
    // dialog:open-image in system-ipc.ts for the same fix.
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      defaultPath: startPath('stage'),
      title: `Choose a folder to stage ${files.length} file(s) for editing`,
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { saved: 0 }
    const dir = result.filePaths[0]
    rememberPick('stage', dir)

    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Staging ${files.length} file(s) to ${dir}...` })

    const manifestEntries: { local: string; driveId: string }[] = []
    let done = 0, failed = 0
    const CONCURRENCY = 4

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(async f => {
        // Same reason as the download handler: `f.name` is the
        // renderer's, `dir` is the user's pick. The written path is
        // what the manifest records, because the name may have had to
        // change (a character the filesystem refuses, a name already
        // taken) and a manifest naming a file that is not there is
        // worse than one naming the one written.
        const dest = await downloadInto(dir, f)
        return { ...f, local: path.basename(dest) }
      }))
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === 'fulfilled') {
          done++
          manifestEntries.push({ local: r.value.local, driveId: chunk[j].id })
        } else {
          failed++
        }
      }
      sendToRenderer('sys:log', { level: 'info', source: 'drive', message: `Staging progress: ${done}/${files.length}${failed ? ` (${failed} failed)` : ''}` })
      sendToRenderer('download:progress', { done, total: files.length, failed })
    }

    const { writeFile } = await import('node:fs/promises')
    const manifest = {
      stagedAt: new Date().toISOString(),
      sourceCount: files.length,
      files: manifestEntries,
    }
    await writeFile(safeJoin(dir, '.cernix-manifest.json'), JSON.stringify(manifest, null, 2))
    sendToRenderer('sys:log', { level: 'info', source: 'drive', message: 'Manifest written. Ready for editing.' })

    return { saved: done, failed, total: files.length, dir }
  }))

}
