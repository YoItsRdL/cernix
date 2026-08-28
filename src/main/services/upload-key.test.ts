import { describe, it, expect } from 'vitest'
import { uploadKey } from './upload-key'

/**
 * These exist because of a real failure, not a hypothetical one: the
 * ledger stored `2026\August\21\P1100463.JPG` and the lookup searched
 * for a path ending in `/P1100463.JPG`, so on Windows nothing ever
 * matched and a card of 2294 already-uploaded files reported that none
 * of them had been imported. The first test here is that bug.
 */
describe('uploadKey', () => {
  const SIZE = 7691264

  it('matches a Windows path against the bare name it ends with', () => {
    expect(uploadKey('2026\\August\\21\\P1100463.JPG', SIZE))
      .toBe(uploadKey('P1100463.JPG', SIZE))
  })

  it('matches a POSIX path the same way', () => {
    expect(uploadKey('2026/August/21/P1100463.JPG', SIZE))
      .toBe(uploadKey('P1100463.JPG', SIZE))
  })

  it('treats the two separators as the same path', () => {
    expect(uploadKey('2026\\August\\21\\P1100463.JPG', SIZE))
      .toBe(uploadKey('2026/August/21/P1100463.JPG', SIZE))
  })

  it('ignores case, since the filesystems it runs on do', () => {
    expect(uploadKey('P1100463.JPG', SIZE)).toBe(uploadKey('p1100463.jpg', SIZE))
  })

  it('separates two different files that share a name', () => {
    // A camera rolling its counter over. Same name, different picture.
    expect(uploadKey('DSC_0001.JPG', 5_133_824))
      .not.toBe(uploadKey('DSC_0001.JPG', 7_868_416))
  })

  it('keeps a bare name usable as a key', () => {
    expect(uploadKey('P1100463.JPG', SIZE)).toBe('p1100463.jpg|7691264')
  })

  it('survives a name with no directory part and odd characters', () => {
    expect(uploadKey('100%_final_v2.JPG', 12)).toBe('100%_final_v2.jpg|12')
  })
})
