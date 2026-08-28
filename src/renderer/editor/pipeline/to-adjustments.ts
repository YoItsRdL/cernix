/**
 * Pure data transform: EditParams (the user-facing schema) → AdjustmentParams
 * (the GPU upload shape consumed by `PreviewPipeline.render`). No WebGL
 * dependency on this side. Every value is either a scalar, a typed array,
 * or a small uniform-bag object.
 *
 * Per-input memoisation by reference: `ParamsStore` returns a fresh nested
 * object on every mutation, so a `WeakMap` keyed by the input lives for
 * exactly one value-epoch and avoids recomputing curve LUTs / HSL float
 * arrays / etc. when other fields change.
 */

import type {
  AdjustmentParams,
  BwUniforms,
  ColorGradingUniforms,
  GeometryParams,
  HealSpotUniforms,
  MaskUniforms,
} from './types'

import type {
  EditParams,
  ToneCurve,
  HslAdjustments,
  BlackAndWhite,
  SelectiveColor,
  Mask,
  LinearMask,
  RadialMask,
  BrushMask,
  HealSpot,
} from '@/types'

import type { ColorGrading, Perspective } from '../../../shared/edit-params'
import {
  HSL_RANGES,
  SC_RANGES,
  MAX_MASKS,
  MAX_HEAL_SPOTS,
  MASK_ADJUSTMENT_FIELDS,
  LIGHT_LEAK_PRESETS,
  isIdentityColorGrading,
} from '../../../shared/edit-params'

import { buildCurveLut, isIdentityToneCurve } from './curve-lut'

/** Width of the per-mask tone curve atlas. One row per
 *  slot; the channel layout (RGBA) matches the global curve LUT so
 *  the shader sample math stays in lockstep. */
const MASK_CURVE_LUT_WIDTH = 256

// ── Small utilities ──

