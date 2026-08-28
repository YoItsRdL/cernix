import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * The edit parameter schema, as it is persisted.
 *
 * Sidecars are written in Cernix's own namespace rather than any other
 * editor's. The alternative was translating into Darktable's native
 * operation params, which are base64-encoded binary structs whose layout
 * tracks each module's version: a reverse-engineering exercise, brittle
 * across releases, and undocumented for anything outside Darktable. That
 * road was abandoned when the WebGL pipeline became the export engine,
 * so nothing here needs to be legible to another renderer.
 *
 * Defaults mean "no edit", and a default record round-trips to a sidecar
 * that changes nothing about the source.
 */
import type { EditParams, ToneCurve, HslAdjustments, SelectiveColor, BlackAndWhite, CropRect, ImageTransform, Mask, MaskAdjustments, HealSpot, LightLeakParams, VignetteParams, ColorGrading, Defringe, Sharpening, NoiseReduction } from '../../shared/edit-params'
import { HSL_RANGES, SC_RANGES, DEFAULT_PARAMS, DEFAULT_TONE_CURVE, DEFAULT_SELECTIVE_COLOR, DEFAULT_BLACK_AND_WHITE, DEFAULT_MASK_ADJUSTMENTS, IDENTITY_IMAGE_TRANSFORM } from '../../shared/edit-params'

const NUMERIC_KEYS: (keyof EditParams)[] = [
  'exposure','contrast','highlights','shadows','whites','blacks','temperature','tint','vibrance','saturation',
  'texture','clarity','dehaze','lensDistortion',
  'noiseAmount','straightenDeg',
]

const XMP_NAMESPACE = 'http://cernix.app/edit/1.0'

export class XmpWriter {
  /** Returns the XMP sidecar path for a given source file (`photo.jpg` → `photo.jpg.xmp`). */
  static sidecarPath(sourcePath: string): string {
    return `${sourcePath}.xmp`
  }

  /** Write params to the sidecar beside `sourcePath`. Creates parent dir if missing. */
  static async write(sourcePath: string, params: EditParams): Promise<void> {
    const xmpPath = this.sidecarPath(sourcePath)
    await fsp.mkdir(path.dirname(xmpPath), { recursive: true })
    await fsp.writeFile(xmpPath, this.serialize(params), 'utf8')
  }

  /** Read params from sidecar; returns defaults if missing or invalid. */
  static async read(sourcePath: string): Promise<EditParams> {
    const xmpPath = this.sidecarPath(sourcePath)
    if (!fs.existsSync(xmpPath)) return { ...DEFAULT_PARAMS }
    try {
      const xml = await fsp.readFile(xmpPath, 'utf8')
      return this.parse(xml)
    } catch {
      return { ...DEFAULT_PARAMS }
    }
  }

