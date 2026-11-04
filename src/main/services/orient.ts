/**
 * Turning a picture the way its EXIF Orientation says (F-046).
 *
 * A RAW file's embedded preview is the sensor's picture, and the camera
 * says which way up it was held in the file's Orientation tag: 6 is "rotate
 * 90 degrees clockwise to view", 8 is the other way, 3 is upside down. The
 * preview, once decoded to pixels and written out again, carries no such
 * tag, so the turn has to be made on the pixels.
 *
 * Works on a 4-byte-per-pixel bitmap in any channel order, since a pixel is
 * only moved, never read.
 */

export interface Bitmap {
  data: Buffer
  width: number
  height: number
}

/** EXIF orientations 1 to 8. Anything else counts as 1. */
export function normaliseOrientation(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 1
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1
}

/** Source coordinates of the pixel that lands at (x, y) in the result. */
function sourceOf(orientation: number, x: number, y: number, w: number, h: number): [number, number] {
  switch (orientation) {
    case 2: return [w - 1 - x, y]               // mirrored horizontally
    case 3: return [w - 1 - x, h - 1 - y]       // rotated 180
    case 4: return [x, h - 1 - y]               // mirrored vertically
    // The next four swap width and height: x, y here are in the turned picture.
    case 5: return [y, x]                       // transposed
    case 6: return [y, h - 1 - x]               // rotate 90 clockwise
    case 7: return [w - 1 - y, h - 1 - x]       // transverse
    case 8: return [w - 1 - y, x]               // rotate 90 counter-clockwise
    default: return [x, y]
  }
}

export function orientBitmap(src: Bitmap, orientationRaw: unknown): Bitmap {
  const orientation = normaliseOrientation(orientationRaw)
  if (orientation === 1) return src
  const swaps = orientation >= 5
  const width = swaps ? src.height : src.width
  const height = swaps ? src.width : src.height
  const out = Buffer.allocUnsafe(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [sx, sy] = sourceOf(orientation, x, y, src.width, src.height)
      src.data.copy(out, (y * width + x) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4)
    }
  }
  return { data: out, width, height }
}
