import { app } from 'electron'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { safeJoin } from './approved-paths'

/**
 * Preset thumbnail cache.
 *
 * Lives at `userData/preset-thumbs/<sourceHash>/<presetId>.jpg`. The
 * renderer-side thumbnail pipeline produces small JPEGs (~256 px on
 * the long edge) of the current photo with each preset applied; we
 * persist them so re-opening the preset panel for the same photo is
 * instant on the second-and-later visits.
 *
 * Cache key. (sourceHash, presetId, presetUpdatedAt). `sourceHash`
 * scopes the cache per-photo, `presetId` per-preset, and
 * `presetUpdatedAt` invalidates the relevant thumbs when a preset is
 * renamed or re-saved without nuking the rest. The updatedAt
 * timestamp lives in a sidecar JSON file alongside the per-photo
 * thumb directory; on a put for a stale timestamp, the previous
 * thumb is overwritten in place.
 *
 * Eviction. A simple total-size cap (default 500 MB) checked on
 * every put. When the cache exceeds the cap, the oldest per-photo
 * directory (by mtime of its sidecar JSON) is deleted in full.
 * Coarser than per-thumb LRU, but the directory granularity matches
 * how users actually evict (close one photo's library worth of
 * thumbs at a time).
 */

const CACHE_DIR_NAME = 'preset-thumbs'
const SIDECAR_NAME = '.timestamps.json'
const DEFAULT_CAP_BYTES = 500 * 1024 * 1024
const CACHE_CAP = process.env.CERNIX_PRESET_THUMB_CACHE_CAP
  ? Number(process.env.CERNIX_PRESET_THUMB_CACHE_CAP)
  : DEFAULT_CAP_BYTES

interface SidecarPayload {
  /** presetId → presetUpdatedAt ISO string. Used for invalidation. */
  presets: Record<string, string>
  /** Last write time, used by the eviction sweep to pick the oldest
   *  per-photo directory. */
  lastWrite: string
}

function cacheRoot(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME)
}

// `sourceHash` and `presetId` both arrive from the renderer through
// `preset-thumb:get` / `preset-thumb:put`, and the put writes bytes.
function photoDir(sourceHash: string): string {
  return safeJoin(cacheRoot(), sourceHash)
}

function thumbPath(sourceHash: string, presetId: string): string {
  return safeJoin(photoDir(sourceHash), `${presetId}.jpg`)
}

function sidecarPath(sourceHash: string): string {
  return safeJoin(photoDir(sourceHash), SIDECAR_NAME)
}

async function readSidecar(sourceHash: string): Promise<SidecarPayload | null> {
  try {
    const raw = await fsp.readFile(sidecarPath(sourceHash), 'utf8')
    const parsed = JSON.parse(raw) as SidecarPayload
    if (!parsed.presets || typeof parsed.lastWrite !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

async function writeSidecar(sourceHash: string, payload: SidecarPayload): Promise<void> {
  await fsp.writeFile(sidecarPath(sourceHash), JSON.stringify(payload), 'utf8')
}

/**
 * Returns the cached thumbnail bytes if (a) the file exists and
 * (b) the sidecar's `presets[presetId]` matches the requested
 * `presetUpdatedAt`. Any mismatch is treated as a miss. The caller
 * will re-render and put.
 */
export async function getPresetThumb(
  sourceHash: string,
  presetId: string,
  presetUpdatedAt: string,
): Promise<Buffer | null> {
  const sidecar = await readSidecar(sourceHash)
  if (!sidecar) return null
  if (sidecar.presets[presetId] !== presetUpdatedAt) return null
  try {
    return await fsp.readFile(thumbPath(sourceHash, presetId))
  } catch {
    return null
  }
}

/**
 * Persist `bytes` for `(sourceHash, presetId)` and stamp the
 * sidecar with `presetUpdatedAt`. Triggers an eviction sweep
 * post-write when the on-disk total exceeds the cap.
 */
export async function putPresetThumb(
  sourceHash: string,
  presetId: string,
  presetUpdatedAt: string,
  bytes: Buffer,
): Promise<void> {
  await fsp.mkdir(photoDir(sourceHash), { recursive: true })
  await fsp.writeFile(thumbPath(sourceHash, presetId), bytes)
  const sidecar = (await readSidecar(sourceHash)) ?? { presets: {}, lastWrite: new Date().toISOString() }
  sidecar.presets[presetId] = presetUpdatedAt
  sidecar.lastWrite = new Date().toISOString()
  await writeSidecar(sourceHash, sidecar)
  // Async fire-and-forget eviction. Don't block the put on the sweep.
  void evictIfOverCap()
}

/**
  * Walk the cache root, sum file sizes, and if we're over the cap,
  * delete the oldest per-photo directory. One pass per put. At
  * steady-state the cache hovers at the cap.
  */
async function evictIfOverCap(): Promise<void> {
  const root = cacheRoot()
  if (!fs.existsSync(root)) return
  const entries = await fsp.readdir(root, { withFileTypes: true })
  const photoDirs: { hash: string; size: number; lastWrite: number }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const sidecar = await readSidecar(entry.name)
    if (!sidecar) continue
    let size = 0
    const files = await fsp.readdir(dir)
    for (const f of files) {
      const stat = await fsp.stat(path.join(dir, f)).catch(() => null)
      if (stat?.isFile()) size += stat.size
    }
    photoDirs.push({
      hash: entry.name,
      size,
      lastWrite: new Date(sidecar.lastWrite).getTime(),
    })
  }
  let total = photoDirs.reduce((s, d) => s + d.size, 0)
  if (total <= CACHE_CAP) return
  // Oldest first.
  photoDirs.sort((a, b) => a.lastWrite - b.lastWrite)
  for (const d of photoDirs) {
    if (total <= CACHE_CAP) break
    await fsp.rm(path.join(root, d.hash), { recursive: true, force: true })
    total -= d.size
  }
}
