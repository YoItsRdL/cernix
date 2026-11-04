import { describe, it, expect } from 'vitest'
import { restorableWindow, serialiseWindow, sizeDrift } from './window-bounds'

const LAPTOP = { x: 0, y: 0, width: 1280, height: 760 }
const MONITOR = { x: 1280, y: 0, width: 2560, height: 1400 }

describe('restorableWindow', () => {
  it('restores a window where it was, and whether it was maximised', () => {
    const raw = serialiseWindow({ x: 100, y: 50, width: 1100, height: 700 }, true)
    expect(restorableWindow(raw, [LAPTOP])).toEqual({ x: 100, y: 50, width: 1100, height: 700, maximized: true })
  })

  // Closed on the external monitor, opened without it.
  it('refuses a place on a monitor that is gone', () => {
    const raw = serialiseWindow({ x: 1500, y: 100, width: 1400, height: 900 }, false)
    expect(restorableWindow(raw, [LAPTOP, MONITOR])).not.toBeNull()
    expect(restorableWindow(raw, [LAPTOP])).toBeNull()
  })

  it('refuses a window whose top strip is off every screen', () => {
    expect(restorableWindow(serialiseWindow({ x: 100, y: -600, width: 1100, height: 700 }, false), [LAPTOP])).toBeNull()
    expect(restorableWindow(serialiseWindow({ x: 1200, y: 50, width: 1100, height: 700 }, false), [LAPTOP])).toBeNull()
  })

  it('accepts a window hanging partly off a screen, as long as it can be dragged back', () => {
    expect(restorableWindow(serialiseWindow({ x: -900, y: 40, width: 1100, height: 700 }, false), [LAPTOP])).not.toBeNull()
  })

  it('ignores a missing, broken or nonsensical record', () => {
    for (const raw of [null, undefined, '', 'not json', '42', '{"x":1}', '{"x":0,"y":0,"width":"wide","height":700}',
      serialiseWindow({ x: 0, y: 0, width: 10, height: 10 }, false)]) {
      expect(restorableWindow(raw, [LAPTOP]), String(raw)).toBeNull()
    }
  })
})

describe('sizeDrift', () => {
  // Measured: Windows at 150%, caption hidden, 1000x650 opens as 1003x651.
  it('is the few pixels the platform adds', () => {
    expect(sizeDrift({ x: 0, y: 0, width: 1000, height: 650 }, { x: 0, y: 0, width: 1003, height: 651 })).toEqual({ width: 3, height: 1 })
  })

  it('is not a window clamped to a smaller screen', () => {
    expect(sizeDrift({ x: 0, y: 0, width: 1400, height: 900 }, { x: 0, y: 0, width: 1296, height: 760 })).toEqual({ width: 0, height: 0 })
  })
})