  private static serialize(params: EditParams): string {
    const attrs = NUMERIC_KEYS.map(k => `    cernix:${k}="${params[k]}"`).join('\n')
    const curveJson = escapeAttr(JSON.stringify(params.toneCurve))
    const hslJson = escapeAttr(JSON.stringify(params.hsl))
    const scJson = escapeAttr(JSON.stringify(params.selectiveColor))
    const bwJson = escapeAttr(JSON.stringify(params.bw))
    const cropJson = escapeAttr(JSON.stringify(params.crop))
    const flipH = params.flipH ? '1' : '0'
    // Only emit the frame attribute when a preset is selected; an empty
    // attribute round-trips to null but adds noise to every sidecar.
    const frameAttr = params.frame ? `\n    cernix:frame="${escapeAttr(params.frame)}"` : ''
    // Free-transform persistence. Only emit when non-identity to keep
    // unmodified sidecars clean.
    const t = params.imageTransform
    const isIdentity = t.scale === 1 && t.panX === 0 && t.panY === 0
    const transformAttr = isIdentity ? '' : `\n    cernix:imageTransform="${escapeAttr(JSON.stringify(t))}"`
    const noiseMono = params.noiseMono ? '1' : '0'
    const noiseDistribution = params.noiseDistribution
    // Only emit masks when non-empty. Keeps unmodified sidecars clean.
    const masksAttr = params.masks.length > 0
      ? `\n    cernix:masks="${escapeAttr(JSON.stringify(params.masks))}"`
      : ''
    const healSpotsAttr = params.healSpots.length > 0
      ? `\n    cernix:healSpots="${escapeAttr(JSON.stringify(params.healSpots))}"`
      : ''
    const ll = params.lightLeak
    const lightLeakAttr = ll && ll.preset !== 'none'
      ? `\n    cernix:lightLeak="${escapeAttr(JSON.stringify(ll))}"`
      : ''
    // Only emit vignette when amount is non-zero.
    const vig = params.vignette
    const vignetteAttr = vig && vig.amount !== 0
      ? `\n    cernix:vignette="${escapeAttr(JSON.stringify(vig))}"`
      : ''
    // Only emit colour grading when at least one band has sat or lum
    // applied. Otherwise the schema stays clean for plain edits.
    const cg = params.colorGrading
    const cgIdentity = !cg ||
      (cg.shadows.sat === 0 && cg.shadows.lum === 0 &&
       cg.midtones.sat === 0 && cg.midtones.lum === 0 &&
       cg.highlights.sat === 0 && cg.highlights.lum === 0 &&
       cg.global.sat === 0 && cg.global.lum === 0)
    const colorGradingAttr = cgIdentity
      ? ''
      : `\n    cernix:colorGrading="${escapeAttr(JSON.stringify(cg))}"`
    // Defringe: only emit when at least one amount is non-zero.
    const df = params.defringe
    const dfIdentity = !df || (df.purpleAmount === 0 && df.greenAmount === 0)
    const defringeAttr = dfIdentity
      ? ''
      : `\n    cernix:defringe="${escapeAttr(JSON.stringify(df))}"`
    // Sharpening: only emit when amount > 0 (masking alone is a no-op).
    const sh = params.sharpening
    const shIdentity = !sh || sh.amount === 0
    const sharpeningAttr = shIdentity
      ? ''
      : `\n    cernix:sharpening="${escapeAttr(JSON.stringify(sh))}"`
    // Noise reduction: only emit when at least one amount is non-zero.
    const nr = params.noiseReduction
    const nrIdentity = !nr || (nr.luminance === 0 && nr.color === 0)
    const noiseReductionAttr = nrIdentity
      ? ''
      : `\n    cernix:noiseReduction="${escapeAttr(JSON.stringify(nr))}"`
    // Grain shape (Lightroom Size + Frequency). Only emit
    // when either field is non-default so plain edits stay clean.
    const noiseShape = { size: params.noiseSize ?? 0, frequency: params.noiseFrequency ?? 0 }
    const noiseShapeAttr = noiseShape.size === 0 && noiseShape.frequency === 0
      ? ''
      : `\n    cernix:noiseShape="${escapeAttr(JSON.stringify(noiseShape))}"`
    // Camera calibration. Identity at all-zero across
    // the three primaries. Keeps unmodified sidecars clean.
    const cal = params.calibration
    const calIdentity = !cal ||
      (cal.red.hue   === 0 && cal.red.sat   === 0 &&
       cal.green.hue === 0 && cal.green.sat === 0 &&
       cal.blue.hue  === 0 && cal.blue.sat  === 0)
    const calibrationAttr = calIdentity
      ? ''
      : `\n    cernix:calibration="${escapeAttr(JSON.stringify(cal))}"`
    // Perspective transform. Identity at all-zero.
    // `lensDistortion` rides alongside in NUMERIC_KEYS.
    const persp = params.perspective
    const perspIdentity = !persp ||
      (persp.vertical === 0 && persp.horizontal === 0 &&
       persp.aspect   === 0 && persp.x          === 0 && persp.y === 0)
    const perspectiveAttr = perspIdentity
      ? ''
      : `\n    cernix:perspective="${escapeAttr(JSON.stringify(persp))}"`
    return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:cernix="${XMP_NAMESPACE}"
${attrs}
    cernix:toneCurve="${curveJson}"
    cernix:hsl="${hslJson}"
    cernix:selectiveColor="${scJson}"
    cernix:bw="${bwJson}"
    cernix:crop="${cropJson}"
    cernix:orientation="${params.orientation}"
    cernix:flipH="${flipH}"${frameAttr}${transformAttr}${masksAttr}${healSpotsAttr}
    cernix:noiseMono="${noiseMono}"
    cernix:noiseDistribution="${noiseDistribution}"${lightLeakAttr}${vignetteAttr}${colorGradingAttr}${defringeAttr}${sharpeningAttr}${noiseReductionAttr}${noiseShapeAttr}${calibrationAttr}${perspectiveAttr}
    cernix:schemaVersion="22" />
 </rdf:RDF>
</x:xmpmeta>
`
  }

  private static parse(xml: string): EditParams {
    const out: EditParams = { ...DEFAULT_PARAMS, toneCurve: cloneToneCurve(DEFAULT_TONE_CURVE) }
    for (const key of NUMERIC_KEYS) {
      const match = xml.match(new RegExp(`cernix:${key}="(-?[0-9.]+)"`))
      if (match) {
        const n = Number(match[1])
        if (!Number.isNaN(n)) (out[key] as number) = n
      }
    }
    const curveMatch = xml.match(/cernix:toneCurve="([^"]*)"/)
    if (curveMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(curveMatch[1])) as ToneCurve
        if (parsed && parsed.luma && parsed.r && parsed.g && parsed.b) out.toneCurve = parsed
      } catch { /* malformed curve → keep default */ }
    }
    const hslMatch = xml.match(/cernix:hsl="([^"]*)"/)
    if (hslMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(hslMatch[1])) as Partial<HslAdjustments>
        // v20 sidecars are missing aqua + magenta; spread over the
        // identity defaults so older edits round-trip without their
        // existing band edits being clobbered.
        if (parsed && typeof parsed === 'object') {
          out.hsl = { ...DEFAULT_PARAMS.hsl }
          for (const r of HSL_RANGES) {
            const band = parsed[r]
            if (band && typeof band.h === 'number') out.hsl[r] = band
          }
        }
      } catch { /* keep default */ }
    }
    const scMatch = xml.match(/cernix:selectiveColor="([^"]*)"/)
    if (scMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(scMatch[1])) as SelectiveColor
        if (parsed && SC_RANGES.every(r => parsed[r])) {
          out.selectiveColor = { ...DEFAULT_SELECTIVE_COLOR, ...parsed }
        }
      } catch { /* keep default */ }
    }
    const monoMatch = xml.match(/cernix:noiseMono="([01])"/)
    if (monoMatch) out.noiseMono = monoMatch[1] === '1'
    const distMatch = xml.match(/cernix:noiseDistribution="(uniform|gaussian)"/)
    if (distMatch) out.noiseDistribution = distMatch[1] as 'uniform' | 'gaussian'
    const bwMatch = xml.match(/cernix:bw="([^"]*)"/)
    if (bwMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(bwMatch[1])) as Partial<BlackAndWhite> & { cyan?: number }
        if (parsed && typeof parsed.enabled === 'boolean') {
          // v20 → v21 rename: cyan → aqua (same hue centre 0.5),
          // magenta-at-0.833 → purple. v20's "magenta" field semantically
          // matches v21's "purple"; v21 introduces a new magenta at
          // 0.917. Detect a v20 payload by the presence of `cyan`
          // (which v21 doesn't have) and translate.
          const isLegacy = typeof parsed.cyan === 'number'
          if (isLegacy) {
            const legacy = parsed as Partial<BlackAndWhite> & {
              cyan?: number; magenta?: number
            }
            out.bw = {
              ...DEFAULT_BLACK_AND_WHITE,
              ...legacy,
              aqua:    legacy.cyan    ?? 1,
              purple:  legacy.magenta ?? 1,
              magenta: 1, // new band; defaults to identity
            }
          } else {
            out.bw = { ...DEFAULT_BLACK_AND_WHITE, ...parsed }
          }
        }
      } catch { /* keep default */ }
    }
    const cropMatch = xml.match(/cernix:crop="([^"]*)"/)
    if (cropMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(cropMatch[1])) as CropRect
        if (parsed && [parsed.x, parsed.y, parsed.w, parsed.h].every(n => typeof n === 'number')) {
          out.crop = parsed
        }
      } catch { /* keep default */ }
    }
    const orientMatch = xml.match(/cernix:orientation="(0|90|180|270)"/)
    if (orientMatch) out.orientation = Number(orientMatch[1]) as 0 | 90 | 180 | 270
    const flipMatch = xml.match(/cernix:flipH="([01])"/)
    if (flipMatch) out.flipH = flipMatch[1] === '1'
    const frameMatch = xml.match(/cernix:frame="([^"]*)"/)
    if (frameMatch) out.frame = frameMatch[1] ? unescapeAttr(frameMatch[1]) : null
    const transformMatch = xml.match(/cernix:imageTransform="([^"]*)"/)
    if (transformMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(transformMatch[1])) as ImageTransform
        if (parsed && [parsed.scale, parsed.panX, parsed.panY].every(n => typeof n === 'number')) {
          out.imageTransform = parsed
        }
      } catch { out.imageTransform = IDENTITY_IMAGE_TRANSFORM }
    }
    // Masks: read new-shape `cernix:masks` first, fall back to the
    // old `cernix:localAdjustments` attribute and migrate its field
    // names (mask → shape, params → adjustments). Sidecars written
    // before schema v8 round-trip silently on first save.
    const masksMatch = xml.match(/cernix:masks="([^"]*)"/)
    const legacyMatch = !masksMatch ? xml.match(/cernix:localAdjustments="([^"]*)"/) : null
    const rawMasks = masksMatch?.[1] ?? legacyMatch?.[1]
    if (rawMasks !== undefined) {
      try {
        const parsed = JSON.parse(unescapeAttr(rawMasks)) as unknown[]
        if (Array.isArray(parsed)) {
          // Validate shape + coerce legacy field names. One bad entry
          // drops the whole list. Safer than rendering a half-right
          // mask pass.
          const valid: Mask[] = []
          let ok = true
          for (const entry of parsed) {
            if (typeof entry !== 'object' || entry === null) { ok = false; break }
            const e = entry as Record<string, unknown>
            // Retired mask types are skipped rather than fail-closing
            // the whole list, so the rest of the edit survives.
            if (e.type === 'ai-point' || e.type === 'ai-subject' || e.type === 'ai-sky') continue
            const shape = (e.shape ?? e.mask) as unknown
            const adjustments = (e.adjustments ?? e.params) as unknown
            if (
              typeof e.id !== 'string' ||
              (e.type !== 'linear' && e.type !== 'graduated' && e.type !== 'radial' && e.type !== 'brush') ||
              typeof e.enabled !== 'boolean' ||
              typeof shape !== 'object' || shape === null ||
              typeof adjustments !== 'object' || adjustments === null
            ) { ok = false; break }
            // v16 → v17 migration: 'graduated' renamed to 'linear'
            // (matching modern Lightroom / Capture One terminology;
            // the legacy name was carried over from physical ND
            // graduated filters). Type-only swap, shape unchanged.
            let migratedType = e.type
            const migratedShape: unknown = shape
            if (e.type === 'graduated') {
              migratedType = 'linear'
            }
            // v21 → v22 migration: MaskAdjustments grew
            // from 9 fields to 16 (vibrance + 6 spatial deltas).
            // Pre-v22 sidecars carry the 9-field shape; spread over
            // the identity defaults so the new fields default to 0
            // and the legacy 9 fields populate their matching keys.
            // No data loss; visually identical to pre-v22 because the
            // new fields are at zero on read.
            const adj = adjustments as Partial<MaskAdjustments>
            const built: Mask = {
              id: e.id,
              type: migratedType as Mask['type'],
              enabled: e.enabled,
              shape: migratedShape as Mask['shape'],
              adjustments: { ...DEFAULT_MASK_ADJUSTMENTS, ...adj },
            }
            // Preserve the optional range-mask intersect when present
            // and well-formed. Missing or malformed = no gate (legacy
            // sidecars round-trip cleanly).
            const r = e.range as Record<string, unknown> | undefined
            if (
              r && typeof r === 'object' &&
              (r.mode === 'off' || r.mode === 'luminance' || r.mode === 'color') &&
              typeof r.min === 'number' && typeof r.max === 'number' &&
              typeof r.feather === 'number' &&
              Array.isArray(r.sampleColor) && r.sampleColor.length === 3 &&
              r.sampleColor.every((n) => typeof n === 'number')
            ) {
              built.range = {
                mode: r.mode,
                min: r.min,
                max: r.max,
                feather: r.feather,
                sampleColor: [r.sampleColor[0], r.sampleColor[1], r.sampleColor[2]] as [number, number, number],
              }
            }
            // v17 → v18: top-level `invert` flag. Missing on legacy
            // sidecars defaults to false (no inversion), so existing
            // files round-trip cleanly without migration.
            if (typeof e.invert === 'boolean') built.invert = e.invert
            // v22: per-mask vector params (HSL / Color
            // Grading / Calibration). Each block is optional; missing
            // = identity, applied via the standard `?? undefined`
            // semantics in the shader binder. JSON.stringify on the
            // outbound side preserves the keys exactly, so the only
            // migration concern is partially-formed payloads.
            // `typeof === 'object'` is enough to guard. Stricter
            // shape validation lives in the renderer's
            // `cachedHsl/Cg/Cal` since the global path runs the same
            // type guards anyway.
            if (e.hsl && typeof e.hsl === 'object') built.hsl = e.hsl as Mask['hsl']
            if (e.colorGrading && typeof e.colorGrading === 'object') built.colorGrading = e.colorGrading as Mask['colorGrading']
            if (e.calibration && typeof e.calibration === 'object') built.calibration = e.calibration as Mask['calibration']
            // per-mask tone curve. Same shape as the
            // global `cernix:toneCurve` JSON; the renderer's
            // `buildCurveLut` does the validation, so we accept any
            // object here and let an malformed payload fall through
            // to identity at LUT-build time.
            if (e.toneCurve && typeof e.toneCurve === 'object') built.toneCurve = e.toneCurve as Mask['toneCurve']
            valid.push(built)
          }
          if (ok) out.masks = valid
        }
      } catch { /* keep default [] */ }
    }
    // Heal/clone spots. Schema v15. Whole list drops on a malformed
    // entry (same conservative policy as masks). Missing attribute
    // leaves the field at default (empty list).
    const healMatch = xml.match(/cernix:healSpots="([^"]*)"/)
    if (healMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(healMatch[1])) as unknown[]
        if (Array.isArray(parsed)) {
          const valid: HealSpot[] = []
          let ok = true
          for (const entry of parsed) {
            if (typeof entry !== 'object' || entry === null) { ok = false; break }
            const e = entry as Record<string, unknown>
            if (
              typeof e.id !== 'string' ||
              typeof e.destX !== 'number' || typeof e.destY !== 'number' ||
              typeof e.srcX  !== 'number' || typeof e.srcY  !== 'number' ||
              typeof e.radius !== 'number' || typeof e.feather !== 'number' ||
              typeof e.opacity !== 'number' ||
              (e.mode !== 'heal' && e.mode !== 'clone')
            ) { ok = false; break }
            valid.push({
              id: e.id, destX: e.destX, destY: e.destY,
              srcX: e.srcX, srcY: e.srcY,
              radius: e.radius, feather: e.feather, opacity: e.opacity,
              mode: e.mode,
            })
          }
          if (ok) out.healSpots = valid
        }
      } catch { /* keep default [] */ }
    }
    const llMatch = xml.match(/cernix:lightLeak="([^"]*)"/)
    if (llMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(llMatch[1])) as LightLeakParams
        if (parsed && typeof parsed.preset === 'string' && typeof parsed.intensity === 'number') {
          out.lightLeak = { ...DEFAULT_PARAMS.lightLeak, ...parsed }
        }
      } catch { /* keep default */ }
    }
    const vigMatch = xml.match(/cernix:vignette="([^"]*)"/)
    if (vigMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(vigMatch[1])) as VignetteParams
        if (parsed && typeof parsed.amount === 'number') {
          out.vignette = { ...DEFAULT_PARAMS.vignette, ...parsed }
        }
      } catch { /* keep default */ }
    }
    // Colour grading: missing attribute leaves the field at default
    // (identity grade). Existing v8 sidecars round-trip cleanly.
    const cgMatch = xml.match(/cernix:colorGrading="([^"]*)"/)
    if (cgMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(cgMatch[1])) as ColorGrading
        if (parsed && parsed.shadows && parsed.midtones && parsed.highlights) {
          out.colorGrading = {
            shadows:    { ...DEFAULT_PARAMS.colorGrading.shadows,    ...parsed.shadows    },
            midtones:   { ...DEFAULT_PARAMS.colorGrading.midtones,   ...parsed.midtones   },
            highlights: { ...DEFAULT_PARAMS.colorGrading.highlights, ...parsed.highlights },
            // v20 sidecars omit `global`. Spread over default band so
            // a missing field reads as identity rather than crashing.
            global:     { ...DEFAULT_PARAMS.colorGrading.global,     ...(parsed.global ?? {}) },
            blend:   typeof parsed.blend   === 'number' ? parsed.blend   : DEFAULT_PARAMS.colorGrading.blend,
            balance: typeof parsed.balance === 'number' ? parsed.balance : DEFAULT_PARAMS.colorGrading.balance,
          }
        }
      } catch { /* keep default */ }
    }
    // Defringe: missing attribute leaves the field at identity (both
    // amounts zero). v9 sidecars load with defringe off.
    const dfMatch = xml.match(/cernix:defringe="([^"]*)"/)
    if (dfMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(dfMatch[1])) as Partial<Defringe>
        if (parsed && typeof parsed.purpleAmount === 'number' && typeof parsed.greenAmount === 'number') {
          // v20 sidecars carry only the two amounts; the four hue-
          // range fields default through. v21 writes all six.
          out.defringe = {
            ...DEFAULT_PARAMS.defringe,
            ...parsed,
          }
        }
      } catch { /* keep default */ }
    }
    // Grain shape (Lightroom Size + Frequency). v20
    // sidecars omit it entirely. Defaults of 0/0 leave grain at the
    // pre-v21 spatial frequency, so existing edits look unchanged.
    const noiseShapeMatch = xml.match(/cernix:noiseShape="([^"]*)"/)
    if (noiseShapeMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(noiseShapeMatch[1])) as { size?: number; frequency?: number }
        if (typeof parsed?.size === 'number') out.noiseSize = parsed.size
        if (typeof parsed?.frequency === 'number') out.noiseFrequency = parsed.frequency
      } catch { /* keep defaults */ }
    }
    // Camera calibration. Missing attribute = identity
    // foundation (every primary at zero). Spread per-primary over the
    // identity defaults so a partially-populated payload (e.g. only
    // red.hue specified) loads cleanly rather than breaking validation.
    const calMatch = xml.match(/cernix:calibration="([^"]*)"/)
    if (calMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(calMatch[1])) as Partial<typeof DEFAULT_PARAMS.calibration>
        if (parsed && typeof parsed === 'object') {
          out.calibration = {
            red:   { ...DEFAULT_PARAMS.calibration.red,   ...(parsed.red   ?? {}) },
            green: { ...DEFAULT_PARAMS.calibration.green, ...(parsed.green ?? {}) },
            blue:  { ...DEFAULT_PARAMS.calibration.blue,  ...(parsed.blue  ?? {}) },
          }
        }
      } catch { /* keep default */ }
    }
    // Perspective transform. Spread over the identity
    // default so partial payloads load cleanly.
    const perspMatch = xml.match(/cernix:perspective="([^"]*)"/)
    if (perspMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(perspMatch[1])) as Partial<typeof DEFAULT_PARAMS.perspective>
        if (parsed && typeof parsed === 'object') {
          out.perspective = { ...DEFAULT_PARAMS.perspective, ...parsed }
        }
      } catch { /* keep default */ }
    }
    // Sharpening: missing attribute leaves the field at identity. v10
    // sidecars load with sharpening off; pre- v21 sidecars
    // are missing `radius`/`detail`, which fall back to LR identity
    // defaults (radius=1.0 px, detail=0.25). Visually equivalent to
    // pre-Radius/Detail behaviour because Amount=0 short-circuits the
    // whole pass anyway.
    const shMatch = xml.match(/cernix:sharpening="([^"]*)"/)
    if (shMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(shMatch[1])) as Partial<Sharpening>
        if (parsed && typeof parsed.amount === 'number' && typeof parsed.masking === 'number') {
          out.sharpening = {
            ...DEFAULT_PARAMS.sharpening,
            amount:  parsed.amount,
            masking: parsed.masking,
            ...(typeof parsed.radius === 'number' ? { radius: parsed.radius } : {}),
            ...(typeof parsed.detail === 'number' ? { detail: parsed.detail } : {}),
          }
        }
      } catch { /* keep default */ }
    }
    // Noise reduction: same shape, same defaults policy.
    const nrMatch = xml.match(/cernix:noiseReduction="([^"]*)"/)
    if (nrMatch) {
      try {
        const parsed = JSON.parse(unescapeAttr(nrMatch[1])) as NoiseReduction
        if (parsed && typeof parsed.luminance === 'number' && typeof parsed.color === 'number') {
          out.noiseReduction = { luminance: parsed.luminance, color: parsed.color }
        }
      } catch { /* keep default */ }
    }
    return out
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function unescapeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
function cloneToneCurve(c: ToneCurve): ToneCurve {
  return {
    luma: c.luma.map(p => ({ ...p })),
    r:    c.r.map(p => ({ ...p })),
    g:    c.g.map(p => ({ ...p })),
    b:    c.b.map(p => ({ ...p })),
  }
}
