import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { messageOf } from '../../shared/errors'
import type { UploadSessionSummary, UploadProgress } from '../../shared/ipc-types'

// One declaration, in shared/; re-exported from the service that emits it.
export type { UploadSessionSummary, UploadProgress }

// ── Types ──

export interface UploadJob {
  id: string
  filePath: string
  fileName: string
  mimeType: string
  sizeBytes: number
  driveFolderId: string
  status: 'pending' | 'uploading' | 'complete' | 'failed' | 'cancelled'
  progress: number            // 0-100
  bytesUploaded: number
  resumeUri: string | null    // Google resumable upload URI
  retryCount: number
  error: string | null
}

export interface UploadSessionConfig {
  sessionId: string
  stagingPath: string
  driveFolderName: string     // e.g. "2026-03-31_201700_a1b2"
  /** If provided, only upload these files (relative paths within stagingPath) */
  filterFiles?: string[]
}



export type DriveUploadEvents = {
  'upload:started':    [summary: UploadSessionSummary]
  'upload:progress':   [progress: UploadProgress]
  'upload:file-done':  [job: UploadJob]
  'upload:complete':   [summary: UploadSessionSummary]
  'upload:error':      [error: { file: string; error: string; retryCount: number }]
}

// ── MIME Type Map ──

const MIME_TYPES: Record<string, string> = {
  // RAW
  '.arw':  'image/x-sony-arw',
  '.cr3':  'image/x-canon-cr3',
  '.cr2':  'image/x-canon-cr2',
  '.nef':  'image/x-nikon-nef',
  '.dng':  'image/x-adobe-dng',
  '.raf':  'image/x-fuji-raf',
  '.orf':  'image/x-olympus-orf',
  '.rw2':  'image/x-panasonic-rw2',
  // Image
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.tiff': 'image/tiff',
  '.tif':  'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  // Video
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.avi':  'video/x-msvideo',
  // Sidecar
  '.xmp':  'application/xml',
  '.xml':  'application/xml',
}

// ── Constants ──

const MAX_CONCURRENT = 3
const MAX_RETRIES = 5
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024  // 5 MB
const CHUNK_SIZE = 8 * 1024 * 1024            // 8 MB per chunk for resumable

// ── Google Drive Upload Service ──
//
// Queue-based upload engine with:
//   - Resumable uploads for files > 5 MB
//   - Concurrency limit of 3
//   - Exponential backoff retry (max 5)
//   - Auto folder creation (/Cernix/<session>/)
//   - Per-file progress tracking
//

export class DriveUploadService extends EventEmitter {
  private getToken: () => Promise<string | null>
  private driveClient: import('./drive-client').DriveClient
  private queue: UploadJob[] = []
  private activeJobs: Map<string, UploadJob> = new Map()
  private isPaused = false
  private sessionSummary: UploadSessionSummary | null = null

  constructor(getToken: () => Promise<string | null>, driveClient: import('./drive-client').DriveClient) {
    super()
    this.getToken = getToken
    this.driveClient = driveClient
  }

  // ── Public API ──

  /**
   * Upload all files in a staging session folder to Google Drive.
   * Creates /Cernix/<driveFolderName>/ in Drive.
   */
  async uploadSession(config: UploadSessionConfig): Promise<UploadSessionSummary> {
    const token = await this.getToken()
    if (!token) {
      throw new Error('Not authenticated. Connect Google Drive first.')
    }

    // Scan staging folder for files, optionally filtering to session-added files only
    let files = await this.scanStagingFolder(config.stagingPath)
    if (config.filterFiles) {
      const allowed = new Set(config.filterFiles)
      files = files.filter(f => allowed.has(f.relativePath))
    }
    if (files.length === 0) {
      const summary = this.createSummary(config.sessionId, 'complete')
      this.emit('upload:complete', summary)
      return summary
    }

    // Ensure /Cernix/ root folder exists
    const rootId = await this.driveClient.getRootFolderId()

    // Resolve Drive folder for each file based on its date path (YYYY/MM/DD)
    // Cache folder IDs to avoid redundant API calls
    const folderCache = new Map<string, string>()
    folderCache.set('', rootId)

    const resolveDriveFolder = async (relativePath: string): Promise<string> => {
      const dir = relativePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      if (!dir) return rootId

      if (folderCache.has(dir)) return folderCache.get(dir)!

      const segments = dir.split('/')
      let parentId = rootId
      let pathSoFar = ''

      for (const segment of segments) {
        pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment
        if (folderCache.has(pathSoFar)) {
          parentId = folderCache.get(pathSoFar)!
        } else {
          parentId = await this.driveClient.createSubfolder(parentId, segment)
          folderCache.set(pathSoFar, parentId)
        }
      }

      return parentId
    }

    // Build upload jobs with correct Drive folder per file
    this.queue = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const driveFolderId = await resolveDriveFolder(f.relativePath)
      this.queue.push({
        id: `${config.sessionId}_${i}`,
        filePath: f.absolutePath,
        fileName: f.relativePath,
        mimeType: this.getMimeType(f.absolutePath),
        sizeBytes: f.sizeBytes,
        driveFolderId,
        status: 'pending' as const,
        progress: 0,
        bytesUploaded: 0,
        resumeUri: null,
        retryCount: 0,
        error: null,
      })
    }

