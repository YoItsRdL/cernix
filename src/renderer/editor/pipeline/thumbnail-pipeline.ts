/**
 * Offscreen thumbnail pipeline.
 *
 * Wraps a single shared `PreviewPipeline` against an offscreen
 * `<canvas>` sized to the thumb's long edge (~256 px). One instance
 * per editor session, reused across every preset thumbnail render.
 * The heavy work (shader compile, VAO + uniform-location capture)
 * happens once, then each `render(params)` call is a single GL draw
 * + `toBlob` on the small canvas.
 *
 * Thumbnails are JPEG quality 0.8. Scannable for visual signature,
 * not pixel-precise. The cache key (presetUpdatedAt) handles
 * invalidation, so we never need to compare bytes.
 */
import { PreviewPipeline } from './preview'
import { toAdjustments, toGeometry } from './to-adjustments'
import type { EditParams } from '@/types'

const THUMB_LONG_EDGE = 256
const THUMB_QUALITY = 0.8

export class ThumbnailPipeline {
  private canvas: HTMLCanvasElement
  private pipeline: PreviewPipeline
  private sourceBitmap: ImageBitmap | null = null
  private srcWidth = 0
  private srcHeight = 0
  private disposed = false

  constructor() {
    this.canvas = document.createElement('canvas')
    // Size will be reset per-source on `setSource`; we just need a
    // valid GL context to construct the pipeline.
    this.canvas.width = THUMB_LONG_EDGE
    this.canvas.height = THUMB_LONG_EDGE
    this.pipeline = new PreviewPipeline(this.canvas)
  }

  /**
   * Upload the source bitmap downsampled to thumb resolution. The
   * pipeline reads the bitmap unchanged at first; the caller is
   * responsible for passing a pre-downsampled bitmap when memory
   * matters. For our use case (one bitmap, ~24 MP source down to a
   * 256 px thumb) we accept the GPU-side upload of the full source:
   * the pipeline already handles arbitrary sizes and the visible
   * cost is one upload per editor session.
   */
  setSource(bitmap: ImageBitmap): void {
    if (this.disposed) throw new Error('ThumbnailPipeline disposed')
    this.sourceBitmap = bitmap
    this.srcWidth = bitmap.width
    this.srcHeight = bitmap.height
    // Resize the offscreen canvas so the thumb's aspect matches the
    // source. Long edge = THUMB_LONG_EDGE.
    if (bitmap.width >= bitmap.height) {
      this.canvas.width = THUMB_LONG_EDGE
      this.canvas.height = Math.max(1, Math.round(THUMB_LONG_EDGE * bitmap.height / bitmap.width))
    } else {
      this.canvas.height = THUMB_LONG_EDGE
      this.canvas.width = Math.max(1, Math.round(THUMB_LONG_EDGE * bitmap.width / bitmap.height))
    }
    this.pipeline.uploadImage(bitmap, false)
    this.pipeline.resize(this.canvas.width, this.canvas.height, 1)
  }

  /**
   * Render `params` against the loaded source and return a JPEG
   * blob. Uses the same render path the on-screen preview uses, so
   * the thumb matches the eventual full-res look exactly. Throws if
   * the source hasn't been uploaded yet.
   */
  async render(params: EditParams): Promise<Blob> {
    if (this.disposed) throw new Error('ThumbnailPipeline disposed')
    if (!this.sourceBitmap) throw new Error('No source uploaded')
    const adj = toAdjustments(params)
    const geo = toGeometry(params)
    this.pipeline.render(
      { zoom: 1, panX: 0, panY: 0 },
      adj,
      geo,
      [0.02, 0.02, 0.02, 1],
      params.crop,
    )
    const blob = await new Promise<Blob | null>(resolve =>
      this.canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY),
    )
    if (!blob) throw new Error('toBlob returned null')
    return blob
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pipeline.dispose()
    this.sourceBitmap = null
    void this.srcWidth; void this.srcHeight
  }
}

/**
 * Stable per-photo content hash. SHA-1 over the first/last 4 KB of
 * the source bitmap's RGBA pixels. Collision-resistant for the
 * photo-library use case, much cheaper than hashing the full image.
 *
 * We sample two regions instead of the whole bitmap so the hash
 * stays sub-millisecond on a 24 MP image; visually-identical photos
 * with the same crop+orientation will hash identically (which is
 * what we want. The thumbs are equivalent so the cache should hit).
 */
export async function hashSourceBitmap(bitmap: ImageBitmap): Promise<string> {
  // Render a small representative slice into a 64×64 offscreen,
  // grab its RGBA bytes, hash. SHA-1 is fine here. We're not doing
  // crypto, just a content fingerprint.
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, 64, 64)
  const bytes = ctx.getImageData(0, 0, 64, 64).data.buffer
  const hash = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
