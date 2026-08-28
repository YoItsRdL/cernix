import type { EditParams } from '@/types'
import { DEFAULT_PARAMS } from '@/../shared/edit-params'

export type ParamKey = keyof EditParams

type Listener = (params: EditParams) => void
type HistoryListener = (entries: ReadonlyArray<HistoryEntry>, currentIndex: number) => void

/**
 * One step in the edit history.
 *
 * Stored eagerly with the full `EditParams` snapshot so jumping to
 * any prior step is O(1). Memory is fine. A 500-entry session at
 * ~2 KB per snapshot is ~1 MB resident, well below where it'd start
 * to bite. Labels are inferred from the param key (`'Exposure'`,
 * `'HSL'`, …) or supplied explicitly for compound operations
 * (`'Apply preset: Kodachrome 64'`, `'Reset all'`).
 */
export interface HistoryEntry {
  label: string
  /** Wall-clock timestamp of the mutation; used for the
   *  same-label-within-500ms coalescing rule. */
  timestamp: number
  /** Frozen snapshot: restoring this entry overwrites `current`. */
  params: EditParams
}

const COALESCE_MS = 500

/**
 * Observable parameter store. Subscribers are notified synchronously on every
 * mutation. Persistence to XMP is debounced. The renderer state is the source
 * of truth during editing; XMP catches up.
 */
export class ParamsStore {
  private current: EditParams = { ...DEFAULT_PARAMS }
  private listeners = new Set<Listener>()
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private sourcePath: string | null = null
  private static WRITE_DEBOUNCE_MS = 500
  private savedListeners = new Set<(saved: boolean) => void>()
  private _saved = true
  // Edit history. Session-scoped; not persisted across
  // editor reloads. The History panel reads this list to surface
  // labelled steps and "jump to step N" affordances.
  private history: HistoryEntry[] = []
  private historyIndex = -1
  private historyListeners = new Set<HistoryListener>()

  bind(sourcePath: string, initial: EditParams): void {
    this.sourcePath = sourcePath
    // Copy across only keys the current schema knows about: missing
    // fields backfill from defaults, unknown ones are dropped rather
    // than re-persisted on the next save.
    const merged: Record<string, unknown> = { ...DEFAULT_PARAMS }
    for (const k of Object.keys(DEFAULT_PARAMS)) {
      const v = (initial as unknown as Record<string, unknown>)[k]
      if (v !== undefined) merged[k] = v
    }
    this.current = merged as unknown as EditParams
    this._saved = true
    // Reset the history when loading a new photo. Entries from the
    // previous file would mean nothing here. Seed with the loaded
    // state so step 0 is always "Open" / the on-disk baseline.
    this.history = [{ label: 'Open', timestamp: Date.now(), params: this.current }]
    this.historyIndex = 0
    this.notify()
    this.notifyHistory()
    for (const fn of this.savedListeners) fn(true)
  }

  get(): EditParams {
    return this.current
  }

  set<K extends ParamKey>(key: K, value: EditParams[K]): void {
    if (this.current[key] === value) return
    this.current = { ...this.current, [key]: value }
    this.notify()
    this.scheduleWrite()
    this.recordHistory(labelForKey(key))
  }

  /** Replace all params at once (used by preset apply). Debounced write as usual. */
  applyAll(params: EditParams | Partial<EditParams>, label: string = 'Apply preset'): void {
    this.current = { ...DEFAULT_PARAMS, ...params } as EditParams
    this.notify()
    this.scheduleWrite()
    this.recordHistory(label)
  }

  reset(key?: ParamKey): void {
    if (key) {
      if (this.current[key] === DEFAULT_PARAMS[key]) return
      this.current = { ...this.current, [key]: DEFAULT_PARAMS[key] }
      this.notify()
      this.scheduleWrite()
      this.recordHistory(`Reset ${labelForKey(key)}`)
    } else {
      this.current = { ...DEFAULT_PARAMS }
      this.notify()
      this.scheduleWrite()
      this.recordHistory('Reset all')
    }
  }

  // ── History ──

  getHistory(): { entries: ReadonlyArray<HistoryEntry>; currentIndex: number } {
    return { entries: this.history, currentIndex: this.historyIndex }
  }

  subscribeHistory(fn: HistoryListener): () => void {
    this.historyListeners.add(fn)
    fn(this.history, this.historyIndex)
    return () => this.historyListeners.delete(fn)
  }

