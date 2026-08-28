import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { EditParams, HslAdjustments } from '../../shared/edit-params'
import {
  DEFAULT_PARAMS, DEFAULT_TONE_CURVE, DEFAULT_HSL, DEFAULT_SELECTIVE_COLOR,
  HSL_RANGES,
  stripForPreset,
} from '../../shared/edit-params'

export interface Preset {
  id: string
  name: string
  params: EditParams
  createdAt: number
  builtin?: boolean
}

/**
 * JSON-backed global preset store. Presets are a flat array in a single file;
 * writes go through a temp-file + rename for atomicity. Built-in starter
 * presets are seeded on first init and never overwritten afterwards.
 */
export class PresetStore {
  private filePath: string
  private cache: Preset[] | null = null

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'presets.json')
  }

  async list(): Promise<Preset[]> {
    if (this.cache) return this.cache
    if (!fs.existsSync(this.filePath)) {
      this.cache = this.seedBuiltins()
      await this.persist()
      return this.cache
    }
    try {
      const text = await fsp.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(text) as Preset[]
      // Migrate every saved preset to the current schema. Top-level
      // spread alone isn't enough. Presets saved before
      // / 1500 / 1501 carry incomplete *nested* shapes (e.g. `hsl`
      // missing aqua / magenta bands, `bw` missing the new channels,
      // `colorGrading` without `global`, `sharpening` without
      // radius / detail). Without per-nested migration the renderer
      // crashes on `hsl[band].h` for the missing band.
      this.cache = Array.isArray(parsed)
        ? parsed.map(p => ({ ...p, params: migratePresetParams(p.params) }))
        : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  async save(name: string, params: EditParams): Promise<Preset> {
    const list = await this.list()
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const preset: Preset = { id, name, params: stripForPreset(params), createdAt: Date.now() }
    list.push(preset)
    await this.persist()
    return preset
  }

  async delete(id: string): Promise<void> {
    const list = await this.list()
    const before = list.length
    this.cache = list.filter(p => p.id !== id)
    if (this.cache.length !== before) await this.persist()
  }

  /** Rename a user-created preset. Built-ins are protected; renaming one
   *  is a no-op so the UI can guard the affordance but the store is the
   *  final line of defence. Empty/whitespace names are rejected. */
  async rename(id: string, name: string): Promise<Preset | null> {
    const trimmed = name.trim()
    if (!trimmed) return null
    const list = await this.list()
    const target = list.find(p => p.id === id)
    if (!target || target.builtin) return null
    if (target.name === trimmed) return target
    target.name = trimmed
    await this.persist()
    return target
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
    await fsp.rename(tmp, this.filePath)
  }

  private seedBuiltins(): Preset[] {
    const now = Date.now()
    const base = (extra: Partial<EditParams>): EditParams => ({
      ...DEFAULT_PARAMS,
      toneCurve: structuredClone(DEFAULT_TONE_CURVE),
      hsl: structuredClone(DEFAULT_HSL),
      selectiveColor: structuredClone(DEFAULT_SELECTIVE_COLOR),
      ...extra,
    })
    return [
      { id: 'builtin-neutral', name: 'Neutral', builtin: true, createdAt: now, params: base({}) },
      { id: 'builtin-punchy',  name: 'Punchy',  builtin: true, createdAt: now, params: base({ contrast: 0.2, saturation: 0.15, vibrance: 0.1 }) },
      { id: 'builtin-muted',   name: 'Muted Film', builtin: true, createdAt: now, params: base({
        saturation: -0.2, shadows: 0.15, highlights: -0.1,
        toneCurve: {
          ...structuredClone(DEFAULT_TONE_CURVE),
          luma: [{ x: 0, y: 0.06 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.94 }],
        },
      }) },
    ]
  }
}

/**
 * Migrate a saved preset's `params` to the current schema.
 *
 * Top-level spread fills missing top-level keys (vibrance, texture,
 * dehaze, perspective, etc.) but doesn't reach nested fields. Each
 * saved-pre-Phase-14/15 preset carries an `hsl` / `bw` /
 * `colorGrading` / `defringe` / `sharpening` / `noiseReduction` /
 * `calibration` / `vignette` shape that's missing the bands /
 * fields those phases added. Feeding such a shape into the
 * renderer throws `Cannot read properties of undefined` on the
 * missing band lookup. This helper deep-merges each nested record
 * with the current default so partial shapes upgrade cleanly.
 *
 * Saved presets stay on disk in their original shape; the migration
 * runs in memory on every read. A subsequent `save` (rename, etc.)
 * persists the migrated shape.
 */
function migratePresetParams(saved: Partial<EditParams> | undefined): EditParams {
  const s = (saved ?? {}) as Partial<EditParams>
  return {
    ...DEFAULT_PARAMS,
    ...s,
    hsl: migrateHsl(s.hsl),
    bw: { ...DEFAULT_PARAMS.bw, ...(s.bw ?? {}) },
    colorGrading: { ...DEFAULT_PARAMS.colorGrading, ...(s.colorGrading ?? {}) },
    defringe: { ...DEFAULT_PARAMS.defringe, ...(s.defringe ?? {}) },
    sharpening: { ...DEFAULT_PARAMS.sharpening, ...(s.sharpening ?? {}) },
    noiseReduction: { ...DEFAULT_PARAMS.noiseReduction, ...(s.noiseReduction ?? {}) },
    calibration: {
      ...DEFAULT_PARAMS.calibration,
      ...(s.calibration ?? {}),
      red:   { ...DEFAULT_PARAMS.calibration.red,   ...(s.calibration?.red   ?? {}) },
      green: { ...DEFAULT_PARAMS.calibration.green, ...(s.calibration?.green ?? {}) },
      blue:  { ...DEFAULT_PARAMS.calibration.blue,  ...(s.calibration?.blue  ?? {}) },
    },
    vignette: { ...DEFAULT_PARAMS.vignette, ...(s.vignette ?? {}) },
    perspective: { ...DEFAULT_PARAMS.perspective, ...(s.perspective ?? {}) },
  }
}

/** Spread DEFAULT_HSL over the saved shape so any missing band falls
 *  back to identity. The HSL object's keys are the band names (red,
 *  orange, …); each band has { h, s, l }. */
function migrateHsl(saved: HslAdjustments | undefined): HslAdjustments {
  const out = { ...DEFAULT_HSL }
  if (!saved) return out
  for (const r of HSL_RANGES) {
    const band = saved[r]
    if (band && typeof band.h === 'number') {
      out[r] = { ...DEFAULT_HSL[r], ...band }
    }
  }
  return out
}
