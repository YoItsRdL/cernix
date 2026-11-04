import fs from 'node:fs'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { exiftool } from 'exiftool-vendored'
import type { SyncDatabase } from './sync-db'
import { uploadKey } from './upload-key'
import { ARCHIVE_META_KEY, SUPPORTED_EXTENSIONS, MAX_SCAN_DEPTH, SWEEP_CONCURRENCY, EXIF_TIMEOUT_MS, datePath as buildDatePath } from '../constants'
import { messageOf } from '../../shared/errors'
import type { SweepSession, SweepProgress, SweepError, FileEntry, ScannedFile, FileDamage } from '../../shared/ipc-types'
import { indexLibrary, isInLibrary } from './library-index'
import { checkFile } from './file-check'
import { parseExifDate } from './exif-date'
import { readJpegCaptureDate } from './jpeg-exif-date'

// Re-exported so main-side callers keep importing them from the service
// that emits them, while one declaration lives in shared/.
export type { SweepSession, SweepProgress, SweepError, FileEntry, ScannedFile }

// ── Types ──

export type FileSweepEvents = {
  'sweep:started':  [session: SweepSession]
  'sweep:progress': [progress: SweepProgress]
  'sweep:complete': [session: SweepSession]
  'sweep:error':    [error: { sessionId: string; error: string; file?: string }]
}

// ── File Sweeper Service ──
// Recursively scans a source path for supported media,
// then copies all files to a local staging directory.
//

export class FileSweeper extends EventEmitter {
  private activeSessions: Map<string, SweepSession> = new Map()
  private cancelledSessions: Set<string> = new Set()
  private db: SyncDatabase

  constructor(db: SyncDatabase) {
    super()
    this.db = db
  }

  // ── Public API ──

  /**
   * Get the root staging directory.
   * Defaults to %APPDATA%/Cernix/staging
   */
  getStagingRoot(): string {
    // A development and test switch. In the installed app a folder outside
    // userData made the archive unreachable, since the path guard admits
    // only userData/staging (F-034).
    const custom = app.isPackaged ? undefined : process.env['STAGING_DIR']
    if (custom && custom.trim() !== '') return custom
    return path.join(app.getPath('userData'), 'staging')
  }

  /**
   * Pre-scan a volume and return files, marking ones that have already
   * been uploaded to Google Drive in the past.
   */
  async scan(sourcePath: string): Promise<ScannedFile[]> {
    console.log(`[FileSweeper] Pre-scanning ${sourcePath}...`)

    const rawFiles = await this.scanDirectory(sourcePath)
    const libraryRoot = this.getLibraryRoot()
    console.log(`[FileSweeper] Library root: ${libraryRoot}`)
    console.log(`[FileSweeper] Source files found: ${rawFiles.length}`)

    // Read the ledger once, then match each file against it. Asking the
    // database per file meant a scan of a full card ran thousands of
    // queries to answer one question.
    const uploaded = this.db.getUploadedKeys()
    const inArchive = await indexLibrary(libraryRoot)
    const results: ScannedFile[] = []
    let syncedCount = 0
    // Per file, in batches: whether it is whole, and for a JPEG when it was
    // taken, read from its first bytes (about 0.1 ms). The review orders by
    // that date; without it a 2031 or a 1970 photograph sat among the rest
    // by file time. Other formats are ordered by file time, as before.
    const damage: Array<FileDamage | undefined> = []
    const taken: Array<Date | undefined> = []
    for (let i = 0; i < rawFiles.length; i += SWEEP_CONCURRENCY * 8) {
      const batch = rawFiles.slice(i, i + SWEEP_CONCURRENCY * 8)
      damage.push(...await Promise.all(batch.map(f => checkFile(f.absolutePath, f.sizeBytes))))
      taken.push(...await Promise.all(batch.map(async f =>
        /\.jpe?g$/i.test(f.absolutePath) ? parseExifDate(await readJpegCaptureDate(f.absolutePath)) : undefined)))
    }
    for (const [i, file] of rawFiles.entries()) {
      const isSynced = uploaded.has(uploadKey(file.absolutePath, file.sizeBytes))
      if (isSynced) syncedCount++

      results.push({
        ...file,
        damage: damage[i],
        ...(taken[i] ? { captureDate: taken[i] } : {}),
        isUploaded: isSynced,
        isCopied: !isSynced && isInLibrary(inArchive, file.absolutePath, file.sizeBytes),
      })
    }

    console.log(`[FileSweeper] Scan result: ${syncedCount} synced to Drive, ${results.length - syncedCount} new`)
    return results
  }

