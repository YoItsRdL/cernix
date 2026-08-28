/**
 * Lightroom Camera Raw XMP preset importer.
 *
 * Reads a `.xmp` preset file, maps its `crs:*` fields to a partial
 * `EditParams` patch, and reports the fields we couldn't apply.
 * The renderer-side `PresetGrid` consumes the patch via the
 * normal `applyAll` write path so the import flows through the
 * same persistence and history paths as a manual edit.
 *
 * **Wire-format normalisation.** Adobe Camera Raw is on its sixth
 * process version; many fields exist in two or three naming
 * conventions across LR's history (e.g. PV2010 `RedHue` and PV2012
 * `Camera2012RedPrimaryHue` are both still in active circulation,
 * sometimes in the same export). This module reads every form we
 * encounter and projects them onto Cernix's single canonical
 * schema. The mappings aren't tech debt. Cernix never *writes*
 * the alternate forms, and Adobe doesn't add new variants. They're
 * one-way interop logic at the import boundary.
 *
 * **Field map** is grouped by section to mirror the Lightroom panel
 * layout. Each block declares the LR field name(s), the Cernix
 * target, and the unit conversion (most LR sliders are in ±100 or
 * 0..100; Cernix uses normalised ranges).
 *
 * **What we don't import on first ship.**
 * - `LensProfileName` + per-profile fields. The lens-profile
 *   catalog is a separate program (thousands of camera/lens
 *   profiles, license-encumbered). The toast surfaces the missing
 *   profile name explicitly.
 * - `LookProfileName` / `CameraProfile` references to Adobe
 *   profile DCPs. Same reason.
 * - `UprightVersion` / `UprightFocalMode35mm`. Upright auto-modes
 *   need feature detection (line fitting on horizon edges); the
 *   manual perspective sliders are imported faithfully but the
 *   auto mode falls back to "off".
 * - Local adjustment masks (`PaintBasedCorrections`,
 *   `CircularGradientBasedCorrections`, `GradientBasedCorrections`):
 * LR usually strips these from saved presets, but if they
 *   appear we surface them rather than silently dropping.
 *
 * Everything else maps 1:1 to a field this app ships and round-trips
 * losslessly.
 */
import type { EditParams, Calibration, Perspective, ToneCurve, CurvePoint } from '@/../shared/edit-params'
import { DEFAULT_PARAMS } from '@/../shared/edit-params'

export interface LightroomImportResult {
  /** Partial patch ready for `ParamsStore.applyAll` over current params. */
  patch: Partial<EditParams>
  /** LR field names we recognised but couldn't render. The UI surfaces
   *  these in a toast so the user knows the preset's intent isn't
   *  100% covered. Empty when every recognised field mapped cleanly. */
  unsupported: string[]
  /** Optional preset name parsed from the XMP header (LR writes
   *  `crs:Name` for user-saved presets, omitted for camera-export
   *  XMPs). Caller may use it as the default when saving the
   *  imported look as an Cernix preset. */
  name: string | null
}

/** Parse an XMP preset string (the file contents) into an EditParams
   *  patch + unsupported-field list. Throws only on a fundamental
   *  parse failure (not XMP, no rdf:Description root); recognised-but-
   *  unsupported fields go into `unsupported` so the caller can show
   *  them. */
