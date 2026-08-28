/**
 * Shared edit-parameter schema and defaults. Single source of truth consumed
 * by both the main-process XMP writer and the renderer-side param store /
 * pipeline / UI components. Keep this file free of runtime dependencies on
 * either side. Pure types and plain-object constants only.
 */

export interface CurvePoint { x: number; y: number }
export type CurveChannel = 'luma' | 'r' | 'g' | 'b'
export type ToneCurve = Record<CurveChannel, CurvePoint[]>

/**
 * HSL ranges. 8 hue bands matching Lightroom Classic / Camera Raw so
 * preset libraries import without lossy band reduction. Centres in
 * normalised hue space:
 *   red 0.000  orange 0.083  yellow 0.167  green 0.333
 *   aqua 0.500 blue   0.667  purple 0.833  magenta 0.917
 */
export type HslRange = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta'
export interface HslBand { h: number; s: number; l: number }
export type HslAdjustments = Record<HslRange, HslBand>

/**
 * Photopea-style Selective Color. For each of six hue families, the user
 * biases the CMYK decomposition of pixels that fall in that range. Values
 * are in [-1, 1]. Positive adds ink, negative removes it. The effect is
 * weighted by how close a pixel's hue is to the band centre and by its
 * saturation, so neutrals stay neutral unless "black" is tugged.
 */
export type SelectiveColorRange = 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta'
export interface SelectiveColorBand { c: number; m: number; y: number; k: number }
export type SelectiveColor = Record<SelectiveColorRange, SelectiveColorBand>

export const SC_RANGES: readonly SelectiveColorRange[] = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta']

/**
 * Colour Grading (Lightroom-style). Three independent HSL offsets, one
 * per tonal band (shadows / midtones / highlights). Per-band `hue` is
 * normalised to [0..1] (multiply by 360 for degrees), `sat` is [0..1],
 * `lum` is [-1..+1]. `balance` shifts the band centres along the tonal
 * range (-1 biases toward shadows, +1 toward highlights). `blend`
 * widens the per-band Gaussian falloff so adjacent bands overlap more
 * (0 = sharp, 1 = soft).
 */
export interface ColorGradingBand {
  hue: number
  sat: number
  lum: number
}

export interface ColorGrading {
  shadows: ColorGradingBand
  midtones: ColorGradingBand
  highlights: ColorGradingBand
  /** Global tint applied uniformly across every luminance band, on top
   *  of the per-band shadows/midtones/highlights tints. Mirrors
   *  Lightroom Classic's Colour Grading "Global" wheel. Used to push
   *  an overall colour cast across the image without re-balancing the
   *  three tonal bands. Same field shape as the band-specific tints. */
  global: ColorGradingBand
  blend: number
  balance: number
}

export const DEFAULT_COLOR_GRADING_BAND: ColorGradingBand = { hue: 0, sat: 0, lum: 0 }

export const DEFAULT_COLOR_GRADING: ColorGrading = {
  shadows:    { ...DEFAULT_COLOR_GRADING_BAND },
  midtones:   { ...DEFAULT_COLOR_GRADING_BAND },
  highlights: { ...DEFAULT_COLOR_GRADING_BAND },
  global:     { ...DEFAULT_COLOR_GRADING_BAND },
  blend: 0.5,
  balance: 0,
}

export function isIdentityColorGrading(cg: ColorGrading): boolean {
  const flat = (b: ColorGradingBand) => b.sat === 0 && b.lum === 0
  return flat(cg.shadows) && flat(cg.midtones) && flat(cg.highlights) && flat(cg.global)
}

