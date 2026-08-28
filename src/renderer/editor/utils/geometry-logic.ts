/**
 * Coordinate transforms, viewport layout and crop-baking. Pure maths:
 * no React, no WebGL, so it can be reasoned about and tested on its own.
 */

import type { FramePreset } from '@/../shared/frame-presets'

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageLayout {
  /** The interaction-aware workspace bounds (canvas size) */
  box: Rect;
  /** Viewport-aware rect where non-crop pixels are trimmed (the "document") */
  documentBox: Rect;
  /** Rect in image space [0..1] the WebGL pipeline should currently sample */
  sampleCrop: Rect;
  /** The intrinsic aspect-fit placement of the FULL image in the container */
  imageFitBox: Rect;
  /** Framing metadata if active */
  frame: {
    preset: FramePreset;
    boxX: number; boxY: number; boxW: number; boxH: number;
    cutout: Rect;
  } | null;
}

export type Mode = 'idle' | 'cropping' | 'transforming' | 'masking' | 'healing'

/**
 * Calculates the base aspect-fit scale for an image inside the canvas.
 * Correctly accounts for orientation-induced dimension swaps.
 */
export function computeBaseScale(
  imageW: number, imageH: number,
  orientation: number,
  cropW: number, cropH: number,
  canvasW: number, canvasH: number,
): { baseScaleX: number; baseScaleY: number } {
  const swap = orientation === 90 || orientation === 270
  const effW = swap ? imageH : imageW
  const effH = swap ? imageW : imageH
  const cropAspect = (effW * Math.max(1e-6, cropW)) / (effH * Math.max(1e-6, cropH))
  const canvasAspect = canvasW / canvasH
  return {
    baseScaleX: cropAspect > canvasAspect ? 1 : cropAspect / canvasAspect,
    baseScaleY: cropAspect > canvasAspect ? canvasAspect / cropAspect : 1,
  }
}

/**
 * Helper clamp
 */
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/**
 * Convert a screen-pixel delta to an image-local pan delta. Inverse of the
 * render matrix's pan→screen mapping in `preview.ts`. Use this any time a
 * cursor gesture writes to `imageTransform.panX/panY`. Without it, 90°/
 * 180°/270° rotations swap or invert the axes, and rectangular aspects
 * drift proportionally.
 *
 * `bw`/`bh` are the screen-axis dimensions of the image's display rect at
 * identity scale (the `imageFitBox` in non-frame mode, the frame cutout
 * in frame mode). `scale` is the current `imageTransform.scale`. Pass the
 * full shader rotation (`orientation + straightenDeg`) as `rotationDeg`.
 */
export function screenDeltaToPan(
  dxPixel: number, dyPixel: number,
  rotationDeg: number, flipH: boolean,
  bw: number, bh: number, scale: number,
): { dpanX: number; dpanY: number } {
  const theta = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const flip = flipH ? -1 : 1
  const s = Math.max(1e-6, scale)
  const u = dxPixel / (bw * s)
  const v = dyPixel / (bh * s)
  return {
    dpanX: flip * (cos * u - sin * v),
    dpanY: sin * u + cos * v,
  }
}

/**
 * Forward of `screenDeltaToPan`. Image-local pan → screen-pixel offset.
 * Used when a UI element (overlay rect, handle) needs to track the image
 * position under rotation.
 */
export function panToScreenDelta(
  panX: number, panY: number,
  rotationDeg: number, flipH: boolean,
  bw: number, bh: number, scale: number,
): { dxPixel: number; dyPixel: number } {
  const theta = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const flip = flipH ? -1 : 1
  return {
    dxPixel: bw * scale * (flip * cos * panX + sin * panY),
    dyPixel: bh * scale * (-flip * sin * panX + cos * panY),
  }
}

/**
 * Computes the unified stage layout for the editor.
 * Extracted from the monolithic logic in EditorCanvas.tsx.
 */