export function importLightroomXmp(xml: string): LightroomImportResult {
  if (!/<rdf:Description/.test(xml)) {
    throw new Error('Not a Camera Raw XMP: missing <rdf:Description>')
  }

  const attrs = parseAttrs(xml)
  const patch: Partial<EditParams> = {}
  const unsupported: string[] = []

  // ── Light ──
  applyScalar(patch, attrs, 'Exposure2012',   'exposure',  v => clamp(v * 0.6, -3, 3))
  applyScalar(patch, attrs, 'Contrast2012',   'contrast',  v => clamp(v / 100 * 0.5, -0.5, 0.5))
  applyScalar(patch, attrs, 'Highlights2012', 'highlights', v => v / 100)
  applyScalar(patch, attrs, 'Shadows2012',    'shadows',   v => v / 100)
  applyScalar(patch, attrs, 'Whites2012',     'whites',    v => v / 100)
  applyScalar(patch, attrs, 'Blacks2012',     'blacks',    v => v / 100)

  // ── Color ──
  // LR's Temperature is absolute Kelvin; ours is a delta from a
  // 5500 K baseline.
  if (attrs.has('Temperature')) {
    const k = num(attrs.get('Temperature'))
    if (k != null) patch.temperature = clamp(k - 5500, -5000, 5000)
  }
  applyScalar(patch, attrs, 'Tint',       'tint',       v => clamp(v / 150, -1, 1))
  applyScalar(patch, attrs, 'Vibrance',   'vibrance',   v => v / 100)
  applyScalar(patch, attrs, 'Saturation', 'saturation', v => v / 100)

  // ── Presence ──
  applyScalar(patch, attrs, 'Texture',      'texture', v => v / 100)
  applyScalar(patch, attrs, 'Clarity2012',  'clarity', v => v / 100)
  applyScalar(patch, attrs, 'Dehaze',       'dehaze',  v => v / 100)

  // ── Detail ──
  // Lightroom Sharpening: Amount 0..150, Radius 0.5..3.0 px, Detail
  // 0..100, Masking 0..100. Our schema mirrors LR's units for Radius
  // (px) and uses 0..1 for the rest. Identity is Amount=0. The four
  // sliders all import faithfully.
  const sharpening = { ...DEFAULT_PARAMS.sharpening }
  let sharpeningTouched = false
  if (attrs.has('Sharpness')) {
    const v = num(attrs.get('Sharpness'))
    if (v != null) { sharpening.amount = clamp(v / 100, 0, 1); sharpeningTouched = true }
  }
  if (attrs.has('SharpenRadius')) {
    const v = num(attrs.get('SharpenRadius'))
    if (v != null) { sharpening.radius = clamp(v, 0, 3); sharpeningTouched = true }
  }
  if (attrs.has('SharpenDetail')) {
    const v = num(attrs.get('SharpenDetail'))
    if (v != null) { sharpening.detail = clamp(v / 100, 0, 1); sharpeningTouched = true }
  }
  if (attrs.has('SharpenEdgeMasking')) {
    const v = num(attrs.get('SharpenEdgeMasking'))
    if (v != null) { sharpening.masking = clamp(v / 100, 0, 1); sharpeningTouched = true }
  }
  if (sharpeningTouched) patch.sharpening = sharpening

  const noiseReduction = { ...DEFAULT_PARAMS.noiseReduction }
  let nrTouched = false
  if (attrs.has('LuminanceSmoothing')) {
    const v = num(attrs.get('LuminanceSmoothing'))
    if (v != null) { noiseReduction.luminance = clamp(v / 100, 0, 1); nrTouched = true }
  }
  if (attrs.has('ColorNoiseReduction')) {
    const v = num(attrs.get('ColorNoiseReduction'))
    if (v != null) { noiseReduction.color = clamp(v / 100, 0, 1); nrTouched = true }
  }
  if (nrTouched) patch.noiseReduction = noiseReduction

  // ── HSL (8 bands matches LR exactly) ──
  const hsl: typeof DEFAULT_PARAMS.hsl = JSON.parse(JSON.stringify(DEFAULT_PARAMS.hsl))
  let hslTouched = false
  for (const band of ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const) {
    const key = band.toLowerCase() as keyof typeof hsl
    if (attrs.has(`HueAdjustment${band}`)) {
      const v = num(attrs.get(`HueAdjustment${band}`))
      if (v != null) { hsl[key].h = v / 100; hslTouched = true }
    }
    if (attrs.has(`SaturationAdjustment${band}`)) {
      const v = num(attrs.get(`SaturationAdjustment${band}`))
      if (v != null) { hsl[key].s = v / 100; hslTouched = true }
    }
    if (attrs.has(`LuminanceAdjustment${band}`)) {
      const v = num(attrs.get(`LuminanceAdjustment${band}`))
      if (v != null) { hsl[key].l = v / 100; hslTouched = true }
    }
  }
  if (hslTouched) patch.hsl = hsl

  // ── Color Grading (4 bands incl. Global) ──
  const cg: typeof DEFAULT_PARAMS.colorGrading = JSON.parse(JSON.stringify(DEFAULT_PARAMS.colorGrading))
  let cgTouched = false
  for (const band of ['Shadow', 'Midtone', 'Highlight', 'Global'] as const) {
    const targetKey = ({ Shadow: 'shadows', Midtone: 'midtones', Highlight: 'highlights', Global: 'global' } as const)[band]
    if (attrs.has(`ColorGrade${band}Hue`)) {
      const v = num(attrs.get(`ColorGrade${band}Hue`))
      if (v != null) { cg[targetKey].hue = clamp(v / 360, 0, 1); cgTouched = true }
    }
    if (attrs.has(`ColorGrade${band}Sat`)) {
      const v = num(attrs.get(`ColorGrade${band}Sat`))
      if (v != null) { cg[targetKey].sat = clamp(v / 100, 0, 1); cgTouched = true }
    }
    // LR uses "Luminance" for shadows/midtones/highlights but
    // sometimes "Lum" for global. Accept either.
    const lumLR = attrs.get(`ColorGrade${band}Luminance`) ?? attrs.get(`ColorGrade${band}Lum`)
    if (lumLR != null) {
      const v = num(lumLR)
      if (v != null) { cg[targetKey].lum = clamp(v / 100, -1, 1); cgTouched = true }
    }
  }
  if (attrs.has('ColorGradeBlending')) {
    const v = num(attrs.get('ColorGradeBlending'))
    if (v != null) { cg.blend = clamp(v / 100, 0, 1); cgTouched = true }
  }
  if (attrs.has('ColorGradeBalance')) {
    const v = num(attrs.get('ColorGradeBalance'))
    if (v != null) { cg.balance = clamp(v / 100, -1, 1); cgTouched = true }
  }
  if (cgTouched) patch.colorGrading = cg

  // ── Defringe ──
  const df = { ...DEFAULT_PARAMS.defringe }
  let dfTouched = false
  // LR's Defringe amounts run 0..20.
  if (attrs.has('DefringePurpleAmount')) {
    const v = num(attrs.get('DefringePurpleAmount'))
    if (v != null) { df.purpleAmount = clamp(v / 20, 0, 1); dfTouched = true }
  }
  if (attrs.has('DefringeGreenAmount')) {
    const v = num(attrs.get('DefringeGreenAmount'))
    if (v != null) { df.greenAmount = clamp(v / 20, 0, 1); dfTouched = true }
  }
  // Hue range fields. LR uses 0..100 (mapped to a 0..1 hue range).
  for (const fringe of ['Purple', 'Green'] as const) {
    for (const edge of ['HueLo', 'HueHi'] as const) {
      const lrKey = `Defringe${fringe}${edge}` as const
      const targetKey = `${fringe.toLowerCase()}Hue${edge.slice(3)}` as keyof typeof df
      if (attrs.has(lrKey)) {
        const v = num(attrs.get(lrKey))
        if (v != null) { (df as unknown as Record<string, number>)[targetKey] = clamp(v / 100, 0, 1); dfTouched = true }
      }
    }
  }
  if (dfTouched) patch.defringe = df

  // ── Vignette (post-crop) ──
  const vig = { ...DEFAULT_PARAMS.vignette }
  let vigTouched = false
  if (attrs.has('PostCropVignetteAmount')) {
    const v = num(attrs.get('PostCropVignetteAmount'))
    if (v != null) { vig.amount = clamp(v / 100, -1, 1); vigTouched = true }
  }
  if (attrs.has('PostCropVignetteMidpoint')) {
    const v = num(attrs.get('PostCropVignetteMidpoint'))
    if (v != null) { vig.radius = clamp(v / 100, 0, 1); vigTouched = true }
  }
  if (attrs.has('PostCropVignetteFeather')) {
    const v = num(attrs.get('PostCropVignetteFeather'))
    if (v != null) { vig.softness = clamp(v / 100, 0, 1); vigTouched = true }
  }
  if (attrs.has('PostCropVignetteRoundness')) {
    const v = num(attrs.get('PostCropVignetteRoundness'))
    if (v != null) { vig.roundness = clamp(v / 100, -1, 1); vigTouched = true }
  }
  if (attrs.has('PostCropVignetteHighlightContrast')) {
    const v = num(attrs.get('PostCropVignetteHighlightContrast'))
    if (v != null) { vig.highlightContrast = clamp(v / 100, 0, 1); vigTouched = true }
  }
  if (vigTouched) patch.vignette = vig

  // ── Grain ──
  if (attrs.has('GrainAmount')) {
    const v = num(attrs.get('GrainAmount'))
    if (v != null) patch.noiseAmount = clamp(v / 100, 0, 1)
  }
  if (attrs.has('GrainSize')) {
    const v = num(attrs.get('GrainSize'))
    if (v != null) patch.noiseSize = clamp(v / 100, 0, 1)
  }
  if (attrs.has('GrainFrequency')) {
    const v = num(attrs.get('GrainFrequency'))
    if (v != null) patch.noiseFrequency = clamp(v / 100, 0, 1)
  }

  // ── Calibration (PV2012 primaries) ──
  // Adobe Camera Raw emits two interchangeable naming forms for
  // the per-primary calibration: `Camera2012RedPrimaryHue` /
  // `…Saturation` (PV2012 schema) and the shorter `RedHue` /
  // `RedSaturation` (PV2010 schema). Both are still in active
  // circulation. Modern Lightroom Classic writes the PV2012 form,
  // many third-party packs still write the PV2010 form (especially
  // film-emulation packs like Kodachrome / Portra), and some
  // exports emit both at once. We accept either; the PV2012 form
  // wins when both are present, since it's the canonical encoding.
  const cal: Calibration = JSON.parse(JSON.stringify(DEFAULT_PARAMS.calibration))
  let calTouched = false
  for (const primary of ['Red', 'Green', 'Blue'] as const) {
    const targetKey = primary.toLowerCase() as keyof Calibration
    const hueLR = attrs.get(`Camera2012${primary}PrimaryHue`) ?? attrs.get(`${primary}Hue`)
    const satLR = attrs.get(`Camera2012${primary}PrimarySaturation`) ?? attrs.get(`${primary}Saturation`)
    if (hueLR != null) {
      const v = num(hueLR)
      if (v != null) { cal[targetKey].hue = clamp(v / 100, -1, 1); calTouched = true }
    }
    if (satLR != null) {
      const v = num(satLR)
      if (v != null) { cal[targetKey].sat = clamp(v / 100, -1, 1); calTouched = true }
    }
  }
  if (calTouched) patch.calibration = cal

  // ── Split Toning + ShadowTint → Color Grading ──
  // Lightroom kept Split Toning as a separate panel through PV2012
  // and rolled it into Color Grading in 2020. Adobe still emits the
  // older `SplitToningShadow*` / `SplitToningHighlight*` /
  // `SplitToningBalance` fields when a preset was authored on a
  // pre-2020 release, and an even earlier `ShadowTint` scalar when
  // the preset traces back to PV2010. Both encode the same
  // shadows/highlights tonal-band tinting that Color Grading now
  // owns end-to-end, so we project them into our `colorGrading`
  // field rather than carrying parallel state.
  //
  // Skip when the modern `ColorGrade*` fields have already
  // populated `cgTouched`. A preset that emits both forms
  // (re-export from a hybrid-vintage library) means the modern
  // form is the one the author actually saw, and applying both
  // would double-tint the band.
  if (!cgTouched) {
    const lrShadowTint     = num(attrs.get('ShadowTint'))
    const stShadowHue      = num(attrs.get('SplitToningShadowHue'))
    const stShadowSat      = num(attrs.get('SplitToningShadowSaturation'))
    const stHighlightHue   = num(attrs.get('SplitToningHighlightHue'))
    const stHighlightSat   = num(attrs.get('SplitToningHighlightSaturation'))
    const stBalance        = num(attrs.get('SplitToningBalance'))
    const splitToningPresent =
      (lrShadowTint != null && lrShadowTint !== 0) ||
      (stShadowHue != null && stShadowHue !== 0) ||
      (stShadowSat != null && stShadowSat !== 0) ||
      (stHighlightHue != null && stHighlightHue !== 0) ||
      (stHighlightSat != null && stHighlightSat !== 0) ||
      (stBalance != null && stBalance !== 0)
    if (splitToningPresent) {
      const projectedCg: typeof DEFAULT_PARAMS.colorGrading =
        JSON.parse(JSON.stringify(DEFAULT_PARAMS.colorGrading))
      // Explicit SplitToning fields take precedence over the older
      // ShadowTint scalar on the shadows band when both are present.
      if (stShadowHue != null) projectedCg.shadows.hue = clamp(stShadowHue / 360, 0, 1)
      if (stShadowSat != null) projectedCg.shadows.sat = clamp(stShadowSat / 100, 0, 1)
      if (stHighlightHue != null) projectedCg.highlights.hue = clamp(stHighlightHue / 360, 0, 1)
      if (stHighlightSat != null) projectedCg.highlights.sat = clamp(stHighlightSat / 100, 0, 1)
      if (stBalance != null) projectedCg.balance = clamp(stBalance / 100, -1, 1)
      // ShadowTint scalar: -100 ≈ green direction, +100 ≈ magenta
      // direction. Apply only when SplitToningShadow* didn't
      // already populate the shadows band.
      if (lrShadowTint != null && lrShadowTint !== 0 && stShadowHue == null && stShadowSat == null) {
        // Cernix hue convention: red=0, green≈0.33, magenta≈0.83.
        projectedCg.shadows.hue = lrShadowTint > 0 ? 0.83 : 0.33
        projectedCg.shadows.sat = clamp(Math.abs(lrShadowTint) / 100 * 0.3, 0, 1)
      }
      patch.colorGrading = projectedCg
    }
  }

  // ── Perspective + lens distortion ──
  const persp: Perspective = { ...DEFAULT_PARAMS.perspective }
  let perspTouched = false
  for (const [lrKey, target, scale] of [
    ['PerspectiveVertical',   'vertical',   100],
    ['PerspectiveHorizontal', 'horizontal', 100],
    ['PerspectiveAspect',     'aspect',     100],
    ['PerspectiveX',          'x',          100],
    ['PerspectiveY',          'y',          100],
  ] as const) {
    if (attrs.has(lrKey)) {
      const v = num(attrs.get(lrKey))
      if (v != null) { (persp as unknown as Record<string, number>)[target] = clamp(v / scale, -1, 1); perspTouched = true }
    }
  }
  if (perspTouched) patch.perspective = persp
  if (attrs.has('LensManualDistortionAmount')) {
    const v = num(attrs.get('LensManualDistortionAmount'))
    if (v != null) patch.lensDistortion = clamp(v / 100, -1, 1)
  }

  // ── Tone curves ──
  // LR ships up to four curves: ToneCurvePV2012 (composite), and per-
  // channel ToneCurvePV2012Red/Green/Blue. Each is a sequence of
  // "x, y" pairs in 0..255. Map directly to Cernix's 0..1 points.
  // Parametric curve (ParametricShadows / Darks / Lights / Highlights)
  // is converted into the composite curve: ratio multipliers on
  // luma-band ranges become a five-point spline.
  const tone: ToneCurve = JSON.parse(JSON.stringify(DEFAULT_PARAMS.toneCurve))
  let toneTouched = false
  const lrLuma = parseLrCurve(xml, 'ToneCurvePV2012')
  if (lrLuma) { tone.luma = lrLuma; toneTouched = true }
  const lrR = parseLrCurve(xml, 'ToneCurvePV2012Red')
  if (lrR) { tone.r = lrR; toneTouched = true }
  const lrG = parseLrCurve(xml, 'ToneCurvePV2012Green')
  if (lrG) { tone.g = lrG; toneTouched = true }
  const lrB = parseLrCurve(xml, 'ToneCurvePV2012Blue')
  if (lrB) { tone.b = lrB; toneTouched = true }
  // Parametric → point conversion. Only applied when no explicit
  // luma curve was set, to avoid double-counting.
  if (!lrLuma && hasParametric(attrs)) {
    tone.luma = parametricToPoints(attrs)
    toneTouched = true
  }
  if (toneTouched) patch.toneCurve = tone

  // ── Black & White mixer ──
  if (attrs.get('ConvertToGrayscale') === 'True') {
    const bw: typeof DEFAULT_PARAMS.bw = { ...DEFAULT_PARAMS.bw, enabled: true }
    for (const band of ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const) {
      const lrKey = `GrayMixer${band}`
      const target = band.toLowerCase() as keyof typeof bw
      if (attrs.has(lrKey)) {
        const v = num(attrs.get(lrKey))
        // LR's GrayMixer is in -100..+100, where 0 is identity.
        // Our weights are in 0..2 with 1 as identity, so map
        // v in [-100..+100] → weight in [0..2] linearly.
        if (v != null) (bw as unknown as Record<string, number>)[target] = clamp(1 + v / 100, 0, 2)
      }
    }
    patch.bw = bw
  }

  // ── Unsupported field flagging ──
  for (const [field, label] of UNSUPPORTED_FIELDS) {
    if (attrs.has(field)) {
      // CameraProfile is only "unsupported" when it references a
      // creative camera profile (Camera Vivid / Portrait / Landscape /
      // Monochrome, or any third-party DCP). The neutral profiles
      //  (Adobe Standard, Adobe Color, Camera Standard, Embedded) 
      // are effectively no-op rendering baselines and would just
      // generate toast noise on every import; LR Classic auto-selects
      // Camera Standard for most RAW imports, so it's the modal
      // value across user-saved presets in the wild.
      if (field === 'CameraProfile') {
        const profile = (attrs.get(field) ?? '').trim()
        if (NEUTRAL_CAMERA_PROFILES.has(profile)) continue
      }
      const value = attrs.get(field)
      unsupported.push(value ? `${label} (${value})` : label)
    }
  }
  // Sub-slider granularity that Cernix's schema doesn't expose
  // yet. Flag only when the preset value is non-default. Many LR
  // exports always emit these fields with the default value, and
  // we don't want false-positive noise in the toast.
  // (SharpenRadius + SharpenDetail moved into the active map above
  // when landed; the NR sub-sliders are still pending.)
  for (const [field, label, defaultValue] of [
    ['LuminanceNoiseReductionDetail',  'Luminance NR Detail',      50],
    ['LuminanceNoiseReductionContrast','Luminance NR Contrast',    0],
    ['ColorNoiseReductionDetail',      'Color NR Detail',          50],
    ['ColorNoiseReductionSmoothness',  'Color NR Smoothness',      50],
  ] as const) {
    if (!attrs.has(field)) continue
    const v = num(attrs.get(field))
    if (v != null && v !== defaultValue) unsupported.push(`${label} (${v})`)
  }

  // Local-adjustment masks emit nested rdf:Seq blocks; presence is a
  // simple substring check.
  for (const [tag, label] of [
    ['<crs:PaintBasedCorrections>',           'Brush adjustments'],
    ['<crs:CircularGradientBasedCorrections>', 'Radial mask adjustments'],
    ['<crs:GradientBasedCorrections>',        'Linear mask adjustments'],
    ['<crs:MaskGroupBasedCorrections>',       'AI mask adjustments'],
  ] as const) {
    if (xml.includes(tag)) unsupported.push(label)
  }

  return { patch, unsupported, name: attrs.get('Name') ?? null }
}

