/**
 * Brush stroke rasteriser. Walks a vector stroke list (saved in the
 * EditParams sidecar) and paints it into an off-screen Canvas2D, then
 * pulls the alpha channel out as a Uint8Array ready to upload as a
 * single-channel WebGL texture.
 *
 * Vectors live in the schema (not bitmaps) so the mask resamples
 * cleanly at any zoom and the XMP stays human-readable. We keep the
 * raster cache small (typically 512px on the long edge) because the
 * mask only needs to drive a per-pixel weight in [0..1] and the eye
 * doesn't care about sub-pixel mask edges at preview scale.
 */
import type { BrushStroke } from '@/types'

/** Long edge of the rasterised mask in pixels. Bigger = sharper mask
 *  edge but more upload cost. 512 keeps us well under the per-frame
 *  budget at 1440p preview while still resolving fine brush detail. */
export const BRUSH_MASK_LONG_EDGE = 512

export interface BrushMaskBitmap {
  /** RGBA8 pixel buffer ready for gl.texImage2D. R=G=B=255, A=mask. */
  data: Uint8Array
  width: number
  height: number
}

/**
 * Returns the rasterised mask bitmap for a stroke list against an
 * image of dimensions `imageWidth × imageHeight`. Stroke positions
 * and radii are normalised against the image's longer edge so the
 * mask travels with the source.
 *
 * Returns `null` when the stroke list is empty. Caller should treat
 * that as "no brush mask, use weight 0 everywhere."
 */
export function rasteriseBrushStrokes(
  strokes: BrushStroke[],
  imageWidth: number,
  imageHeight: number,
): BrushMaskBitmap | null {
  if (!strokes.length) return null
  const aspect = imageWidth / Math.max(1, imageHeight)
  const w = aspect >= 1 ? BRUSH_MASK_LONG_EDGE : Math.round(BRUSH_MASK_LONG_EDGE * aspect)
  const h = aspect >= 1 ? Math.round(BRUSH_MASK_LONG_EDGE / aspect) : BRUSH_MASK_LONG_EDGE
  const longEdge = Math.max(w, h)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.clearRect(0, 0, w, h)

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue
    const radiusPx = Math.max(1, stroke.radius * longEdge)
    // Hardness 0 = soft Gaussian falloff (low alpha edge), hardness 1
    // = hard circular splat. Map to a radial gradient: stop at
    // `hardness` keeps the centre solid; everything past it falls to 0.
    const hardness = Math.max(0, Math.min(1, stroke.hardness))
    const opacity  = Math.max(0, Math.min(1, stroke.opacity))
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'

    // Walk the polyline and stamp at sub-radius spacing so sparse pointer
    // samples still look like a continuous brush. Spacing of radius/4
    // produces visually smooth strokes without going overboard on stamps.
    const stampSpacing = Math.max(1, radiusPx * 0.25)
    let lastX = stroke.points[0].x * w
    let lastY = stroke.points[0].y * h
    stamp(ctx, lastX, lastY, radiusPx, hardness, opacity)

    for (let i = 1; i < stroke.points.length; i++) {
      const x = stroke.points[i].x * w
      const y = stroke.points[i].y * h
      const dx = x - lastX
      const dy = y - lastY
      const dist = Math.hypot(dx, dy)
      const stamps = Math.max(1, Math.floor(dist / stampSpacing))
      for (let s = 1; s <= stamps; s++) {
        const t = s / stamps
        stamp(ctx, lastX + dx * t, lastY + dy * t, radiusPx, hardness, opacity)
      }
      lastX = x
      lastY = y
    }
  }

  const img = ctx.getImageData(0, 0, w, h)
  return { data: new Uint8Array(img.data.buffer), width: w, height: h }
}

function stamp(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  radius: number, hardness: number, opacity: number,
): void {
  const innerStop = hardness * 0.95
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
  // Centre stays at full per-stroke opacity until `innerStop`, then
  // falls to zero at the edge. The bigger `hardness`, the wider the
  // solid core.
  grad.addColorStop(0, `rgba(255,255,255,${opacity})`) // design-allow: brush feathering gradient on canvas, not a UI surface
  grad.addColorStop(innerStop, `rgba(255,255,255,${opacity})`) // design-allow: brush feathering gradient on canvas, not a UI surface
  grad.addColorStop(1, 'rgba(255,255,255,0)') // design-allow: brush feathering gradient on canvas, not a UI surface
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}