/**
 * Defringe. Chromatic aberration removal. Two independent strengths
 * for the two fringes that show up in 99% of cases:
 *   - `purpleAmount` (purple/violet bloom on backlit edges)
 *   - `greenAmount`  (green bloom on opposing edges)
 * Each is in [0..1]; 0 = off. The shader gates by luminance gradient
 * (only fringes-on-edges are touched) and a per-fringe hue *range*
 * (only the actual fringe colour is desaturated, not legitimate
 * purple/green subjects).
 *
 * Hue ranges are normalised [0..1]; defaults match Lightroom Classic's
 * out-of-the-box defringe settings (Camera Raw 7.x onward):
 *   purple: ~0.74 → ~0.83 (violet → magenta-leaning purple)
 *   green:  ~0.27 → ~0.39 (yellow-green → blue-green)
 * The shader's smoothstep falloff softens both edges of the range so
 * the boundary doesn't clip subjects right at the edge of the band.
 */
export interface Defringe {
  purpleAmount: number
  greenAmount: number
  /** Lo edge of the purple-fringe hue band [0..1]. */
  purpleHueLo: number
  /** Hi edge of the purple-fringe hue band [0..1]. */
  purpleHueHi: number
  /** Lo edge of the green-fringe hue band [0..1]. */
  greenHueLo: number
  /** Hi edge of the green-fringe hue band [0..1]. */
  greenHueHi: number
}

const DEFAULT_DEFRINGE: Defringe = {
  purpleAmount: 0,
  greenAmount: 0,
  purpleHueLo: 0.74,
  purpleHueHi: 0.83,
  greenHueLo: 0.27,
  greenHueHi: 0.39,
}

/**
 * Sharpening. Lightroom's four-slider unsharp mask.
 *   amount. Strength multiplier (0..1; 1 = nominal Lightroom 50).
 *   radius. Gaussian σ in pixels for the FBO blur (0..3 px,
 *              Lightroom Radius range). When 0 the shader falls back
 *              to a cheap 4-tap cross (LR identity behaviour).
 *   detail. Halo suppression in [0..1]. 0 fully suppresses small
 *              high-pass amplitudes (clean edges only); 1 passes the
 *              raw highpass (fine detail and grain amplified).
 *              Default 0.25 matches Lightroom's identity (Detail=25).
 *   masking. Luminance-gradient gate (0 = sharpen everything,
 *              1 = only strong edges; preserves smooth skin / sky).
 */
export interface Sharpening {
  amount: number
  radius: number
  detail: number
  masking: number
}

const DEFAULT_SHARPENING: Sharpening = { amount: 0, radius: 1.0, detail: 0.25, masking: 0 }

/**
 * Noise Reduction. Single-pass denoise. `luminance` runs an edge-
 * aware blur on the luma channel; `colour` runs a wider blur on the
 * chroma channels (UV in YCbCr) since chroma noise is always lower-
 * frequency than luma noise.
 */
export interface NoiseReduction {
  luminance: number
  color: number
}

const DEFAULT_NOISE_REDUCTION: NoiseReduction = { luminance: 0, color: 0 }

/**
 * Black & white channel mixer. Eight per-hue luminance weights matching
 * the HSL band layout (and Lightroom Classic / Camera Raw): each weight
 * is `1 = neutral`, `<1` darkens that hue in the grayscale result,
 * `>1` brightens. Colorize tints the resulting gray uniformly.
 *
 * Schema note (v20 → v21): pre-v21 `cyan` and `magenta` mapped to the
 * 0.5 and 0.833 hue centres. They have been renamed to `aqua` and
 * `purple` to match HSL band labels; a new `magenta` (0.917) and
 * `orange` (0.083) are added. The XMP read path translates v20
 * sidecars (cyan → aqua, magenta-at-0.833 → purple) so older edits
 * round-trip without loss.
 */
export interface BlackAndWhite {
  enabled: boolean
  red: number
  orange: number
  yellow: number
  green: number
  aqua: number
  blue: number
  purple: number
  magenta: number
  colorize: boolean
  /** Tint colour as #rrggbb, used when colorize = true. */
  colorizeHex: string
}

export const DEFAULT_BLACK_AND_WHITE: BlackAndWhite = {
  enabled: false,
  red: 1, orange: 1, yellow: 1, green: 1, aqua: 1, blue: 1, purple: 1, magenta: 1,
  colorize: false,
  colorizeHex: '#7a5a3a',
}