// ── Helpers ──

const UNSUPPORTED_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['LensProfileName',     'Lens profile correction'],
  ['LensProfileSetup',    'Lens profile setup'],
  ['CameraProfile',       'Camera profile'],
  ['LookProfileName',     'Look profile'],
  ['UprightVersion',      'Upright auto-mode'],
  ['UprightCenterMode',   'Upright auto-centre'],
]

/** Profile names that map to "no meaningful creative override": we
 *  silently skip flagging these because the visual delta vs our
 *  no-DCP baseline is well under JND on representative photos. The
 *  creative DCPs (Camera Vivid / Portrait / Landscape / Monochrome
 *  and any third-party profile) still get flagged because their
 *  saturation and tone shifts are large enough to skew the imported
 *  look noticeably. */
const NEUTRAL_CAMERA_PROFILES = new Set<string>([
  '',
  'Adobe Standard',
  'Adobe Color',
  'Camera Standard',
  'Embedded',
])

function parseAttrs(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  // crs:NAME="VALUE". Value can be any character except an
  // unescaped double quote. LR uses XML attribute escapes, which
  // means &quot; and friends would need decoding for textual
  // values, but every numeric/enum field we read is plain ASCII.
  const re = /\bcrs:([A-Za-z0-9]+)="([^"]*)"/g
  for (const m of xml.matchAll(re)) {
    out.set(m[1], m[2])
  }
  return out
}

