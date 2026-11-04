import { describe, it, expect } from 'vitest'
import { localRatingKey, baseName } from './local-rating-key'

describe('localRatingKey', () => {
  const base = { name: 'IMG_0001.JPG', sizeBytes: 1234, mtime: '2026-10-24T10:01:00.000Z' }

  it('is the same wherever the card is mounted', () => {
    expect(localRatingKey(base)).toBe(localRatingKey({ ...base }))
  })
  it('does not depend on the case of the name, or on a Date against its text', () => {
    expect(localRatingKey({ ...base, name: 'img_0001.jpg', mtime: new Date(base.mtime) })).toBe(localRatingKey(base))
  })
  it('differs when the size or the time differs', () => {
    expect(localRatingKey({ ...base, sizeBytes: 1235 })).not.toBe(localRatingKey(base))
    expect(localRatingKey({ ...base, mtime: '2026-10-24T10:01:01.000Z' })).not.toBe(localRatingKey(base))
  })
  it('ignores the sub-millisecond part a filesystem may add', () => {
    expect(localRatingKey({ ...base, mtime: 1761300060000.4 })).toBe(localRatingKey({ ...base, mtime: 1761300060000 }))
  })
})

describe('baseName', () => {
  it('takes the last part of a Windows or POSIX path', () => {
    expect(baseName('C:\\a\\b\\c.jpg')).toBe('c.jpg')
    expect(baseName('a/b/c.jpg')).toBe('c.jpg')
    expect(baseName('c.jpg')).toBe('c.jpg')
  })
})
