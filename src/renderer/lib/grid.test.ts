import { describe, it, expect } from 'vitest'
import {
  GRID_GUTTER, GRID_MIN_THUMB, GRID_TARGET_THUMB,
  maxColumnsFor, defaultColumnsFor, pageSizeFor, thumbEdgeFor,
} from './grid'

/**
 * The grid sizing rules, which exist because there were two of them.
 *
 * This module's own docstring records the cost: Workstation packed to a
 * 140px minimum with a 300px target, Local Archive to 160px with no
 * target, and only one of them was fixed when "as many as fit" turned
 * out to be the wrong default. The functions are shared now, so what is
 * worth pinning is the arithmetic both libraries depend on rather than
 * either surface's behaviour, which `test:ui` already covers.
 *
 * Widths are swept rather than sampled. A rule with a boundary at
 * `GRID_MIN_THUMB + GRID_GUTTER` is exactly the kind that is right at
 * 1200 and wrong at 1199.
 */

const WIDTHS = Array.from({ length: 200 }, (_, i) => i * 20)   // 0 .. 3980

describe('maxColumnsFor', () => {
  it('never returns less than one column, at any width', () => {
    for (const w of [...WIDTHS, -1, -1000, 0.5, NaN]) {
      expect(maxColumnsFor(w), String(w)).toBeGreaterThanOrEqual(1)
    }
  })

  it('never packs a column narrower than the breaking point', () => {
    for (const w of WIDTHS.filter(w => w >= GRID_MIN_THUMB + GRID_GUTTER)) {
      const columns = maxColumnsFor(w)
      expect(columns * (GRID_MIN_THUMB + GRID_GUTTER), String(w)).toBeLessThanOrEqual(w)
    }
  })

  it('never loses a column as the window widens', () => {
    let previous = 0
    for (const w of WIDTHS) {
      const columns = maxColumnsFor(w)
      expect(columns, `width ${w} gave fewer columns than ${w - 20}`).toBeGreaterThanOrEqual(previous)
      previous = columns
    }
  })
})

describe('defaultColumnsFor', () => {
  /**
   * The invariant the two implementations broke. Opening with more
   * columns than physically fit is what put thumbnails below the
   * breaking point and made the "more columns" control run past its own
   * limit.
   *
   * The clamp inside `defaultColumnsFor` is unreachable at the current
   * constants: `GRID_TARGET_THUMB` is 300 against a 140 minimum, so the
   * wanted count is below the maximum at every width (measured: it binds
   * at 0 of 6000). Removing the clamp today therefore breaks nothing and
   * this test still passes, which is worth stating so nobody deletes it
   * as dead. Lower the target below the minimum and the test fails at
   * once, which is the case the clamp is there for.
   */
  it('never opens with more columns than actually fit', () => {
    for (const w of [...WIDTHS, -1, 0, 1]) {
      expect(defaultColumnsFor(w), `width ${w}`).toBeLessThanOrEqual(maxColumnsFor(w))
    }
  })

  it('never returns less than one column', () => {
    for (const w of [...WIDTHS, -1, 0, NaN]) {
      expect(defaultColumnsFor(w), String(w)).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * The point of a target size: a thumbnail stays roughly judgeable and
   * the count is what changes. Opening at the breaking point instead
   * would pack in everything that technically fits at 140px, which is
   * too small to cull from.
   */
  it('keeps the opening thumbnail nearer the target than the minimum', () => {
    for (const w of WIDTHS.filter(w => w >= GRID_TARGET_THUMB * 2)) {
      const cell = w / defaultColumnsFor(w)
      expect(cell, `width ${w} opened at ${cell}px per cell`).toBeGreaterThan(GRID_MIN_THUMB)
    }
  })
})

describe('pageSizeFor', () => {
  it('fills whole rows only', () => {
    for (const columns of [1, 2, 3, 5, 8]) {
      for (const height of [100, 337, 900, 1440]) {
        expect(pageSizeFor(height, 220, columns) % columns, `${height}/${columns}`).toBe(0)
      }
    }
  })

  // Zero would divide the page count by zero and strand the user on a
  // page that cannot exist.
  it('always holds at least one row', () => {
    expect(pageSizeFor(10, 220, 4)).toBe(4)
    expect(pageSizeFor(0, 220, 3)).toBe(3)
  })

  it('does not divide by a zero row height or column count', () => {
    expect(() => pageSizeFor(900, 0, 4)).not.toThrow()
    expect(pageSizeFor(900, 0, 4)).toBeGreaterThanOrEqual(1)
    expect(pageSizeFor(900, 220, 0)).toBeGreaterThanOrEqual(1)
  })
})

describe('thumbEdgeFor', () => {
  it('never asks for a thumbnail smaller than 128px', () => {
    for (const w of [0, 1, 50, 127, 128]) expect(thumbEdgeFor(w)).toBe(128)
  })

  /**
   * The coarse step is the whole point: adjacent column widths must land
   * on the same request so they share a cache entry, and the viewer must
   * compute the same number the grid did or it misses the cache on every
   * photograph.
   */
  it('steps in 128px buckets so neighbouring widths share a cache entry', () => {
    for (const w of [200, 220, 240, 255]) expect(thumbEdgeFor(w), String(w)).toBe(256)
    for (const w of [260, 300, 383]) expect(thumbEdgeFor(w), String(w)).toBe(384)
    for (const w of [0, 130, 260, 401, 999]) expect(thumbEdgeFor(w) % 128, String(w)).toBe(0)
  })

  it('accounts for device pixel ratio', () => {
    expect(thumbEdgeFor(200, 2)).toBe(512)
    expect(thumbEdgeFor(200, 1)).toBe(256)
  })

  it('is deterministic, so the grid and the viewer agree', () => {
    for (const w of [137, 260, 411]) expect(thumbEdgeFor(w)).toBe(thumbEdgeFor(w))
  })
})