    // Initialize session summary
    this.sessionSummary = {
      sessionId: config.sessionId,
      totalFiles: files.length,
      completedFiles: 0,
      failedFiles: 0,
      totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
      uploadedBytes: 0,
      status: 'uploading',
      driveFolderId: rootId,
      driveFolderUrl: `https://drive.google.com/drive/folders/${rootId}`,
    }

    this.isPaused = false
    this.emit('upload:started', { ...this.sessionSummary })

    // Process the queue
    await this.processQueue(token)

    // Finalize. `complete` is a claim that every file reached Drive, so
    // it is only available to a session where none failed. Anything else
    // is `partial`, and the renderer is responsible for saying so before
    // the user reaches for the card.
    if (this.sessionSummary) {
      this.sessionSummary.status = this.sessionSummary.failedFiles > 0 ? 'partial' : 'complete'
      this.emit('upload:complete', { ...this.sessionSummary })
    }

    return this.sessionSummary!
  }

  /** Pause the upload queue (in-flight uploads will finish) */
  pause(): void {
    this.isPaused = true
    if (this.sessionSummary) {
      this.sessionSummary.status = 'paused'
    }
  }

  /** Resume a paused queue */
  async resume(): Promise<void> {
    this.isPaused = false
    if (this.sessionSummary) {
      this.sessionSummary.status = 'uploading'
    }
    const token = await this.getToken()
    if (token) {
      await this.processQueue(token)
    }
  }

  /** Cancel all pending uploads */
  cancel(): void {
    for (const job of this.queue) {
      if (job.status === 'pending') {
        job.status = 'cancelled'
      }
    }
    this.isPaused = true
  }

  /** Get current session summary */
  getSummary(): UploadSessionSummary | null {
    return this.sessionSummary ? { ...this.sessionSummary } : null
  }

  // ── Queue Processor ──

  private async processQueue(token: string): Promise<void> {
    const promises: Promise<void>[] = []

    while (true) {
      if (this.isPaused) break

      // Fill up to MAX_CONCURRENT slots
      while (this.activeJobs.size < MAX_CONCURRENT) {
        const nextJob = this.queue.find(j => j.status === 'pending')
        if (!nextJob) break

        nextJob.status = 'uploading'
        this.activeJobs.set(nextJob.id, nextJob)

        const promise = this.uploadFile(nextJob, token)
          .then(() => {
            this.activeJobs.delete(nextJob.id)
          })
          .catch(() => {
            this.activeJobs.delete(nextJob.id)
          })

        promises.push(promise)
      }

      // If no active jobs and no pending jobs, we're done
      if (this.activeJobs.size === 0 && !this.queue.find(j => j.status === 'pending')) {
        break
      }

      // Wait for at least one job to complete before checking again
      if (this.activeJobs.size > 0) {
        await Promise.race(
          Array.from(this.activeJobs.values()).map(
            job => new Promise<void>(resolve => {
              const check = setInterval(() => {
                if (job.status !== 'uploading') {
                  clearInterval(check)
                  resolve()
                }
              }, 100)
            })
          )
        )
      }
    }

    // Wait for all remaining active jobs to finish
    await Promise.all(promises)
  }

  // ── Single File Upload ──

  private async uploadFile(job: UploadJob, token: string): Promise<void> {
    try {
      if (job.sizeBytes > RESUMABLE_THRESHOLD) {
        await this.resumableUpload(job, token)
      } else {
        await this.simpleUpload(job, token)
      }

      job.status = 'complete'
      job.progress = 100
      job.bytesUploaded = job.sizeBytes

      if (this.sessionSummary) {
        this.sessionSummary.completedFiles++
        this.sessionSummary.uploadedBytes += job.sizeBytes
      }

      this.emit('upload:file-done', { ...job })

    } catch (err) {
      const errorMsg = messageOf(err) || String(err)

      // Retry with exponential backoff + Connectivity Watch
      if (job.retryCount < MAX_RETRIES && this.isRetryableError(err)) {
        job.retryCount++
        job.status = 'pending'
        
        // Wait for active connectivity before retrying if it's a network error
        const hasNet = await this.checkConnectivity()
        const delay = Math.pow(2, job.retryCount) * 1000 + (hasNet ? Math.random() * 1000 : 5000)

        console.log(`[DriveUpload] Resilience Triggered: Retry ${job.retryCount}/${MAX_RETRIES} for ${job.fileName} in ${Math.round(delay)}ms`)
        this.emit('upload:error', { file: job.fileName, error: `Network Instability Detected. Retrying... (${job.retryCount}/${MAX_RETRIES})`, retryCount: job.retryCount })

        await new Promise(resolve => setTimeout(resolve, delay))
        return
      }

      // Permanent failure
      job.status = 'failed'
      job.error = errorMsg

      if (this.sessionSummary) {
        this.sessionSummary.failedFiles++
      }

      console.error(`[DriveUpload] Failed: ${job.fileName}, ${errorMsg}`)
      this.emit('upload:error', { file: job.fileName, error: errorMsg, retryCount: job.retryCount })
    }
  }

  // ── Simple Upload (< 5 MB) ──

  private async simpleUpload(job: UploadJob, token: string): Promise<void> {
    const fileContent = await fsp.readFile(job.filePath)

    const metadata = JSON.stringify({
      name: path.basename(job.filePath),
      parents: [job.driveFolderId],
    })

    const boundary = '===Cernix_Boundary==='
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${job.mimeType}\r\n\r\n`
      ),
      fileContent,
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Upload failed (${response.status}): ${errorBody}`)
    }

    // Emit final progress
    this.emitProgress(job, job.sizeBytes)
  }

  // ── Resumable Upload (> 5 MB) ──

  private async resumableUpload(job: UploadJob, token: string): Promise<void> {
    // Step 1: Initiate resumable upload session (if no resume URI)
    if (!job.resumeUri) {
      const metadata = JSON.stringify({
        name: path.basename(job.filePath),
        parents: [job.driveFolderId],
      })

      const initResponse = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': job.mimeType,
            'X-Upload-Content-Length': String(job.sizeBytes),
          },
          body: metadata,
        }
      )

      if (!initResponse.ok) {
        const errorBody = await initResponse.text()
        throw new Error(`Resumable init failed (${initResponse.status}): ${errorBody}`)
      }

      job.resumeUri = initResponse.headers.get('location')
      if (!job.resumeUri) {
        throw new Error('No upload URI returned from Google Drive')
      }
    }

    // Step 2: Upload file in chunks
    const fileHandle = await fsp.open(job.filePath, 'r')

    try {
      let offset = job.bytesUploaded

      while (offset < job.sizeBytes) {
        if (this.isPaused || job.status === 'cancelled') break

        const remaining = job.sizeBytes - offset
        const chunkLength = Math.min(CHUNK_SIZE, remaining)
        const buffer = Buffer.alloc(chunkLength)

        const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, offset)
        if (bytesRead === 0) break

        const chunk = buffer.subarray(0, bytesRead)
        const endByte = offset + bytesRead - 1

        const chunkResponse = await fetch(job.resumeUri, {
          method: 'PUT',
          headers: {
            'Content-Length': String(bytesRead),
            'Content-Range': `bytes ${offset}-${endByte}/${job.sizeBytes}`,
          },
          body: chunk,
        })

        // 308 = Resume Incomplete (more chunks needed)
        // 200/201 = Upload complete
        if (chunkResponse.status === 308) {
          offset += bytesRead
          job.bytesUploaded = offset
          this.emitProgress(job, offset)
        } else if (chunkResponse.ok) {
          // Upload complete
          offset = job.sizeBytes
          job.bytesUploaded = job.sizeBytes
          this.emitProgress(job, job.sizeBytes)
        } else {
          const errorBody = await chunkResponse.text()
          throw new Error(`Chunk upload failed (${chunkResponse.status}): ${errorBody}`)
        }
      }
    } finally {
      await fileHandle.close()
    }
  }

  // ── Drive Folder Management ──

  /**
   * Find an existing folder by name, or create it.
   * Returns the folder's Drive ID.
   */
  // ── Helpers ──

  private async scanStagingFolder(stagingPath: string): Promise<{ absolutePath: string; relativePath: string; sizeBytes: number }[]> {
    const results: { absolutePath: string; relativePath: string; sizeBytes: number }[] = []

    const scan = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await scan(fullPath)
        } else if (entry.isFile()) {
          try {
            const stat = await fsp.stat(fullPath)
            results.push({
              absolutePath: fullPath,
              relativePath: path.relative(stagingPath, fullPath),
              sizeBytes: stat.size,
            })
          } catch { /* skip unreadable files */ }
        }
      }
    }

    await scan(stagingPath)
    return results
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    return MIME_TYPES[ext] || 'application/octet-stream'
  }

  private emitProgress(job: UploadJob, bytesUploaded: number): void {
    job.bytesUploaded = bytesUploaded
    job.progress = Math.round((bytesUploaded / job.sizeBytes) * 100)

    this.emit('upload:progress', {
      jobId: job.id,
      file: job.fileName,
      percent: job.progress,
      bytesUploaded,
      totalBytes: job.sizeBytes,
    } as UploadProgress)
  }

  /**
   * Whether this failure is worth another attempt.
   *
   * Wrong in either direction costs the user a photograph or a wait.
   * Called retryable when it is not, the queue spends its attempts and
   * reports "network instability" for something that will never work.
   * Called permanent when it was transient, the file leaves the session
   * and the upload is reported finished without it.
   *
   * The status is parsed out of the `(NNN):` that every throw site in
   * this file formats, rather than matched as a substring of the whole
   * message. The message carries the filename and the byte counts, and
   * a substring test made `IMG_1500.ARW` a 500 and a quota of
   * `503316480 bytes` a 503, so a permanent failure retried until it
   * ran out of attempts.
   */
  private isRetryableError(err: unknown): boolean {
    const e = err as { message?: unknown; code?: unknown }
    const message = String(e?.message ?? '')
    const lower = message.toLowerCase()
    const code = String(e?.code ?? '').toLowerCase()

    // Transport failures, by errno where the platform supplies one.
    if (['econnreset', 'etimedout', 'enotfound', 'econnrefused', 'epipe', 'eai_again']
      .some(c => code.includes(c))) return true
    if (lower.includes('fetch failed') || lower.includes('timeout') || lower.includes('network')) return true

    const status = /\((\d{3})\):/.exec(message)?.[1]
    if (!status) return false

    // Too many requests, and anything the server admits is its own fault.
    if (status === '429' || status.startsWith('5')) return true

    // 403 is both "you may not" and "not so fast", and Drive returns it
    // for rate limiting as well as permission denial. Backing off is
    // right for the first and pointless for the second, so the reason
    // decides. Storage quota is deliberately absent: out of space is a
    // permanent condition that retrying only delays reporting.
    if (status === '403') return /rate ?limit ?exceeded/i.test(message)

    return false
  }

  /**
   * Resilience Heartbeat
   * Verifies Google Drive API is reachable before attempting a data burst.
   */
  private async checkConnectivity(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      
      const res = await fetch('https://www.googleapis.com/generate_204', { 
        signal: controller.signal 
      })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }

  private createSummary(sessionId: string, status: UploadSessionSummary['status']): UploadSessionSummary {
    return {
      sessionId,
      totalFiles: 0,
      completedFiles: 0,
      failedFiles: 0,
      totalBytes: 0,
      uploadedBytes: 0,
      status,
      driveFolderId: null,
      driveFolderUrl: null,
    }
  }
}
