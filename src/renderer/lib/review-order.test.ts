import { describe, it, expect } from 'vitest'
import { sortOldestFirst } from './review-order'

const f = (relativePath: string, mtime: string, captureDate?: string) => ({ relativePath, mtime, captureDate })

describe('sortOldestFirst', () => {
  it('puts the earliest capture first, whatever the file time says', () => {
    const out = sortOldestFirst([
      f('b.jpg', '2026-10-30', '2026-10-24T10:02:00Z'),
      f('a.jpg', '2026-10-01', '2026-10-24T10:01:00Z'),
      f('c.jpg', '2026-10-31'),
    ])
    expect(out.map(x => x.relativePath)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('falls back to file time without a capture date, and keeps a burst in numeric order', () => {
    const out = sortOldestFirst([
      f('IMG_10.jpg', '2026-10-24T10:00:00Z'),
      f('IMG_9.jpg', '2026-10-24T10:00:00Z'),
      f('IMG_2.jpg', '2026-10-24T10:00:00Z'),
    ])
    expect(out.map(x => x.relativePath)).toEqual(['IMG_2.jpg', 'IMG_9.jpg', 'IMG_10.jpg'])
  })

  it('does not change the list it is given', () => {
    const input = [f('b', '2026-02-01'), f('a', '2026-01-01')]
    sortOldestFirst(input)
    expect(input[0].relativePath).toBe('b')
  })
})
