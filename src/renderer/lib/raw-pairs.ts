/**
 * RAW+JPEG pairs (decision 25).
 *
 * A camera set to RAW+JPEG writes two files for one shot: IMG_0001.CR2 and
 * IMG_0001.JPG, side by side. They are one photograph, so the review shows
 * one tile for them, and what is done to the tile is done to both files:
 * ticked, rated, imported, trashed.
 *
 * A pair is a RAW and a JPEG in the same folder with the same name apart
 * from the extension, compared without regard to case. The JPEG is the
 * tile (it is the camera's own rendering and decodes at once); the RAW is
 * its companion and has no tile of its own. Anything else stays alone,
 * including a second JPEG with the same stem.
 */
import { isRawPath } from '@/../shared/media-types'

const JPEG_RE = /\.jpe?g$/i

export interface PairIndex {
  /** The tile's path -> the RAW that goes with it. */
  companionOf: Map<string, string>
  /** The RAW's path -> the tile it hides behind. */
  tileOf: Map<string, string>
}

/** Folder and name without extension, lower-cased, with either separator. */
function stemKey(relativePath: string): string {
  const cut = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  const dir = relativePath.slice(0, cut + 1)
  const name = relativePath.slice(cut + 1)
  const dot = name.lastIndexOf('.')
  return (dir + (dot > 0 ? name.slice(0, dot) : name)).toLowerCase()
}

export function findPairs(paths: readonly string[]): PairIndex {
  const raws = new Map<string, string[]>()
  const jpegs = new Map<string, string[]>()
  for (const p of paths) {
    const bucket = isRawPath(p) ? raws : JPEG_RE.test(p) ? jpegs : null
    if (!bucket) continue
    const key = stemKey(p)
    bucket.set(key, [...(bucket.get(key) ?? []), p])
  }
  const companionOf = new Map<string, string>()
  const tileOf = new Map<string, string>()
  for (const [key, rawList] of raws) {
    const jpegList = jpegs.get(key)
    // Exactly one of each. Two RAWs or two JPEGs of one name is not a pair
    // anyone can name, and guessing could hide a photograph.
    if (!jpegList || rawList.length !== 1 || jpegList.length !== 1) continue
    companionOf.set(jpegList[0], rawList[0])
    tileOf.set(rawList[0], jpegList[0])
  }
  return { companionOf, tileOf }
}

/** What the person sees ticked, as the files it stands for: a tile brings its RAW. */
export function withCompanions(paths: readonly string[], pairs: PairIndex): string[] {
  const out = new Set(paths)
  for (const p of paths) {
    const raw = pairs.companionOf.get(p)
    if (raw) out.add(raw)
  }
  return [...out]
}

/** Every file a set of tiles stands for, to test a selection against. */
export function filesOfTiles(tiles: readonly string[], pairs: PairIndex): Set<string> {
  return new Set(withCompanions(tiles, pairs))
}
