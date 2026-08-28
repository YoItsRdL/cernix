import { exiftool, Tags } from 'exiftool-vendored'

export interface MediaMetadata {
  make?: string
  model?: string
  lens?: string
  focalLength?: string
  aperture?: string
  iso?: number
  shutterSpeed?: string
  createDate?: string
  width?: number
  height?: number
  megapixels?: number
}

/** Reads EXIF off a file: capture date, dimensions, ISO, camera. The
 *  capture date is what the ingest files a photograph by. */
export class MetadataExtractor {
  /**
   * Extract key organizational metadata from a single file.
   * Supports RAW, JPEG, and Sidecar files.
   */
  async extract(filePath: string): Promise<MediaMetadata> {
    try {
      const tags: Tags = await Promise.race([
        exiftool.read(filePath),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('EXIF read timeout')), 5000))
      ])

      const w = tags.ImageWidth
      const h = tags.ImageHeight
      return {
        make: tags.Make,
        model: tags.Model,
        lens: tags.LensModel || tags.Lens,
        focalLength: tags.FocalLength,
        aperture: tags.Aperture ? `f/${tags.Aperture}` : undefined,
        iso: tags.ISO,
        shutterSpeed: tags.ShutterSpeed,
        createDate: tags.CreateDate
          ? (typeof tags.CreateDate === 'object' && 'toDate' in tags.CreateDate
              ? (tags.CreateDate as { toDate(): Date }).toDate().toISOString()
              : String(tags.CreateDate))
          : undefined,
        width: w,
        height: h,
        megapixels: w && h ? Math.round((w * h) / 1_000_000 * 10) / 10 : undefined,
      }
    } catch {
      // Silently skip files that fail or timeout
      return {}
    }
  }

  /**
   * Batch extract from a sample of files to prevent UI lag.
   */
  async extractSample(filePaths: string[], limit = 5): Promise<MediaMetadata[]> {
    const sample = filePaths.slice(0, limit)
    const results = await Promise.all(sample.map(p => this.extract(p)))
    return results.filter(r => Object.keys(r).length > 0)
  }

  /**
   * Batch extract metadata for all files with concurrency limit.
   * Returns a Map keyed by file path for fast lookup.
   */
  async extractBatch(
    filePaths: string[],
    concurrency = 16,
    onProgress?: (done: number, total: number) => void
  ): Promise<Map<string, MediaMetadata>> {
    const results = new Map<string, MediaMetadata>()
    let done = 0
    const total = filePaths.length

    // Fire initial progress immediately so the UI isn't stuck at 0
    onProgress?.(0, total)

    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency)
      const extracted = await Promise.allSettled(batch.map(p => this.extract(p)))
      batch.forEach((p, j) => {
        const result = extracted[j]
        if (result.status === 'fulfilled' && Object.keys(result.value).length > 0) {
          results.set(p, result.value)
        }
      })
      done += batch.length
      onProgress?.(Math.min(done, total), total)
      // Yield to event loop so IPC messages can flush to renderer
      await new Promise(r => setImmediate(r))
    }

    return results
  }

  async close(): Promise<void> {
    await exiftool.end()
  }
}
