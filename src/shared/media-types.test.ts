import { describe, it, expect } from 'vitest'
import { isRawPath, isImagePath, isVideoPath } from './media-types'

describe('isRawPath', () => {
  it('knows the camera formats, in any case, with either separator', () => {
    for (const f of ['a.CR2', 'a.cr3', 'DCIM\\100\\A.NEF', 'x/y/z.arw', 'a.DNG', 'a.orf', 'a.raf', 'a.rw2', 'a.srw', 'a.pef', 'a.raw'])
      expect(isRawPath(f), f).toBe(true)
  })
  it('does not take other pictures, videos or look-alikes for RAW', () => {
    for (const f of ['a.jpg', 'a.png', 'a.mp4', 'a.xmp', 'raw', 'a.cr2.txt', 'a.crw2', 'cr2'])
      expect(isRawPath(f), f).toBe(false)
  })
  it('is separate from the picture and video kinds', () => {
    expect(isImagePath('a.cr2')).toBe(false)
    expect(isVideoPath('a.cr2')).toBe(false)
  })
})
