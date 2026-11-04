import { describe, it, expect } from 'vitest'
import { describeSweep } from './sweep-status'

const base = {
  file: 'DCIM/100CERNX/QA_0012.JPG', current: 12, total: 678,
  bytesPerSecond: 14 * 1024 * 1024, startedAt: 0, at: 10_000,
}

describe('describeSweep', () => {
  it('names the count, the file and the pace', () => {
    const d = describeSweep(base)
    expect(d.count).toBe('12 of 678')
    expect(d.file).toBe('QA_0012.JPG')
    expect(d.pace).toMatch(/^14 MB\/s · about \d+ min left$/)
  })

  it('says nothing about time left before there is a rate to go on', () => {
    expect(describeSweep({ ...base, current: 1 }).pace).toBe('14 MB/s')
    expect(describeSweep({ ...base, at: 1_000 }).pace).toBe('14 MB/s')
  })

  it('has no pace line when nothing is known', () => {
    expect(describeSweep({ ...base, current: 1, bytesPerSecond: 0, at: 500 }).pace).toBeNull()
  })

  it('reads a Windows path and slow speeds', () => {
    const d = describeSweep({ ...base, file: 'DCIM\\A.JPG', bytesPerSecond: 300 * 1024, current: 1 })
    expect(d.file).toBe('A.JPG')
    expect(d.pace).toBe('300 KB/s')
  })
})
