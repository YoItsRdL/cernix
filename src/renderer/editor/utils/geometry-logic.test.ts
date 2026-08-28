import { describe, it, expect } from 'vitest'
import {
  clamp,
  computeBaseScale,
  screenDeltaToPan,
  panToScreenDelta,
  cropToTransform,
  transformToCrop,
} from './geometry-logic'

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
