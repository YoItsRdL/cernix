/**
 * A RAW file's embedded preview, sized and turned to be shown (F-046).
 *
 * Electron-side, because decoding and encoding the JPEG is nativeImage's job.
 * The pure parts, finding the preview and turning the pixels, are in
 * raw-preview.ts and orient.ts, where they can be tested without Electron.
 */
import { nativeImage } from 'electron'
import { orientBitmap } from './orient'
import type { RawPreview } from './raw-preview'

/**
 * `maxEdge` shrinks the long side to that, never enlarges; null keeps the
 * size. A preview that is already upright and not being shrunk goes out as
 * the camera wrote it, untouched.
 */
export function renderRawPreview(pv: RawPreview, maxEdge: number | null, quality: number): Buffer {
  const decoded = nativeImage.createFromBuffer(pv.jpeg)
  if (decoded.isEmpty()) throw new Error('The preview in this file could not be decoded.')
  const { width, height } = decoded.getSize()
  const long = Math.max(width, height)
  const shrink = maxEdge !== null && long > maxEdge

  if (!shrink && pv.orientation === 1) return pv.jpeg

  const sized = shrink
    ? decoded.resize({ width: Math.max(1, Math.round(width * maxEdge! / long)), height: Math.max(1, Math.round(height * maxEdge! / long)), quality: 'good' })
    : decoded
  const size = sized.getSize()
  if (pv.orientation === 1) return sized.toJPEG(quality)

  const turned = orientBitmap({ data: sized.toBitmap(), width: size.width, height: size.height }, pv.orientation)
  return nativeImage.createFromBitmap(turned.data, { width: turned.width, height: turned.height }).toJPEG(quality)
}
