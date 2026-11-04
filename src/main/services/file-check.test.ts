import { describe, it, expect } from 'vitest'
import { damageOf } from './file-check'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const tiffLe = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])
const junk = Buffer.from('not an image')

describe('damageOf', () => {
  it('calls a zero-byte file empty, whatever it is', () => {
    expect(damageOf('A.JPG', 0, Buffer.alloc(0))).toBe('empty')
    expect(damageOf('A.MP4', 0, Buffer.alloc(0))).toBe('empty')
  })

  it('passes a JPEG with its signature and flags one without', () => {
    expect(damageOf('A.JPG', 1000, jpeg)).toBeUndefined()
    expect(damageOf('A.jpeg', 1000, junk)).toBe('unreadable')
  })

  it('checks the TIFF header on TIFF-based RAW files', () => {
    expect(damageOf('A.ARW', 1000, tiffLe)).toBeUndefined()
    expect(damageOf('A.ARW', 1000, junk)).toBe('unreadable')
  })

  it('trusts formats it has no fixed signature for', () => {
    expect(damageOf('A.MP4', 1000, junk)).toBeUndefined()
    expect(damageOf('A.CR3', 1000, junk)).toBeUndefined()
    expect(damageOf('A.XMP', 1000, junk)).toBeUndefined()
  })
})
