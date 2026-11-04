import { describe, it, expect } from 'vitest'
import { nudgedValue } from './editor-keys'

describe('nudgedValue', () => {
  it('moves one step on a plain arrow, whatever the step is', () => {
    expect(nudgedValue(0, 1, 0.05, false, -5, 5)).toBe(0.05)
    expect(nudgedValue(5000, 1, 50, false, 2000, 50000)).toBe(5050)
    expect(nudgedValue(10, -1, 1, false, 0, 100)).toBe(9)
    expect(nudgedValue(0, 1, 0.1, false, -45, 45)).toBe(0.1)
  })

  it('moves ten steps with shift', () => {
    expect(nudgedValue(0, 1, 0.05, true, -5, 5)).toBe(0.5)
    expect(nudgedValue(5000, -1, 50, true, 2000, 50000)).toBe(4500)
  })

  it('stays inside the slider', () => {
    expect(nudgedValue(4.98, 1, 0.05, false, -5, 5)).toBe(5)
    expect(nudgedValue(-4.99, -1, 0.05, true, -5, 5)).toBe(-5)
  })

  it('does not accumulate float noise', () => {
    let v = 0
    for (let i = 0; i < 30; i++) v = nudgedValue(v, 1, 0.1, false, -100, 100)
    expect(v).toBe(3)
  })
})
