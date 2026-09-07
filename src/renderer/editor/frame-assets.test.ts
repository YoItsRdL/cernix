import { describe, it, expect } from 'vitest'
import { FRAME_PRESETS, findFrame } from '../../shared/frame-presets'
import { frameAssetUrl } from './frame-assets'

/**
 * The preset table and the URL map are two lists that have to agree, in
 * two files, kept apart on purpose so the main process can read the
 * metadata without importing PNGs. Nothing makes them agree.
 *
 * A preset whose id is missing from the map fails silently in both
 * places it is used: FramePanel renders `src={frameAssetUrl(p.id) ?? ''}`
 * and shows an empty tile, and the canvas overlay does the same. No
 * error, no warning, just a frame that is in the picker and cannot be
 * seen. That is what these cover.
 */
describe('frame presets and their assets', () => {
  it('every preset resolves to a bundled asset', () => {
    const missing = FRAME_PRESETS.filter(p => !frameAssetUrl(p.id)).map(p => p.id)
    expect(missing).toEqual([])
  })

  it('ids are unique, so findFrame cannot be ambiguous', () => {
    const ids = FRAME_PRESETS.map(p => p.id)
    expect(ids).toEqual([...new Set(ids)])
  })

  it('every preset is findable by its own id', () => {
    for (const p of FRAME_PRESETS) expect(findFrame(p.id)).toBe(p)
  })

  it('an unknown id resolves to nothing rather than to some other frame', () => {
    expect(frameAssetUrl('no-such-frame')).toBeNull()
    expect(findFrame('no-such-frame')).toBeNull()
  })

  // The cutout is where the photograph is drawn. A box that runs outside
  // the frame would place part of the picture beyond the exported image.
  it('every cutout lies inside its own outer bounds', () => {
    for (const { id, outer, cutout } of FRAME_PRESETS) {
      expect({ id, ok: cutout.x >= 0 && cutout.y >= 0 }).toEqual({ id, ok: true })
      expect({ id, ok: cutout.w > 0 && cutout.h > 0 }).toEqual({ id, ok: true })
      expect({ id, right: cutout.x + cutout.w <= outer.w }).toEqual({ id, right: true })
      expect({ id, bottom: cutout.y + cutout.h <= outer.h }).toEqual({ id, bottom: true })
    }
  })
})
