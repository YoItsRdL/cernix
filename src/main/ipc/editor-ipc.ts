import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import { RatingStore } from '../services/rating-store'
import { EditCache } from '../services/edit-cache'
import { PresetStore } from '../services/preset-store'
import { getPresetThumb, putPresetThumb } from '../services/preset-thumb-cache'
import { DriveClient } from '../services/drive-client'
import { XmpWriter } from '../services/xmp-writer'
import type { PathGuard } from '../services/approved-paths'
import { postprocessExport } from '../services/export-postprocess'
import { EditParams, DEFAULT_PARAMS } from '../../shared/edit-params'
import type { Stars } from '../services/rating-store'

// Helper for extension resolution
const EXPORT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
function mimeTypeForExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXPORT_MIME[ext] || 'image/jpeg'
}

/**
 * Returns a Drive-collision-safe filename: appends -v2, -v3 and so on
 * before the extension until Drive has no file by that name.
 */
async function uniqueExportName(driveClient: DriveClient, parentId: string, desired: string): Promise<string> {
  const existing = await driveClient.listFileNames(parentId)
  if (!existing.has(desired)) return desired
  const dot = desired.lastIndexOf('.')
  const stem = dot === -1 ? desired : desired.slice(0, dot)
  const ext = dot === -1 ? '' : desired.slice(dot)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-v${i}${ext}`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error(`Cannot find a free name for ${desired} after 1000 attempts`)
}

export function registerEditorHandlers(
  window: BrowserWindow | null,
  ratingStore: RatingStore,
  editCache: EditCache,
  presetStore: PresetStore,
  driveClient: DriveClient,
  isAllowedPath: PathGuard,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
) {
  // ── Rating Domain ──
  ipcMain.handle('rating:get-all', () => ratingStore.getAllRatings())
  ipcMain.handle('rating:set-stars', (_, fileId: string, stars: number | null) => {
    // The renderer is the caller this is defending against, so anything
    // outside the scale is dropped rather than written.
    if (stars !== null && !(Number.isInteger(stars) && stars >= 0 && stars <= 5)) return
    ratingStore.setUserStars(fileId, stars as Stars)
  })
  ipcMain.handle('rating:set-flag', (_, fileId: string, flag: 'pick' | null) => {
    ratingStore.setFlag(fileId, flag)
  })
  ipcMain.handle('rating:set-user-pick', (_, fileId: string, picked: boolean) => {
    ratingStore.setUserPick(fileId, picked)
  })

  // ── Editor Vitals ──
  ipcMain.handle('editor:prepare-source', async (_, fileId: string, modifiedTime: string, fileName: string) => {
    return editCache.getOrDownload(fileId, modifiedTime, fileName)
  })

  // Both write a sidecar derived from `sourcePath`, and the write end
  // creates parent directories, so an unchecked path here is an
  // arbitrary write anywhere the OS user can reach. The legitimate
  // callers only ever pass a path that came back from
  // `editor:prepare-source` or an OS dialog pick, which is exactly what
  // the guard admits.
  ipcMain.handle('editor:read-params', async (_, sourcePath: string) => {
    if (!isAllowedPath(sourcePath)) return { ...DEFAULT_PARAMS }
    return XmpWriter.read(sourcePath)
  })

  ipcMain.handle('editor:write-params', async (_, sourcePath: string, params: EditParams) => {
    if (!isAllowedPath(sourcePath)) {
      console.warn('[editor] Refused a sidecar write outside the approved paths')
      return
    }
    return XmpWriter.write(sourcePath, params)
  })

  /**
   * The source whose EXIF and ICC an export inherits.
   *
   * `postprocessExport` runs `exiftool -TagsFromFile <path> -all:all`,
   * so whatever this names has its entire metadata block copied into an
   * image the user then uploads to Drive or saves to disk. Unguarded,
   * that is a renderer-named read of any file exiftool can parse, with
   * the result published. Same class as the sweep paths, and the guard
   * was already in this file two handlers above.
   *
   * A refused path degrades to `null` rather than throwing: that is the
   * path `postprocessExport` already takes when there is no source on
   * disk, so the export still completes, just without inherited
   * metadata. The refusal is logged rather than swallowed, because a
   * silent one is indistinguishable from a source that moved.
   */
  const sourceForMetadata = (
    sourceCachePath: string | null,
    log: (msg: string) => void,
  ): string | null => {
    if (!sourceCachePath) return null
    if (isAllowedPath(sourceCachePath)) return sourceCachePath
    log(`Export: refused metadata source outside the approved roots: ${sourceCachePath}`)
    return null
  }

  // ── Export Authority ──
  ipcMain.handle('editor:upload-export', async (_, sourceFileId: string, bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null, subpath: string[] | null) => {
    const log = (msg: string) => sendToRenderer('sys:log', { level: 'info', source: 'editor', message: msg })
    log('Export: mirroring source path under \'Cernix Shared\'...')
    let { folderId, path: mirrorPath } = await driveClient.resolveSharedMirrorFolder(sourceFileId)

    if (subpath?.length) {
      for (const raw of subpath) {
        const segment = raw.trim()
        if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
          throw new Error(`Invalid export sub-path segment: ${JSON.stringify(raw)}`)
        }
        folderId = await driveClient.findOrCreateChildFolder(folderId, segment)
        mirrorPath = [...mirrorPath, segment]
      }
    }

    log(`Export: destination = Cernix Shared${mirrorPath.length ? '/' + mirrorPath.join('/') : ''}`)
    log(`Export: postprocessing ${bytes.byteLength} bytes (EXIF + ICC)...`)
    const { bytes: enriched, warning } = await postprocessExport(new Uint8Array(bytes), sourceForMetadata(sourceCachePath, log), (stage) => log(`Export stage: ${stage}`))
    if (warning) log(`Export: warning - ${warning}`)

    log('Export: choosing filename (collision-safe)...')
    const finalName = await uniqueExportName(driveClient, folderId, outputName)
    const mimeType = mimeTypeForExtension(finalName)

    log(`Export: uploading ${enriched.length} bytes as ${finalName}...`)
    const result = await driveClient.uploadBytes(enriched, finalName, folderId, mimeType)
    log(`Export uploaded: ${finalName} (${result.id})`)
    return { ...result, name: finalName, mirrorPath, warning }
  })

  // Local export. Same postprocess pipeline as the Drive path, just
  // writes the enriched bytes to a user-chosen filesystem path instead
  // of uploading. The Save dialog gives the user full control over
  // filename and directory, so we skip the collision-avoidance dance.
  ipcMain.handle('editor:save-export-local', async (_, bytes: ArrayBuffer, outputName: string, sourceCachePath: string | null) => {
    // `window` was captured at handler-registration time (before
    // createWindow ran), so it's permanently null. Use the live
    // focused window for the dialog parent. Same fix as
    // dialog:open-image in system-ipc.ts.
    const parent = BrowserWindow.getFocusedWindow() ?? window
    const log = (msg: string) => sendToRenderer('sys:log', { level: 'info', source: 'editor', message: msg })

    const dialogOpts = { defaultPath: outputName, title: 'Export image' }
    const pick = parent
      ? await dialog.showSaveDialog(parent, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts)
    if (pick.canceled || !pick.filePath) return { saved: false as const }

    log(`Local export: postprocessing ${bytes.byteLength} bytes (EXIF + ICC)...`)
    const { bytes: enriched, warning } = await postprocessExport(new Uint8Array(bytes), sourceForMetadata(sourceCachePath, log), (stage) => log(`Export stage: ${stage}`))
    if (warning) log(`Local export: warning - ${warning}`)

    log(`Local export: writing ${enriched.length} bytes to ${pick.filePath}...`)
    await fs.writeFile(pick.filePath, enriched)
    log(`Local export saved: ${pick.filePath}`)
    return { saved: true as const, path: pick.filePath, warning }
  })

  // ── Preset Services ──
  ipcMain.handle('preset:list', () => presetStore.list())
  ipcMain.handle('preset:save', (_, name: string, params: EditParams) => presetStore.save(name, params))
  ipcMain.handle('preset:delete', (_, id: string) => presetStore.delete(id))
  ipcMain.handle('preset:rename', (_, id: string, name: string) => presetStore.rename(id, name))

  // ── Preset thumbnail cache ──
  // Disk cache for the preset-grid thumbnails. The renderer renders
  // each preset's look against the current photo at thumb size and
  // posts the bytes here; on the second-and-later opens for the
  // same photo it reads them back instead of re-rendering.
  ipcMain.handle('preset-thumb:get', async (_, sourceHash: string, presetId: string, presetUpdatedAt: string) => {
    const buf = await getPresetThumb(sourceHash, presetId, presetUpdatedAt)
    return buf ? buf : null
  })
  ipcMain.handle('preset-thumb:put', async (_, sourceHash: string, presetId: string, presetUpdatedAt: string, bytes: Uint8Array) => {
    await putPresetThumb(sourceHash, presetId, presetUpdatedAt, Buffer.from(bytes))
  })
}
