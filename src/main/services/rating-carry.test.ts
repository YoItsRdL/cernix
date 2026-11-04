import { describe, it, expect } from 'vitest'
import { carryRating, carryUploadedRating } from './rating-carry'
import { localRatingKey } from '../../shared/local-rating-key'
import type { RatingRecord } from '../../shared/ipc-types'

function fakeStore(initial: Record<string, Partial<RatingRecord>> = {}) {
  const rows = new Map<string, RatingRecord>()
  for (const [id, r] of Object.entries(initial)) rows.set(id, { fileId: id, userStars: null, flag: null, updatedAt: 0, ...r })
  const get = (id: string) => rows.get(id) ?? { fileId: id, userStars: null, flag: null, updatedAt: 0 }
  return {
    rows,
    getRating: (id: string) => rows.get(id) ?? null,
    setUserStars: (id: string, stars: RatingRecord['userStars']) => rows.set(id, { ...get(id), userStars: stars }),
    setFlag: (id: string, flag: RatingRecord['flag']) => rows.set(id, { ...get(id), flag }),
  }
}

describe('carryRating', () => {
  it('copies stars and pick to the Drive id and leaves the local mark', () => {
    const s = fakeStore({ 'local:a|1|2': { userStars: 4, flag: 'pick' } })
    expect(carryRating(s, 'local:a|1|2', 'drive1')).toBe(true)
    expect(s.rows.get('drive1')).toMatchObject({ userStars: 4, flag: 'pick' })
    expect(s.rows.get('local:a|1|2')).toMatchObject({ userStars: 4, flag: 'pick' })
  })
  it('does nothing for a photograph that was never marked', () => {
    const s = fakeStore({ 'local:a|1|2': {} })
    expect(carryRating(s, 'local:a|1|2', 'drive1')).toBe(false)
    expect(carryRating(s, 'local:none', 'drive1')).toBe(false)
    expect(s.rows.has('drive1')).toBe(false)
  })
  it('never overwrites a rating the Drive file already has', () => {
    const s = fakeStore({ 'local:a|1|2': { userStars: 5 }, drive1: { userStars: 2 } })
    expect(carryRating(s, 'local:a|1|2', 'drive1')).toBe(false)
    expect(s.rows.get('drive1')?.userStars).toBe(2)
  })
  it('does nothing without a Drive id', () => {
    const s = fakeStore({ 'local:a|1|2': { userStars: 5 } })
    expect(carryRating(s, 'local:a|1|2', null)).toBe(false)
  })
})

describe('carryUploadedRating', () => {
  const mtime = new Date('2026-10-24T10:01:00.000Z')
  const key = localRatingKey({ name: 'IMG_0001.NEF', sizeBytes: 5488179, mtime })

  it('finds the mark though the upload names the file by its path in the archive', () => {
    const s = fakeStore({ [key]: { userStars: 5, flag: 'pick' } })
    const job = { fileName: ['2017', 'September', '02', 'IMG_0001.NEF'].join('\\'), sizeBytes: 5488179, driveFileId: 'drive-id-1' }
    expect(carryUploadedRating(s, job, mtime)).toBe(true)
    expect(s.rows.get('drive-id-1')).toMatchObject({ userStars: 5, flag: 'pick' })
  })

  it('works the same with forward slashes', () => {
    const s = fakeStore({ [key]: { userStars: 3 } })
    expect(carryUploadedRating(s, { fileName: '2017/September/02/IMG_0001.NEF', sizeBytes: 5488179, driveFileId: 'd2' }, mtime)).toBe(true)
  })

  it('does not carry to another photograph that happens to share a name', () => {
    const s = fakeStore({ [key]: { userStars: 5 } })
    const other = { fileName: 'x/IMG_0001.NEF', sizeBytes: 999, driveFileId: 'd3' }
    expect(carryUploadedRating(s, other, mtime)).toBe(false)
    expect(carryUploadedRating(s, { ...other, sizeBytes: 5488179 }, new Date('2026-10-25T00:00:00Z'))).toBe(false)
  })

  it('does nothing when the upload has no Drive id', () => {
    const s = fakeStore({ [key]: { userStars: 5 } })
    expect(carryUploadedRating(s, { fileName: 'IMG_0001.NEF', sizeBytes: 5488179 }, mtime)).toBe(false)
  })
})