export type NoiseDistribution = 'uniform' | 'gaussian'

// ── Light Leak / Film Burn ──

/**
* Preset ids for the built-in light leak looks. Each preset bakes a set of
* analytical GLSL coefficients (bloom position, radii, colour, falloff) so
* no texture assets are required. 'none' is the disabled/identity state.
*/
export type LightLeakPreset =
  | 'none'
  | 'ember'      // warm amber corner bloom: classic summer film look
  | 'halo'       // soft pink/magenta centre-edge glow
  | 'arctic'     // cool cyan-white leak from top-left
  | 'dusk'       // orange–red diagonal burn
  | 'prism'      // multi-spot rainbow leak
  | 'overburn'   // aggressive full-corner warm overexposure

export const LIGHT_LEAK_PRESETS: { id: LightLeakPreset; label: string }[] = [
  { id: 'none',     label: 'None'     },
  { id: 'ember',    label: 'Ember'    },
  { id: 'halo',     label: 'Halo'     },
  { id: 'arctic',   label: 'Arctic'   },
  { id: 'dusk',     label: 'Dusk'     },
  { id: 'prism',    label: 'Prism'    },
  { id: 'overburn', label: 'Overburn' },
]

export interface LightLeakParams {
  /** Active preset id. 'none' = effect disabled. */
  preset: LightLeakPreset
  /** Master intensity multiplier [0..1]. 0 = transparent even when preset != 'none'. */
  intensity: number
  /** Rotation of the leak pattern in degrees around the image centre.
   *  Lets the user re-aim a corner burn or change a diagonal's direction
   *  without needing a new preset. 0 = shader-defined default. */
  rotation: number
  /** Spread multiplier on the bloom σ. 1 = preset as-authored;
   *  >1 expands the bloom so the leak reaches further into the frame
   *  (toward the opposite edges); <1 tightens it into a localised spot. */
  spread: number
}

export interface VignetteParams {
  /** -1..+1: negative darkens edges, positive brightens them. */
  amount: number
  /** 0..1: falloff start distance from center. */
  radius: number
  /** 0..1: feathering amount of the falloff band. */
  softness: number
  /** -1..+1: shape of the falloff. -1 = square (rectangular crop
   *  matched), +1 = perfectly round, 0 = Cernix's pre-v21 default
   *  (slightly rounded). Maps to a Lp-norm distance metric in the
   *  shader: round = L2, square = L∞. */
  roundness: number
  /** 0..1: restores highlights inside a darkening vignette so blown
   *  street lights / specular spots survive the corner roll-off. No
   *  effect when amount > 0 (a brightening vignette doesn't need it). */
  highlightContrast: number
}

export const DEFAULT_VIGNETTE: VignetteParams = {
  amount: 0,
  radius: 0.8,
  softness: 0.5,
  roundness: 0,
  highlightContrast: 0,
}

/**
 * Camera calibration (PV2012 primaries). Per-primary hue
 * and saturation biases applied as a colorimetric foundation before
 * any creative adjustment. Many premium Lightroom presets bake on
 * top of these. Ignoring them skews the imported look noticeably,
 * especially on portraits (skin tones live close to the red primary).
 *
 * Implementation note: this is *not* a full DCP profile catalog.
 * Real PV2012 calibration drives a colour-matrix shift derived from
 * camera-specific calibration data; we approximate the user-facing
 * sliders with a per-primary hue rotation and saturation scaling
 * weighted by RGB channel dominance. The result matches LR's slider
 * output closely on natural images; loading an arbitrary DCP file
 * is a separate program (out of phase 14 scope).
 */
export interface CalibrationPrimary {
  /** Hue shift in [-1..+1]; the shader maps this into a small hue
   *  rotation gated by how much of this primary is present. */
  hue: number
  /** Saturation bias in [-1..+1]; multiplies (1 + sat × weight)
   *  in the per-primary block. */
  sat: number
}

