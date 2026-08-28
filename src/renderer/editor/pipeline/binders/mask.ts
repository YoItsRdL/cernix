import type { BinderContext, FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import type { BrushMask } from '@/types'
import { MAX_MASKS, MASK_ADJUSTMENT_FIELDS } from '../../../../shared/edit-params'
import { rasteriseBrushStrokes, type BrushMaskBitmap } from '../brush-raster'

/** TEXTURE0 is the source bitmap, TEXTURE1 is the curve LUT.
*  Brush mask textures occupy TEXTURE2 through TEXTURE2 + MAX_MASKS - 1. */
const BRUSH_TEXTURE_UNIT_OFFSET = 2
/** Per-mask tone curve atlas: one texture for all eight slots, at unit
*  14. Unit 15 is left free for a ninth mask; the budget was parked at
*  14 used. */
const MASK_CURVE_ATLAS_UNIT = 14
/** Width of one row in the per-mask tone curve atlas. Mirrors
*  `MASK_CURVE_LUT_WIDTH` in to-adjustments.ts. */
const MASK_CURVE_ATLAS_WIDTH = 256

/**
* Per-mask linear/radial/brush filters. Up to MAX_MASKS slots. WebGL2's
* array uniforms can be flaky on some drivers (the single-name path
* with `uniform1fv` doesn't always bind), so we capture per-element
* locations and push individually. Disabled slots get a zero flag and
* skip the rest of the writes implicitly via the shader's enabled bit.
*/
export class MaskBinder implements FeatureBinder {
  private uShape: (WebGLUniformLocation | null)[] = []
  private uAdjustments: (WebGLUniformLocation | null)[] = []
  private uFlags: (WebGLUniformLocation | null)[] = []
  private uFeatherInvert: (WebGLUniformLocation | null)[] = []
  private uRangeMode: (WebGLUniformLocation | null)[] = []
  private uRangeBand: (WebGLUniformLocation | null)[] = []
  private uRangeColor: (WebGLUniformLocation | null)[] = []
  private uInvert: (WebGLUniformLocation | null)[] = []
  private uBrushSampler: (WebGLUniformLocation | null)[] = []
  // Per-mask vector params. Flat per-element locations
  // for the same reason the adjustments path captures per-element:
  // some drivers don't honour `uniform1fv` on the array name alone.
  private uVecHsl: (WebGLUniformLocation | null)[] = []
  private uVecCg:  (WebGLUniformLocation | null)[] = []
  private uVecCal: (WebGLUniformLocation | null)[] = []
  private uVecEnabled: (WebGLUniformLocation | null)[] = []
  // Per-mask tone curve atlas.
  private uCurveAtlas: WebGLUniformLocation | null = null
  private uCurveEnabled: (WebGLUniformLocation | null)[] = []
  private curveAtlasTex: WebGLTexture | null = null
  private curveAtlasZeros: Uint8Array | null = null
  private uOutlineSlot: WebGLUniformLocation | null = null
  /** Per-slot bitmap-mask texture and the object it was uploaded from.
   *  The source is the BrushMask reference, which changes when its
   *  strokes do; while it matches, the texture is reused. */
  private brushTextures: (WebGLTexture | null)[] = []
  private brushSourceRefs: (object | null)[] = []
  private brushSourceDims: { w: number; h: number }[] = []

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uShape = []
    this.uAdjustments = []
    this.uFlags = []
    this.uFeatherInvert = []
    this.uRangeMode = []
    this.uRangeBand = []
    this.uRangeColor = []
    this.uInvert = []
    this.uBrushSampler = []
    this.uVecHsl = []
    this.uVecCg = []
    this.uVecCal = []
    this.uVecEnabled = []
    this.uCurveEnabled = []
    this.uCurveAtlas = gl.getUniformLocation(program, 'u_mask_curve_atlas')
    this.uOutlineSlot = gl.getUniformLocation(program, 'u_outline_mask_slot')
    this.brushTextures = new Array(MAX_MASKS).fill(null)
    this.brushSourceRefs = new Array(MAX_MASKS).fill(null)
    this.brushSourceDims = new Array(MAX_MASKS).fill(null).map(() => ({ w: 0, h: 0 }))
    for (let i = 0; i < MAX_MASKS; i++) {
      this.uShape.push(gl.getUniformLocation(program, `u_mask_shape[${i}]`))
      this.uFlags.push(gl.getUniformLocation(program, `u_mask_flags[${i}]`))
      this.uFeatherInvert.push(gl.getUniformLocation(program, `u_mask_feather_invert[${i}]`))
      this.uRangeMode.push(gl.getUniformLocation(program, `u_mask_range_mode[${i}]`))
      this.uRangeBand.push(gl.getUniformLocation(program, `u_mask_range_band[${i}]`))
      this.uRangeColor.push(gl.getUniformLocation(program, `u_mask_range_color[${i}]`))
      this.uInvert.push(gl.getUniformLocation(program, `u_mask_invert[${i}]`))
      this.uBrushSampler.push(gl.getUniformLocation(program, `u_mask_brush_${i}`))
      this.uVecEnabled.push(gl.getUniformLocation(program, `u_mask_vec_enabled[${i}]`))
      this.uCurveEnabled.push(gl.getUniformLocation(program, `u_mask_curve_enabled[${i}]`))
      for (let j = 0; j < MASK_ADJUSTMENT_FIELDS; j++) {
        this.uAdjustments.push(gl.getUniformLocation(program, `u_mask_adjustments[${i * MASK_ADJUSTMENT_FIELDS + j}]`))
      }
      for (let j = 0; j < 24; j++) {
        this.uVecHsl.push(gl.getUniformLocation(program, `u_mask_vec_hsl[${i * 24 + j}]`))
      }
      for (let j = 0; j < 14; j++) {
        this.uVecCg.push(gl.getUniformLocation(program, `u_mask_vec_cg[${i * 14 + j}]`))
      }
      for (let j = 0; j < 6; j++) {
        this.uVecCal.push(gl.getUniformLocation(program, `u_mask_vec_cal[${i * 6 + j}]`))
      }
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < this.brushTextures.length; i++) {
      const tex = this.brushTextures[i]
      if (tex) gl.deleteTexture(tex)
      this.brushTextures[i] = null
      this.brushSourceRefs[i] = null
    }
    if (this.curveAtlasTex) {
      gl.deleteTexture(this.curveAtlasTex)
      this.curveAtlasTex = null
    }
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams, ctx?: BinderContext): void {
    const masks = adj.masks
    if (this.uOutlineSlot) gl.uniform1i(this.uOutlineSlot, adj.outlineMaskSlot ?? -1)

    // Per-mask tone curve atlas. One texture for all
    // eight slots; bound unconditionally on unit 14 so the sampler
    // never dangles. The per-slot u_mask_curve_enabled gate skips
    // the actual sample for rows that don't carry a curve. Lazy-
    // allocate the GL texture only when first needed.
    const atlas = masks?.curveAtlas ?? null
    if (atlas) {
      if (!this.curveAtlasTex) this.curveAtlasTex = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + MASK_CURVE_ATLAS_UNIT)
      gl.bindTexture(gl.TEXTURE_2D, this.curveAtlasTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        MASK_CURVE_ATLAS_WIDTH, MAX_MASKS, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, atlas,
      )
    } else {
      // Bind a 1×MAX_MASKS placeholder when no mask carries a curve
      // so the sampler unit stays valid. The placeholder is all-zero
      // RGBA. Any spurious sample reads black, which is gated out
      // by curveEnabled anyway.
      if (!this.curveAtlasTex) this.curveAtlasTex = gl.createTexture()
      if (!this.curveAtlasZeros) this.curveAtlasZeros = new Uint8Array(MAX_MASKS * 4)
      gl.activeTexture(gl.TEXTURE0 + MASK_CURVE_ATLAS_UNIT)
      gl.bindTexture(gl.TEXTURE_2D, this.curveAtlasTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        1, MAX_MASKS, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, this.curveAtlasZeros,
      )
    }
    if (this.uCurveAtlas) gl.uniform1i(this.uCurveAtlas, MASK_CURVE_ATLAS_UNIT)

    for (let i = 0; i < MAX_MASKS; i++) {
      const flagLoc = this.uFlags[i]
      if (!masks) {
        if (flagLoc) gl.uniform2i(flagLoc, 0, 0)
        const rmLoc0 = this.uRangeMode[i]
        if (rmLoc0) gl.uniform1i(rmLoc0, 0)
        const invLoc0 = this.uInvert[i]
        if (invLoc0) gl.uniform1i(invLoc0, 0)
        const veLoc0 = this.uVecEnabled[i]
        if (veLoc0) gl.uniform1i(veLoc0, 0)
        const ceLoc0 = this.uCurveEnabled[i]
        if (ceLoc0) gl.uniform1i(ceLoc0, 0)
        // Bind a placeholder so the sampler uniform doesn't dangle.
        this.bindBrushPlaceholder(gl, i)
        continue
      }
      if (flagLoc) gl.uniform2i(flagLoc, masks.flags[i * 2], masks.flags[i * 2 + 1])
      const shapeLoc = this.uShape[i]
      if (shapeLoc) gl.uniform4f(shapeLoc, masks.shape[i * 4], masks.shape[i * 4 + 1], masks.shape[i * 4 + 2], masks.shape[i * 4 + 3])
      const fiLoc = this.uFeatherInvert[i]
      if (fiLoc) gl.uniform2f(fiLoc, masks.featherInvert[i * 2], masks.featherInvert[i * 2 + 1])
      for (let j = 0; j < MASK_ADJUSTMENT_FIELDS; j++) {
        const pLoc = this.uAdjustments[i * MASK_ADJUSTMENT_FIELDS + j]
        if (pLoc) gl.uniform1f(pLoc, masks.adjustments[i * MASK_ADJUSTMENT_FIELDS + j])
      }
      // Per-mask vector params. Only push when the slot
      // has any non-identity vector block. Saves 44 uniform1f calls
      // per masked frame on the common scalar-only path.
      const vecOn = masks.vecEnabled[i]
      const veLoc = this.uVecEnabled[i]
      if (veLoc) gl.uniform1i(veLoc, vecOn)
      const ceLoc = this.uCurveEnabled[i]
      if (ceLoc) gl.uniform1i(ceLoc, masks.curveEnabled[i])
      if (vecOn) {
        for (let j = 0; j < 24; j++) {
          const loc = this.uVecHsl[i * 24 + j]
          if (loc) gl.uniform1f(loc, masks.vecHsl[i * 24 + j])
        }
        for (let j = 0; j < 14; j++) {
          const loc = this.uVecCg[i * 14 + j]
          if (loc) gl.uniform1f(loc, masks.vecCg[i * 14 + j])
        }
        for (let j = 0; j < 6; j++) {
          const loc = this.uVecCal[i * 6 + j]
          if (loc) gl.uniform1f(loc, masks.vecCal[i * 6 + j])
        }
      }
      const rmLoc = this.uRangeMode[i]
      if (rmLoc) gl.uniform1i(rmLoc, masks.rangeMode[i])
      const rbLoc = this.uRangeBand[i]
      if (rbLoc) gl.uniform3f(rbLoc, masks.rangeBand[i * 3], masks.rangeBand[i * 3 + 1], masks.rangeBand[i * 3 + 2])
      const rcLoc = this.uRangeColor[i]
      if (rcLoc) gl.uniform3f(rcLoc, masks.rangeColor[i * 3], masks.rangeColor[i * 3 + 1], masks.rangeColor[i * 3 + 2])
      const invLoc = this.uInvert[i]
      if (invLoc) gl.uniform1i(invLoc, masks.invert[i])

      // Bitmap-backed mask binding. Brush slots rasterise strokes
      // into a bitmap; the source object reference gates re-upload.
      // Non-bitmap slots get the placeholder.
      const typeCode = masks.flags[i * 2]
      const isBitmap = typeCode === 2
      if (isBitmap && ctx && ctx.imageWidth > 0 && ctx.imageHeight > 0) {
        const brush = masks.brushMasks[i]
        if (brush) {
          this.uploadBrushIfChanged(gl, i, brush, ctx.imageWidth, ctx.imageHeight)
        } else {
          // Bitmap-typed but no source data yet. Drop the texture so
          // the placeholder takes over until the cache populates.
          this.releaseSlotTexture(gl, i)
        }
      }
      this.bindBrushSlot(gl, i)
    }
  }

  private uploadBrushIfChanged(
    gl: WebGL2RenderingContext, slot: number, brush: BrushMask, imgW: number, imgH: number,
  ): void {
    const dims = this.brushSourceDims[slot]
    if (this.brushSourceRefs[slot] === brush && dims.w === imgW && dims.h === imgH && this.brushTextures[slot]) {
      return
    }
    const bitmap = rasteriseBrushStrokes(brush.strokes, imgW, imgH)
    if (!bitmap) {
      this.releaseSlotTexture(gl, slot)
      this.brushSourceRefs[slot] = brush
      dims.w = imgW; dims.h = imgH
      return
    }
    this.uploadBitmap(gl, slot, bitmap)
    this.brushSourceRefs[slot] = brush
    dims.w = imgW; dims.h = imgH
  }

  private uploadBitmap(gl: WebGL2RenderingContext, slot: number, bitmap: BrushMaskBitmap): void {
    // Activate the slot's own unit BEFORE binding so the texImage2D
    // upload lands on the correct unit. Without this, bindTexture +
    // texImage2D would target whichever unit happened to be active
    // when MaskBinder.apply was entered (usually UNIT 0. The source
    // bitmap), unbinding the source for one frame and producing a
    // visible flash of garbage on the first render after a mask is
    // added. Per-render `bindBrushSlot` re-confirms the same state.
    gl.activeTexture(gl.TEXTURE0 + BRUSH_TEXTURE_UNIT_OFFSET + slot)
    let tex = this.brushTextures[slot]
    if (!tex) {
      tex = gl.createTexture()
      this.brushTextures[slot] = tex
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bitmap.width, bitmap.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap.data)
  }

  private releaseSlotTexture(gl: WebGL2RenderingContext, slot: number): void {
    const tex = this.brushTextures[slot]
    if (tex) { gl.deleteTexture(tex); this.brushTextures[slot] = null }
  }

  private bindBrushSlot(gl: WebGL2RenderingContext, slot: number): void {
    const unit = BRUSH_TEXTURE_UNIT_OFFSET + slot
    gl.activeTexture(gl.TEXTURE0 + unit)
    const tex = this.brushTextures[slot] ?? this.placeholder(gl)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    const samp = this.uBrushSampler[slot]
    if (samp) gl.uniform1i(samp, unit)
  }

  private bindBrushPlaceholder(gl: WebGL2RenderingContext, slot: number): void {
    this.bindBrushSlot(gl, slot)
  }

  /** Cached 1×1 transparent texture used as a safe fallback when no
   *  brush bitmap exists for a slot. Lazily created once per binder. */
  private placeholderTex: WebGLTexture | null = null
  private placeholder(gl: WebGL2RenderingContext): WebGLTexture {
    if (this.placeholderTex) return this.placeholderTex
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    this.placeholderTex = tex
    return tex
  }
}