function num(s: string | undefined): number | null {
  if (s == null) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function applyScalar<K extends keyof EditParams>(
  patch: Partial<EditParams>,
  attrs: Map<string, string>,
  lrKey: string,
  targetKey: K,
  transform: (v: number) => number,
): void {
  if (!attrs.has(lrKey)) return
  const v = num(attrs.get(lrKey))
  if (v == null) return
  ;(patch as Record<string, unknown>)[targetKey] = transform(v)
}

/** Parse a `<crs:ToneCurvePV2012*>...<rdf:Seq>...</rdf:Seq>...</crs:...>`
 *  block and return the curve as Cernix-normalised points. Returns
 *  null when the block is missing or empty. */
function parseLrCurve(xml: string, fieldName: string): CurvePoint[] | null {
  const open = `<crs:${fieldName}>`
  const close = `</crs:${fieldName}>`
  const start = xml.indexOf(open)
  if (start < 0) return null
  const end = xml.indexOf(close, start)
  if (end < 0) return null
  const block = xml.slice(start, end)
  const points: CurvePoint[] = []
  for (const m of block.matchAll(/<rdf:li>\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*<\/rdf:li>/g)) {
    points.push({ x: clamp(parseFloat(m[1]) / 255, 0, 1), y: clamp(parseFloat(m[2]) / 255, 0, 1) })
  }
  return points.length >= 2 ? points : null
}

function hasParametric(attrs: Map<string, string>): boolean {
  return ['ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights']
    .some(k => attrs.has(k))
}

/** Convert LR's parametric tone-curve sliders into a five-point
 *  spline. Each parametric slider is in -100..+100 and biases its
 *  region's output relative to identity. The four regions are
 *  defined by three split points (defaults 25 / 50 / 75 in LR's
 *  0..100 space); when the preset supplies different splits, the
 *  band centres shift accordingly so the curve goes through points
 *  at the *preset's* band midpoints rather than fixed positions.
 *  Y shift = `slider/100 * 0.15`. Calibration constant chosen so
 *  slider=+100 lifts the band ~15% of its range, matching LR's
 *  visual amplitude on a representative image set. */
function parametricToPoints(attrs: Map<string, string>): CurvePoint[] {
  const shadows    = num(attrs.get('ParametricShadows'))    ?? 0
  const darks      = num(attrs.get('ParametricDarks'))      ?? 0
  const lights     = num(attrs.get('ParametricLights'))     ?? 0
  const highlights = num(attrs.get('ParametricHighlights')) ?? 0
  // Splits define region boundaries: shadows < shadowSplit,
  // darks in [shadowSplit..midSplit], lights in [midSplit..highSplit],
  // highlights > highSplit. Defaults 25/50/75; preset can override.
  const shadowSplit    = (num(attrs.get('ParametricShadowSplit'))    ?? 25) / 100
  const midtoneSplit   = (num(attrs.get('ParametricMidtoneSplit'))   ?? 50) / 100
  const highlightSplit = (num(attrs.get('ParametricHighlightSplit')) ?? 75) / 100
  // Band centres are the midpoints of each region.
  const xS = clamp(shadowSplit / 2,                              0.02, 0.98)
  const xD = clamp((shadowSplit + midtoneSplit) / 2,             0.02, 0.98)
  const xL = clamp((midtoneSplit + highlightSplit) / 2,          0.02, 0.98)
  const xH = clamp((highlightSplit + 1) / 2,                     0.02, 0.98)
  const k = 0.0015 // 0.15 / 100
  return [
    { x: 0,  y: 0 },
    { x: xS, y: clamp(xS + shadows    * k, 0, 1) },
    { x: xD, y: clamp(xD + darks      * k, 0, 1) },
    { x: xL, y: clamp(xL + lights     * k, 0, 1) },
    { x: xH, y: clamp(xH + highlights * k, 0, 1) },
    { x: 1,  y: 1 },
  ]
}
