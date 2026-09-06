import { describe, it, expect } from 'vitest'
import { ZOOM_STEPS, DEFAULT_ZOOM, stepZoom, parseZoom, zoomIntent } from './zoom'

const MAC = { control: false, meta: true, alt: false, isMac: true }
const PC = { control: true, meta: false, alt: false, isMac: false }

describe('the zoom ladder', () => {
  it('has 1 on it, exactly, so reset is reachable', () => {
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM)
  })

  it('is sorted, which every step and snap below assumes', () => {
    expect([...ZOOM_STEPS]).toEqual([...ZOOM_STEPS].sort((a, b) => a - b))
  })

  it('steps one rung at a time in both directions', () => {
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.9, -1)).toBe(0.8)
    expect(stepZoom(1, 1)).toBe(1.1)
  })

  // Chromium blanks the window at a zoom factor of 0 and the layout has
  // nowhere to go past the ends, so the ladder has to stop rather than
  // run off either edge.
  it('stops at the ends rather than running off them', () => {
    const min = ZOOM_STEPS[0]
    const max = ZOOM_STEPS[ZOOM_STEPS.length - 1]
    expect(stepZoom(min, -1)).toBe(min)
    expect(stepZoom(max, 1)).toBe(max)
  })

  it('returns to exactly 1 after going down and back up', () => {
    expect(stepZoom(stepZoom(1, -1), 1)).toBe(1)
  })

  it('snaps a value that is not on the ladder before stepping', () => {
    // 0.83 sits between 0.8 and 0.9; a step down must land on 0.8, not
    // on 0.83 minus something.
    expect(stepZoom(0.83, -1)).toBe(0.75)
    expect(ZOOM_STEPS).toContain(stepZoom(0.83, 1))
  })
})

describe('reading the stored zoom', () => {
  it('defaults when nothing has been stored', () => {
    expect(parseZoom(null)).toBe(DEFAULT_ZOOM)
    expect(parseZoom(undefined)).toBe(DEFAULT_ZOOM)
    expect(parseZoom('')).toBe(DEFAULT_ZOOM)
    expect(parseZoom('   ')).toBe(DEFAULT_ZOOM)
  })

  // The store is text and has held it across versions. A zoom factor of
  // 0 renders a blank window, so none of these may reach Chromium.
  it('refuses anything that would blank the window', () => {
    expect(parseZoom('nonsense')).toBe(DEFAULT_ZOOM)
    expect(parseZoom('0')).toBe(DEFAULT_ZOOM)
    expect(parseZoom('-1')).toBe(DEFAULT_ZOOM)
    expect(parseZoom('NaN')).toBe(DEFAULT_ZOOM)
    expect(parseZoom('Infinity')).toBe(DEFAULT_ZOOM)
  })

  it('round-trips every step it wrote', () => {
    for (const step of ZOOM_STEPS) expect(parseZoom(String(step))).toBe(step)
  })

  it('snaps an off-ladder value onto the ladder', () => {
    expect(ZOOM_STEPS).toContain(parseZoom('0.83'))
    expect(parseZoom('99')).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1])
  })
})

describe('recognising the keypress', () => {
  it('reads Ctrl and the Mac reads Command', () => {
    expect(zoomIntent('-', PC)).toBe('out')
    expect(zoomIntent('-', MAC)).toBe('out')
  })

  it('takes both halves of the shared +/= key', () => {
    expect(zoomIntent('=', PC)).toBe('in')
    expect(zoomIntent('+', PC)).toBe('in')
    expect(zoomIntent('_', PC)).toBe('out')
  })

  it('0 resets', () => {
    expect(zoomIntent('0', PC)).toBe('reset')
  })

  // Without the modifier these are a hyphen and a zero. The viewer binds
  // 0-5 to star ratings, so swallowing a bare 0 would take a rating away.
  it('ignores the same keys without the modifier', () => {
    const none = { control: false, meta: false, alt: false, isMac: false }
    expect(zoomIntent('0', none)).toBeNull()
    expect(zoomIntent('-', none)).toBeNull()
  })

  it('ignores the wrong modifier for the platform', () => {
    expect(zoomIntent('-', { control: false, meta: true, alt: false, isMac: false })).toBeNull()
    expect(zoomIntent('-', { control: true, meta: false, alt: false, isMac: true })).toBeNull()
  })

  it('leaves Alt combinations alone', () => {
    expect(zoomIntent('-', { ...PC, alt: true })).toBeNull()
  })

  it('is not interested in any other key', () => {
    for (const k of ['a', '1', 'Enter', 'ArrowLeft', 'Escape']) {
      expect(zoomIntent(k, PC)).toBeNull()
    }
  })
})