export interface Calibration {
  red: CalibrationPrimary
  green: CalibrationPrimary
  blue: CalibrationPrimary
}

const ZERO_CAL_PRIMARY: CalibrationPrimary = { hue: 0, sat: 0 }
export const DEFAULT_CALIBRATION: Calibration = {
  red:   { ...ZERO_CAL_PRIMARY },
  green: { ...ZERO_CAL_PRIMARY },
  blue:  { ...ZERO_CAL_PRIMARY },
}

/**
 * Perspective transform. Manual sliders matching the
 * Lightroom Transform panel. Vertical/Horizontal keystone, Aspect
 * stretch, and X/Y translate. Each is in [-1..+1]; identity at zero.
 *
 * Implementation note: rotation and uniform scale are *deliberately
 * not* in this struct because they're already covered by
 * `straightenDeg` and the existing `imageTransform.scale`/free-
 * transform overlay. Adding them again would invite drift between
 * the two paths. The Upright auto modes (Auto / Level / Vertical /
 * Full) are out of scope. Those need line-fitting feature detection
 * and can ship as a follow-up.
 */
export interface Perspective {
  /** Vertical keystone correction. -1 narrows the top, +1 narrows
   *  the bottom. Counter-keystone for looking up/down at a wall. */
  vertical: number
  /** Horizontal keystone correction. -1 narrows the left, +1
   *  narrows the right. */
  horizontal: number
  /** Aspect bias along the Y axis. -1 squishes vertically, +1
   *  stretches vertically (independent of zoom). */
  aspect: number
  /** Post-perspective translation in normalised UV space. */
  x: number
  y: number
}

export const DEFAULT_PERSPECTIVE: Perspective = {
  vertical: 0, horizontal: 0, aspect: 0, x: 0, y: 0,
}

/**
 * Crop rectangle in normalized source-image coordinates (0..1 each).
 * Identity = full frame (0,0,1,1). Editor never trims pixels in the live
 * preview. `exportFullResolution` honors the rect at render time.
 */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

// ── Masks ──

/**
* Linear-gradient mask. Two points in normalized UV image coords
* [0..1]. The mask weight is 1.0 at `start`, falls off to 0.0 at
* `end`. The gradient direction is perpendicular to the line between
* the two points.
*/
export interface LinearMask {
  startX: number
  startY: number
  endX: number
  endY: number
}

/**
 * Radial mask. Ellipse defined in normalized UV image coords [0..1].
 * `feather` widens the smoothstep falloff band as a fraction of the
 * smaller radius; 0 = hard edge, 1 = fully soft. When `invert` is true
 * the mask applies outside the ellipse instead of inside it.
 */
export interface RadialMask {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Falloff band width as a fraction of the smaller radius (0..1). */
  feather: number
  /** When true the mask applies outside the ellipse. */
  invert: boolean
}

/**
 * Per-mask tone/color deltas. Values are additive on top of the global
 * adjustment result and share the same units as their global
 * counterparts. Zero on every field = transparent (no effect).
 *
 * Schema (v22): two strata.
 *
 * **Tone deltas** (exposure → vibrance) compose per-pixel through
 * `applyMaskTone` in the shader: each enabled mask's contribution is
 * `weight × delta` summed into the running colour. Identity at zero.
 *
 * **Spatial deltas** (texture → nrColor) modulate the matching global
 * pass's effective amount per pixel rather than running their own
 * per-mask spatial pass. The global pass runs once with
 * `effective = global + Σ_i weight_i × delta_i`, which preserves
 * Lightroom's regional-amount semantics at one-pass cost. This avoids
 * the 8× pipeline blowup that running the spatial pass per-mask would
 * incur on full-coverage masks.
 */
export interface MaskAdjustments {
  // Light + Color (tone deltas)
  exposure: number      // -3..+3
  contrast: number      // -0.5..+0.5
  highlights: number    // -1..+1
  shadows: number       // -1..+1
  whites: number        // -1..+1
  blacks: number        // -1..+1
  temperature: number   // -5000..+5000
  tint: number          // -1..+1
  saturation: number    // -1..+1
  vibrance: number      // -1..+1

