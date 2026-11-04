import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { dateFromJpegHead, readJpegCaptureDate } from './jpeg-exif-date'

/** A JPEG head with one Exif block: IFD0 -> Exif IFD -> DateTimeOriginal. */
function jpegWith(date: string, littleEndian: boolean, tag = 0x9003): Buffer {
  const w16 = (n: number) => { const b = Buffer.alloc(2)
    if (littleEndian) b.writeUInt16LE(n)
    else b.writeUInt16BE(n)
    return b }
  const w32 = (n: number) => { const b = Buffer.alloc(4)
    if (littleEndian) b.writeUInt32LE(n)
    else b.writeUInt32BE(n)
    return b }
  const text = Buffer.concat([Buffer.from(date, 'latin1'), Buffer.from([0])])
  // TIFF: header (8), IFD0 at 8 with 1 entry (2 + 12 + 4), Exif IFD at 26 with 1 entry, then the text.
  const ifd0 = Buffer.concat([w16(1), w16(0x8769), w16(4), w32(1), w32(26), w32(0)])
  const textAt = 26 + 2 + 12 + 4
  const exif = Buffer.concat([w16(1), w16(tag), w16(2), w32(text.length), w32(textAt), w32(0)])
  const tiff = Buffer.concat([Buffer.from(littleEndian ? 'II' : 'MM'), w16(42), w32(8), ifd0, exif, text])
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 0xff]), body])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xda, 0, 2])])
}

describe('dateFromJpegHead', () => {
  it('reads DateTimeOriginal in either byte order', () => {
    expect(dateFromJpegHead(jpegWith('2026:10:24 10:01:00', true))).toBe('2026:10:24 10:01:00')
    expect(dateFromJpegHead(jpegWith('2026:10:24 10:01:00', false))).toBe('2026:10:24 10:01:00')
  })
  it('falls back to the digitised date, and ignores an empty one', () => {
    expect(dateFromJpegHead(jpegWith('2025:01:02 03:04:05', true, 0x9004))).toBe('2025:01:02 03:04:05')
    expect(dateFromJpegHead(jpegWith('0000:00:00 00:00:00', true))).toBeUndefined()
  })
  it('gives nothing for what is not a JPEG with Exif, rather than throwing', () => {
    expect(dateFromJpegHead(Buffer.from('not a jpeg'))).toBeUndefined()
    expect(dateFromJpegHead(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined()
    expect(dateFromJpegHead(jpegWith('2026:10:24 10:01:00', true).subarray(0, 30))).toBeUndefined()
    expect(dateFromJpegHead(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('against the QA fixture card, when it is here', () => {
  const card = 'C:/Users/User/CernixQA/fixture-card/DCIM/100CERNX'
  const have = fs.existsSync(path.join(card, 'QA_0001.JPG'))
  it.skipIf(!have)('agrees with the fixture manifest', async () => {
    expect(await readJpegCaptureDate(path.join(card, 'QA_0001.JPG'))).toBe('2026:10:24 10:01:00')
    expect(await readJpegCaptureDate(path.join(card, 'QA_NODATE.JPG'))).toBeUndefined()
    expect(await readJpegCaptureDate(path.join(card, 'ZERO.JPG'))).toBeUndefined()
  })
})
