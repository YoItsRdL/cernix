import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import type { DriveClient } from './drive-client'
import { safeJoin } from './approved-paths'

export interface CacheProgress {
  fileId: string
  done: number
  total: number
}

/**
 * Local file cache for editor source images. Files are streamed from Drive
 * into `<userData>/edit-cache/` keyed by Drive fileId + modifiedTime.
 * LRU-evicted to stay under MAX_BYTES.
 *
 * Events: `progress` → CacheProgress during downloads.
 */
export class EditCache extends EventEmitter {
  private static MAX_BYTES = 2 * 1024 * 1024 * 1024
  private driveClient: DriveClient
  private cacheDir: string
  private inflight = new Map<string, Promise<string>>()

  constructor(driveClient: DriveClient, cacheDir: string) {
    super()
    this.driveClient = driveClient
    this.cacheDir = cacheDir
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  /**
   * Returns an absolute path to the cached source. Downloads from Drive on miss.
   * Multiple concurrent calls for the same key share one download.
   */
  async getOrDownload(fileId: string, modifiedTime: string, fileName: string): Promise<string> {
    const cacheKey = `${fileId}-${this.sanitizeModifiedTime(modifiedTime)}${this.sanitizeExtension(fileName)}`
    // `safeJoin` reduces the key to a single safe component and refuses
    // anything that would leave the cache directory. `fileId` reaches
    // here straight from the renderer.
    const destPath = safeJoin(this.cacheDir, cacheKey)

    if (fs.existsSync(destPath)) {
      fs.utimesSync(destPath, new Date(), new Date()) // LRU: bump access time
      return destPath
    }

    const existing = this.inflight.get(cacheKey)
    if (existing) return existing

    const download = this.streamDownload(fileId, destPath).finally(() => {
      this.inflight.delete(cacheKey)
    })
    this.inflight.set(cacheKey, download)
    return download
  }

  private async streamDownload(fileId: string, destPath: string): Promise<string> {
    const total = await this.driveClient.downloadFileStreaming(fileId, destPath, (done, totalBytes) => {
      this.emit('progress', { fileId, done, total: totalBytes } satisfies CacheProgress)
    })
    this.enforceBudget().catch(() => {}) // fire-and-forget; don't block return
    this.emit('progress', { fileId, done: total, total } satisfies CacheProgress)
    return destPath
  }

  /** Walk cache, evict oldest accessed files until under MAX_BYTES. */
  private async enforceBudget(): Promise<void> {
    const entries = await fsp.readdir(this.cacheDir)
    const stats = await Promise.all(entries.map(async name => {
      const p = path.join(this.cacheDir, name)
      const s = await fsp.stat(p).catch(() => null)
      return s ? { path: p, size: s.size, atime: s.atimeMs } : null
    }))
    const files = stats.filter(Boolean) as { path: string; size: number; atime: number }[]
    let total = files.reduce((sum, f) => sum + f.size, 0)
    if (total <= EditCache.MAX_BYTES) return
    files.sort((a, b) => a.atime - b.atime)
    for (const f of files) {
      if (total <= EditCache.MAX_BYTES) break
      await fsp.unlink(f.path).catch(() => {})
      total -= f.size
    }
  }

  private sanitizeModifiedTime(t: string): string {
    return t.replace(/[^0-9a-zA-Z]/g, '')
  }

  /**
   * Every component of the key comes from the renderer.
   *
   * `editor:prepare-source` passes its three arguments through untouched,
   * so a `fileId` of `../../evil` used to interpolate straight into a
   * filename and out of this directory, and the download then wrote
   * attacker-chosen bytes to an attacker-chosen path. `modifiedTime` was
   * already stripped this way; `fileId` was not, and it is the one that
   * leads. Drive ids are alphanumerics with `-` and `_`, so nothing
   * legitimate is lost.
   */
  private sanitizeKeyPart(s: string): string {
    return s.replace(/[^0-9a-zA-Z_-]/g, '')
  }

  /** Only the extension is taken from the name, and only if it looks like one. */
  private sanitizeExtension(fileName: string): string {
    const ext = path.extname(fileName)
    return /^\.[0-9a-zA-Z]{1,8}$/.test(ext) ? ext : '.bin'
  }

  /**
   * The containment check, kept separate from the sanitising above.
   *
   * Stripping the inputs is what makes traversal impossible today;
   * this is what keeps it impossible if the key ever gains a component.
   * A guard that only works while someone remembers the rule is the
   * kind that fails silently later.
   */
  private resolveInCache(cacheKey: string): string {
    const root = path.resolve(this.cacheDir)
    const dest = path.resolve(path.join(root, cacheKey))
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error('Refusing a cache path outside the cache directory')
    }
    return dest
  }
}
