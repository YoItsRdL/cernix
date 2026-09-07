import { describe, it, expect } from 'vitest'
import {
  clamp,
  computeBaseScale,
  screenDeltaToPan,
  panToScreenDelta,
  cropToTransform,
  transformToCrop,
  calculateStageLayout,
  inscribedCrop,
} from './geometry-logic'
import { FRAME_PRESETS, findFrame } from '../../../shared/frame-presets'

/**
 * The editor's coordinate maths.
 *
 * Most editor faults announce themselves: a slider that does nothing, a
 * crop handle in the wrong place. These do not, quite. A pan that
 * drifts by a fraction under rotation, or a crop that loses a percent
 * each time it is round-tripped, looks like the photograph moving
 * slightly and reads as the user's own imprecision.
 *
 * Two of these functions are inverses of two others, which gives an
 * invariant worth far more than any sampled expectation: whatever goes
 * in must come back.
 */

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

const FIT = { x: 100, y: 50, w: 800, h: 600 }
const DOC = { x: 100, y: 50, w: 800, h: 600 }

describe('clamp', () => {
  it('holds a value inside its bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(0, 0, 0)).toBe(0)
  })
})

describe('computeBaseScale', () => {
  /**
   * One axis is always 1: the image is fitted, so it touches the canvas
   * on its limiting side and is inset on the other. Both below 1 would
   * mean the photograph never fills the frame in either direction.
   */
  it('always pins one axis to 1, whatever the aspect', () => {
    for (const [cw, ch] of [[3, 2], [2, 3], [1, 1], [16, 9], [9, 16]]) {
      for (const [vw, vh] of [[1200, 800], [800, 1200], [1000, 1000]]) {
        const { baseScaleX, baseScaleY } = computeBaseScale(4000, 3000, 0, cw, ch, vw, vh)
        expect(Math.max(baseScaleX, baseScaleY), `${cw}x${ch} in ${vw}x${vh}`).toBeCloseTo(1, 9)
        expect(Math.min(baseScaleX, baseScaleY)).toBeGreaterThan(0)
        expect(Math.min(baseScaleX, baseScaleY)).toBeLessThanOrEqual(1)
      }
    }
  })

  /**
   * `cropW`/`cropH` are normalised fractions of the image, not an aspect
   * ratio. Reading them as an aspect is what made the first version of
   * this test fail against correct code.
   */
  it('fills both axes when the cropped image matches the canvas', () => {
    const { baseScaleX, baseScaleY } = computeBaseScale(4000, 3000, 0, 1, 1, 1200, 900)
    expect(baseScaleX).toBeCloseTo(1, 9)
    expect(baseScaleY).toBeCloseTo(1, 9)
  })

  it('accounts for a 90 degree orientation swapping the image axes', () => {
    const upright = computeBaseScale(4000, 3000, 0, 1, 1, 1200, 900)
    const turned = computeBaseScale(4000, 3000, 90, 1, 1, 1200, 900)
    expect(upright).not.toEqual(turned)
    expect(Math.max(turned.baseScaleX, turned.baseScaleY)).toBeCloseTo(1, 9)
  })
})

describe('screenDeltaToPan and panToScreenDelta are inverses', () => {
  /**
   * The pair the drag path depends on: a pointer moves by some pixels,
   * that becomes a pan, and the overlay converts it back to position a
   * handle. Any asymmetry shows as the handle lagging the cursor.
   */
  it('round-trips a drag through every rotation and flip', () => {
    for (const rot of [0, 15, 90, 180, 270, -45]) {
      for (const flip of [false, true]) {
        for (const [dx, dy] of [[10, 0], [0, 10], [-37, 21], [120, -80]]) {
          const { dpanX, dpanY } = screenDeltaToPan(dx, dy, rot, flip, 800, 600, 1.4)
          const back = panToScreenDelta(dpanX, dpanY, rot, flip, 800, 600, 1.4)
          const label = `rot=${rot} flip=${flip} d=(${dx},${dy})`
          expect(near(back.dxPixel, dx, 1e-9), `${label} x: ${back.dxPixel}`).toBe(true)
          expect(near(back.dyPixel, dy, 1e-9), `${label} y: ${back.dyPixel}`).toBe(true)
        }
      }
    }
  })

  it('moves the photograph the way the pointer moved, unrotated', () => {
    const { dpanX, dpanY } = screenDeltaToPan(80, 0, 0, false, 800, 600, 1)
    expect(dpanX).toBeGreaterThan(0)
    expect(near(dpanY, 0)).toBe(true)
  })

  // A horizontal flip has to invert horizontal dragging, or the image
  // runs away from the cursor on a mirrored photograph.
  it('inverts horizontal movement when the image is flipped', () => {
    const plain = screenDeltaToPan(50, 0, 0, false, 800, 600, 1)
    const flipped = screenDeltaToPan(50, 0, 0, true, 800, 600, 1)
    expect(Math.sign(plain.dpanX)).toBe(-Math.sign(flipped.dpanX))
  })
})

