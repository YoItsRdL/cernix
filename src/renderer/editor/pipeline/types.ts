/** The interfaces and constants the WebGL2 pipeline is built from: what
 *  a binder receives, what the shader expects, and the slot budgets. */

import { IDENTITY_IMAGE_TRANSFORM } from '../../../shared/edit-params'

export interface PreviewViewport {
  zoom: number
  panX: number
  panY: number
}

/**
 * Geometric transform applied to the image before display. Composes with
 * the viewport's zoom/pan. Lives alongside AdjustmentParams so render() gets
 * everything needed to paint a frame.
 */
export interface GeometryParams {
  /** Discrete orientation in degrees (0/90/180/270). */
  orientation: 0 | 90 | 180 | 270
  /** Additional fine rotation on top of orientation (-45..+45). */
  straightenDeg: number
  /** Mirror horizontally. */
  flipH: boolean
  imageTransform: { scale: number, panX: number, panY: number }
}

export const IDENTITY_GEOMETRY: GeometryParams = { 
  orientation: 0, 
  straightenDeg: 0, 
  flipH: false, 
  imageTransform: IDENTITY_IMAGE_TRANSFORM 
}

export interface MaskUniforms {
  /** 8 x vec4 (shape): linear=(sX,sY,eX,eY), radial=(cx,cy,rx,ry). */
  shape: Float32Array
  /** 8 x MASK_ADJUSTMENT_FIELDS adjustments. Layout matches the
   *  GLSL `u_mask_adjustments` index constants in shaders.ts:
   *  0..9 tone deltas (exposure..vibrance), 10..15 spatial deltas
   *  (texture..nrColor), 16..17 defringe deltas (purple, green). */
  adjustments: Float32Array
  /** 8 x ivec2: [type(0=linear,1=radial,2=brush), enabled(0/1)]. */
  flags: Int32Array
  /** 8 x vec2: [feather, invert(0/1)] (radial only). */
  featherInvert: Float32Array
  /** 8 x int: range-mask mode (0 = off, 1 = luminance, 2 = colour). */
  rangeMode: Int32Array
  /** 8 x vec3: (min, max, feather) for the range gate, normalised [0..1]. */
  rangeBand: Float32Array
  /** 8 x vec3: sample colour (r, g, b) for colour-mode range gating. */
  rangeColor: Float32Array
  /** 8 x int: top-level invert flag (0 / 1). Applied to the mask
   *  weight as `w = 1 - w` after the type-specific computation.
   *  Works uniformly across every mask type. Distinct from the
   *  geometric `RadialMask.shape.invert` baked into the radial
   *  shape itself. */
  invert: Int32Array
 /** Per-mask vector parameters. Layout per slot:
   *  - hsl: 8 bands × (h, s, l) = 24 floats. Order matches HSL_RANGES.
   *  - cg:  4 bands × (h, s, l) + (balance, blend) = 14 floats. Order
   *         shadows / midtones / highlights / global, then balance + blend.
   *  - cal: 3 primaries × (hue, sat) = 6 floats. Order red, green, blue.
   *  Total 44 floats per slot × 8 = 352 floats.
   *  `vecEnabled[i] = 1` iff the slot has any non-identity vector
   *  block; the shader fast-paths the per-mask vector evaluation
   *  through this flag so masks with only scalar deltas pay zero. */
  vecHsl: Float32Array
  vecCg: Float32Array
  vecCal: Float32Array
  vecEnabled: Int32Array
 /** Per-mask tone curve atlas. 256 × MAX_MASKS RGBA
   *  bytes. One row per slot, identical channel layout to the global
   *  curve LUT (R/G/B = per-channel curves, A = luma curve). Slots
   *  without a curve get a zeroed row; the shader gates the sample
   *  via `curveEnabled[i]` so the row contents don't matter when the
   *  flag is 0. Null when no mask has set a curve. The binder skips
   *  the texture upload entirely. */
  curveAtlas: Uint8Array | null
  /** Per-slot 0/1: slot has a non-identity tone curve. */
  curveEnabled: Int32Array
  /** 8 x BrushMask | null. The MaskBinder rasterises strokes to a
   *  per-slot texture on demand (cached by reference). */
  brushMasks: (import('@/types').BrushMask | null)[]
}