  /** Restore the params snapshot at history step `index`. The current
   *  index moves to that step; the forward branch (entries past
   *  `index`) is preserved so the user can re-jump within the
   *  existing list. Destructive truncation only happens when a
   *  *new* mutation lands while sitting on a non-tip step. */
  jumpTo(index: number): void {
    if (index < 0 || index >= this.history.length) return
    if (index === this.historyIndex) return
    this.historyIndex = index
    this.current = this.history[index].params
    this.notify()
    this.scheduleWrite()
    this.notifyHistory()
  }

  private recordHistory(label: string): void {
    const now = Date.now()
    const tip = this.history[this.historyIndex]
    // Coalesce same-label entries inside the 500 ms window. Drag
    // gestures otherwise spam the history with a hundred "Exposure"
    // entries; Lightroom's history coalesces the same way. We keep
    // the *original* timestamp so the coalescing window doesn't
    // walk forward indefinitely on a continuous drag.
    if (
      tip && tip.label === label &&
      now - tip.timestamp < COALESCE_MS &&
      this.historyIndex === this.history.length - 1
    ) {
      this.history[this.historyIndex] = { label, timestamp: tip.timestamp, params: this.current }
      this.notifyHistory()
      return
    }
    // A new mutation while sitting on a prior step branches the
    // history. We drop everything past the current index, then
    // append. Matches the behaviour of every undo stack the user
    // has touched (LR / Photoshop / VSCode / browser back-button).
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1)
    }
    this.history.push({ label, timestamp: now, params: this.current })
    this.historyIndex = this.history.length - 1
    this.notifyHistory()
  }

  private notifyHistory(): void {
    for (const fn of this.historyListeners) fn(this.history, this.historyIndex)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Subscribe to save-status changes (true = XMP on disk matches memory). */
  subscribeSaved(fn: (saved: boolean) => void): () => void {
    this.savedListeners.add(fn)
    fn(this._saved)
    return () => this.savedListeners.delete(fn)
  }

  private setSaved(saved: boolean): void {
    if (this._saved === saved) return
    this._saved = saved
    for (const fn of this.savedListeners) fn(saved)
  }

  /** Force-flush any pending XMP write (e.g. before unmount). */
  flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    return this.writeNow()
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.current)
  }

  private scheduleWrite(): void {
    this.setSaved(false)
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writeNow().catch(() => {})
    }, ParamsStore.WRITE_DEBOUNCE_MS)
  }

  private async writeNow(): Promise<void> {
    if (!this.sourcePath) return
    await window.electronAPI.editorWriteParams(this.sourcePath, this.current)
    if (!this.writeTimer) this.setSaved(true) // stay dirty if a new write is already queued
  }
}

// ── Label inference for history entries ──
//
// Maps EditParams keys to human-readable labels for the history
// panel. Anything not in the map falls through to a sensible default
// (the key itself, capitalised). Adding new params doesn't require
// updating this map. They'll show up labelled by their key, which
// is fine for technical fields and a tiny improvement gap for
// designed labels.
const KEY_LABELS: Partial<Record<ParamKey, string>> = {
  exposure: 'Exposure',
  contrast: 'Contrast',
  highlights: 'Highlights',
  shadows: 'Shadows',
  whites: 'Whites',
  blacks: 'Blacks',
  temperature: 'Temperature',
  tint: 'Tint',
  vibrance: 'Vibrance',
  saturation: 'Saturation',
  texture: 'Texture',
  clarity: 'Clarity',
  dehaze: 'Dehaze',
  toneCurve: 'Tone Curve',
  hsl: 'HSL',
  selectiveColor: 'Selective Color',
  bw: 'Black & White',
  colorGrading: 'Color Grading',
  defringe: 'Defringe',
  sharpening: 'Sharpening',
  noiseReduction: 'Noise Reduction',
  noiseAmount: 'Grain',
  noiseSize: 'Grain Size',
  noiseFrequency: 'Grain Frequency',
  calibration: 'Calibration',
  perspective: 'Perspective',
  lensDistortion: 'Lens Distortion',
  vignette: 'Vignette',
  lightLeak: 'Light Leak',
  frame: 'Frame',
  crop: 'Crop',
  orientation: 'Orientation',
  flipH: 'Flip',
  straightenDeg: 'Straighten',
  imageTransform: 'Transform',
  masks: 'Masks',
  healSpots: 'Heal & Clone',
}

function labelForKey(key: ParamKey): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key] as string
  // Fallback: capitalise the key. Better than showing the raw key
  // because it stays consistent with the labelled entries.
  const k = String(key)
  return k.charAt(0).toUpperCase() + k.slice(1)
}