  /**
   * Start a staging sweep locally.
   * Copies media from `sourcePath` into the staging directory.
   */
  /** The canonical library path: one persistent tree for all imports */
  getLibraryRoot(): string {
    const moved = this.db.getMeta(ARCHIVE_META_KEY)
    if (moved && moved.trim() !== '') return moved
    return path.join(this.getStagingRoot(), 'library')
  }

  /** Records a new archive location. Empty puts it back to the default. */
  setLibraryRoot(root: string): void {
    this.db.setMeta(ARCHIVE_META_KEY, root)
  }

  private frozen = false
  /** Holds new imports back while the archive is being moved. */
  freeze(on: boolean): void {
    this.frozen = on
  }

  /** True while a sweep is scanning or copying. */
  isBusy(): boolean {
    return this.activeSessions.size > 0
  }

  async sweep(sourcePath: string, selectedFiles?: string[], customFolder?: string): Promise<SweepSession> {
    if (this.frozen) throw new Error('The archive is being moved. Import again when that has finished.')
    const sessionId = this.generateSessionId()
    // All files land in one canonical library, not per-session directories
    const stagingPath = this.getLibraryRoot()

    // Initialize session
    const session: SweepSession = {
      sessionId,
      sourcePath,
      stagingPath,
      startedAt: new Date(),
      totalFiles: 0,
      processedFiles: 0,
      totalBytes: 0,
      processedBytes: 0,
      status: 'scanning',
      errors: [],
      customFolder,
      addedFiles: [],
    }

    this.activeSessions.set(sessionId, session)

    try {
      // ── Phase 1: Scan ──
      console.log(`[FileSweeper] Scanning ${sourcePath} for sweep...`)
      let files = await this.scanDirectory(sourcePath, () => this.cancelledSessions.has(sessionId))

      // Terminated while still reading the card: there is nothing copied
      // to report, and the walk must not go on to copy what it found.
      if (this.cancelledSessions.has(sessionId)) {
        session.status = 'cancelled'
        this.emit('sweep:complete', { ...session })
        return session
      }

      // Filter by selection if provided
      if (selectedFiles && selectedFiles.length > 0) {
        const selectedSet = new Set(selectedFiles)
        files = files.filter(f => selectedSet.has(f.relativePath))
      }

      if (files.length === 0) {
        session.status = 'complete'
        session.totalFiles = 0
        this.emit('sweep:started', { ...session })
        this.emit('sweep:complete', { ...session })
        this.activeSessions.delete(sessionId)
        return session
      }

      session.totalFiles = files.length
      session.totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
      session.status = 'copying'

      console.log(`[FileSweeper] Found ${files.length} files (${this.formatBytes(session.totalBytes)})`)
      this.emit('sweep:started', { ...session })

      // Create staging directory
      await fsp.mkdir(stagingPath, { recursive: true })

      // ── Phase 2: Copy (Concurrent Batch) ──
      const CONCURRENCY = SWEEP_CONCURRENCY
      let lastProgressTime = Date.now()
      let bytesSinceLastProgress = 0
      let errorsBefore = 0
      let diskFull = false
      let stopReason: string | null = null
      let alreadyThere = 0

      // Throttled to every 200ms. A duplicate is skipped, not copied, but
      // it is still a file the sweep has got through: a card that was
      // mostly imported before showed no movement at all.
      const reportProgress = (file: FileEntry) => {
        const now = Date.now()
        const elapsed = now - lastProgressTime
        if (elapsed < 200) return
        const bytesPerSecond = Math.round((bytesSinceLastProgress / elapsed) * 1000)
        this.emit('sweep:progress', {
          sessionId,
          file: file.relativePath,
          current: session.processedFiles,
          total: session.totalFiles,
          bytesPerSecond,
          percentComplete: Math.round((session.processedFiles / session.totalFiles) * 100),
        })
        lastProgressTime = now
        bytesSinceLastProgress = 0
      }

      // A rolling pool: each worker takes the next file as soon as it is
      // free. Fixed chunks of four waited for their slowest file every
      // time, so a sweep ran at the speed of its slowest reads (F-080).
      const work = async (file: FileEntry) => {
        {
          if (!file.captureDate) {
            file.captureDate = await this.readExifCaptureDate(file.absolutePath)
          }
          const d = file.captureDate || file.mtime
          const wantedPath = path.join(stagingPath, buildDatePath(d), path.basename(file.absolutePath))
          /** The name claimed for this copy, removed again if the copy fails. */
          let claimed: string | null = null

          try {
            // Ensure destination subdirectory exists
            await fsp.mkdir(path.dirname(wantedPath), { recursive: true })

            const { destPath, duplicate } = await this.resolveDestination(wantedPath, file.absolutePath, file.sizeBytes)
            const relPath = path.relative(stagingPath, destPath)

            if (duplicate) {
              // Already staged locally. Still track for upload in case it never made it to Drive
              session.addedFiles.push(relPath)
              session.processedFiles++
              alreadyThere++
              reportProgress(file)
              return
            }

            // Stream copy (memory-efficient for large files)
            claimed = destPath
            await this.copyFileStream(file.absolutePath, destPath)
            claimed = null
            session.addedFiles.push(relPath)

            session.processedFiles++
            session.processedBytes += file.sizeBytes
            bytesSinceLastProgress += file.sizeBytes

            reportProgress(file)

          } catch (err) {
            // The placeholder claimed for this copy, or the part of it that
            // was written, is not a photograph: left in the archive it read
            // as one, empty, under the photograph's name.
            if (claimed) await fsp.rm(claimed, { force: true }).catch(() => {})
            const code = (err as NodeJS.ErrnoException).code ?? /\b(E[A-Z]+)\b/.exec(messageOf(err) ?? '')?.[1]
            const reason = describeCopyFailure(code, messageOf(err) || String(err))
            console.error(`[FileSweeper] Error copying ${file.relativePath}: ${messageOf(err)}`)
            session.errors.push({ file: file.relativePath, error: reason })
            if (code === 'ENOSPC') diskFull = true
            // One file is not the whole sweep: said in the log, counted at
            // the end. As a `sweep:error` it put the window into its error
            // state for a single locked file, and on into a screen that
            // never left "Importing".
            this.emit('log', { level: 'warn', source: 'sweep', message: `Could not copy ${file.relativePath}: ${reason}` })
          }
        }
      }

      let cursor = 0
      const worker = async () => {
        while (stopReason === null && !this.cancelledSessions.has(sessionId)) {
          const i = cursor++
          if (i >= files.length) return
          await work(files[i])

          // Two failures every remaining file would share, so the sweep
          // stops and says so rather than failing the rest one by one.
          if (session.errors.length > errorsBefore) {
            errorsBefore = session.errors.length
            const sourceGone = !(await fsp.access(sourcePath).then(() => true, () => false))
            if ((sourceGone || diskFull) && stopReason === null) {
              const copied = `${session.processedFiles} of ${session.totalFiles} files were copied`
              stopReason = sourceGone
                ? `The card or folder is no longer there, so the copy stopped: ${copied}. Insert it again and import to copy the rest.`
                : `The disk holding the archive is full, so the copy stopped: ${copied}. Free some space and import again to copy the rest.`
            }
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      if (this.cancelledSessions.has(sessionId)) session.status = 'cancelled'

      if (stopReason) {
        session.status = 'error'
        console.error(`[FileSweeper] Sweep stopped: ${stopReason}`)
        this.emit('sweep:error', { sessionId, error: stopReason })
        return session
      }

      // ── Complete ──
      if (session.status !== 'cancelled') {
        session.status = 'complete'
      }

      console.log(`[FileSweeper] Sweep complete: ${session.processedFiles - alreadyThere} copied, ${alreadyThere} already in the archive, of ${session.totalFiles}`)
      this.emit('sweep:complete', { ...session })

    } catch (err) {
      session.status = 'error'
      const errorMsg = messageOf(err) || String(err)
      console.error(`[FileSweeper] Fatal sweep error: ${errorMsg}`)
      this.emit('sweep:error', { sessionId, error: errorMsg })
    } finally {
      this.activeSessions.delete(sessionId)
      this.cancelledSessions.delete(sessionId)
    }

    return session
  }

  /** Cancel an active sweep session */
  cancel(sessionId: string): boolean {
    if (this.activeSessions.has(sessionId)) {
      this.cancelledSessions.add(sessionId)
      console.log(`[FileSweeper] Cancellation requested for session ${sessionId}`)
      return true
    }
    return false
  }

  /**
   * Cancel every in-flight sweep and return how many were cancelled.
   *
   * The renderer drives this from "Terminate Protocol". It has no
   * session id to pass. The renderer only learns the id at
   * `sweep:complete`, which is too late to cancel. The UI only ever runs one sweep at a
   * time, so cancelling all active sessions is the same operation
   * from the user's point of view.
   */
  cancelAll(): number {
    let cancelled = 0
    for (const sessionId of this.activeSessions.keys()) {
      if (this.cancel(sessionId)) cancelled++
    }
    return cancelled
  }

  /** Get an active session's current state */
  getSession(sessionId: string): SweepSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  /** Get all active sessions */
  getActiveSessions(): SweepSession[] {
    return Array.from(this.activeSessions.values())
  }

  // ── Private ──

  /**
   * Recursively scan a directory for files with supported extensions.
   */
  private async scanDirectory(dirPath: string, shouldStop?: () => boolean): Promise<FileEntry[]> {
    const results: FileEntry[] = []
    const visited = new Set<string>()
    const MAX_DEPTH = MAX_SCAN_DEPTH

    const scan = async (currentPath: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return

      // Resolve real path to detect symlink/junction loops.
      // Windows drive roots (e.g. "D:\") can throw on realpath. Fall back to the raw path.
      let realPath: string
      try {
        realPath = await fsp.realpath(currentPath)
      } catch {
        realPath = currentPath
      }
      if (visited.has(realPath)) return
      visited.add(realPath)

      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(currentPath, { withFileTypes: true })
      } catch (err) {
        // Skip unreadable directories (e.g., System Volume Information)
        console.warn(`[FileSweeper] Cannot read directory: ${currentPath} (${messageOf(err)})`)
        return
      }

      for (const entry of entries) {
        if (shouldStop?.()) return
        const fullPath = path.join(currentPath, entry.name)

        if (entry.isDirectory()) {
          // Skip hidden/system directories
          if (entry.name.startsWith('.') || entry.name === 'System Volume Information' || entry.name === '$Recycle.Bin') {
            continue
          }
          await scan(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            try {
              const stat = await fsp.stat(fullPath)
              results.push({
                absolutePath: fullPath,
                relativePath: path.relative(dirPath, fullPath),
                sizeBytes: stat.size,
                mtime: stat.mtime,
              })
            } catch {
              // Skip files we can't stat (permission issues, etc.)
            }
          }
        }
      }
    }

    await scan(dirPath, 0)

    // EXIF enrichment is deferred to sweep time so the Review UI opens instantly.
    console.log(`[FileSweeper] Enumeration complete: ${results.length} files found.`)
    return results
  }

  /** Read EXIF capture date for a single file. Returns undefined on timeout/missing. */
  private async readExifCaptureDate(absolutePath: string): Promise<Date | undefined> {
    // A JPEG says so in its first bytes, which costs a fraction of a
    // millisecond against ExifTool's 25. Anything it cannot answer, a
    // JPEG without that tag included, still goes to ExifTool.
    if (/\.jpe?g$/i.test(absolutePath)) {
      const quick = parseExifDate(await readJpegCaptureDate(absolutePath))
      if (quick) return quick
    }
    try {
      const tags = await Promise.race([
        exiftool.read(absolutePath),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), EXIF_TIMEOUT_MS))
      ])
      const raw = tags.DateTimeOriginal ?? tags.CreateDate
      if (raw != null) {
        const d = typeof raw === 'object' && 'toDate' in raw
          ? (raw as { toDate(): Date }).toDate()
          : new Date(String(raw))
        if (d instanceof Date && !isNaN(d.getTime())) return d
      }
    } catch { /* EXIF unavailable */ }
    return undefined
  }

  /**
   * Stream-copy a file. Uses Node streams to avoid buffering
   * multi-GB video files into memory.
   */
  private copyFileStream(src: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(src)
      const writeStream = fs.createWriteStream(dest)

      readStream.on('error', (err) => {
        writeStream.destroy()
        reject(new Error(`Read error: ${err.message}`))
      })

      writeStream.on('error', (err) => {
        readStream.destroy()
        reject(new Error(`Write error: ${err.message}`))
      })

      writeStream.on('finish', () => {
        // Preserve original capture timestamps so Drive folder naming
        // reflects the actual media date, not the copy date.
        try {
          const stat = fs.statSync(src)
          fs.utimesSync(dest, stat.atime, stat.mtime)
        } catch { /* non-critical: folder naming will fall back to today */ }
        resolve()
      })
      readStream.pipe(writeStream)
    })
  }

  /**
   * Where this file may safely be written, and whether it is already there.
   *
   * The destination is `<library>/<datePath>/<basename>`, so two frames
   * that share a name and a capture date resolve to one path. That is
   * not a corner case: a second body produces the same names as the
   * first, and one body repeats them every time the counter wraps at
   * 9999. The old check compared size alone and then copied, so the
   * larger frame overwrote the smaller, and two distinct frames of equal
   * length were treated as already-staged and the second never landed.
   * Either way the sweep reported success and a photograph was gone.
   *
   * A name is only reused when the bytes actually match, so re-sweeping
   * the same card still dedupes rather than filling the library with
   * copies. Otherwise the name is suffixed until it is free.
   */
  private async resolveDestination(
    wantedPath: string,
    sourcePath: string,
    expectedSize: number,
  ): Promise<{ destPath: string; duplicate: boolean }> {
    const dir = path.dirname(wantedPath)
    const ext = path.extname(wantedPath)
    const stem = path.basename(wantedPath, ext)

    // Bounded: a name that has genuinely collided a thousand times is a
    // bug somewhere else, and an unbounded loop here would hang a sweep.
    for (let i = 0; i < 1000; i++) {
      const candidate = i === 0 ? wantedPath : path.join(dir, `${stem}-${i}${ext}`)

      // Claim the name by creating it exclusively rather than by
      // checking whether it exists. SWEEP_CONCURRENCY is 4, so two
      // colliding frames are usually in flight together and a
      // stat-then-write would let both pass the check and write the
      // same path. `wx` fails if the name is taken, which makes the
      // claim atomic; the copy that follows truncates the placeholder.
      try {
        const handle = await fsp.open(candidate, 'wx')
        await handle.close()
        return { destPath: candidate, duplicate: false }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }

      // Taken. The same bytes already staged, or a different frame?
      const stat = await fsp.stat(candidate).catch(() => null)
      if (stat && stat.size === expectedSize && await this.sameContent(sourcePath, candidate)) {
        return { destPath: candidate, duplicate: true }
      }
      // A different frame under this name. Try the next one.
    }
    throw new Error(`Cannot find a free name for ${path.basename(wantedPath)}`)
  }

  /**
   * Whether two files hold the same bytes.
   *
   * Only ever reached when sizes already match and a name has collided,
   * which is rare, so hashing a pair of RAW files there costs nothing in
   * the ordinary case. Streamed rather than read whole: these are 20 to
   * 80 MB each and a sweep runs several at once.
   */
  private async sameContent(a: string, b: string): Promise<boolean> {
    const digest = async (p: string): Promise<string> => {
      const hash = createHash('sha256')
      for await (const chunk of fs.createReadStream(p)) hash.update(chunk as Buffer)
      return hash.digest('hex')
    }
    try {
      const [da, db] = await Promise.all([digest(a), digest(b)])
      return da === db
    } catch {
      // Unreadable means we cannot claim they match, and claiming it
      // wrongly is what loses the file.
      return false
    }
  }

  /**
   * Generate a unique session ID: YYYY-MM-DD_HHmmss_XXXX
   */
  private generateSessionId(): string {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)              // "2026-03-31"
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '') // "201700"
    const rand = Math.random().toString(36).substring(2, 6)  // "a1b2"
    return `${date}_${time}_${rand}`
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }
}

/**
 * Why one file could not be copied, in words. The raw text ("Read error:
 * ENOENT: no such file or directory, open 'C:\\...'") reached the screen as
 * it was; the path is already named beside it.
 */
export function describeCopyFailure(code: string | undefined, raw: string): string {
  switch (code) {
    case 'ENOENT': return 'it is no longer there'
    case 'EBUSY': return 'another program has it open'
    case 'EPERM':
    case 'EACCES': return 'Windows or another program will not let it be read'
    case 'ENOSPC': return 'the disk holding the archive is full'
    case 'EIO': return 'the card could not be read here (it may be damaged)'
    default: return raw
  }
}
