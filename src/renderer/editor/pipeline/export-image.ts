/**
 * Full-resolution export. Spins up a temporary off-screen `PreviewPipeline`
 * sized to the export rect, runs the same render path the on-screen
 * preview uses (so what you see is what you get), then optionally
 * composes onto a frame card or downscales to a target long-edge.
 *
 * Lives outside `PreviewPipeline` because it constructs another instance:
 * keeping that recursion as an instance method on the same class made
 * the relationship hard to read. As a free function it's just two
 * pipelines and a Canvas2D pass.
 */
import type { AdjustmentParams, GeometryParams } from './types'
import { PreviewPipeline } from './preview'

export interface ExportOptions {
  format?: 'image/jpeg' | 'image/png' | 'image/webp'
  quality?: number
  maxLongEdge?: number
  frame?: {
    outer: { w: number; h: number }
    cutout: { x: number; y: number; w: number; h: number }
    bitmap: ImageBitmap
  }
}

export async function exportImage(
  source: { bitmap: ImageBitmap; imageWidth: number; imageHeight: number },
  adjustments: AdjustmentParams,
  geometry: GeometryParams,
  crop: { x: number; y: number; w: number; h: number },
  options: ExportOptions = {},
): Promise<Blob> {
  if (!source.imageWidth || !source.imageHeight) throw new Error('No source image loaded')
  if (!source.bitmap) throw new Error('Source bitmap no longer available; reopen the image')

  const format = options.format ?? 'image/jpeg'
  const quality = options.quality ?? 0.95

  const swap = geometry.orientation === 90 || geometry.orientation === 270
  const dispW = swap ? source.imageHeight : source.imageWidth
  const dispH = swap ? source.imageWidth : source.imageHeight

  let s1W: number, s1H: number
  if (options.frame) {
    s1W = Math.max(1, Math.round(options.frame.cutout.w))
    s1H = Math.max(1, Math.round(options.frame.cutout.h))
  } else {
    s1W = Math.max(1, Math.round(crop.w * dispW))
    s1H = Math.max(1, Math.round(crop.h * dispH))
  }

  const stage1 = document.createElement('canvas')
  stage1.width = s1W
  stage1.height = s1H
  const exporter = new PreviewPipeline(stage1)
  try {
    exporter.uploadImage(source.bitmap, false)
    exporter.resize(s1W, s1H, 1)
    const bg: [number, number, number, number] = options.frame ? [1, 1, 1, 1] : [0.02, 0.02, 0.02, 1]
    exporter.render({ zoom: 1, panX: 0, panY: 0 }, adjustments, geometry, bg, crop)
  } catch (err) {
    exporter.dispose()
    throw err
  }

  let outW: number, outH: number
  let finalCanvas: HTMLCanvasElement
  if (options.frame) {
    outW = options.frame.outer.w
    outH = options.frame.outer.h
    finalCanvas = document.createElement('canvas')
    finalCanvas.width = outW
    finalCanvas.height = outH
    const ctx = finalCanvas.getContext('2d', { alpha: format === 'image/png' })
    if (!ctx) { exporter.dispose(); throw new Error('Canvas2D unavailable for export') }
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff' // eslint-disable-line no-restricted-syntax -- design-allow: export-side fill under transparent frame cutout, must match physical white paper, not UI
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(stage1, 0, 0, s1W, s1H, options.frame.cutout.x, options.frame.cutout.y, options.frame.cutout.w, options.frame.cutout.h)
    ctx.drawImage(options.frame.bitmap, 0, 0, outW, outH)
  } else {
    const longEdge = Math.max(s1W, s1H)
    const scale = options.maxLongEdge && options.maxLongEdge < longEdge ? options.maxLongEdge / longEdge : 1
    outW = Math.max(1, Math.round(s1W * scale))
    outH = Math.max(1, Math.round(s1H * scale))
    if (scale < 1) {
      finalCanvas = document.createElement('canvas')
      finalCanvas.width = outW
      finalCanvas.height = outH
      const ctx = finalCanvas.getContext('2d', { alpha: format === 'image/png' })
      if (!ctx) { exporter.dispose(); throw new Error('Canvas2D unavailable for export') }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(stage1, 0, 0, outW, outH)
    } else {
      finalCanvas = stage1
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    finalCanvas.toBlob(resolve, format, format === 'image/png' ? undefined : quality),
  )
  exporter.dispose()
  if (!blob) throw new Error('toBlob returned null')
  return blob
}