  // Presence + Detail (spatial deltas. Modulate the global pass amount)
  texture: number       // -1..+1
  clarity: number       // -1..+1
  dehaze: number        // -1..+1
  sharpenAmount: number // -1..+1 (signed: negative reduces global sharpening in this region)
  nrLuma: number        // -1..+1
  nrColor: number       // -1..+1
  // Lens correction (spatial deltas). Modulate the
  // global defringe pass's effective amount per pixel; same pattern
  // as texture / clarity / etc.
  defringePurple: number // -1..+1
  defringeGreen: number  // -1..+1
}

export const DEFAULT_MASK_ADJUSTMENTS: MaskAdjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, temperature: 0, tint: 0,
  saturation: 0, vibrance: 0,
  texture: 0, clarity: 0, dehaze: 0,
  sharpenAmount: 0, nrLuma: 0, nrColor: 0,
  defringePurple: 0, defringeGreen: 0,
}

/** Per-mask field count for the GLSL `u_mask_adjustments` flat array.
 *  Mirrors the field count in `MaskAdjustments`; keep in lockstep
 *  with the GLSL struct layout. */
export const MASK_ADJUSTMENT_FIELDS = 18

export type MaskType = 'linear' | 'radial' | 'brush'

/**
 * Brush mask. Vector strokes that get rasterised into an alpha
 * texture at render time. Each stroke is a polyline of points with
 * per-stroke radius / hardness / opacity / mode, captured from the
 * user's pointer. Vectors (not bitmaps) so the mask resamples cleanly
 * at any zoom and stays human-readable in the XMP sidecar.
 */
export interface BrushStrokePoint { x: number; y: number }
export interface BrushStroke {
  points: BrushStrokePoint[]
  /** Brush radius as a fraction of the image's longer edge [0..1]. */
  radius: number
  /** 0 = soft edge (Gaussian falloff), 1 = hard edge. */
  hardness: number
  /** Per-stroke opacity in [0..1]. */
  opacity: number
  /** 'paint' adds to the mask; 'erase' subtracts. */
  mode: 'paint' | 'erase'
}
export interface BrushMask {
  strokes: BrushStroke[]
}

export const DEFAULT_BRUSH_MASK: BrushMask = { strokes: [] }

/**
 * Optional intersect filter that gates the parametric mask weight by a
 * tonal or colour range. Multiplied with the base mask weight per
 * pixel; when `mode = 'off'` the gate is identity and shader fast-
 * paths it. `min`/`max`/`feather` are normalised [0..1]; for colour
 * mode the distance is measured against `sampleColor` (stored as a
 * normalised RGB triple) in HSL hue space with a saturation gate.
 */
export type RangeMaskMode = 'off' | 'luminance' | 'color'

export interface RangeMask {
  mode: RangeMaskMode
  min: number
  max: number
  feather: number
  /** RGB triple in [0..1]^3: the colour the user sampled (eyedropper). */
  sampleColor: [number, number, number]
}

export const DEFAULT_RANGE_MASK: RangeMask = {
  mode: 'off',
  min: 0,
  max: 1,
  feather: 0.2,
  sampleColor: [1, 0, 0],
}

