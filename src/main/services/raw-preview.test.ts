import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { binarySize, readRawPreview } from './raw-preview'

describe('binarySize', () => {
  it('reads the size ExifTool reports for a binary tag', () => {
    expect(binarySize('(Binary data 703881 bytes, use -b option to extract)')).toBe(703881)
  })
  it('gives 0 for anything else', () => {
    expect(binarySize(undefined)).toBe(0)
    expect(binarySize('Rotate 90 CW')).toBe(0)
    expect(binarySize(42)).toBe(0)
  })
})

/**
 * Against real camera files, when they are on this machine (QA fetched them
 * from raw.pixls.us, public domain). Skipped everywhere else.
 */
const dir = 'C:/Users/User/CernixQA/raw-card/DCIM/100RAW'
const have = fs.existsSync(dir)
describe.skipIf(!have)('readRawPreview on real RAW files', () => {
  const find = (part: string) => path.join(dir, fs.readdirSync(dir).find(f => f.includes(part))!)

  it.each([
    ['Canon_EOS-350D', 'PreviewImage'],
    ['Canon_EOS-R', 'JpgFromRaw'],       // the full-size one, not the 230 kB preview
    ['Nikon_D70', 'JpgFromRaw'],
    ['Sony_DSLR-A100', 'PreviewImage'],
    ['Fujifilm_X-T1', 'PreviewImage'],
    ['Olympus_E-M10', 'PreviewImage'],   // lives in the maker notes
    ['Panasonic_DMC-LX3', 'JpgFromRaw'],
    ['Pentax_K100D', 'JpgFromRaw'],
    ['Samsung_NX1000', 'JpgFromRaw'],
  ])('%s gives a JPEG from %s', async (camera, tag) => {
    const pv = await readRawPreview(find(camera))
    expect(pv?.tag).toBe(tag)
    expect(pv!.jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(pv!.jpeg.length).toBeGreaterThan(8 * 1024)
  }, 20000)

  it('gives nothing for a file with no JPEG in it, rather than something wrong', async () => {
    expect(await readRawPreview(find('Leica_M8'))).toBeNull()
  }, 20000)

  it('gives nothing for a file that is not there', async () => {
    expect(await readRawPreview(path.join(dir, 'nope.CR2'))).toBeNull()
  }, 20000)
})
