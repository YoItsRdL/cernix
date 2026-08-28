/**
 * Renderer-side resolver: maps frame-preset IDs to bundled asset URLs.
 * Vite's `?url` import suffix gives a hashed URL that survives the build.
 * Kept separate from `shared/frame-presets.ts` so the main process can
 * read the metadata table without trying to import PNGs.
 */
import classicUrl from './assets/frames/classic-1440.png?url'
import storyLandscapeUrl from './assets/frames/story-landscape-1080x1920.png?url'
import storyPortraitUrl from './assets/frames/story-portrait-1080x1920.png?url'
import landscapeUrl from './assets/frames/landscape-1300x971.png?url'

const URLS: Record<string, string> = {
  'classic-1440': classicUrl,
  'story-landscape': storyLandscapeUrl,
  'story-portrait': storyPortraitUrl,
  'landscape-1300x971': landscapeUrl,
}

export function frameAssetUrl(id: string): string | null {
  return URLS[id] ?? null
}

/** Decode a frame PNG into an ImageBitmap once and cache it by id. */
const bitmapCache = new Map<string, Promise<ImageBitmap>>()
export function loadFrameBitmap(id: string): Promise<ImageBitmap> {
  let p = bitmapCache.get(id)
  if (p) return p
  const url = frameAssetUrl(id)
  if (!url) return Promise.reject(new Error(`Unknown frame id: ${id}`))
  p = fetch(url).then(r => r.blob()).then(b => createImageBitmap(b))
  bitmapCache.set(id, p)
  return p
}