describe('cropToTransform and transformToCrop are inverses', () => {
  /**
   * Free transform bakes whatever is inside the document into a new
   * crop; opening that crop again must reproduce the same transform.
   * A drift here compounds: every apply shaves a little more off the
   * frame, and each individual step looks plausible.
   */
  it('round-trips a crop through the transform and back', () => {
    const CROPS = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { x: 0.25, y: 0.4, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    ]
    for (const crop of CROPS) {
      const t = cropToTransform(crop, FIT, DOC)
      const back = transformToCrop(t, FIT, DOC)
      const label = JSON.stringify(crop)
      expect(near(back.x, crop.x, 1e-6), `${label} x -> ${back.x}`).toBe(true)
      expect(near(back.y, crop.y, 1e-6), `${label} y -> ${back.y}`).toBe(true)
      expect(near(back.w, crop.w, 1e-6), `${label} w -> ${back.w}`).toBe(true)
      expect(near(back.h, crop.h, 1e-6), `${label} h -> ${back.h}`).toBe(true)
    }
  })

  it('leaves a full-frame crop at identity', () => {
    const t = cropToTransform({ x: 0, y: 0, w: 1, h: 1 }, FIT, DOC)
    expect(t.scale).toBeCloseTo(1, 9)
    expect(t.panX).toBeCloseTo(0, 9)
    expect(t.panY).toBeCloseTo(0, 9)
  })

  it('scales up as the crop tightens', () => {
    const wide = cropToTransform({ x: 0, y: 0, w: 1, h: 1 }, FIT, DOC).scale
    const tight = cropToTransform({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, FIT, DOC).scale
    expect(tight).toBeGreaterThan(wide)
  })

  // Never a crop that reaches outside the image, and never one of zero
  // area: both produce a WebGL sample outside the texture, which reads
  // as a black edge the user cannot explain.
  it('never returns a crop outside the image, however extreme the transform', () => {
    for (const t of [
      { scale: 0.001, panX: 0, panY: 0 },
      { scale: 1000, panX: 0, panY: 0 },
      { scale: 1, panX: 5, panY: -5 },
      { scale: 0, panX: 0, panY: 0 },
      { scale: 2, panX: -3, panY: 3 },
    ]) {
      const c = transformToCrop(t, FIT, DOC)
      const label = JSON.stringify(t)
      expect(c.x, `${label} x`).toBeGreaterThanOrEqual(0)
      expect(c.y, `${label} y`).toBeGreaterThanOrEqual(0)
      expect(c.w, `${label} w`).toBeGreaterThan(0)
      expect(c.h, `${label} h`).toBeGreaterThan(0)
      expect(c.x + c.w, `${label} right edge`).toBeLessThanOrEqual(1 + 1e-9)
      expect(c.y + c.h, `${label} bottom edge`).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

/**
 * Where a frame puts the photograph.
 *
 * `calculateStageLayout` is what both the preview and the export ask,
 * and they share a shader so they cannot disagree about it. That makes
 * this the furthest the frame path can be checked without a GPU, a raw
 * file and a real editor session — which is exactly the gap that let a
 * frame ship in the picker and fail on export before.
 */
describe('a frame places the photograph in its cutout', () => {
  const FIND = (id: string | null) => findFrame(id)
  const FULL = { x: 0, y: 0, w: 1, h: 1 }
  const layoutFor = (id: string, container = { width: 1200, height: 900 }) =>
    calculateStageLayout(
      container,
      { w: 4000, h: 3000 },
      { orientation: 0, frame: id, crop: null },
      'idle',
      FIND,
      FULL,
      1,
    )

  it('every shipped preset produces a layout', () => {
    for (const preset of FRAME_PRESETS) expect(layoutFor(preset.id)).not.toBeNull()
  })

  // The cutout is a window in the frame. A photograph placed outside it
  // is painted over by the frame, or off the exported image entirely.
  it('keeps every cutout inside the frame box it belongs to', () => {
    for (const preset of FRAME_PRESETS) {
      const l = layoutFor(preset.id)!
      const { boxX, boxY, boxW, boxH, cutout } = l.frame!
      const inside =
        cutout.x >= boxX - 1e-6 &&
        cutout.y >= boxY - 1e-6 &&
        cutout.x + cutout.w <= boxX + boxW + 1e-6 &&
        cutout.y + cutout.h <= boxY + boxH + 1e-6
      expect({ id: preset.id, inside }).toEqual({ id: preset.id, inside: true })
    }
  })

  // The whole point of a frame is the shape of its window. If the
  // layout does not preserve the aspect the PNG was measured at, the
  // photograph is stretched into it.
  it('preserves each cutout aspect from the preset table', () => {
    for (const preset of FRAME_PRESETS) {
      const l = layoutFor(preset.id)!
      const wanted = preset.cutout.w / preset.cutout.h
      const got = l.frame!.cutout.w / l.frame!.cutout.h
      expect({ id: preset.id, ok: near(wanted, got, 1e-6) }).toEqual({ id: preset.id, ok: true })
    }
  })

  // The new preset specifically: a landscape window in a portrait card,
  // so the cutout must be wider than it is tall while the frame is not.
  it('gives the landscape preset a landscape window in a portrait card', () => {
    const preset = findFrame('classic-landscape')!
    const l = layoutFor('classic-landscape')!
    expect(preset.outer.w / preset.outer.h).toBeLessThan(1)
    expect(l.frame!.cutout.w / l.frame!.cutout.h).toBeGreaterThan(1)
    // And it sits below the top of the card rather than flush with it,
    // which is what the band above the photograph is.
    expect(l.frame!.cutout.y).toBeGreaterThan(l.frame!.boxY)
  })

  it('fits the frame inside the container in either window shape', () => {
    for (const container of [{ width: 1200, height: 900 }, { width: 700, height: 1200 }]) {
      const l = layoutFor('classic-landscape', container)!
      const { boxW, boxH } = l.frame!
      expect(boxW).toBeLessThanOrEqual(container.width + 1e-6)
      expect(boxH).toBeLessThanOrEqual(container.height + 1e-6)
    }
  })
})

/**
 * The auto-crop rectangle.
 *
 * It lived inside GeometryPanel, private to a React component, which is
 * why the maths that decides how much of a straightened photograph
 * survives had no test at all. Here it is a function of four numbers.
 */
describe('the inscribed crop for a straightened photograph', () => {
  const LANDSCAPE = { w: 4000, h: 3000 }

  it('asks for no crop when the photograph is not straightened', () => {
    expect(inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, 0)).toBeNull()
    // A hair off level is not worth cropping for, and cropping for it
    // would throw away pixels every time a slider is nudged and released.
    expect(inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, 0.01)).toBeNull()
  })

  it('crops symmetrically about the centre', () => {
    const r = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, 16.9)!
    expect(near(r.x, (1 - r.w) / 2)).toBe(true)
    expect(near(r.y, (1 - r.h) / 2)).toBe(true)
  })

  it('takes the same rectangle whichever way the angle leans', () => {
    const left = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, -16.9)!
    const right = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, 16.9)!
    expect(near(left.w, right.w)).toBe(true)
    expect(near(left.h, right.h)).toBe(true)
  })

  // The rectangle must fit inside the photograph, or the crop reaches
  // past the edge and the corners it exists to remove come back.
  it('stays inside the photograph at every angle it accepts', () => {
    for (let deg = 0.1; deg <= 44; deg += 0.7) {
      const r = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, deg)
      if (!r) continue
      const ok = r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9
      expect({ deg: Math.round(deg * 10) / 10, ok }).toEqual({ deg: Math.round(deg * 10) / 10, ok: true })
    }
  })

  it('keeps less of the photograph the further it is turned', () => {
    const areas = [5, 10, 20, 30].map(d => {
      const r = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, d)!
      return r.w * r.h
    })
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThan(areas[i - 1])
  })

  // A quarter-turn swaps the axes twice over: once for the display the
  // user is straightening, once converting back to source coordinates.
  // The two cancel, so the crop in source terms is the same rectangle.
  it('agrees with itself across a quarter-turn', () => {
    const upright = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, 16.9)!
    const turned = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 90, 16.9)!
    expect(near(upright.w, turned.w)).toBe(true)
    expect(near(upright.h, turned.h)).toBe(true)
  })

  it('refuses rather than returning a degenerate rectangle', () => {
    // Past 45° the inscribed rectangle collapses; the guard must return
    // null instead of a negative or inverted rect.
    for (const deg of [45, 60, 89]) {
      const r = inscribedCrop(LANDSCAPE.w, LANDSCAPE.h, 0, deg)
      expect(r === null || (r.w > 0 && r.h > 0)).toBe(true)
    }
  })
})