export function memoByRef<K extends object, V>(fn: (k: K) => V): (k: K) => V {
  const cache = new WeakMap<K, V>()
  return (k) => {
    if (cache.has(k)) return cache.get(k)!
    const v = fn(k)
    cache.set(k, v)
    return v
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

// ── Per-feature derivations (cached by reference) ──

/**
* Compose a 3x3 homography from the Perspective sliders. Stored
* column-major for `gl.uniformMatrix3fv` (transpose=false). The
* shader applies the matrix to `(uv - 0.5)` then dehomogenises and
* adds 0.5, so this builder writes a matrix that operates in
* centred-UV space.
*
* Each slider contributes a small homography component. We compose
* them in a fixed order (vertical → horizontal → aspect → translate)
* which matches how Lightroom stacks the sliders. The constants
* calibrate slider extreme to a roughly 30% keystone correction, in
* line with what real-world building photographs need.
*/
function buildPerspectiveMatrix(p: Perspective): Float32Array {
  // Column-major identity. mat3(1.0) in GLSL.
  const m = new Float32Array([1,0,0, 0,1,0, 0,0,1])
  if (p.vertical === 0 && p.horizontal === 0 && p.aspect === 0 && p.x === 0 && p.y === 0) {
    return m
  }
  // Vertical keystone: makes the bottom edge wider than the top
  // when vertical > 0 (the typical "looking up" correction). The
  // homography encodes the perspective division via the third row.
  // Magnitude tuned so slider == 1 maps to ~30% top/bottom width
  // ratio difference. Matches LR's slider scaling at extreme.
  const kV = p.vertical * 0.6
  // Horizontal keystone: same shape, swapped axes.
  const kH = p.horizontal * 0.6
  // Aspect: non-uniform scale on Y. ±30% at slider extreme.
  const aspectScale = 1 + p.aspect * 0.3
  // Translation in centred-UV space. ±30% of half-image at extreme.
  const tx = p.x * 0.3
  const ty = p.y * 0.3

  // Manually compose: rows of the result matrix, then write column-
  // major into m. The composed matrix is:
  //   T(tx,ty) · A(aspectScale) · KV(kV) · KH(kH)
  // We build row-major then transpose into column-major at the end.
  // KH (horizontal keystone): | 1 0 0 |
  //                          | 0 1 0 |
  //                          | kH 0 1 |
  // KV (vertical keystone):   | 1  0 0 |
  //                          | 0  1 0 |
  //                          | 0 kV 1 |
  // Composed KV·KH: row-major
  //   | 1   0  0 |
  //   | 0   1  0 |
  //   | kH kV  1 |
  // Apply A (scale Y by aspectScale). Multiplies row 1 by aspectScale:
  //   | 1            0           0 |
  //   | 0            aspectScale 0 |
  //   | kH           kV          1 |
  // Apply T (translate by tx, ty) in homogeneous space. Adds tx*z to x, ty*z to y:
  //   | 1            0            tx |
  //   | 0            aspectScale  ty |
  //   | kH           kV           1  |
  // Column-major layout: [m00, m10, m20, m01, m11, m21, m02, m12, m22]
  m[0] = 1;       m[1] = 0;            m[2] = kH
  m[3] = 0;       m[4] = aspectScale;  m[5] = kV
  m[6] = tx;      m[7] = ty;           m[8] = 1
  return m
}


const cachedLut = memoByRef<ToneCurve, Uint8Array | null>(
  (curve) => isIdentityToneCurve(curve) ? null : buildCurveLut(curve),
)

const cachedHsl = memoByRef<HslAdjustments, Float32Array | null>((hsl) => {
  const nonZero = HSL_RANGES.some(r => hsl[r].h !== 0 || hsl[r].s !== 0 || hsl[r].l !== 0)
  if (!nonZero) return null
  const arr = new Float32Array(HSL_RANGES.length * 3)
  HSL_RANGES.forEach((r, i) => {
    arr[i * 3 + 0] = hsl[r].h
    arr[i * 3 + 1] = hsl[r].s
    arr[i * 3 + 2] = hsl[r].l
  })
  return arr
})

const cachedSelectiveColor = memoByRef<SelectiveColor, Float32Array | null>((sc) => {
  const nonZero = SC_RANGES.some(r => sc[r].c !== 0 || sc[r].m !== 0 || sc[r].y !== 0 || sc[r].k !== 0)
  if (!nonZero) return null
  const arr = new Float32Array(24)
  SC_RANGES.forEach((r, i) => {
    arr[i * 4 + 0] = sc[r].c
    arr[i * 4 + 1] = sc[r].m
    arr[i * 4 + 2] = sc[r].y
    arr[i * 4 + 3] = sc[r].k
  })
  return arr
})

const cachedColorGrading = memoByRef<ColorGrading, ColorGradingUniforms | null>((cg) => {
  if (isIdentityColorGrading(cg)) return null
  return {
    shadows:    [cg.shadows.hue,    cg.shadows.sat,    cg.shadows.lum],
    midtones:   [cg.midtones.hue,   cg.midtones.sat,   cg.midtones.lum],
    highlights: [cg.highlights.hue, cg.highlights.sat, cg.highlights.lum],
    global:     [cg.global.hue,     cg.global.sat,     cg.global.lum],
    blend: cg.blend,
    balance: cg.balance,
  }
})

const cachedBw = memoByRef<BlackAndWhite, BwUniforms | null>((bw) => {
  if (!bw.enabled) return null
  return {
    colorize: bw.colorize,
    tint: bw.colorize ? hexToRgb(bw.colorizeHex) : [1, 1, 1],
    // Order matches HSL_RANGES (and the GLSL u_bwWeights[] indices):
    // R, O, Y, G, A, B, P, M.
    weights: new Float32Array([
      bw.red, bw.orange, bw.yellow, bw.green,
      bw.aqua, bw.blue, bw.purple, bw.magenta,
    ]),
  }
})

/**
 * Packs the masks array into flat typed arrays suitable for WebGL uniform
 * upload. Returns null when the list is empty so the render path can skip
 * the upload entirely (all shader slots default to disabled).
 *
 * Layout mirrors the shader struct comment in FRAGMENT_SHADER exactly.
 * Changing one requires changing the other.
 */
function packMasks(masks: Mask[]): MaskUniforms | null {
  if (!masks.length) return null
  const N = MAX_MASKS
  const shape = new Float32Array(N * 4)
  const adjustments = new Float32Array(N * MASK_ADJUSTMENT_FIELDS)
  const flags = new Int32Array(N * 2)
  const featherInvert = new Float32Array(N * 2)
  const rangeMode = new Int32Array(N)
  const rangeBand = new Float32Array(N * 3)
  const rangeColor = new Float32Array(N * 3)
  const invert = new Int32Array(N)
  // Per-mask vector params. 24 floats for HSL, 14 for CG,
  // 6 for Calibration. vecEnabled[i] gates the per-pixel evaluation;
  // 0 means "every block at identity, fast-path skip".
  const vecHsl = new Float32Array(N * 24)
  const vecCg  = new Float32Array(N * 14)
  const vecCal = new Float32Array(N * 6)
  const vecEnabled = new Int32Array(N)
  // Per-mask tone curve atlas. Built lazily. Only
  // allocated when at least one mask actually sets a non-identity
  // curve. Identity rows stay zeroed; the shader's curveEnabled
  // gate means the row contents don't matter for unused slots.
  let curveAtlas: Uint8Array | null = null
  const curveEnabled = new Int32Array(N)
  const brushMasks: (BrushMask | null)[] = new Array(N).fill(null)

  masks.slice(0, N).forEach((m, i) => {
    // Type code: 0 = linear (formulaic), 1 = radial (formulaic),
    // 2 = bitmap-backed (brush). The shader uses
    // the same brushSample(slot, uv) path for everything in bucket
    // 2; the pipeline knows which bitmap source to upload per slot.
    const typeCode =
      m.type === 'linear' ? 0 :
      m.type === 'radial' ? 1 :
      /* brush */ 2
    flags[i * 2 + 0] = typeCode
    flags[i * 2 + 1] = m.enabled ? 1 : 0
    invert[i] = m.invert ? 1 : 0

    if (m.type === 'linear') {
      const s = m.shape as LinearMask
      shape[i * 4 + 0] = s.startX
      shape[i * 4 + 1] = s.startY
      shape[i * 4 + 2] = s.endX
      shape[i * 4 + 3] = s.endY
    } else if (m.type === 'radial') {
      const s = m.shape as RadialMask
      shape[i * 4 + 0] = s.cx
      shape[i * 4 + 1] = s.cy
      shape[i * 4 + 2] = s.rx
      shape[i * 4 + 3] = s.ry
      featherInvert[i * 2 + 0] = s.feather
      featherInvert[i * 2 + 1] = s.invert ? 1 : 0
    } else if (m.type === 'brush') {
      // Stroke list. MaskBinder rasterises into a per-slot texture.
      brushMasks[i] = m.shape as BrushMask
    }

    // Layout (16 floats per slot. Keep in lockstep with the GLSL
    // u_mask_adjustments index constants in shaders.ts):
    //   0..8   tone deltas: exposure, contrast, highlights, shadows,
    //          whites, blacks, temperature, tint, saturation
    //   9      vibrance (tone delta)
    //   10..15 spatial deltas: texture, clarity, dehaze, sharpenAmount,
    //          nrLuma, nrColor. Modulate the matching global pass's
    //          effective amount per pixel rather than running a per-
    //          mask spatial pass.
    const b = i * MASK_ADJUSTMENT_FIELDS
    const a = m.adjustments
    adjustments[b + 0]  = a.exposure
    adjustments[b + 1]  = a.contrast
    adjustments[b + 2]  = a.highlights
    adjustments[b + 3]  = a.shadows
    adjustments[b + 4]  = a.whites
    adjustments[b + 5]  = a.blacks
    adjustments[b + 6]  = a.temperature
    adjustments[b + 7]  = a.tint
    adjustments[b + 8]  = a.saturation
    adjustments[b + 9]  = a.vibrance
    adjustments[b + 10] = a.texture
    adjustments[b + 11] = a.clarity
    adjustments[b + 12] = a.dehaze
    adjustments[b + 13] = a.sharpenAmount
    adjustments[b + 14] = a.nrLuma
    adjustments[b + 15] = a.nrColor
    adjustments[b + 16] = a.defringePurple
    adjustments[b + 17] = a.defringeGreen

    // Per-mask vector params. Pack into the typed arrays;
    // `vecEnabled[i]` flips on if any block has a non-identity field.
    let anyVec = false
    if (m.hsl) {
      const hb = i * 24
      HSL_RANGES.forEach((r, j) => {
        const band = m.hsl![r]
        vecHsl[hb + j * 3 + 0] = band.h
        vecHsl[hb + j * 3 + 1] = band.s
        vecHsl[hb + j * 3 + 2] = band.l
        if (band.h !== 0 || band.s !== 0 || band.l !== 0) anyVec = true
      })
    }
    if (m.colorGrading) {
      const cb = i * 14
      const cg = m.colorGrading
      vecCg[cb + 0]  = cg.shadows.hue;    vecCg[cb + 1]  = cg.shadows.sat;    vecCg[cb + 2]  = cg.shadows.lum
      vecCg[cb + 3]  = cg.midtones.hue;   vecCg[cb + 4]  = cg.midtones.sat;   vecCg[cb + 5]  = cg.midtones.lum
      vecCg[cb + 6]  = cg.highlights.hue; vecCg[cb + 7]  = cg.highlights.sat; vecCg[cb + 8]  = cg.highlights.lum
      vecCg[cb + 9]  = cg.global.hue;     vecCg[cb + 10] = cg.global.sat;     vecCg[cb + 11] = cg.global.lum
      vecCg[cb + 12] = cg.balance
      vecCg[cb + 13] = cg.blend
      if (!isIdentityColorGrading(cg)) anyVec = true
    }
    if (m.calibration) {
      const kb = i * 6
      const k = m.calibration
      vecCal[kb + 0] = k.red.hue;   vecCal[kb + 1] = k.red.sat
      vecCal[kb + 2] = k.green.hue; vecCal[kb + 3] = k.green.sat
      vecCal[kb + 4] = k.blue.hue;  vecCal[kb + 5] = k.blue.sat
      if (k.red.hue !== 0 || k.red.sat !== 0 ||
          k.green.hue !== 0 || k.green.sat !== 0 ||
          k.blue.hue !== 0 || k.blue.sat !== 0) anyVec = true
    }
    vecEnabled[i] = anyVec ? 1 : 0

    // Per-mask tone curve. Identity = no row written.
    // The atlas is allocated on first non-identity curve so masks
    // without curves don't pay the 8 KB allocation.
    if (m.toneCurve && !isIdentityToneCurve(m.toneCurve)) {
      if (!curveAtlas) curveAtlas = new Uint8Array(N * MASK_CURVE_LUT_WIDTH * 4)
      const lut = buildCurveLut(m.toneCurve)
      curveAtlas.set(lut, i * MASK_CURVE_LUT_WIDTH * 4)
      curveEnabled[i] = 1
    }

    // Optional range gate. Legacy masks without `range` resolve to mode 0
    // (off), which the shader fast-paths to weight = 1.
    const r = m.range
    if (r && r.mode !== 'off') {
      rangeMode[i] = r.mode === 'luminance' ? 1 : 2
      rangeBand[i * 3 + 0] = r.min
      rangeBand[i * 3 + 1] = r.max
      rangeBand[i * 3 + 2] = r.feather
      rangeColor[i * 3 + 0] = r.sampleColor[0]
      rangeColor[i * 3 + 1] = r.sampleColor[1]
      rangeColor[i * 3 + 2] = r.sampleColor[2]
    }
  })

  return {
    shape, adjustments, flags, featherInvert,
    rangeMode, rangeBand, rangeColor, invert,
    vecHsl, vecCg, vecCal, vecEnabled,
    curveAtlas, curveEnabled,
    brushMasks,
  }
}

/**
 * Packs the heal/clone spot list into flat typed arrays for the
 * shader's MAX_HEAL_SPOTS slots. Returns null when there are no spots
 * so the binder can early-out and the shader hits its `count == 0`
 * fast path.
 */
function packHealSpots(spots: HealSpot[]): HealSpotUniforms | null {
  if (!spots.length) return null
  const N = MAX_HEAL_SPOTS
  const dest = new Float32Array(N * 2)
  const src = new Float32Array(N * 2)
  const params = new Float32Array(N * 3)
  const mode = new Int32Array(N)
  const used = Math.min(spots.length, N)
  for (let i = 0; i < used; i++) {
    const s = spots[i]
    dest[i * 2 + 0] = s.destX
    dest[i * 2 + 1] = s.destY
    src[i * 2 + 0] = s.srcX
    src[i * 2 + 1] = s.srcY
    params[i * 3 + 0] = s.radius
    params[i * 3 + 1] = s.feather
    params[i * 3 + 2] = s.opacity
    mode[i] = s.mode === 'heal' ? 1 : 0
  }
  return { dest, src, params, mode, count: used }
}

// ── Public API ──

export function toAdjustments(p: EditParams): AdjustmentParams {
  return {
    exposure: p.exposure, contrast: p.contrast, highlights: p.highlights, shadows: p.shadows,
    whites: p.whites, blacks: p.blacks, temperature: p.temperature, tint: p.tint,
    vibrance: p.vibrance, saturation: p.saturation,
    textureAmount: p.texture, clarityAmount: p.clarity, dehazeAmount: p.dehaze,
    calibration: {
      redHue:   p.calibration.red.hue,   redSat:   p.calibration.red.sat,
      greenHue: p.calibration.green.hue, greenSat: p.calibration.green.sat,
      blueHue:  p.calibration.blue.hue,  blueSat:  p.calibration.blue.sat,
    },
    perspective: buildPerspectiveMatrix(p.perspective),
    lensDistortion: p.lensDistortion,
    curveLut: cachedLut(p.toneCurve),
    hsl: cachedHsl(p.hsl),
    selectiveColor: cachedSelectiveColor(p.selectiveColor),
    colorGrading: cachedColorGrading(p.colorGrading),
    defringePurple:       p.defringe.purpleAmount,
    defringeGreen:        p.defringe.greenAmount,
    defringePurpleHueLo:  p.defringe.purpleHueLo,
    defringePurpleHueHi:  p.defringe.purpleHueHi,
    defringeGreenHueLo:   p.defringe.greenHueLo,
    defringeGreenHueHi:   p.defringe.greenHueHi,
    sharpenAmount:  p.sharpening.amount,
    sharpenRadius:  p.sharpening.radius,
    sharpenDetail:  p.sharpening.detail,
    sharpenMasking: p.sharpening.masking,
    nrLuma:         p.noiseReduction.luminance,
    nrColor:        p.noiseReduction.color,
    noiseAmount: p.noiseAmount,
    noiseMono: p.noiseMono,
    noiseDist: p.noiseDistribution === 'gaussian' ? 1 : 0,
    noiseSize: p.noiseSize,
    noiseFrequency: p.noiseFrequency,
    bw: cachedBw(p.bw),
    masks: packMasks(p.masks),
    healSpots: packHealSpots(p.healSpots),
    llPreset: LIGHT_LEAK_PRESETS.findIndex(x => x.id === p.lightLeak.preset),
    llIntensity: p.lightLeak.intensity,
    llRotation: (p.lightLeak.rotation ?? 0) * Math.PI / 180,
    llSpread: p.lightLeak.spread ?? 1,
    vignetteAmount:            p.vignette.amount,
    vignetteRadius:            p.vignette.radius,
    vignetteSoftness:          p.vignette.softness,
    vignetteRoundness:         p.vignette.roundness,
    vignetteHighlightContrast: p.vignette.highlightContrast,
  }
}

export function toGeometry(p: EditParams): GeometryParams {
  return { orientation: p.orientation, straightenDeg: p.straightenDeg, flipH: p.flipH, imageTransform: p.imageTransform }
}
