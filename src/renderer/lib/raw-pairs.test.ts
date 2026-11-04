import { describe, it, expect } from 'vitest'
import { findPairs, withCompanions, filesOfTiles } from './raw-pairs'

describe('findPairs', () => {
  it('pairs a RAW and a JPEG of the same name in the same folder, whatever the case', () => {
    const p = findPairs(['DCIM/100/IMG_1.CR2', 'DCIM/100/IMG_1.JPG', 'DCIM/100/img_2.nef', 'DCIM/100/IMG_2.jpeg'])
    expect(p.companionOf.get('DCIM/100/IMG_1.JPG')).toBe('DCIM/100/IMG_1.CR2')
    expect(p.companionOf.get('DCIM/100/IMG_2.jpeg')).toBe('DCIM/100/img_2.nef')
    expect(p.tileOf.get('DCIM/100/IMG_1.CR2')).toBe('DCIM/100/IMG_1.JPG')
  })

  it('reads either path separator', () => {
    const p = findPairs(['DCIM\\100\\A.ARW', 'DCIM\\100\\A.JPG'])
    expect(p.companionOf.get('DCIM\\100\\A.JPG')).toBe('DCIM\\100\\A.ARW')
  })

  it('leaves a RAW or a JPEG on its own, and the same name in another folder', () => {
    const p = findPairs(['a/IMG_1.CR2', 'b/IMG_1.JPG', 'a/IMG_3.JPG', 'a/IMG_4.CR2'])
    expect(p.companionOf.size).toBe(0)
    expect(p.tileOf.size).toBe(0)
  })

  it('does not guess when a name has more than one of either', () => {
    expect(findPairs(['a/X.CR2', 'a/X.JPG', 'a/X.jpeg']).companionOf.size).toBe(0)
    expect(findPairs(['a/X.CR2', 'a/X.NEF', 'a/X.JPG']).companionOf.size).toBe(0)
  })

  it('does not pair a JPEG with a video, a sidecar or another picture format', () => {
    expect(findPairs(['a/X.MP4', 'a/X.JPG', 'a/X.xmp', 'a/X.png']).companionOf.size).toBe(0)
  })

  it('handles a name with several dots', () => {
    const p = findPairs(['a/IMG.v2.CR2', 'a/IMG.v2.JPG'])
    expect(p.companionOf.get('a/IMG.v2.JPG')).toBe('a/IMG.v2.CR2')
  })
})

describe('withCompanions and filesOfTiles', () => {
  const pairs = findPairs(['a/1.CR2', 'a/1.JPG', 'a/2.JPG'])
  it('adds the RAW of a ticked pair and nothing else', () => {
    expect(withCompanions(['a/1.JPG', 'a/2.JPG'], pairs).sort()).toEqual(['a/1.CR2', 'a/1.JPG', 'a/2.JPG'])
  })
  it('does not add a RAW to a tile that is not ticked', () => {
    expect(withCompanions(['a/2.JPG'], pairs)).toEqual(['a/2.JPG'])
  })
  it('lists every file the shown tiles stand for', () => {
    expect([...filesOfTiles(['a/1.JPG'], pairs)].sort()).toEqual(['a/1.CR2', 'a/1.JPG'])
  })
})