export function calculateStageLayout(
  containerSize: { width: number; height: number },
  imageDims: { w: number; h: number },
  previewParams: { 
    orientation: number; 
    frame: string | null; 
    crop: Rect | null;
  },
  mode: Mode,
  findFrame: (id: string | null) => FramePreset | null,
  FULL_FRAME_CROP: Rect,
  CROP_ZOOM: number
): StageLayout | null {
  const cw = containerSize.width
  const ch = containerSize.height
  if (!cw || !ch || !imageDims.w || !imageDims.h) return null

  const swap = previewParams.orientation === 90 || previewParams.orientation === 270
  const effImgW = swap ? imageDims.h : imageDims.w
  const effImgH = swap ? imageDims.w : imageDims.h
  const imgAspect = effImgW / effImgH
  const conAspect = cw / ch

  const framePreset = findFrame(previewParams.frame)
  if (framePreset) {
    const fa = framePreset.outer.w / framePreset.outer.h
    const boxW = conAspect > fa ? ch * fa : cw
    const boxH = conAspect > fa ? ch : cw / fa
    const boxX = (cw - boxW) / 2
    const boxY = (ch - boxH) / 2
    const sx = boxW / framePreset.outer.w
    const sy = boxH / framePreset.outer.h
    const cutout: Rect = {
      x: boxX + framePreset.cutout.x * sx,
      y: boxY + framePreset.cutout.y * sy,
      w: framePreset.cutout.w * sx,
      h: framePreset.cutout.h * sy,
    }
    // Calculate imageFitBox for reference in frame mode
    const baseW = imgAspect > conAspect ? cw : ch * imgAspect
    const baseH = imgAspect > conAspect ? cw / imgAspect : ch
    const imageFitBox: Rect = { x: (cw - baseW) / 2, y: (ch - baseH) / 2, w: baseW, h: baseH }

    return {
      box: cutout,
      documentBox: cutout,
      sampleCrop: previewParams.crop ?? FULL_FRAME_CROP,
      frame: { preset: framePreset, boxX, boxY, boxW, boxH, cutout },
      imageFitBox,
    }
  }

  // Base fit dimensions for the FULL image (for cropping mode and free-transform reference)
  const baseW = imgAspect > conAspect ? cw : ch * imgAspect
  const baseH = imgAspect > conAspect ? cw / imgAspect : ch
  const imageFitBox: Rect = { x: (cw - baseW) / 2, y: (ch - baseH) / 2, w: baseW, h: baseH }

  if (mode === 'cropping') {
    const pw = baseW * CROP_ZOOM
    const ph = baseH * CROP_ZOOM
    return {
      box: { x: 0, y: 0, w: cw, h: ch },
      documentBox: { x: (cw - pw) / 2, y: (ch - ph) / 2, w: pw, h: ph },
      sampleCrop: FULL_FRAME_CROP,
      frame: null,
      imageFitBox,
    }
  }

  const crop = previewParams.crop ?? FULL_FRAME_CROP
  // The intrinsic aspect of the CROP in display space (accounting for orientation swap).
  const cropAspect = (effImgW * crop.w) / (effImgH * crop.h)

  // Calculate fit dimensions so the CROP fills the container (Photopea-style idle view).
  const fitW = cropAspect > conAspect ? cw : ch * cropAspect
  const fitH = cropAspect > conAspect ? cw / cropAspect : ch
  const documentBox: Rect = { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }

  return {
    box: { x: 0, y: 0, w: cw, h: ch },
    documentBox,
    sampleCrop: mode === 'transforming' ? FULL_FRAME_CROP : crop,
    frame: null,
    imageFitBox,
  }
}

/**
 * Inverse of `transformToCrop`. Given a committed crop rect, return the
 * `imageTransform` that would render the full image such that only the
 * crop region fills the document. Used when entering free-transform on
 * an already-cropped image so the user picks up where they left off
 * instead of being dropped onto the uncropped original.
 *
 * Derivation: at identity, the full image fills `imageFitBox`. Scaling
 * by `docBox.w / (imgFB.w * crop.w)` makes the crop region's width
 * match the document's. Panning by `0.5 - (crop centre)` shifts that
 * crop centre onto the image centre (which is centred on the document,
 * since the box layout is centred). Rotation isn't needed in the
 * formula: both `crop` and `panX/panY` are expressed in image-local
 * coords, so the shader's rotation applies to them identically.
 */
export function cropToTransform(
  crop: Rect,
  imageFitBox: Rect,
  documentBox: Rect,
): { scale: number; panX: number; panY: number } {
  const scale = documentBox.w / Math.max(1e-6, imageFitBox.w * crop.w)
  return {
    scale,
    panX: 0.5 - crop.x - crop.w / 2,
    panY: 0.5 - crop.y - crop.h / 2,
  }
}

/**
 * Bake an `imageTransform` (scale + pan in image-normalized units) into
 * an equivalent crop rect. Used on free-transform apply: whatever of
 * the image is currently inside `documentBox` becomes the new crop;
 * everything outside the document gets trimmed. `imageFitBox` is where
 * the full source image sits at identity transform.
 */
export function transformToCrop(
  t: { scale: number; panX: number; panY: number },
  imageFitBox: Rect,
  documentBox: Rect
): Rect {
  const S = Math.max(1e-6, t.scale)
  const imgW = imageFitBox.w * S
  const imgH = imageFitBox.h * S
  const imgCx = imageFitBox.x + imageFitBox.w / 2 + imageFitBox.w * S * t.panX
  const imgCy = imageFitBox.y + imageFitBox.h / 2 + imageFitBox.h * S * t.panY
  const imgX = imgCx - imgW / 2
  const imgY = imgCy - imgH / 2
  const x = (documentBox.x - imgX) / imgW
  const y = (documentBox.y - imgY) / imgH
  const w = documentBox.w / imgW
  const h = documentBox.h / imgH

  // Helper clamp
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

  // Clamp to valid image coords [0..1].
  //
  // The origin is pulled back far enough to leave room for the minimum
  // extent before it is used. Clamping the origin to 1 first and then
  // asking for `clamp(w, 0.01, 1 - cx)` inverts the bounds, and this
  // `clamp` resolves an inverted pair in favour of the minimum, so a
  // transform that pushed the image fully out of the document returned
  // `x = 1, w = 0.01` and a rect reaching past the image edge. The
  // shader then samples outside the texture, which reads as a black
  // band nobody can account for.
  const MIN_EXTENT = 0.01
  const cx = clamp(x, 0, 1 - MIN_EXTENT)
  const cy = clamp(y, 0, 1 - MIN_EXTENT)
  return {
    x: cx,
    y: cy,
    w: clamp(w, MIN_EXTENT, 1 - cx),
    h: clamp(h, MIN_EXTENT, 1 - cy),
  }
}