export interface AdjustmentParams {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  vibrance: number
  saturation: number
  /** 256 RGBA bytes; R/G/B/A channels encode r/g/b/luma curves. Null = identity. */
  curveLut?: Uint8Array | null
  /** 6 bands x (h, s, l): flat array of 18 floats. Null = all zero. */
  hsl?: Float32Array | null
  /** 6 bands x (c, m, y, k): flat array of 24 floats. Null = all zero. */
  selectiveColor?: Float32Array | null
  /** Colour grading bands packed as 3 vec3 + (blend, balance). Null when
   *  every band's sat == 0 and lum == 0. The shader skips the pass. */
  colorGrading?: ColorGradingUniforms | null
  /** Defringe: purple + green strengths in [0..1]. Both 0 = pass-through. */
  defringePurple?: number
  defringeGreen?: number
  defringePurpleHueLo?: number
  defringePurpleHueHi?: number
  defringeGreenHueLo?: number
  defringeGreenHueHi?: number
  /** Sharpening: amount (0..1) + radius (0..3 px) + detail (0..1) +
   *  masking (0..1). amount or radius = 0 short-circuits the FBO
   *  blur pass; the shader falls back to a 4-tap cross at radius=0. */
  sharpenAmount?: number
  sharpenRadius?: number
  sharpenDetail?: number
  sharpenMasking?: number
  /** Noise reduction: luma + chroma strengths in [0..1]. 0 = pass-through. */
  nrLuma?: number
  nrColor?: number
  noiseAmount?: number
  noiseMono?: boolean
  noiseSize?: number
  noiseFrequency?: number
  /** Texture (Lightroom presence): drives the narrow-radius blur
   *  pass and the unsharp delta in `applyTexture`. */
  textureAmount?: number
  /** Clarity (Lightroom presence): drives the wide-radius blur pass
   *  and the mid-tone-gated unsharp in `applyClarity`. */
  clarityAmount?: number
  /** Dehaze (Lightroom presence): reuses the wide-radius blur as
   *  the spatial-min source for the dark-channel-prior approximation
   *  in `applyDehaze`. The PresenceBinder triggers the wide blur
   *  whenever clarity OR dehaze is non-zero. */
  dehazeAmount?: number
 /** Camera calibration. Per-primary hue + sat biases
   *  flattened to six scalars; the shader early-outs when all six
   *  are zero so the cost is purely the uploads. */
  calibration?: {
    redHue: number; redSat: number
    greenHue: number; greenSat: number
    blueHue: number; blueSat: number
  }
 /** Perspective transform: 3x3 homography composed
   *  CPU-side from the user-facing slider values. Identity matrix
   *  when every slider is 0; the shader uploads it unconditionally
   *  and the matrix multiplication early-outs visually. Stored as
   *  a 9-element column-major Float32Array ready for `uniformMatrix3fv`. */
  perspective?: Float32Array
 /** Lens distortion: single Brown-Conrady k1 in
   *  [-1..+1]. 0 = pass-through. */
  lensDistortion?: number
  /** 0 = uniform, 1 = gaussian */
  noiseDist?: 0 | 1
  /** Black & white channel-mixer output. Null = disabled. */
  bw?: BwUniforms | null
  /** Packed mask uniforms. Null when the masks array is empty. */
  masks?: MaskUniforms | null
  /** Slot index (0..MAX_MASKS-1) of the mask whose boundary to trace
   *  with a high-contrast outline on the rendered canvas. -1 (or
   *  omitted) disables the outline. Transient render-time state.
   *  Derived from the UI's selectedMaskId, not from EditParams. */
  outlineMaskSlot?: number
 /** Visualise Spots: transient diagnostic mode for the
   *  heal tool. When `true`, the shader bypasses the whole adjustment
   *  pipeline and renders `abs(laplacian(luma))` of the source as a
   *  contrast-stretched grayscale, surfacing dust spots / sensor
   *  artefacts that are invisible in the normal preview. The
   *  sensitivity slider scales the stretch threshold so the user can
   *  dial in the reveal level for their sensor's noise floor. */
  visualizeSpots?: boolean
  visualizeSensitivity?: number
  /** Packed heal/clone spot uniforms. Null when the list is empty. */
  healSpots?: HealSpotUniforms | null
  /** Light leak preset index (0=none), intensity, rotation (radians),
   *  and spread (bloom σ multiplier; 1 = preset as-authored). */
  llPreset?: number
  llIntensity?: number
  llRotation?: number
  llSpread?: number
  vignetteAmount: number
  vignetteRadius: number
  vignetteSoftness: number
  vignetteRoundness?: number
  vignetteHighlightContrast?: number
}

export interface BwUniforms {
  colorize: boolean
  tint: [number, number, number]
  /** Eight per-hue luminance weights, ordered to match `HSL_RANGES`
   *  and the GLSL `u_bwWeights[]` array indices:
   *  red, orange, yellow, green, aqua, blue, purple, magenta. */
  weights: Float32Array
}

/**
   * Packed heal/clone spot uniforms. One entry per slot, padded out to
   * MAX_HEAL_SPOTS. The shader iterates the array and skips disabled
   * slots (count < i).
   *
   *  - `dest`/`src`: 16 x vec4 each, but packed flat as Float32Arrays of
   *    length MAX_HEAL_SPOTS * 2 (xy pairs in normalised image UV).
   *  - `params`: MAX_HEAL_SPOTS x vec3. (radius, feather, opacity).
   *  - `mode`:  MAX_HEAL_SPOTS x int. 0 = clone, 1 = heal.
   *  - `count`: number of active spots; the shader's loop bound.
   */
export interface HealSpotUniforms {
  dest: Float32Array
  src: Float32Array
  params: Float32Array
  mode: Int32Array
  count: number
}

export interface ColorGradingUniforms {
  /** (h, s, l): h in [0..1] (×2π in shader), s in [0..1], l in [-1..+1]. */
  shadows:    [number, number, number]
  midtones:   [number, number, number]
  highlights: [number, number, number]
  /** Global tint, applied with weight 1.0 across every luminance band. */
  global:     [number, number, number]
  /** Band overlap (0 = sharp, 1 = soft). */
  blend: number
  /** Band-centre shift (-1 toward shadows, +1 toward highlights). */
  balance: number
}
