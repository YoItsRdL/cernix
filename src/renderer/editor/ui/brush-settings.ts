/** The brush tool's own state: what the cursor does, not what the
 *  photograph records. Kept out of MaskPanel so the panel module
 *  exports a component and nothing else. */
export interface BrushSettings {
  /** Radius as a fraction of the image's longer edge [0..1]. */
  radius: number
  /** 0 = soft Gaussian, 1 = hard splat. */
  hardness: number
  /** Per-stroke opacity [0..1]. */
  opacity: number
  /** 'paint' adds, 'erase' subtracts. */
  mode: 'paint' | 'erase'
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  radius: 0.06,
  hardness: 0.5,
  opacity: 0.9,
  mode: 'paint',
}
