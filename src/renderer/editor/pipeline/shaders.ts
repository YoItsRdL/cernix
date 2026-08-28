/** GLSL ES 3.0 source for the editor's rendering pipeline. */

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform mat3 u_transform;
uniform mat2 u_straighten;
// (x, y, w, h) of the active crop in normalized image coords. Identity
// (0, 0, 1, 1) samples the full texture. When non-identity, the texture
// sampling is remapped so only the crop region fills the rendered quad.
// The *vertex* placement is already aspect-fit to the crop by the CPU.
uniform vec4 u_cropUV;
out vec2 v_uv;
void main() {
  vec3 p = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  
  // Rotate UVs around the center before applying the crop mapping.
  // This keeps the rendered quad axis-aligned while straightening pixels.
  vec2 uv = u_straighten * (a_uv - 0.5) + 0.5;
  v_uv = u_cropUV.xy + uv * u_cropUV.zw;
}`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;

uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;

uniform sampler2D u_curveLut;
uniform bool u_curveEnabled;

// HSL bands: 8 hue ranges x 3 adjustments (h, s, l each in -1..+1).
// Hue centres match Lightroom Classic so preset libraries import 1:1.
uniform vec3 u_hsl_red;      // 0.000
uniform vec3 u_hsl_orange;   // 0.083
uniform vec3 u_hsl_yellow;   // 0.167
uniform vec3 u_hsl_green;    // 0.333
uniform vec3 u_hsl_aqua;     // 0.500
uniform vec3 u_hsl_blue;     // 0.667
uniform vec3 u_hsl_purple;   // 0.833
uniform vec3 u_hsl_magenta;  // 0.917
uniform bool u_hslEnabled;

// Selective Color: 6 hue ranges x (c, m, y, k) each in -1..+1.
uniform vec4 u_sc_red;
uniform vec4 u_sc_yellow;
uniform vec4 u_sc_green;
uniform vec4 u_sc_cyan;
uniform vec4 u_sc_blue;
uniform vec4 u_sc_magenta;
uniform bool u_scEnabled;

// Colour grading: 3 tonal bands, each (hue [0..1], sat [0..1], lum [-1..+1]).
// blend widens band overlap (Gaussian sigma); balance shifts band centres
// along the tonal range (-1 toward shadows, +1 toward highlights).
uniform bool  u_cgEnabled;
uniform vec3  u_cgShadows;
uniform vec3  u_cgMidtones;
uniform vec3  u_cgHighlights;
// Global tint applied with weight = 1.0 across every luminance band
// (sits on top of the per-band tints). Mirrors Lightroom Classic.
uniform vec3  u_cgGlobal;
uniform float u_cgBlend;
uniform float u_cgBalance;

// Defringe (chromatic aberration): two amounts in [0..1]. 0 = pass-through.
uniform float u_defringePurple;
uniform float u_defringeGreen;
// Per-fringe hue range [lo..hi] in normalised hue space. Centred
// defaults match Lightroom Classic; user-adjustable for unusual
// fringe palettes (older lenses, IR-pass filters, etc.).
uniform float u_defringePurpleHueLo;
uniform float u_defringePurpleHueHi;
uniform float u_defringeGreenHueLo;
uniform float u_defringeGreenHueHi;

// Texture + Clarity (Lightroom's Presence pair). Both are
// unsharp-mask variants on top of an FBO-backed Gaussian blur of
// the source; u_blurNarrow (~10 px sigma) drives Texture (mid-
// frequency detail), u_blurWide (~30 px sigma) drives Clarity
// (mid-tone local contrast). The blur passes run before this
// fragment program; consumers here just sample. When both amounts
// are zero, the binder skips the blur runs entirely (placeholder
// 1x1 textures stay bound on the texture units).
uniform sampler2D u_blurNarrow;
uniform sampler2D u_blurWide;
uniform float u_textureAmount;
uniform float u_clarityAmount;
// Dehaze. Reuses u_blurWide as the spatial-min source
// for the dark-channel-prior approximation; no extra sampler unit.
// Positive removes haze, negative adds it.
uniform float u_dehazeAmount;

// Camera calibration. Per-primary hue + sat biases.
// Applied before WB so it acts as a colorimetric foundation rather
// than a creative tweak. Each primary's effect is gated by RGB
// channel dominance, so red.hue rotates only red-leaning pixels,
// blue.sat scales saturation only where blue is the major channel.
uniform float u_calRedHue;
uniform float u_calRedSat;
uniform float u_calGreenHue;
uniform float u_calGreenSat;
uniform float u_calBlueHue;
uniform float u_calBlueSat;

// Perspective transform. 3x3 homography composed CPU-
// side from the user-facing sliders (vertical/horizontal keystone,
// aspect, x/y translate). Identity matrix when every slider is 0.
// Applied per-fragment because non-affine homography doesn't survive
// the vertex-stage linear interpolation.
uniform mat3 u_perspective;
// Lens distortion. Single Brown-Conrady k1 coefficient;
// 0 = pass-through, negative corrects barrel, positive corrects
// pincushion. Applied per-fragment as a radial polynomial warp.
uniform float u_lensDistortion;

// Sharpening.
//   amount. Strength multiplier
//   radius. Gaussian σ in pixels for the FBO blur (Lightroom Radius
//              0.5..3.0). When > 0, applySharpening samples u_blurSharpen
//              instead of the local 4-tap cross.
//   detail. Lightroom-style halo suppression (0 = only strong edges
//              pass the smoothstep gate, 1 = bare highpass. Fine
//              detail and grain amplified).
//   masking. Edge-gradient gating (0 = sharpen everything, 1 = only
//              on strong edges).
uniform float u_sharpenAmount;
uniform float u_sharpenRadius;
uniform float u_sharpenDetail;
uniform float u_sharpenMasking;
uniform sampler2D u_blurSharpen;
// Noise reduction: luminance + chroma blur strengths in [0..1].
uniform float u_nrLuma;
uniform float u_nrColor;

uniform float u_noiseAmount;
uniform bool  u_noiseMono;
uniform int   u_noiseDist; // 0 = uniform, 1 = gaussian
// 0 = ~2000-grain density (default, Lightroom Size ≈ 25), 1 = chunkier
// ~500-grain density (Size ≈ 100). Scales the spatial frequency.
uniform float u_noiseSize;
// 0 = uniform per-pixel (default), 1 = clustered into low-frequency
// cells. Multiplies grain by a slow-modulation envelope so grain
// reads as clumpy film stock rather than scattered.
uniform float u_noiseFrequency;

uniform bool  u_bwEnabled;
uniform bool  u_bwColorize;
uniform vec3  u_bwTint;
// Eight per-hue luminance weights, ordered to match HSL_RANGES:
// red(0), orange(0.083), yellow(0.167), green(0.333),
// aqua(0.5), blue(0.667), purple(0.833), magenta(0.917).
uniform float u_bwWeights[8];

// Masks: up to 8 slots. Each is a packed struct of uniforms.
// u_mask_shape: linear = (startX, startY, endX, endY)
//               radial = (cx, cy, rx, ry)
// u_mask_adjustments: 16 floats per slot. Layout:
//   0..8   tone deltas. Exposure, contrast, highlights, shadows,
//          whites, blacks, temperature, tint, saturation
//   9      vibrance (tone delta)
//   10..15 spatial deltas. Texture, clarity, dehaze, sharpenAmount,
//          nrLuma, nrColor. These don't run their own per-mask spatial
//          pass; they modulate the matching global pass's effective
//          amount (effective = global + Σ_i weight_i × delta_i).
// u_mask_flags: x = type (0=linear,1=radial), y = enabled (0/1)
// u_mask_feather_invert: x = feather, y = invert (0/1)   [radial only]
// u_mask_range_mode:     0 = off, 1 = luminance, 2 = colour
// u_mask_range_band:     (min, max, feather). Semantics depend on mode
// u_mask_range_color:    sample colour (r, g, b) for colour mode
#define MASK_SLOTS 8
#define MASK_FIELDS 18
uniform vec4  u_mask_shape[MASK_SLOTS];
uniform float u_mask_adjustments[MASK_SLOTS * MASK_FIELDS];
// Per-mask vector params. Layout per slot:
//   u_mask_vec_hsl: 8 bands × (h, s, l) = 24 floats. Order matches HSL_RANGES
//   u_mask_vec_cg:  4 bands × (h, s, l) + (balance, blend) = 14 floats.
//                   Order shadows, midtones, highlights, global, then balance + blend
//   u_mask_vec_cal: 3 primaries × (hue, sat) = 6 floats. Order red, green, blue
// u_mask_vec_enabled[i] = 1 iff slot i has any non-identity vector
// block. The shader fast-paths the per-mask vector evaluation through
// this flag so masks with only scalar deltas pay zero vector cost.
uniform float u_mask_vec_hsl[MASK_SLOTS * 24];
uniform float u_mask_vec_cg[MASK_SLOTS * 14];
uniform float u_mask_vec_cal[MASK_SLOTS * 6];
uniform int   u_mask_vec_enabled[MASK_SLOTS];
// Per-mask tone curve atlas. One row per slot, 256 px
// wide, RGBA (R/G/B = per-channel curves, A = luma curve. Same
// layout as the global u_curveLut). Atlas height = MASK_SLOTS;
// row v = (slot + 0.5) / MASK_SLOTS to land on the row centre and
// avoid bilinear bleed across rows.
uniform sampler2D u_mask_curve_atlas;
uniform int u_mask_curve_enabled[MASK_SLOTS];
uniform ivec2 u_mask_flags[MASK_SLOTS];
uniform vec2  u_mask_feather_invert[MASK_SLOTS];
uniform int   u_mask_range_mode[MASK_SLOTS];
uniform vec3  u_mask_range_band[MASK_SLOTS];
uniform vec3  u_mask_range_color[MASK_SLOTS];
// Per-slot top-level invert flag (0/1). Distinct from the geometric
// invert baked into RadialMask.shape. This one applies post-weight
// (w = 1.0 - w) so it works uniformly across linear / radial /
// brush masks. Note that nothing in the app sets it today: the flag
// is in the schema and honoured here, and no surface writes it.
uniform int   u_mask_invert[MASK_SLOTS];
// Per-slot brush mask textures (alpha = mask weight). Indexed by slot
// since GLSL ES 3.00 disallows non-constant indexing into sampler
// arrays. One named uniform per slot keeps the shader portable.
uniform sampler2D u_mask_brush_0;
uniform sampler2D u_mask_brush_1;
uniform sampler2D u_mask_brush_2;
uniform sampler2D u_mask_brush_3;
uniform sampler2D u_mask_brush_4;
uniform sampler2D u_mask_brush_5;
uniform sampler2D u_mask_brush_6;
uniform sampler2D u_mask_brush_7;

// Visualise Spots. When enabled, main() bypasses the
// whole pipeline at top-of-frame and writes a contrast-stretched
// grayscale Laplacian of the source. Dust spots, sensor artefacts,
// and any high-frequency anomaly the user wants to find before
// running the heal tool. Sensitivity scales the contrast stretch
// (lower = only the strongest anomalies survive; higher = subtle
// pixel-scale noise also reads).
uniform bool  u_visualizeSpots;
uniform float u_visualizeSensitivity;

// Selected-mask outline. Holds the slot index whose boundary should be
// traced on the rendered output, or -1 for no outline. Driven by the
// MaskPanel's current selectedId so the user sees exactly which region
// a mask covers. Works for all mask types via the same edge-detect
// pass (linear falloff, radial feather, brush stroke edge).
uniform int u_outline_mask_slot;

// Heal / clone spots. Each enabled slot copies a circular patch from
// the source neighbourhood at u_heal_src[i] into the destination at
// u_heal_dest[i], with feathered alpha and (in heal mode) a local
// mean-colour shift so the patch matches the destination's tone.
//   u_heal_dest:   normalised image UV centre of the destination disc.
//   u_heal_src:    normalised image UV centre of the source disc.
//   u_heal_params: (radius, feather, opacity).
//                  radius. Fraction of the longer image edge.
//                  feather. Width of the alpha falloff band as a
//                            fraction of radius (0 = hard, 1 = soft).
//                  opacity. Final alpha multiplier in [0..1].
//   u_heal_mode:   0 = clone (raw copy), 1 = heal (copy + colour match).
//   u_heal_count:  number of active slots; loop bound (0 = pass-through).
#define HEAL_SLOTS 16
uniform int   u_heal_count;
uniform vec2  u_heal_dest[HEAL_SLOTS];
uniform vec2  u_heal_src[HEAL_SLOTS];
uniform vec3  u_heal_params[HEAL_SLOTS];
uniform int   u_heal_mode[HEAL_SLOTS];

// Light leak / film burn
// Preset encoded as an integer (0=none, 1=ember, 2=halo, 3=arctic,
// 4=dusk, 5=prism, 6=overburn). Master intensity in [0..1].
uniform int   u_llPreset;
uniform float u_llIntensity;
uniform float u_llRotation; // radians, rotates the leak pattern around (0.5, 0.5)
uniform float u_llSpread;   // σ multiplier; 1 = preset as-authored, >1 reaches further

uniform float u_vignetteAmount;
uniform float u_vignetteRadius;
uniform float u_vignetteSoftness;
// roundness: -1 (square Lp=∞ falloff) → +1 (round Lp=2 falloff).
// 0 picks the legacy distance metric so existing edits round-trip
// visually unchanged at default.
uniform float u_vignetteRoundness;
// 0..1; restores highlights inside a darkening vignette so blown
// specular spots survive the corner roll-off. No-op when amount > 0.
uniform float u_vignetteHighlightContrast;

out vec4 outColor;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Per-band tonal weight for colour grading. Gaussian centred at the
// band centre with sigma derived from the global blend slider (clamped
// so a wide spread doesn't flatten the bands into a single uniform tint).
float cgBandWeight(float L, float centre, float sigma) {
  float d = (L - centre) / sigma;
  return exp(-0.5 * d * d);
}

// Apply one tonal-band tint. band = (hue [0..1], sat [0..1], lum [-1..+1]).
// Builds a target colour from hue+sat at mid-luminance, mixes the pixel
// toward it weighted by sat * weight, then nudges luma by lum * weight.
vec3 cgApplyBand(vec3 c, vec3 band, float weight) {
  if (weight <= 0.0001 || (band.y == 0.0 && band.z == 0.0)) return c;
  vec3 target = hsv2rgb(vec3(band.x, band.y, 1.0));
  float mixAmt = clamp(band.y * weight * 0.6, 0.0, 1.0);
  vec3 tinted = mix(c, c * target * 1.5, mixAmt);
  // Lum offset: scale the result around mid-grey for symmetrical
  // brighten/darken, weighted by the band.
  float lumScale = 1.0 + band.z * weight * 0.6;
  return tinted * lumScale;
}

// Three-band colour grading. Bands are anchored at 0.18 / 0.5 / 0.82
// luma by default; balance shifts all three together so the user can
// re-aim the trio without re-touching every band individually.
vec3 applyColorGrading(vec3 c) {
  if (!u_cgEnabled) return c;
  float L = clamp(luma(c), 0.0, 1.0);
  float bal = u_cgBalance * 0.18;
  float sCentre = clamp(0.18 + bal, 0.05, 0.95);
  float mCentre = clamp(0.50 + bal, 0.05, 0.95);
  float hCentre = clamp(0.82 + bal, 0.05, 0.95);
  float sigma = mix(0.12, 0.32, clamp(u_cgBlend, 0.0, 1.0));
  float wS = cgBandWeight(L, sCentre, sigma);
  float wM = cgBandWeight(L, mCentre, sigma);
  float wH = cgBandWeight(L, hCentre, sigma);
  float total = max(wS + wM + wH, 1e-3);
  wS /= total; wM /= total; wH /= total;
  c = cgApplyBand(c, u_cgShadows,    wS);
  c = cgApplyBand(c, u_cgMidtones,   wM);
  c = cgApplyBand(c, u_cgHighlights, wH);
  // Global tint sits on top with full weight. Affects every pixel
  // regardless of luminance, on top of the per-band shifts above.
  c = cgApplyBand(c, u_cgGlobal,     1.0);
  return clamp(c, 0.0, 1.0);
}

// Hue distance on a circular [0,1]. Returns smoothstep weight peaking at center.
float rangeWeight(float h, float center) {
  float d = abs(h - center);
  d = min(d, 1.0 - d);
  return 1.0 - smoothstep(0.0, 0.12, d);
}

// High-quality hash for pseudo-random [0..1) per pixel.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Box-Muller: two uniform samples -> one N(0,1) value. Guards log(0).
float gaussNoise(vec2 p) {
  float u1 = max(hash12(p), 1e-6);
  float u2 = hash12(p + vec2(19.19, 47.3));
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

// ── DRY tone-color delta function ──
//
// Applies a set of additive tone/color deltas to color [c] at weight [w].
// Shared by the global pass (w=1) and every mask slot (w=mask weight).
// Parameters match the per-slot packed array layout:
//   p[0]=exposure, p[1]=contrast, p[2]=highlights, p[3]=shadows,
//   p[4]=whites,   p[5]=blacks,   p[6]=temperature, p[7]=tint,
//   p[8]=saturation, p[9]=vibrance.
// (p[10..15] are spatial deltas, not applied here; they modulate
//  the global texture/clarity/dehaze/sharpen/NR pass amounts at the
//  top of main() and are read directly from u_mask_adjustments.)
vec3 applyMaskTone(vec3 c, float w, float p0, float p1, float p2, float p3,
                                    float p4, float p5, float p6, float p7,
                                    float p8, float p9) {
  if (w <= 0.0) return c;

  // White balance
  float tempScale = p6 / 5000.0;
  vec3 wb = c;
  wb.r *= 1.0 + tempScale * 0.3;
  wb.b *= 1.0 - tempScale * 0.3;
  wb.g *= 1.0 - p7 * 0.2;

  // Exposure
  wb *= exp2(p0);

  // Tone zones
  float l = luma(wb);
  float wHigh  = smoothstep(0.5, 1.0, l);
  float wShad  = 1.0 - smoothstep(0.0, 0.5, l);
  float wWhite = smoothstep(0.7, 1.0, l);
  float wBlack = 1.0 - smoothstep(0.0, 0.3, l);
  wb *= 1.0 + p2 * wHigh  * 0.5;
  wb *= 1.0 + p3 * wShad  * 0.5;
  wb *= 1.0 + p4 * wWhite * 0.4;
  wb *= 1.0 + p5 * wBlack * 0.4;

  // Contrast
  wb = (wb - 0.5) * (1.0 + p1) + 0.5;

  // Saturation + Vibrance. Vibrance prefers under-saturated pixels
  // (matches the global pass): boost = (1 - sat) × vibrance, applied
  // before the linear saturation gain so a high-vibrance + low-sat
  // mask reads correctly.
  vec3 hsv = rgb2hsv(max(wb, 0.0));
  float vibBoost = (1.0 - hsv.y) * p9;
  hsv.y = clamp(hsv.y * (1.0 + p8) + vibBoost, 0.0, 1.0);
  wb = hsv2rgb(hsv);

  return mix(c, wb, w);
}

// Per-mask vector tone. Evaluates the slot's HSL,
// Color Grading, and Calibration blocks against the current colour
// in the same order as the global pipeline (Calibration first as a
// foundation, CG mid, HSL on top), and returns the modified colour.
// Caller mix()es by the mask weight. u_mask_vec_enabled gates the
// whole call so masks with only scalar deltas pay zero.
//
// Math here mirrors applyCalibration / applyColorGrading / the global
// HSL pass. Kept inline so per-slot uniform offsets can be indexed
// without an outer arg-pack copy. Identity short-circuit on each
// block keeps a CG-only mask from running HSL math, etc.
vec3 applyMaskVectorTone(vec3 c, int slot) {
  // ── Calibration ──
  int kb = slot * 6;
  float kRH = u_mask_vec_cal[kb + 0];
  float kRS = u_mask_vec_cal[kb + 1];
  float kGH = u_mask_vec_cal[kb + 2];
  float kGS = u_mask_vec_cal[kb + 3];
  float kBH = u_mask_vec_cal[kb + 4];
  float kBS = u_mask_vec_cal[kb + 5];
  if (kRH != 0.0 || kRS != 0.0 || kGH != 0.0 || kGS != 0.0 || kBH != 0.0 || kBS != 0.0) {
    float wR = max(0.0, 2.0 * c.r - c.g - c.b);
    float wG = max(0.0, 2.0 * c.g - c.r - c.b);
    float wB = max(0.0, 2.0 * c.b - c.r - c.g);
    float total = max(wR + wG + wB, 1e-3);
    wR /= total; wG /= total; wB /= total;
    vec3 hsv = rgb2hsv(max(c, 0.0));
    float hueShift = (kRH * wR + kGH * wG + kBH * wB) * 0.028;
    float satMult  = 1.0 + (kRS * wR + kGS * wG + kBS * wB);
    hsv.x = fract(hsv.x + hueShift + 1.0);
    hsv.y = clamp(hsv.y * satMult, 0.0, 1.0);
    c = hsv2rgb(hsv);
  }

  // ── Color Grading (4-band tonal tint) ──
  int cb = slot * 14;
  float cgSh = u_mask_vec_cg[cb + 1] + abs(u_mask_vec_cg[cb + 2]);
  float cgMd = u_mask_vec_cg[cb + 4] + abs(u_mask_vec_cg[cb + 5]);
  float cgHi = u_mask_vec_cg[cb + 7] + abs(u_mask_vec_cg[cb + 8]);
  float cgGl = u_mask_vec_cg[cb + 10] + abs(u_mask_vec_cg[cb + 11]);
  if (cgSh > 0.0 || cgMd > 0.0 || cgHi > 0.0 || cgGl > 0.0) {
    float L = clamp(luma(c), 0.0, 1.0);
    float bal = u_mask_vec_cg[cb + 12] * 0.18;
    float blend = u_mask_vec_cg[cb + 13];
    float sigma = mix(0.18, 0.36, clamp(blend, 0.0, 1.0));
    float wS = cgBandWeight(L, clamp(0.18 + bal, 0.05, 0.95), sigma);
    float wM = cgBandWeight(L, clamp(0.50 + bal, 0.05, 0.95), sigma);
    float wH = cgBandWeight(L, clamp(0.82 + bal, 0.05, 0.95), sigma);
    vec3 bandS = vec3(u_mask_vec_cg[cb + 0], u_mask_vec_cg[cb + 1], u_mask_vec_cg[cb + 2]);
    vec3 bandM = vec3(u_mask_vec_cg[cb + 3], u_mask_vec_cg[cb + 4], u_mask_vec_cg[cb + 5]);
    vec3 bandH = vec3(u_mask_vec_cg[cb + 6], u_mask_vec_cg[cb + 7], u_mask_vec_cg[cb + 8]);
    vec3 bandG = vec3(u_mask_vec_cg[cb + 9], u_mask_vec_cg[cb + 10], u_mask_vec_cg[cb + 11]);
    c = cgApplyBand(c, bandS, wS);
    c = cgApplyBand(c, bandM, wM);
    c = cgApplyBand(c, bandH, wH);
    c = cgApplyBand(c, bandG, 1.0);
  }

  // ── HSL (8 bands) ──
  int hb = slot * 24;
  // Cheap identity check: hue/sat/lum for any band non-zero.
  float hslSum = 0.0;
  for (int j = 0; j < 24; j++) hslSum += abs(u_mask_vec_hsl[hb + j]);
  if (hslSum > 0.0) {
    vec3 hsv = rgb2hsv(max(c, 0.0));
    float h = hsv.x;
    float wR  = rangeWeight(h, 0.000);
    float wO  = rangeWeight(h, 0.083);
    float wY  = rangeWeight(h, 0.167);
    float wG  = rangeWeight(h, 0.333);
    float wA  = rangeWeight(h, 0.500);
    float wBl = rangeWeight(h, 0.667);
    float wP  = rangeWeight(h, 0.833);
    float wM  = rangeWeight(h, 0.917);
    float hueShift =
      u_mask_vec_hsl[hb + 0]  * wR  * 0.08 +
      u_mask_vec_hsl[hb + 3]  * wO  * 0.08 +
      u_mask_vec_hsl[hb + 6]  * wY  * 0.08 +
      u_mask_vec_hsl[hb + 9]  * wG  * 0.08 +
      u_mask_vec_hsl[hb + 12] * wA  * 0.08 +
      u_mask_vec_hsl[hb + 15] * wBl * 0.08 +
      u_mask_vec_hsl[hb + 18] * wP  * 0.08 +
      u_mask_vec_hsl[hb + 21] * wM  * 0.08;
    float satDelta =
      u_mask_vec_hsl[hb + 1]  * wR  +
      u_mask_vec_hsl[hb + 4]  * wO  +
      u_mask_vec_hsl[hb + 7]  * wY  +
      u_mask_vec_hsl[hb + 10] * wG  +
      u_mask_vec_hsl[hb + 13] * wA  +
      u_mask_vec_hsl[hb + 16] * wBl +
      u_mask_vec_hsl[hb + 19] * wP  +
      u_mask_vec_hsl[hb + 22] * wM;
    float lumDelta =
      u_mask_vec_hsl[hb + 2]  * wR  +
      u_mask_vec_hsl[hb + 5]  * wO  +
      u_mask_vec_hsl[hb + 8]  * wY  +
      u_mask_vec_hsl[hb + 11] * wG  +
      u_mask_vec_hsl[hb + 14] * wA  +
      u_mask_vec_hsl[hb + 17] * wBl +
      u_mask_vec_hsl[hb + 20] * wP  +
      u_mask_vec_hsl[hb + 23] * wM;
    hsv.x = fract(hsv.x + hueShift + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + satDelta), 0.0, 1.0);
    hsv.z = clamp(hsv.z * (1.0 + lumDelta * 0.5), 0.0, 1.0);
    c = hsv2rgb(hsv);
  }

  return c;
}

// Per-mask tone curve sampler. All eight slots' LUTs
// share one 256×MASK_SLOTS RGBA atlas. Single texture unit, fixed
// cost regardless of how many masks use a curve. Channel layout
// matches the global u_curveLut (R = r curve, G = g curve, B = b
// curve, A = luma curve). The caller mix()es by mask weight; the
// inline u_mask_curve_enabled gate at the call site means disabled
// rows are never sampled.
vec3 applyMaskCurve(vec3 c, int slot) {
  // Row centre. The 0.5 offset lands on the texel centre and
  // protects against bilinear bleed into adjacent rows on drivers
  // that don't honour NEAREST exactly at integer coords.
  float v = (float(slot) + 0.5) / float(MASK_SLOTS);
  c = clamp(c, 0.0, 1.0);
  vec3 curved;
  curved.r = texture(u_mask_curve_atlas, vec2(c.r, v)).r;
  curved.g = texture(u_mask_curve_atlas, vec2(c.g, v)).g;
  curved.b = texture(u_mask_curve_atlas, vec2(c.b, v)).b;
  // Luma curve: scale RGB to match the curved luma while preserving
  // hue. Same trick the global path uses.
  float y = luma(curved);
  float yCurved = texture(u_mask_curve_atlas, vec2(y, v)).a;
  return curved * (yCurved / max(y, 1e-4));
}

// Linear-gradient mask weight: 1.0 at start line, 0.0 at end line.
// uv is the current texel in normalized image coords [0..1].
float linearWeight(vec2 uv, vec4 mask) {
  vec2 start = mask.xy;
  vec2 end   = mask.zw;
  vec2 dir   = end - start;
  float len2 = dot(dir, dir);
  if (len2 < 1e-10) return 0.0;
  // Project uv onto the start->end axis. t=0 at start, t=1 at end.
  // smoothstep (Hermite ease-in-out) clamps and shapes the transition:
  // a linear ramp reads harsh at the edges even when the handles are
  // far apart, because there's no easing at t=0 and t=1.
  float t = dot(uv - start, dir) / len2;
  return 1.0 - smoothstep(0.0, 1.0, t);
}

// Radial filter mask weight: 1.0 inside ellipse, 0.0 outside (or inverted).
// feather_invert.x = feather [0..1], feather_invert.y = invert flag.
float radialWeight(vec2 uv, vec4 mask, vec2 feather_invert) {
  vec2  center  = mask.xy;
  vec2  radii   = mask.zw;
  float feather = feather_invert.x;
  bool  invert  = feather_invert.y > 0.5;
  if (radii.x < 1e-6 || radii.y < 1e-6) return 0.0;
  // Normalized ellipse distance: 0 at center, 1 at rim.
  vec2 d = (uv - center) / radii;
  float dist = length(d);
  float rMin = max(0.0, 1.0 - feather);
  float w = 1.0 - smoothstep(rMin, 1.0, dist);
  return invert ? (1.0 - w) : w;
}

// Brush-mask sampler. The slot argument selects which texture to
// sample from (0..7); the alpha channel carries the per-pixel mask
// weight in [0..1]. Constant-index switch keeps the shader within
// the WebGL2 portability envelope.
float brushSample(int slot, vec2 uv) {
  if (slot == 0) return texture(u_mask_brush_0, uv).a;
  if (slot == 1) return texture(u_mask_brush_1, uv).a;
  if (slot == 2) return texture(u_mask_brush_2, uv).a;
  if (slot == 3) return texture(u_mask_brush_3, uv).a;
  if (slot == 4) return texture(u_mask_brush_4, uv).a;
  if (slot == 5) return texture(u_mask_brush_5, uv).a;
  if (slot == 6) return texture(u_mask_brush_6, uv).a;
  return texture(u_mask_brush_7, uv).a;
}

// Range-mask intersect: gates the parametric mask weight by tonal or
// colour range. Multiplied with the base weight per pixel.
//   mode 0 = off (returns 1.0. Shader fast-paths)
//   mode 1 = luminance: band = (min, max, feather), all in [0..1]
//   mode 2 = colour:    band.z = tolerance feather; sample = target RGB
float rangeWeight(vec3 c, int mode, vec3 band, vec3 sampleRgb) {
  if (mode == 0) return 1.0;
  if (mode == 1) {
    float L = clamp(luma(c), 0.0, 1.0);
    float feather = max(band.z, 0.001);
    float lo = smoothstep(band.x - feather, band.x, L);
    float hi = 1.0 - smoothstep(band.y, band.y + feather, L);
    return clamp(lo * hi, 0.0, 1.0);
  }
  // Colour mode: hue distance to sampleRgb. Saturation gate spares
  // near-neutral pixels (they have no meaningful hue to match).
  vec3 pixelHsv  = rgb2hsv(max(c, 0.0));
  if (pixelHsv.y < 0.05) return 0.0;
  vec3 sampleHsv = rgb2hsv(max(sampleRgb, 0.0));
  float dHue = abs(pixelHsv.x - sampleHsv.x);
  dHue = min(dHue, 1.0 - dHue);
  float tolerance = 0.04;
  float falloff = max(band.z * 0.30, 0.005);
  return 1.0 - smoothstep(tolerance, tolerance + falloff, dHue);
}

// ── Heal / Clone ──
//
// For each spot whose destination disc covers the current pixel, sample
// the source neighbourhood at the matching offset. In heal mode, shift
// the sample by the difference between the local mean colour at the
// destination and at the source, so the patch carries the source's
// detail but the destination's tone (Lightroom-style spot heal).
//
// Aspect-correction: radius is authored as a fraction of the longer
// edge in pixel space, so we scale the destination delta by
// textureSize(u_source) before length-checking. This keeps the disc
// circular regardless of image aspect.
//
// Single-pass; the local-mean estimate is a 4-tap cross sampled at
// half-radius, which is good enough for the small disc sizes the spot
// tool produces. Skip the whole block when count == 0.
vec3 applyHealSpots(vec3 c, vec2 uv) {
  if (u_heal_count == 0) return c;
  vec2 dim = vec2(textureSize(u_source, 0));
  // Convert UV deltas to pixel deltas so the disc is round under any
  // aspect ratio, then divide by the longer edge so radius matches its
  // authored unit (fraction of the longer edge).
  float longEdge = max(dim.x, dim.y);
  for (int i = 0; i < HEAL_SLOTS; i++) {
    if (i >= u_heal_count) break;
    vec3 p = u_heal_params[i];
    float radius  = p.x;
    float feather = clamp(p.y, 0.0, 1.0);
    float opacity = clamp(p.z, 0.0, 1.0);
    if (radius <= 0.0 || opacity <= 0.0) continue;

    vec2 dest = u_heal_dest[i];
    vec2 src  = u_heal_src[i];
    vec2 dPx  = (uv - dest) * dim;
    float distNorm = length(dPx) / longEdge;
    if (distNorm >= radius) continue;

    // Inner edge of the falloff band; smoothstep returns 0 outside the
    // disc and 1 at distNorm <= rInner.
    float rInner = radius * (1.0 - feather);
    float alpha  = (1.0 - smoothstep(rInner, radius, distNorm)) * opacity;
    if (alpha <= 0.0) continue;

    // Sample the source at the matching pixel offset, converted back
    // into UV space. This preserves the source's high-frequency detail
    // around its centre.
    vec2 srcUv = src + (uv - dest);
    vec3 sampled = texture(u_source, srcUv).rgb;

    if (u_heal_mode[i] == 1) {
      // Heal mode: 4-tap cross at radius * 0.5 estimates local mean
      // colour at both endpoints. Shift the sample so its mean matches
      // the destination's, preserving its texture/detail.
      float halfR = radius * 0.5 * longEdge;
      vec2 offX = vec2(halfR, 0.0) / dim;
      vec2 offY = vec2(0.0, halfR) / dim;
      vec3 dMean = (
        texture(u_source, dest + offX).rgb +
        texture(u_source, dest - offX).rgb +
        texture(u_source, dest + offY).rgb +
        texture(u_source, dest - offY).rgb
      ) * 0.25;
      vec3 sMean = (
        texture(u_source, src + offX).rgb +
        texture(u_source, src - offX).rgb +
        texture(u_source, src + offY).rgb +
        texture(u_source, src - offY).rgb
      ) * 0.25;
      sampled = sampled + (dMean - sMean);
    }

    c = mix(c, sampled, alpha);
  }
  return c;
}

// ── Light Leak helpers ──

// Radial Gaussian bloom centred at (cx,cy) with isotropic sigma. The
// per-preset sigma is scaled by u_llSpread so the user can expand
// each bloom's reach. Bigger spread means the leak bleeds further
// from its anchor toward the opposite edges.
// Returns a [0..1] scalar. uv is in normalised image coords.
float leakBloom(vec2 uv, float cx, float cy, float sigma) {
  vec2 d = uv - vec2(cx, cy);
  // Correct for aspect ratio so the bloom is visually round
  d.x *= 1.5; // typical landscape aspect; good enough as an approximation
  float effSigma = sigma * max(u_llSpread, 1e-3);
  float r2 = dot(d, d) / max(effSigma * effSigma, 1e-6);
  return exp(-r2 * 0.5);
}

// Screen blend: c + bloom - c*bloom  (never overflows to 1 harshly)
vec3 screenBlend(vec3 base, vec3 top) {
  return 1.0 - (1.0 - base) * (1.0 - top);
}

// Evaluate the active light-leak preset at [uv] and blend onto [c].
vec3 applyLightLeak(vec3 c, vec2 uv, int preset, float intensity, float rotation) {
  if (preset == 0 || intensity <= 0.0) return c;

  // Rotate uv around the image centre so presets can be re-aimed. The
  // preset bloom centres are all authored in the unrotated frame; we
  // transform uv into that frame instead of the centres.
  if (rotation != 0.0) {
    float s = sin(rotation);
    float k = cos(rotation);
    vec2 p = uv - vec2(0.5);
    uv = vec2(k * p.x - s * p.y, s * p.x + k * p.y) + vec2(0.5);
  }

  vec3 leak = vec3(0.0);

  if (preset == 1) {
    // Ember: warm amber from bottom-right corner + faint orange from top-left
    float b1 = leakBloom(uv, 1.05,  1.05, 0.55);
    float b2 = leakBloom(uv, -0.05, -0.05, 0.40);
    leak  = b1 * vec3(1.0, 0.55, 0.10) * 0.90
          + b2 * vec3(1.0, 0.40, 0.05) * 0.45;
  } else if (preset == 2) {
    // Halo: pink/magenta glow from top-right + soft warm centre ring
    float b1 = leakBloom(uv, 1.10, -0.10, 0.60);
    float b2 = leakBloom(uv,  0.50,  0.50, 0.90);
    leak  = b1 * vec3(1.0, 0.25, 0.65) * 0.80
          + b2 * vec3(1.0, 0.70, 0.30) * 0.25;
  } else if (preset == 3) {
    // Arctic: cool cyan-white from top-left + pale blue wash
    float b1 = leakBloom(uv, -0.10, -0.10, 0.50);
    float b2 = leakBloom(uv,  0.30,  0.20, 0.70);
    leak  = b1 * vec3(0.55, 0.85, 1.0) * 0.80
          + b2 * vec3(0.40, 0.60, 1.0) * 0.30;
  } else if (preset == 4) {
    // Dusk: orange-red diagonal burn across image
    float b1 = leakBloom(uv,  1.10, -0.10, 0.65);
    float b2 = leakBloom(uv, -0.10,  1.10, 0.55);
    float b3 = leakBloom(uv,  0.50,  0.50, 1.20);
    leak  = b1 * vec3(1.0, 0.25, 0.05) * 0.75
          + b2 * vec3(1.0, 0.50, 0.10) * 0.65
          + b3 * vec3(1.0, 0.30, 0.00) * 0.20;
  } else if (preset == 5) {
    // Prism: multi-spot rainbow leak (warm + cool + green)
    float b1 = leakBloom(uv, 1.05, -0.05, 0.40);
    float b2 = leakBloom(uv, -0.05, 1.05, 0.40);
    float b3 = leakBloom(uv,  0.50,  0.00, 0.35);
    leak  = b1 * vec3(1.0, 0.20, 0.60) * 0.70   // magenta top-right
          + b2 * vec3(0.20, 0.80, 1.0)  * 0.65   // cyan bottom-left
          + b3 * vec3(0.50, 1.0,  0.20) * 0.40;  // green top-centre
  } else if (preset == 6) {
    // Overburn: aggressive warm blow-out from all four corners
    float b1 = leakBloom(uv,  1.0,  0.0, 0.70);
    float b2 = leakBloom(uv,  0.0,  0.0, 0.70);
    float b3 = leakBloom(uv,  0.0,  1.0, 0.60);
    float b4 = leakBloom(uv,  1.0,  1.0, 0.60);
    leak  = (b1 + b2 + b3 + b4) * vec3(1.0, 0.55, 0.15) * 0.55;
  }

  leak = clamp(leak * intensity, 0.0, 1.0);
  // Screen blend so leak brightens without destructively clamping shadows
  return screenBlend(c, leak);
}

// ── Noise Reduction ──
//
// Single-pass bilateral on a 3×3 neighbourhood. The range weight uses
// luminance similarity, so edges survive while flat noisy patches blur
// out. We split the result into luma-only and chroma-only mixes so the
// two sliders can be tuned independently. Chroma noise is always
// lower-frequency than luma noise, so users typically want more of it.
//
// True non-local-means or larger separable Gaussians need an FBO-backed
// multi-pass; the same binder will route to that when the FBO infra
// lands. Zero cost when both amounts are 0 (early return).
vec3 applyNoiseReduction(vec3 c, vec2 uv, float lumaAmount, float colorAmount) {
  if (lumaAmount <= 0.0 && colorAmount <= 0.0) return c;
  vec2 px = 1.0 / vec2(textureSize(u_source, 0));
  float Lc = luma(c);

  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec3 s = texture(u_source, uv + vec2(float(dx), float(dy)) * px).rgb;
      float Ls = luma(s);
      float dL = Lc - Ls;
      // Bilateral range weight: pixels with similar luma carry more
      // weight than edge-crossing neighbours.
      float w = exp(-dL * dL * 80.0);
      sum += s * w;
      wSum += w;
    }
  }
  vec3 blurred = sum / max(wSum, 1e-4);

  // Luma denoise: replace luma with mix(orig, blurred) while preserving hue.
  if (lumaAmount > 0.0) {
    float Lb = luma(blurred);
    float Lnew = mix(Lc, Lb, lumaAmount);
    if (Lc > 1e-4) c *= Lnew / Lc;
    else c = vec3(Lnew);
  }
  // Chroma denoise: replace chroma (rgb minus luma) with mix toward
  // blurred chroma, preserving the (now possibly luma-denoised) Lnew.
  if (colorAmount > 0.0) {
    float Lnow = luma(c);
    vec3 chromaC = c - vec3(Lc); // chroma relative to original luma
    vec3 chromaB = blurred - vec3(luma(blurred));
    vec3 mixedChroma = mix(chromaC, chromaB, colorAmount);
    c = vec3(Lnow) + mixedChroma;
  }
  return c;
}

// ── Sharpening ──
//
// Unsharp mask with Lightroom's four-slider model (Amount / Radius /
// Detail / Masking).
//
// when u_sharpenRadius > 0 the high-pass uses the FBO-
// backed Gaussian (sampled from u_blurSharpen at the user's σ),
// matching Lightroom's variable-radius behaviour. At radius == 0 we
// fall back to the original 4-tap cross. Cheaper, and visually
// identical to the LR identity at that setting.
//
// Detail follows LR's halo-suppression semantics: at detail = 0 a
// smoothstep gate suppresses small-amplitude high-pass values, so the
// sharpen kernel only fires on real edges (clean, halo-free output).
// At detail = 1 the gate opens fully. Fine detail and grain are
// amplified along with edges. Masking is the existing edge-gradient
// gate, applied on top.
vec3 applySharpening(vec3 c, vec2 uv, float amount) {
  if (amount <= 0.0) return c;
  vec2 px = 1.0 / vec2(textureSize(u_source, 0));
  vec3 c0 = texture(u_source, uv).rgb;
  vec3 blur;
  if (u_sharpenRadius > 0.001) {
    blur = texture(u_blurSharpen, uv).rgb;
  } else {
    vec3 cN = texture(u_source, uv + vec2(0.0, -px.y)).rgb;
    vec3 cS = texture(u_source, uv + vec2(0.0,  px.y)).rgb;
    vec3 cE = texture(u_source, uv + vec2( px.x, 0.0)).rgb;
    vec3 cW = texture(u_source, uv + vec2(-px.x, 0.0)).rgb;
    blur = (cN + cS + cE + cW) * 0.25;
  }
  float highpass = luma(c0) - luma(blur);

  // Detail gate: small high-pass amplitudes are suppressed when
  // u_sharpenDetail is low. The smoothstep thresholds are tuned to
  // Lightroom's visual behaviour. At detail=0 a 1/255-step difference
  // is nearly fully suppressed, mid-amplitude (~5% luma) edges pass at
  // half strength, and real edges (>10% luma) survive untouched.
  float gate = smoothstep(0.005, 0.05, abs(highpass));
  float detailGain = mix(gate, 1.0, u_sharpenDetail);

  // Edge mask (gradient magnitude): mix(1, gradient, masking) so
  // masking=0 keeps full strength and masking=1 fully gates by edges.
  float Lr = luma(texture(u_source, uv + vec2( px.x, 0.0)).rgb);
  float Ll = luma(texture(u_source, uv + vec2(-px.x, 0.0)).rgb);
  float Lu = luma(texture(u_source, uv + vec2(0.0, -px.y)).rgb);
  float Ld = luma(texture(u_source, uv + vec2(0.0,  px.y)).rgb);
  float gradient = abs(Lr - Ll) + abs(Lu - Ld);
  float edgeGate = smoothstep(0.02, 0.15, gradient);
  float edge = mix(1.0, edgeGate, u_sharpenMasking);

  float sharpDelta = highpass * detailGain * amount * 2.0 * edge;
  float L = luma(c);
  float Lnew = clamp(L + sharpDelta, 0.0, 1.0);
  if (L > 1e-4) c *= Lnew / L;
  return c;
}

// ── Defringe ──
//
// Detects purple / green chromatic-aberration fringes on high-contrast
// edges and desaturates them toward the local luminance. Three gates
// stack to keep legitimate purple flowers and green grass intact:
//   1. Edge-only. Luminance gradient over a 4-tap cross sample. Flat
//      regions are never touched.
//   2. Hue-only. Narrow smoothstep window around the canonical fringe
//      hues (~0.78 for purple, ~0.33 for green).
//   3. Saturation-gated. Only chromatic pixels qualify; pure-grey
//      neighbours of an edge stay untouched.
//
// Single-pass: samples u_source four times for the gradient, mixes the
// pixel toward grey at strength = amount * edge * hue * sat. Cheap.
// Hue-window weight: 1.0 inside [lo..hi], smooth-falloff to 0
// outside. Falloff width is a small fraction of the band width so a
// narrow user-tuned range still has a clean edge. Handles the
// wraparound case (lo > hi) so a band can straddle 0.0/1.0 cleanly.
float hueBandWeight(float h, float lo, float hi) {
  float feather = max((hi - lo) * 0.25, 0.005);
  if (lo <= hi) {
    return smoothstep(lo - feather, lo, h) * (1.0 - smoothstep(hi, hi + feather, h));
  }
  float upper = smoothstep(lo - feather, lo, h);
  float lower = 1.0 - smoothstep(hi, hi + feather, h);
  return max(upper, lower);
}

// amounts come in as parameters so the masks loop can
// modulate them regionally. Same pattern as the other spatial
// features. The hue-window uniforms stay global; LR
// doesn't expose per-mask hue range either.
vec3 applyDefringe(vec3 c, vec2 uv, float purpleAmount, float greenAmount) {
  if (purpleAmount <= 0.0 && greenAmount <= 0.0) return c;
  vec2 px = 1.0 / vec2(textureSize(u_source, 0));
  float Lc = luma(c);
  float Lr = luma(texture(u_source, uv + vec2( px.x, 0.0)).rgb);
  float Ll = luma(texture(u_source, uv + vec2(-px.x, 0.0)).rgb);
  float Lu = luma(texture(u_source, uv + vec2(0.0, -px.y)).rgb);
  float Ld = luma(texture(u_source, uv + vec2(0.0,  px.y)).rgb);
  float gradient = abs(Lr - Ll) + abs(Lu - Ld);
  float edge = smoothstep(0.04, 0.18, gradient);
  if (edge <= 0.0) return c;

  vec3 hsv = rgb2hsv(max(c, 0.0));
  if (hsv.y < 0.10) return c; // already neutral; nothing to defringe

  float purpleHue = hueBandWeight(hsv.x, u_defringePurpleHueLo, u_defringePurpleHueHi);
  float greenHue  = hueBandWeight(hsv.x, u_defringeGreenHueLo,  u_defringeGreenHueHi);

  float strength = clamp(
    purpleAmount * purpleHue + greenAmount * greenHue, 0.0, 1.0
  ) * edge * smoothstep(0.10, 0.30, hsv.y);

  return mix(c, vec3(Lc), strength);
}

// Texture. Mid-frequency unsharp mask using the
// pre-rendered narrow-radius Gaussian blur. Positive amount adds
// mid-frequency detail (skin pores, fabric weave); negative softens
// it (smooths skin). Edge-protected by the same gradient gate the
// other detail passes use, so flat regions don't pick up halos.
//
// amount comes in as a parameter so the masks loop can
// modulate it regionally. Effective = u_textureAmount + sum_i(w_i * delta_i).
vec3 applyTexture(vec3 c, vec2 uv, float amount) {
  if (abs(amount) < 0.001) return c;
  vec3 blur = texture(u_blurNarrow, uv).rgb;
  vec3 highpass = c - blur;
  // Gentle edge-mask: amplify by gradient so flat patches don't
  // gain noise at high amounts.
  vec2 px = 1.0 / vec2(textureSize(u_source, 0));
  float Lr = luma(texture(u_source, uv + vec2( px.x, 0.0)).rgb);
  float Ll = luma(texture(u_source, uv + vec2(-px.x, 0.0)).rgb);
  float Lu = luma(texture(u_source, uv + vec2(0.0, -px.y)).rgb);
  float Ld = luma(texture(u_source, uv + vec2(0.0,  px.y)).rgb);
  float gradient = abs(Lr - Ll) + abs(Lu - Ld);
  float edge = smoothstep(0.005, 0.08, gradient);
  // Negative amount: blend toward the blur (smoothing). Positive
  // amount: add the highpass back. Symmetric envelope so the slider
  // reads the same in both directions.
  if (amount > 0.0) {
    return c + highpass * amount * edge * 1.0;
  }
  return mix(c, blur, -amount * 0.6);
}

// Clarity. Mid-tone local contrast: an unsharp variant on
// the wide-radius blur, gated by mid-tone luminance so it doesn't
// crush shadows or blow highlights. Lightroom-style envelope.
vec3 applyClarity(vec3 c, vec2 uv, float amount) {
  if (abs(amount) < 0.001) return c;
  vec3 blur = texture(u_blurWide, uv).rgb;
  vec3 highpass = c - blur;
  float L = luma(c);
  // Mid-tone gate: peak at L=0.5, falls off toward shadows/highlights.
  float midGate = 1.0 - abs(L - 0.5) * 2.0;
  midGate = clamp(midGate, 0.0, 1.0);
  if (amount > 0.0) {
    return c + highpass * amount * midGate * 0.8;
  }
  // Negative clarity: hazy / dreamy mix toward the wide blur.
  return mix(c, blur, -amount * midGate * 0.6);
}

// Dehaze. Dark-channel-prior approximation using the
// already-computed wide Gaussian blur of the source. The dark
// channel. The per-pixel min of the RGB channels in a spatial
// neighbourhood. Is the canonical estimator of haze thickness:
// haze pushes every channel toward the atmospheric light, so the
// minimum channel value is what's left "behind" the haze. We
// approximate that spatial neighbourhood with the wide blur
// (sigma=30 px); for the moderate radii dehaze targets the
// difference vs the formal min-over-window is well below the JND
// for most photos.
//
// Recovery model (positive amount): J = (I - A) / max(t, t_min) + A
// where t = 1 - omega * darkChannel / |A| and A is the atmospheric
// light. We assume A near-white (haze is approximately neutral)
// instead of running a full atmospheric-light estimation pass,
// which would need an additional readback. The compromise is small
// for typical landscapes and saves one render pass per frame.
//
// Negative amount adds haze by blending toward atmospheric light
// gated by the inverse dark channel. Bright regions get more
// haze, shadows are protected.
vec3 applyDehaze(vec3 c, vec2 uv, float amount) {
  if (abs(amount) < 0.001) return c;
  vec3 blur = texture(u_blurWide, uv).rgb;
  float darkChannel = min(blur.r, min(blur.g, blur.b));
  vec3 A = vec3(0.95);
  if (amount > 0.0) {
    // Remove haze. omega = 0.85 keeps a touch of haze for natural
    // depth cues; 1.0 would over-aggressively flatten distance.
    float t = max(1.0 - 0.85 * amount * darkChannel, 0.1);
    vec3 J = (c - A) / t + A;
    return mix(c, clamp(J, 0.0, 1.0), amount);
  }
  // Add haze: stronger in bright regions (dark channel close to
  // 1.0), weaker in shadows where there's no haze to add.
  float strength = -amount * darkChannel * 0.6;
  return mix(c, A, strength);
}

// Perspective + lens distortion. The vertex stage emits
// a linearly-interpolated v_uv across the quad; both transforms
// below run per-fragment because their output is non-affine.
// Composition order is perspective → lens distortion (matches
// Lightroom: perspective is the "geometry of the scene", lens
// distortion is the "geometry of the optic". Applied in shooting
// order outward, undone in reverse on import).
vec2 applyPerspective(vec2 uv) {
  // Skip when matrix is identity (every off-diagonal zero, diagonal
  // ones). Cheap fingerprint. The binder writes mat3(1.0) at rest.
  vec3 p = u_perspective * vec3(uv - 0.5, 1.0);
  return p.xy / max(abs(p.z), 1e-6) + 0.5;
}

vec2 applyLensDistortion(vec2 uv) {
  if (u_lensDistortion == 0.0) return uv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  return 0.5 + d * (1.0 + u_lensDistortion * 0.4 * r2);
}

// Camera calibration. Per-primary hue + sat biases
// gated by RGB channel dominance. weight_R = max(0, 2r - g - b)
// peaks where red is the dominant channel and falls to zero where
// red is no stronger than the average of g/b. Same shape for the
// other primaries. The hue rotation is small (max ±10° at slider
// extreme) since these are calibration nudges, not creative shifts.
vec3 applyCalibration(vec3 c) {
  if (u_calRedHue   == 0.0 && u_calRedSat   == 0.0
   && u_calGreenHue == 0.0 && u_calGreenSat == 0.0
   && u_calBlueHue  == 0.0 && u_calBlueSat  == 0.0) return c;
  float wR = max(0.0, 2.0 * c.r - c.g - c.b);
  float wG = max(0.0, 2.0 * c.g - c.r - c.b);
  float wB = max(0.0, 2.0 * c.b - c.r - c.g);
  // Normalise so a saturated pure red gets weight 1.0; clamp the
  // sum so over-saturated values don't push effects past 100%.
  float total = max(wR + wG + wB, 1e-3);
  wR /= total; wG /= total; wB /= total;

  vec3 hsv = rgb2hsv(max(c, 0.0));
  // Hue rotation, in normalised hue space [0..1] (the shader's
  // existing convention). 0.028 = ~10° / 360° at slider == 1.
  float hueShift = (u_calRedHue * wR + u_calGreenHue * wG + u_calBlueHue * wB) * 0.028;
  // Saturation multiplier. Symmetric envelope so -1 desaturates to
  // grey and +1 doubles saturation in regions dominated by that
  // primary.
  float satMult = 1.0 + (u_calRedSat * wR + u_calGreenSat * wG + u_calBlueSat * wB);
  hsv.x = fract(hsv.x + hueShift + 1.0);
  hsv.y = clamp(hsv.y * satMult, 0.0, 1.0);
  return hsv2rgb(hsv);
}

// Mask weight at a given uv for the requested slot. Same dispatch as
// the masks loop, factored out so the outline pass can reuse it
// without duplicating each shape's math. cBase is the pixel colour
// fed to the range-mask intersect (caller supplies the post-pipeline
// colour; range gating uses what the user sees).
float maskWeightAtSlot(int i, vec2 uv, vec3 cBase) {
  int t = u_mask_flags[i].x;
  float w = 0.0;
  if (t == 0) {
    w = linearWeight(uv, u_mask_shape[i]);
  } else if (t == 1) {
    w = radialWeight(uv, u_mask_shape[i], u_mask_feather_invert[i]);
  } else {
    w = brushSample(i, uv);
  }
  // Top-level invert: flip the shape weight before the range gate.
  // The range gate keeps its semantics (it intersects the post-flip
  // mask with the tonal/colour band), so an inverted mask + range
  // mask still composes as expected.
  if (u_mask_invert[i] != 0) w = 1.0 - w;
  w *= rangeWeight(cBase, u_mask_range_mode[i], u_mask_range_band[i], u_mask_range_color[i]);
  return clamp(w, 0.0, 1.0);
}

void main() {
  // Geometry transforms. Perspective + lens distortion
  // happen first so every downstream sampling site (heal, NR,
  // defringe, presence, masks, sharpening, light leak, vignette,
  // outline) operates on the geometrically-corrected coords.
  vec2 uv = applyLensDistortion(applyPerspective(v_uv));
  vec3 c = texture(u_source, uv).rgb;

  // ── Visualise Spots ──
  // Diagnostic view for the heal tool. Renders the absolute value of
  // the source's discrete Laplacian as a contrast-stretched
  // grayscale, then short-circuits the rest of the pipeline. The
  // Laplacian responds strongly to point-like anomalies (dust,
  // hot pixels, sensor smudges) and is roughly flat on smooth
  // gradients. Exactly the discrimination the user wants when
  // hunting for spots to heal.
  if (u_visualizeSpots) {
    vec2 px = 1.0 / vec2(textureSize(u_source, 0));
    float Lc = luma(texture(u_source, uv).rgb);
    float Ln = luma(texture(u_source, uv + vec2(0.0, -px.y)).rgb);
    float Ls = luma(texture(u_source, uv + vec2(0.0,  px.y)).rgb);
    float Le = luma(texture(u_source, uv + vec2( px.x, 0.0)).rgb);
    float Lw = luma(texture(u_source, uv + vec2(-px.x, 0.0)).rgb);
    // 4-point Laplacian: |4Lc - sum(neighbours)|. Rotation-invariant
    // edge / point detector. Diagonal points add ~30% cost without
    // perceptible improvement on real spots.
    float lap = abs(4.0 * Lc - Ln - Ls - Le - Lw);
    // Sensitivity slider [0..1] maps to a contrast-stretch threshold
    // [0.20 .. 0.005]. Low slider = only strong anomalies; high
    // slider = subtle pixel-scale noise also reads. The smoothstep
    // gates the bottom (suppresses film grain at low sensitivity)
    // and the linear scale stretches the result up to readable
    // grayscale.
    float thresh = mix(0.20, 0.005, clamp(u_visualizeSensitivity, 0.0, 1.0));
    float v = smoothstep(thresh * 0.5, thresh * 2.0, lap);
    outColor = vec4(vec3(v), 1.0);
    return;
  }

  // Heal / clone runs at the very top so every downstream adjustment
  // (NR, tone, colour, masks, …) treats the patched pixels as native
  // source data. The dust spot, blemish, or distracting object is
  // gone before anything else runs.
  c = applyHealSpots(c, uv);

  // ── Mask weight hoist ──
  // Mask weights are evaluated once against the post-heal
  // colour (cBase) so range gating is consistent
  // across both the spatial-amount modulation here and the tone
  // mask loop later. This matches Lightroom: "in range for tone"
  // and "in range for sharpen/NR" mean the same set of pixels.
  // Identity short-circuit: disabled slots get weight 0 and skip
  // every downstream loop.
  vec3 cBase = c;
  float maskWeights[MASK_SLOTS];
  for (int i = 0; i < MASK_SLOTS; i++) {
    maskWeights[i] = (u_mask_flags[i].y == 0) ? 0.0 : maskWeightAtSlot(i, uv, cBase);
  }
  // Spatial-amount modulation: the global pass runs once with an
  // effective amount = u_global + sum_i (w_i * delta_i). Cheaper
  // than running each spatial pass per-mask and produces identical
  // pixels at the linear-mix limit.
  float texDelta = 0.0, clDelta = 0.0, dhDelta = 0.0;
  float shDelta = 0.0, nrLDelta = 0.0, nrCDelta = 0.0;
  float dfPDelta = 0.0, dfGDelta = 0.0;
  for (int i = 0; i < MASK_SLOTS; i++) {
    float w = maskWeights[i];
    if (w <= 0.0) continue;
    int b = i * MASK_FIELDS;
    texDelta += w * u_mask_adjustments[b + 10];
    clDelta  += w * u_mask_adjustments[b + 11];
    dhDelta  += w * u_mask_adjustments[b + 12];
    shDelta  += w * u_mask_adjustments[b + 13];
    nrLDelta += w * u_mask_adjustments[b + 14];
    nrCDelta += w * u_mask_adjustments[b + 15];
    dfPDelta += w * u_mask_adjustments[b + 16];
    dfGDelta += w * u_mask_adjustments[b + 17];
  }

  // NR runs next. Clean noise out of the raw signal so downstream
  // tone / colour work amplifies clean pixels, not amplified noise.
  c = applyNoiseReduction(c, uv, u_nrLuma + nrLDelta, u_nrColor + nrCDelta);
  c = applyDefringe(c, uv, u_defringePurple + dfPDelta, u_defringeGreen + dfGDelta);
  // Texture + Clarity sit between detail-recovery and global tone:
  // their unsharp deltas land on clean pixels (post-NR / -defringe)
  // and feed honest contrast/local-contrast into every downstream
  // adjustment.
  c = applyTexture(c, uv, u_textureAmount + texDelta);
  c = applyClarity(c, uv, u_clarityAmount + clDelta);
  c = applyDehaze(c, uv, u_dehazeAmount + dhDelta);
  // Calibration: per-primary hue + sat biases. Foundation tweak,
  // runs before WB / exposure so subsequent creative adjustments
  // stack on a corrected colorimetric base.
  c = applyCalibration(c);

  // ── White balance ──
  float tempScale = u_temperature / 5000.0;
  c.r *= 1.0 + tempScale * 0.3;
  c.b *= 1.0 - tempScale * 0.3;
  c.g *= 1.0 - u_tint * 0.2;

  // ── Exposure ──
  c *= exp2(u_exposure);

  // ── Tone zones ──
  float l = luma(c);
  float wHigh  = smoothstep(0.5, 1.0, l);
  float wShad  = 1.0 - smoothstep(0.0, 0.5, l);
  float wWhite = smoothstep(0.7, 1.0, l);
  float wBlack = 1.0 - smoothstep(0.0, 0.3, l);
  c *= 1.0 + u_highlights * wHigh  * 0.5;
  c *= 1.0 + u_shadows    * wShad  * 0.5;
  c *= 1.0 + u_whites     * wWhite * 0.4;
  c *= 1.0 + u_blacks     * wBlack * 0.4;

  // ── Contrast ──
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;

  // ── Tone curves (per-channel RGB then luma) ──
  if (u_curveEnabled) {
    c = clamp(c, 0.0, 1.0);
    c.r = texture(u_curveLut, vec2(c.r, 0.5)).r;
    c.g = texture(u_curveLut, vec2(c.g, 0.5)).g;
    c.b = texture(u_curveLut, vec2(c.b, 0.5)).b;
    float y = luma(c);
    float yCurved = texture(u_curveLut, vec2(y, 0.5)).a;
    c *= yCurved / max(y, 1e-4);
  }

  // ── Vibrance and Saturation ──
  vec3 hsv = rgb2hsv(max(c, 0.0));
  float vibBoost = (1.0 - hsv.y) * u_vibrance;
  hsv.y = clamp(hsv.y * (1.0 + u_saturation) + vibBoost, 0.0, 1.0);

  // ── Colour Grading (per-band tonal tint) ──
  // Sits between sat/vib and HSL: vib has set the chroma envelope, the
  // band tint gets applied honestly on top, and HSL still gets to
  // retune hue/sat/lum per range afterwards. Skip the rgb<->hsv
  // round-trip entirely when the grade is identity.
  if (u_cgEnabled) {
    c = hsv2rgb(hsv);
    c = applyColorGrading(c);
    hsv = rgb2hsv(max(c, 0.0));
  }

  // ── HSL per color range (8 bands, Lightroom-aligned hue centres) ──
  if (u_hslEnabled) {
    float h = hsv.x;
    float wR  = rangeWeight(h, 0.000);
    float wO  = rangeWeight(h, 0.083);
    float wY  = rangeWeight(h, 0.167);
    float wG  = rangeWeight(h, 0.333);
    float wA  = rangeWeight(h, 0.500);
    float wB  = rangeWeight(h, 0.667);
    float wP  = rangeWeight(h, 0.833);
    float wM  = rangeWeight(h, 0.917);
    float hueShift =
      u_hsl_red.x     * wR * 0.08 +
      u_hsl_orange.x  * wO * 0.08 +
      u_hsl_yellow.x  * wY * 0.08 +
      u_hsl_green.x   * wG * 0.08 +
      u_hsl_aqua.x    * wA * 0.08 +
      u_hsl_blue.x    * wB * 0.08 +
      u_hsl_purple.x  * wP * 0.08 +
      u_hsl_magenta.x * wM * 0.08;
    float satDelta =
      u_hsl_red.y     * wR +
      u_hsl_orange.y  * wO +
      u_hsl_yellow.y  * wY +
      u_hsl_green.y   * wG +
      u_hsl_aqua.y    * wA +
      u_hsl_blue.y    * wB +
      u_hsl_purple.y  * wP +
      u_hsl_magenta.y * wM;
    float lumDelta =
      u_hsl_red.z     * wR +
      u_hsl_orange.z  * wO +
      u_hsl_yellow.z  * wY +
      u_hsl_green.z   * wG +
      u_hsl_aqua.z    * wA +
      u_hsl_blue.z    * wB +
      u_hsl_purple.z  * wP +
      u_hsl_magenta.z * wM;
    hsv.x = fract(hsv.x + hueShift + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + satDelta), 0.0, 1.0);
    hsv.z = clamp(hsv.z * (1.0 + lumDelta * 0.5), 0.0, 1.0);
  }

  c = hsv2rgb(hsv);

  // ── Selective Color ──
  if (u_scEnabled) {
    vec3 cc = clamp(c, 0.0, 1.0);
    float K = 1.0 - max(cc.r, max(cc.g, cc.b));
    vec3 cmy = (K < 0.9999) ? (vec3(1.0) - cc - K) / (1.0 - K) : vec3(0.0);
    float h = hsv.x;
    float s = hsv.y;
    float wR  = rangeWeight(h, 0.00);
    float wY  = rangeWeight(h, 0.167);
    float wG  = rangeWeight(h, 0.333);
    float wCy = rangeWeight(h, 0.5);
    float wB  = rangeWeight(h, 0.667);
    float wM  = rangeWeight(h, 0.833);
    vec4 shift = (u_sc_red     * wR
                + u_sc_yellow  * wY
                + u_sc_green   * wG
                + u_sc_cyan    * wCy
                + u_sc_blue    * wB
                + u_sc_magenta * wM) * s;
    cmy = clamp(cmy + shift.xyz, 0.0, 1.0);
    float Kn = clamp(K + shift.w, 0.0, 1.0);
    c = (vec3(1.0) - cmy) * (1.0 - Kn);
  }

  // ── Black & White channel mixer (8 bands, Lightroom-aligned) ──
  if (u_bwEnabled) {
    float h = hsv.x;
    float s = hsv.y;
    float wR = rangeWeight(h, 0.000);
    float wO = rangeWeight(h, 0.083);
    float wY = rangeWeight(h, 0.167);
    float wG = rangeWeight(h, 0.333);
    float wA = rangeWeight(h, 0.500);
    float wB = rangeWeight(h, 0.667);
    float wP = rangeWeight(h, 0.833);
    float wM = rangeWeight(h, 0.917);
    float totalW = wR + wO + wY + wG + wA + wB + wP + wM;
    float weightedMult = totalW > 0.001
      ? (wR * u_bwWeights[0] + wO * u_bwWeights[1] + wY * u_bwWeights[2] + wG * u_bwWeights[3]
       + wA * u_bwWeights[4] + wB * u_bwWeights[5] + wP * u_bwWeights[6] + wM * u_bwWeights[7]) / totalW
      : 1.0;
    float mixer = mix(1.0, weightedMult, s);
    float gray = clamp(luma(c) * mixer, 0.0, 1.0);
    c = u_bwColorize ? gray * u_bwTint : vec3(gray);
  }

  // ── Masks (linear + radial + brush). Tone + vector deltas ──
  // Reuses maskWeights[] precomputed at the top of main(); range
  // gating already folded in. applyMaskTone consumes the 10 tone
  // fields (exposure..vibrance) at indices 0..9; the spatial fields
  // at 10..17 were already applied via the global-pass amount
  // modulation above.
  //
  // Per-mask vector params (HSL, Color Grading, Calibration) run in
  // the same loop, after the tone deltas, gated
  // by u_mask_vec_enabled[i] so masks with only scalar deltas pay
  // zero extra cost. The result mix()es into c by the same mask
  // weight, preserving the "in range for tone == in range for
  // colour-mix" semantics.
  for (int i = 0; i < MASK_SLOTS; i++) {
    float w = maskWeights[i];
    if (w <= 0.0) continue;
    int b = i * MASK_FIELDS;
    c = applyMaskTone(c, w,
      u_mask_adjustments[b+0], u_mask_adjustments[b+1], u_mask_adjustments[b+2],
      u_mask_adjustments[b+3], u_mask_adjustments[b+4], u_mask_adjustments[b+5],
      u_mask_adjustments[b+6], u_mask_adjustments[b+7], u_mask_adjustments[b+8],
      u_mask_adjustments[b+9]);
    if (u_mask_vec_enabled[i] != 0) {
      vec3 vec = applyMaskVectorTone(c, i);
      c = mix(c, vec, w);
    }
    // Per-mask tone curve. Same weight + mix() pattern
    // as the vector pass; the atlas-LUT gate skips the texture
    // fetch when the slot has no curve.
    if (u_mask_curve_enabled[i] != 0) {
      vec3 curved = applyMaskCurve(c, i);
      c = mix(c, curved, w);
    }
  }

  // ── Sharpening ──
  // Runs after every colour adjustment but before additive grain so
  // the unsharp delta lands on clean tones, not on the grain itself.
  // Amount is regionally modulated: u_sharpenAmount + sum_i (w_i × delta).
  c = applySharpening(c, uv, u_sharpenAmount + shDelta);

  // ── Noise (additive grain) ──
  // Sample at a fixed image-relative density (~2000 grains across
  // the long edge), independent of source resolution. Sampling at
  // per-source-pixel rate on a 24 MP photo displayed at ~700 px
  // reads noise values 6+ source pixels apart for adjacent screen
  // pixels, and the hash12 step at that offset produces a visible
  // cross-hatch moire instead of grain. The fixed density keeps
  // grain looking the same on a 6 MP and a 24 MP photo, and stays
  // well under screen-pixel rate at typical fit-zoom viewing so the
  // noise reads as random rather than aliased. Grain stays anchored
  // to image content (so it tracks pan/zoom) by deriving from uv.
  if (u_noiseAmount > 0.0) {
    vec2 srcSize = vec2(textureSize(u_source, 0));
    // Density scales from 2000 grains across the long edge (size=0)
    // down to ~500 grains (size=1). Bigger size → bigger grain blobs.
    float density = mix(2000.0, 500.0, clamp(u_noiseSize, 0.0, 1.0));
    float grainScale = density / max(srcSize.x, srcSize.y);
    vec2 pix = uv * srcSize * grainScale;
    // Frequency / clumping: a slow hash sampled at ~10x lower
    // density modulates the per-pixel grain. At freq=0 the
    // multiplier is 1 (uniform); at freq=1 it ranges over [0..2]
    // so grain visibly clusters into low-frequency cells.
    float clump = 1.0;
    if (u_noiseFrequency > 0.0) {
      float slow = hash12(floor(pix * 0.1));
      clump = mix(1.0, slow * 2.0, clamp(u_noiseFrequency, 0.0, 1.0));
    }
    if (u_noiseDist == 1) {
      if (u_noiseMono) {
        float n = gaussNoise(pix);
        c += vec3(n) * u_noiseAmount * 0.15 * clump;
      } else {
        vec3 n = vec3(
          gaussNoise(pix),
          gaussNoise(pix + vec2(17.0, 29.0)),
          gaussNoise(pix + vec2(53.0, 71.0))
        );
        c += n * u_noiseAmount * 0.15 * clump;
      }
    } else {
      if (u_noiseMono) {
        float n = hash12(pix) - 0.5;
        c += vec3(n) * u_noiseAmount * 0.35 * clump;
      } else {
        vec3 n = vec3(
          hash12(pix) - 0.5,
          hash12(pix + vec2(17.0, 29.0)) - 0.5,
          hash12(pix + vec2(53.0, 71.0)) - 0.5
        );
        c += n * u_noiseAmount * 0.35 * clump;
      }
    }
  }

  // ── Light leak / film burn ──
  c = applyLightLeak(c, uv, u_llPreset, u_llIntensity, u_llRotation);

  // ── Vignette ──
  if (u_vignetteAmount != 0.0) {
    // Distance metric: blend between L2 (round) and L∞ (square) by
    // roundness. roundness == 0 picks an Lp p≈4 default that
    // matches Cernix's pre-v21 falloff visually. The mix keeps
    // the corner==1.0 normalisation independent of shape.
    vec2 q = abs(uv - 0.5) * 2.0; // 0 at centre, 1 at edge
    float dRound  = length(q) * 0.7071;       // L2, normalised so corner = 1
    float dSquare = max(q.x, q.y);            // L∞
    // Map roundness [-1..+1] → mix factor [1..0] (square at -1, round at +1).
    float roundMix = clamp((u_vignetteRoundness + 1.0) * 0.5, 0.0, 1.0);
    float d = mix(dSquare, dRound, roundMix);

    float inner = u_vignetteRadius * 0.75;
    float outer = inner + (1.2 - inner) * max(0.01, u_vignetteSoftness);
    float v = smoothstep(inner, outer, d);

    // Highlight contrast: when darkening, lift bright pixels back up
    // so specular highlights survive the roll-off. Gated by the
    // user slider; smoothstep on luminance picks the highlights.
    float vEff = v;
    if (u_vignetteAmount < 0.0 && u_vignetteHighlightContrast > 0.0) {
      float hl = smoothstep(0.6, 0.95, luma(c));
      vEff *= 1.0 - hl * u_vignetteHighlightContrast;
    }

    vec3 target = u_vignetteAmount < 0.0 ? vec3(0.0) : vec3(1.0);
    c = mix(c, target, abs(u_vignetteAmount) * vEff);
  }

  // ── Selected-mask outline ──
  // Traces the 0.5 isoline of the selected mask weight: a 4-tap cross
  // around the current pixel checks whether neighbours straddle the
  // threshold. Where they do, paint a bright cyan line so the user
  // sees exactly which region the mask covers, regardless of mask
  // type. Renders independent of the mask's enabled flag. The user
  // wants to see the boundary even while the effect is paused.
  if (u_outline_mask_slot >= 0 && u_outline_mask_slot < MASK_SLOTS) {
    // Translucent brand-blue tint over the masked region. Alpha
    // proportional to mask weight. Works uniformly across mask
    // types: a hard-edged mask shows a clean tinted region with a
    // sharp edge, a feathered or softly brushed one fades across its
    // own gradient. No edge-detection step, so no
    // aliasing artefacts on fuzzy mask boundaries.
    //
    // Same visual idiom as the candidate-picker thumbnails (magenta
    // wash). The user sees one consistent "this is selected"
    // language on both canvas and picker.
    float w = maskWeightAtSlot(u_outline_mask_slot, uv, c);
    vec3 accent = vec3(0.0, 0.467, 1.0); // matches --accent-primary
    c = mix(c, accent, clamp(w, 0.0, 1.0) * 0.35);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
