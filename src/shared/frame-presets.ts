/**
 * Static metadata for frame overlays. Outer dimensions and cutout bounds
 * in the frame's own pixel space. The renderer loads the PNGs via its own
 * URL-import helper; the main process only needs the IDs (for XMP
 * persistence) and the dimensions (for export-size calculations).
 *
 * Cutouts were precomputed by scanning each PNG's alpha channel for the
 * transparent bounding box. No runtime alpha scanning needed.
 */

export interface FramePreset {
  /** Stable id persisted in XMP. Changing this breaks older sidecars. */
  id: string
  /** Human-readable label shown in the picker. */
  label: string
  /** Source-file name under `src/renderer/editor/assets/frames/`. */
  file: string
  /** Outer (final export) dimensions in pixels. */
  outer: { w: number; h: number }
  /** Transparent region where the photo is placed, in outer-pixel space. */
  cutout: { x: number; y: number; w: number; h: number }
}

export const FRAME_PRESETS: FramePreset[] = [
  {
    id: 'classic-1440',
    label: 'Classic',
    file: 'classic-1440.png',
    outer: { w: 1440, h: 1786 },
    cutout: { x: 16, y: 16, w: 1406, h: 1752 },
  },
  {
    id: 'story-landscape',
    label: 'Story · Landscape',
    file: 'story-landscape-1080x1920.png',
    outer: { w: 1080, h: 1920 },
    cutout: { x: 50, y: 592, w: 980, h: 736 },
  },
  {
    id: 'story-portrait',
    label: 'Story · Portrait',
    file: 'story-portrait-1080x1920.png',
    outer: { w: 1080, h: 1920 },
    cutout: { x: 56, y: 316, w: 968, h: 1288 },
  },
  {
    id: 'landscape-1300x971',
    label: 'Landscape',
    file: 'landscape-1300x971.png',
    outer: { w: 1300, h: 971 },
    cutout: { x: 9, y: 9, w: 1282, h: 952 },
  },
]

export function findFrame(id: string | null | undefined): FramePreset | null {
  if (!id) return null
  return FRAME_PRESETS.find(f => f.id === id) ?? null
}
