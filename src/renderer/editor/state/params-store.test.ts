import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ParamsStore } from './params-store'
import { DEFAULT_PARAMS } from '../../../shared/edit-params'
import type { EditParams } from '@/types'

/**
 * The editor's undo stack.
 *
 * Session-scoped and never persisted, so a fault here costs work that
 * exists nowhere else. It is also the one part of the editor that is
 * quiet when wrong: an undo that lands on the wrong step looks like the
 * user having lost track of what they did, and a history that coalesces
 * too eagerly silently merges two decisions into one.
 */

/** The write path debounces onto a real timer; nothing here needs it. */
const store = () => {
  const s = new ParamsStore()
  // The path is only an opaque id here: the write path is debounced
  // onto a timer and there is no bridge in this environment to take it.
  s.bind('card/DSC_0001.ARW', { ...DEFAULT_PARAMS })
  return s
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const labels = (s: ParamsStore) => s.getHistory().entries.map(e => e.label).join(' | ')
const at = (s: ParamsStore) => s.getHistory().currentIndex

describe('ParamsStore.bind', () => {
  it('backfills a key the stored sidecar predates', () => {
    const s = new ParamsStore()
    const partial = { ...DEFAULT_PARAMS } as Record<string, unknown>
    delete partial.exposure
    s.bind('x', partial as unknown as EditParams)
    expect(s.get().exposure).toBe(DEFAULT_PARAMS.exposure)
  })

  // A key from a newer schema must not be carried back into the file on
  // the next save, where it would look like data this version wrote.
  it('drops a key the current schema does not know', () => {
    const s = new ParamsStore()
    s.bind('x', { ...DEFAULT_PARAMS, somethingFromTheFuture: 42 } as unknown as EditParams)
    expect('somethingFromTheFuture' in (s.get() as unknown as object)).toBe(false)
  })
})

describe('ParamsStore history', () => {
  it('records one step per distinct edit', () => {
    const s = store()
    s.set('exposure', 0.5)
    vi.advanceTimersByTime(600)
    s.set('contrast', 0.25)
    expect(labels(s)).toContain('Contrast')
    expect(s.getHistory().entries.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * A drag emits a value per frame. Without coalescing the panel fills
   * with a hundred identical "Exposure" steps and undo becomes useless,
   * which is why the window exists.
   */
  it('coalesces a continuous drag into a single step', () => {
    const s = store()
    const before = s.getHistory().entries.length
    for (let i = 1; i <= 20; i++) {
      s.set('exposure', i / 100)
      vi.advanceTimersByTime(10)
    }
    expect(s.getHistory().entries.length - before, 'a drag is one decision').toBe(1)
    expect(s.get().exposure).toBeCloseTo(0.2, 6)
  })

  it('starts a new step once the coalescing window has passed', () => {
    const s = store()
    const before = s.getHistory().entries.length
    s.set('exposure', 0.1)
    vi.advanceTimersByTime(600)
    s.set('exposure', 0.2)
    expect(s.getHistory().entries.length - before).toBe(2)
  })

  it('moves the parameters when jumping to an earlier step', () => {
    const s = store()
    s.set('exposure', 0.4)
    vi.advanceTimersByTime(600)
    s.set('exposure', 0.9)
    const top = at(s)
    s.jumpTo(top - 1)
    expect(s.get().exposure).toBeCloseTo(0.4, 6)
    s.jumpTo(top)
    expect(s.get().exposure).toBeCloseTo(0.9, 6)
  })

  /**
   * Editing after an undo branches: everything ahead is dropped, the way
   * every undo stack the user has met behaves. Keeping the tail would
   * let a redo jump to a state the current parameters never passed
   * through.
   */
  it('drops the redo tail when editing after an undo', () => {
    const s = store()
    s.set('exposure', 0.1); vi.advanceTimersByTime(600)
    s.set('contrast', 0.2); vi.advanceTimersByTime(600)
    s.set('saturation', 0.3); vi.advanceTimersByTime(600)
    const full = s.getHistory().entries.length

    s.jumpTo(at(s) - 2)
    s.set('vibrance', 0.4)

    expect(s.getHistory().entries.length, 'the tail must not survive').toBeLessThan(full)
    expect(at(s)).toBe(s.getHistory().entries.length - 1)
    expect(labels(s)).not.toContain('Saturation')
  })

  it('refuses a jump outside the history', () => {
    const s = store()
    s.set('exposure', 0.5)
    const before = at(s)
    s.jumpTo(-1)
    s.jumpTo(999)
    expect(at(s)).toBe(before)
  })

  it('ignores a set that changes nothing', () => {
    const s = store()
    s.set('exposure', 0.5)
    vi.advanceTimersByTime(600)
    const n = s.getHistory().entries.length
    s.set('exposure', 0.5)
    expect(s.getHistory().entries.length).toBe(n)
  })

  it('tells subscribers about every parameter change', () => {
    const s = store()
    const seen: number[] = []
    const off = s.subscribe(p => seen.push(p.exposure))
    s.set('exposure', 0.3)
    s.set('exposure', 0.6)
    off()
    s.set('exposure', 0.9)
    expect(seen).toEqual([0.3, 0.6])
  })
})