export interface Mask {
  /** Stable identifier: generated once on creation, never changes. */
  id: string
  type: MaskType
  /** When false the mask is skipped in the shader and hidden in export. */
  enabled: boolean
  shape: LinearMask | RadialMask | BrushMask
  adjustments: MaskAdjustments
  /** Optional range-mask intersect. Omitted on legacy masks; the shader
   *  treats `undefined` as `mode: 'off'`. */
  range?: RangeMask
  /** When true, the shader applies `1 - w` to the mask weight, so
   *  the mask covers the complement of its shape. Distinct from
   *  `RadialMask.shape.invert`, which is a geometric flip baked into
   *  the shape itself. */
  invert?: boolean
 /** Per-mask vector parameters. Each block evaluates
   *  the same math as its global counterpart and `mix()`es into the
   *  running colour by mask weight. Identity (every band/primary at
   *  zero) short-circuits the per-mask evaluation entirely; the
   *  shader fast-paths via `u_mask_vec_enabled[i]` so masks that
   *  only set scalar deltas pay zero vector cost. */
  hsl?: HslAdjustments
  colorGrading?: ColorGrading
  calibration?: Calibration
 /** Per-mask tone curve. All eight slots' LUTs share a
   *  single 256×MAX_MASKS RGBA atlas texture (one row per slot) so
   *  the texture-unit cost is fixed at 1 regardless of how many masks
   *  use a curve. Identity (the default 2-point straight line) skips
   *  the per-pixel sample via `u_mask_curve_enabled[i]`. */
  toneCurve?: ToneCurve
}

/** Maximum number of simultaneous masks the shader supports. */
export const MAX_MASKS = 8

// ── Heal / Clone spots ──

/**
* Spot retouching primitive. Each spot defines a destination circle
* (where the user clicked) and a source circle (where the patch is
* sampled from). The shader copies the source neighbourhood into the
* destination with feathered alpha, optionally colour-matched to the
* destination's local average (heal mode) or copied verbatim (clone).
*
*  - `dest`/`src` are in normalised image UV [0..1].
*  - `radius` is a fraction of the longer image edge, isotropic in
*    pixels (the shader corrects for aspect ratio).
*  - `feather` widens the alpha falloff band as a fraction of the
*    radius (0 = hard edge, 1 = fully soft).
*  - `opacity` scales the final alpha.
*  - `mode = 'heal'` blends the source patch with a local-average
*    colour shift so it matches the destination's tone; `clone` skips
*    the colour transfer.
*/
export type HealMode = 'heal' | 'clone'

export interface HealSpot {
  id: string
  destX: number
  destY: number
  srcX: number
  srcY: number
  radius: number
  feather: number
  opacity: number
  mode: HealMode
}

/** Maximum spots the shader uniform budget supports. */
export const MAX_HEAL_SPOTS = 16

export const DEFAULT_HEAL_SPOT: Omit<HealSpot, 'id' | 'destX' | 'destY' | 'srcX' | 'srcY'> = {
  radius: 0.04,
  feather: 0.5,
  opacity: 1,
  mode: 'heal',
}

export const FULL_FRAME_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

export const ASPECT_PRESETS: { label: string; ratio: number | null }[] = [
  { label: 'Free',  ratio: null },
  { label: '1:1',   ratio: 1 },
  { label: '3:2',   ratio: 3 / 2 },
  { label: '4:5',   ratio: 4 / 5 },
  { label: '16:9',  ratio: 16 / 9 },
]

/** Discrete image orientation (degrees, clockwise). */
export type Orientation = 0 | 90 | 180 | 270

