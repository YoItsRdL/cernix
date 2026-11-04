import { describe, it, expect } from 'vitest'
import { orientBitmap, normaliseOrientation, type Bitmap } from './orient'

/** A 3 x 2 picture whose pixels are numbered 1 to 6, row by row, so a turn is easy to read. */
//   1 2 3
//   4 5 6
const pic = (): Bitmap => {
  const data = Buffer.alloc(3 * 2 * 4)
  for (let i = 0; i < 6; i++) data.writeUInt32LE(i + 1, i * 4)
  return { data, width: 3, height: 2 }
}
const numbers = (b: Bitmap) => Array.from({ length: b.width * b.height }, (_, i) => b.data.readUInt32LE(i * 4))

describe('orientBitmap', () => {
  it('leaves a picture that is the right way up', () => {
    const p = pic()
    expect(orientBitmap(p, 1)).toBe(p)
    expect(orientBitmap(p, undefined)).toBe(p)
    expect(orientBitmap(p, 99)).toBe(p)
  })

  it('turns 90 degrees clockwise for 6, and swaps width and height', () => {
    const r = orientBitmap(pic(), 6)
    expect([r.width, r.height]).toEqual([2, 3])
    expect(numbers(r)).toEqual([4, 1, 5, 2, 6, 3])
  })

  it('turns 90 degrees the other way for 8', () => {
    const r = orientBitmap(pic(), 8)
    expect([r.width, r.height]).toEqual([2, 3])
    expect(numbers(r)).toEqual([3, 6, 2, 5, 1, 4])
  })

  it('turns upside down for 3', () => {
    const r = orientBitmap(pic(), 3)
    expect([r.width, r.height]).toEqual([3, 2])
    expect(numbers(r)).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('mirrors for 2 and 4', () => {
    expect(numbers(orientBitmap(pic(), 2))).toEqual([3, 2, 1, 6, 5, 4])
    expect(numbers(orientBitmap(pic(), 4))).toEqual([4, 5, 6, 1, 2, 3])
  })

  it('transposes for 5 and transverses for 7', () => {
    expect(numbers(orientBitmap(pic(), 5))).toEqual([1, 4, 2, 5, 3, 6])
    expect(numbers(orientBitmap(pic(), 7))).toEqual([6, 3, 5, 2, 4, 1])
  })

  it('four quarter turns come back to the start', () => {
    let b = pic()
    for (let i = 0; i < 4; i++) b = orientBitmap(b, 6)
    expect(numbers(b)).toEqual(numbers(pic()))
  })
})

describe('normaliseOrientation', () => {
  it('reads a number or its text, and treats anything else as upright', () => {
    expect(normaliseOrientation(6)).toBe(6)
    expect(normaliseOrientation('8')).toBe(8)
    expect(normaliseOrientation('Rotate 90 CW')).toBe(1)
    expect(normaliseOrientation(0)).toBe(1)
    expect(normaliseOrientation(null)).toBe(1)
  })
})
