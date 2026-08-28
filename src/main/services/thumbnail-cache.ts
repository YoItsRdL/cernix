import { nativeImage } from 'electron'
import fsp from 'node:fs/promises'
import { VIDEO_EXTS } from '../../shared/media-types'

/**
 * Thumbnail cache for the photo-grid hot path.
 *
 * The renderer used to load full-resolution JPEGs (4-5 MB each) into
 * `<img>` tags and let the browser scale them. With 1.8k+ files in
 * the Local Archive view that's hundreds of megabytes of decode + GPU
 * upload during a normal scroll. This service serves
 * `nativeImage.createThumbnailFromPath` results instead. The OS
 * thumbnailer is dramatically faster (Windows shell + macOS QuickLook
 * keep pre-rendered thumbnails) and produces ~30 KB JPEGs the
 * browser can blit instantly.
 *
 * Cache key includes mtime so renamed / re-encoded files re-thumbnail
 * automatically without manual invalidation. The bounded LRU caps
 * memory at ~60 MB worth of small JPEGs; oldest entries evict first.
 */
const THUMB_CACHE_MAX = 2000
const cache = new Map<string, Buffer>()

/** Formats whose pixel data Electron's `nativeImage.createThumbnailFromPath`
 *  can't decode. We don't even attempt OS thumbnailing for these. The
 *  protocol handler returns 404 and the renderer extracts a frame
 *  client-side via HTMLVideoElement instead. Keeping these out of the
 *  raw-bytes fallback path also stops the LRU from being poisoned by
 *  multi-MB video files.
 *
 *  Sourced from `src/shared/media-types.ts` so renderer + main stay
 *  in lock-step. */
const UNTHUMBNAILABLE_EXTS = new Set<string>(VIDEO_EXTS)

/** Sentinel error thrown when the path is a known-unthumbnailable
 *  format. The protocol handler maps this to a 404 so the renderer
 *  can fall through to its own thumbnail strategy. */
export class UnthumbnailableError extends Error {
  constructor(public readonly ext: string) {
    super(`No thumbnail available for .${ext} files`)
    this.name = 'UnthumbnailableError'
  }
}

/** Insert with LRU eviction. `Map` preserves insertion order, so
 *  deleting the head is the oldest entry. */
function setLru(key: string, value: Buffer): void {
  if (cache.has(key)) cache.delete(key) // move-to-front on overwrite
  cache.set(key, value)
  while (cache.size > THUMB_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function touchLru(key: string): Buffer | undefined {
  const v = cache.get(key)
  if (v === undefined) return undefined
  // Move to most-recently-used position.
  cache.delete(key)
  cache.set(key, v)
  return v
}

/**
 * Returns a JPEG thumbnail buffer for `absolutePath` at `maxEdge`
 * pixels on the long side. Falls back to the file's raw bytes if the
 * OS thumbnailer can't render the format (RAW, HEIC on some
 * Windows builds, etc.). The browser will still scale the original,
 * which is no worse than the pre-thumbnail behaviour.
 */
export async function getThumbnail(
  absolutePath: string,
  maxEdge: number,
): Promise<{ buffer: Buffer; mime: string }> {
  const ext = absolutePath.split('.').pop()?.toLowerCase() ?? ''
  if (UNTHUMBNAILABLE_EXTS.has(ext)) {
    // Don't waste an LRU slot caching the full video file's bytes.
    // The OS thumbnailer can't decode them and the renderer
    // bypasses this endpoint for videos anyway.
    throw new UnthumbnailableError(ext)
  }
  const stat = await fsp.stat(absolutePath)
  const key = `${absolutePath}:${stat.mtimeMs}:${maxEdge}`
  const cached = touchLru(key)
  if (cached) return { buffer: cached, mime: 'image/jpeg' }

  // Serve the raw file when the OS thumbnailer can't help. The
  // browser's scaler is the safety net. Not cached: THUMB_CACHE_MAX
  // bounds entry count, not bytes, so 20 MB RAW files would poison the
  // LRU the same way videos do. There's no decode work to memoise here
  // anyway.
  const passthrough = async () => {
    const raw = await fsp.readFile(absolutePath)
    // Keep the mime broad so the browser does its own sniffing; the
    // protocol-handler caller can override per the file extension if
    // we ever decide to be precise.
    return { buffer: raw, mime: 'application/octet-stream' }
  }

  // Two failure modes, both ending in the passthrough: an empty image
  // for formats the shell recognises but can't render, and a rejection
  // when no shell codec is registered at all (Sony .ARW on a stock
  // Windows install).
  let img: Electron.NativeImage
  try {
    img = await nativeImage.createThumbnailFromPath(absolutePath, {
      width: maxEdge,
      height: maxEdge,
    })
  } catch {
    return passthrough()
  }

  if (img.isEmpty()) return passthrough()

  const buf = img.toJPEG(80)
  setLru(key, buf)
  return { buffer: buf, mime: 'image/jpeg' }
}