export interface EditParams {
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
  /** Texture (Lightroom presence): mid-frequency contrast at ~10 px
   *  radius. Positive boosts mid-frequency detail (skin pores, fabric
   *  weave); negative softens it (smooths skin). Range [-1..+1]. */
  texture: number
  /** Clarity (Lightroom presence): local contrast at ~30 px radius,
   *  gated by mid-tone luminance so it doesn't crush shadows or blow
   *  highlights. Range [-1..+1]. Positive adds punch, negative gives
   *  a hazy / dreamy look. */
  clarity: number
  /** Dehaze (Lightroom presence): atmospheric haze removal /
   *  addition via dark-channel-prior approximation. Samples the same
   *  wide Gaussian blur Clarity uses, computes a per-pixel dark
   *  channel from the blur (`min(R,G,B)`), and divides out a near-
   *  white haze layer. Positive removes haze (boosts contrast in
   *  hazy regions); negative adds haze (blends toward atmospheric
   *  white in shadows). Range [-1..+1]. */
  dehaze: number
  toneCurve: ToneCurve
  hsl: HslAdjustments
  selectiveColor: SelectiveColor
  colorGrading: ColorGrading
  defringe: Defringe
  sharpening: Sharpening
  noiseReduction: NoiseReduction
  noiseAmount: number
  noiseMono: boolean
  noiseDistribution: NoiseDistribution
  /** Grain size: 0 = ~2000-grain density across the long edge
   *  (Cernix default, Lightroom Size ≈ 25), 1 = chunkier ~500-grain
   *  density (Size ≈ 100). Scales the spatial frequency of the hash
   *  function so grain reads as bigger blobs at the same amount. */
  noiseSize: number
  /** Grain frequency: 0 = uniform random per pixel (default),
   *  1 = clustered into low-frequency cells (matches Lightroom's
   *  "Roughness" / Grain Frequency slider; emulates film stocks
   *  where grain clumps rather than scatters). */
  noiseFrequency: number
  bw: BlackAndWhite
  crop: CropRect
  orientation: Orientation
  flipH: boolean
  straightenDeg: number
  /** Frame preset id; null = no frame. See `frame-presets.ts`. */
  frame: string | null
  /** Free transform of the image inside the canvas. `scale > 1` enlarges
   *  (centered on the image); `panX`/`panY` are normalized fractions of
   *  the image's own bounds (0.5 = shifted by half the image width).
   *  Baked into `GeometryParams` so the export and preview share one
   *  matrix. What you see in the editor is what lands in the JPEG. */
  imageTransform: ImageTransform
  /** Masks (linear + radial + brush + AI). Up to MAX_MASKS entries;
   *  order is significant. Later entries paint on top. */
  masks: Mask[]
  /** Heal / clone spots. Up to MAX_HEAL_SPOTS entries; applied at the
   *  top of the fragment shader so every subsequent adjustment lands
   *  on the corrected pixels. */
  healSpots: HealSpot[]
  /** Film light leak / burn overlay. */
  lightLeak: LightLeakParams
  /** Corner falloff (vignette). Amount < 0 darkens, > 0 brightens. */
  vignette: VignetteParams
 /** Camera calibration baseline. Per-primary hue + sat
   *  biases applied before any creative tweak; identity at all-zero. */
  calibration: Calibration
 /** Manual perspective transform: keystone + aspect
   *  + translate. Rotation and uniform scale are owned by
   *  `straightenDeg` / `imageTransform` to keep the two free-
   *  transform paths from drifting. */
  perspective: Perspective
 /** Lens-distortion correction. [-1..+1]; negative
   *  corrects barrel distortion, positive corrects pincushion. */
  lensDistortion: number
}

export interface ImageTransform {
  scale: number
  panX: number
  panY: number
}

export const IDENTITY_IMAGE_TRANSFORM: ImageTransform = { scale: 1, panX: 0, panY: 0 }

