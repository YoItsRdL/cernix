import { describe, it, expect } from 'vitest'
import { parseExifDate } from './exif-date'

describe('parseExifDate', () => {
  it('reads a zone-less date as local time', () => {
    const d = parseExifDate('2026:10:24 10:01:00')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 24, 10, 1])
  })
  it('reads an offset', () => {
    expect(parseExifDate('2026:10:24 10:01:00+02:00')!.toISOString()).toBe('2026-10-24T08:01:00.000Z')
    expect(parseExifDate('2026:10:24 10:01:00Z')!.toISOString()).toBe('2026-10-24T10:01:00.000Z')
    expect(parseExifDate('2026:10:24 10:01:00.25-0500')!.toISOString()).toBe('2026-10-24T15:01:00.000Z')
  })
  it('gives nothing for no date, junk, or a non-string', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeUndefined()
    expect(parseExifDate('yesterday')).toBeUndefined()
    expect(parseExifDate(undefined)).toBeUndefined()
    expect(parseExifDate(42)).toBeUndefined()
  })
})
