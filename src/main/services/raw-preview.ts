/**
 * The picture inside a RAW file (F-046).
 *
 * A RAW file is the sensor's data, which a browser cannot show and a thumbnailer
 * rarely can. Nearly every camera also writes an ordinary JPEG into it, so the
 * camera's own screen has something to display, and the file's author put it
 * there to be used. Where it lives differs by maker: Nikon, Panasonic, Pentax
 * and Samsung in JpgFromRaw, Canon CR2, Fuji and Sony in PreviewImage, Olympus
 * in its maker notes (also PreviewImage), and a Canon CR3 has both a small
 * PreviewImage and a full-size JpgFromRaw. So all are asked about, and the
 * largest real JPEG wins.
 *
 * Some files have none: a Leica DNG here carries only a 320 x 240 thumbnail
 * as raw pixels. Those return nothing, and the tile keeps its icon.
 */
import { exiftool } from 'exiftool-vendored'
import { normaliseOrientation } from './orient'

export interface RawPreview {
  jpeg: Buffer
  /** EXIF Orientation of the RAW, 1 to 8. */
  orientation: number
  /** Which tag the picture came from. */
  tag: string
}

const CANDIDATES = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage', 'OtherImage'] as const
/** Below this a "preview" is an icon, not a picture. */
const MIN_BYTES = 8 * 1024
const READ_TIMEOUT_MS = 8000

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

/** "(Binary data 703881 bytes, use -b option to extract)" -> 703881. */
export function binarySize(text: unknown): number {
  const m = typeof text === 'string' ? /Binary data (\d+) bytes/.exec(text) : null
  return m ? Number(m[1]) : 0
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS)),
  ])
}

export async function readRawPreview(absolutePath: string): Promise<RawPreview | null> {
  let tags: Record<string, unknown>
  try {
    // Not `-fast`: it skips the maker notes, which is where Olympus keeps its preview.
    tags = await withTimeout(exiftool.readRaw(absolutePath, {
      // The main image's orientation. A RAW can carry a second one in the
      // preview's own IFD, which says upright whatever the camera was doing.
      readArgs: [...CANDIDATES.map(c => `-${c}`), '-IFD0:Orientation#'],
    })) as unknown as Record<string, unknown>
  } catch {
    return null
  }
  const orientation = normaliseOrientation(tags['Orientation'])
  const ranked = CANDIDATES
    .map(tag => ({ tag, size: binarySize(tags[tag]) }))
    .filter(c => c.size >= MIN_BYTES)
    .sort((a, b) => b.size - a.size)
  for (const { tag } of ranked) {
    try {
      const jpeg = await withTimeout(exiftool.extractBinaryTagToBuffer(tag, absolutePath))
      if (isJpeg(jpeg)) return { jpeg, orientation, tag }
    } catch { /* try the next one */ }
  }
  return null
}