export const HSL_RANGES: readonly HslRange[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']

export const IDENTITY_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

export const DEFAULT_TONE_CURVE: ToneCurve = {
  luma: [...IDENTITY_CURVE],
  r:    [...IDENTITY_CURVE],
  g:    [...IDENTITY_CURVE],
  b:    [...IDENTITY_CURVE],
}

const ZERO_BAND: HslBand = { h: 0, s: 0, l: 0 }
export const DEFAULT_HSL: HslAdjustments = {
  red:     { ...ZERO_BAND },
  orange:  { ...ZERO_BAND },
  yellow:  { ...ZERO_BAND },
  green:   { ...ZERO_BAND },
  aqua:    { ...ZERO_BAND },
  blue:    { ...ZERO_BAND },
  purple:  { ...ZERO_BAND },
  magenta: { ...ZERO_BAND },
}

const ZERO_SC_BAND: SelectiveColorBand = { c: 0, m: 0, y: 0, k: 0 }
export const DEFAULT_SELECTIVE_COLOR: SelectiveColor = {
  red:     { ...ZERO_SC_BAND },
  yellow:  { ...ZERO_SC_BAND },
  green:   { ...ZERO_SC_BAND },
  cyan:    { ...ZERO_SC_BAND },
  blue:    { ...ZERO_SC_BAND },
  magenta: { ...ZERO_SC_BAND },
}

export const DEFAULT_PARAMS: EditParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  toneCurve: DEFAULT_TONE_CURVE,
  hsl: DEFAULT_HSL,
  selectiveColor: DEFAULT_SELECTIVE_COLOR,
  colorGrading: DEFAULT_COLOR_GRADING,
  defringe: DEFAULT_DEFRINGE,
  sharpening: DEFAULT_SHARPENING,
  noiseReduction: DEFAULT_NOISE_REDUCTION,
  noiseAmount: 0,
  noiseMono: true,
  noiseDistribution: 'gaussian',
  noiseSize: 0,
  noiseFrequency: 0,
  bw: DEFAULT_BLACK_AND_WHITE,
  crop: FULL_FRAME_CROP,
  orientation: 0,
  flipH: false,
  straightenDeg: 0,
  frame: null,
  imageTransform: IDENTITY_IMAGE_TRANSFORM,
  masks: [],
  healSpots: [],
  lightLeak: { preset: 'none', intensity: 0.5, rotation: 0, spread: 1 },
  vignette: DEFAULT_VIGNETTE,
  calibration: DEFAULT_CALIBRATION,
  perspective: DEFAULT_PERSPECTIVE,
  lensDistortion: 0,
}

/**
 * Fields excluded from preset save/apply. A preset is a pure colour recipe:
 * exposure/tone sliders, curves, HSL, selective color, B&W. Everything
 * else is deliberately out: per-image framing (crop/orientation/flip/
 * straighten/frame/imageTransform), per-image masks, and texture/
 * overlay effects (grain, vignette, light leak) that read as a
 * different kind of edit (a "finish") not a "look." This keeps
 * presets transferable across any image without trashing framing or
 * stamping unrelated grain/vignette on top of it.
 */
const PRESET_EXCLUDED_KEYS = [
  // Geometry
  'crop', 'orientation', 'flipH', 'straightenDeg', 'frame', 'imageTransform',
  // Per-image masks + retouching
  'masks', 'healSpots',
  // Texture / overlay effects
  'noiseAmount', 'noiseMono', 'noiseDistribution', 'noiseSize', 'noiseFrequency', 'vignette', 'lightLeak',
  // Per-image detail recovery. Sharpening / NR depend on the source's
  // sensor noise + resolution + viewing scale, so embedding them in a
  // creative "look" preset would force inappropriate strengths onto
  // other images. Defringe stays in (it's a fixed-strength cleanup).
  'sharpening', 'noiseReduction',
] as const satisfies readonly (keyof EditParams)[]

/**
  * Return a copy of `params` with every non-colour field reset to its
  * default. Used on preset save so new presets never persist geometry,
  * masks, grain, vignette, or light leaks.
  */
export function stripForPreset(params: EditParams): EditParams {
  const out = { ...params }
  for (const k of PRESET_EXCLUDED_KEYS) {
    (out as unknown as Record<string, unknown>)[k] = (DEFAULT_PARAMS as unknown as Record<string, unknown>)[k]
  }
  return out
}

/**
 * Overlay a preset's colour fields onto the current params while keeping
 * every non-colour field (framing, masks, grain, vignette, light leak)
 * from the current image untouched. Legacy presets that persisted those
 * fields before `stripForPreset` existed still behave correctly on apply
 * because this path preserves current values regardless of what the
 * preset file carries.
 */
export function applyPresetOverCurrent(preset: EditParams, current: EditParams): EditParams {
  const merged = { ...preset }
  for (const k of PRESET_EXCLUDED_KEYS) {
    (merged as unknown as Record<string, unknown>)[k] = (current as unknown as Record<string, unknown>)[k]
  }
  return merged
}
