import { describe, it, expect, vi } from 'vitest'
import { logActivity, onActivity, drivePath, count, nameList } from './activity-log'

describe('the activity bus', () => {
  it('delivers what was logged to every subscriber', () => {
    const a: string[] = []
    const b: string[] = []
    const offA = onActivity(e => a.push(e.message))
    const offB = onActivity(e => b.push(e.message))
    logActivity('drive', 'info', 'moved something')
    offA(); offB()
    expect(a).toEqual(['moved something'])
    expect(b).toEqual(['moved something'])
  })

  it('carries the level and source through unchanged', () => {
    const seen: unknown[] = []
    const off = onActivity(e => seen.push(e))
    logActivity('editor', 'warn', 'careful')
    off()
    expect(seen).toEqual([{ level: 'warn', source: 'editor', message: 'careful' }])
  })

  it('stops delivering once unsubscribed', () => {
    const seen: string[] = []
    const off = onActivity(e => seen.push(e.message))
    logActivity('drive', 'info', 'first')
    off()
    logActivity('drive', 'info', 'second')
    expect(seen).toEqual(['first'])
  })

  // A log line must never be able to take down the action it describes.
  it('survives a subscriber that throws, and still reaches the others', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: string[] = []
    const offBad = onActivity(() => { throw new Error('boom') })
    const offGood = onActivity(e => seen.push(e.message))
    expect(() => logActivity('drive', 'info', 'still logged')).not.toThrow()
    offBad(); offGood(); spy.mockRestore()
    expect(seen).toEqual(['still logged'])
  })

  it('is unaffected by a subscriber unsubscribing mid-delivery', () => {
    const seen: string[] = []
    let offSecond = () => {}
    const offFirst = onActivity(() => { offSecond() })
    offSecond = onActivity(e => seen.push(e.message))
    expect(() => logActivity('drive', 'info', 'during')).not.toThrow()
    offFirst(); offSecond()
    expect(seen).toEqual(['during'])
  })
})

describe('naming where something is', () => {
  const TRAIL = [{ name: 'Cernix' }, { name: '2025' }, { name: 'Keepers' }]

  it('reads as a path from the trail the user walked', () => {
    expect(drivePath(TRAIL)).toBe('/Cernix/2025/Keepers')
  })

  it('names a file inside that folder', () => {
    expect(drivePath(TRAIL, 'DSC_0001.ARW')).toBe('/Cernix/2025/Keepers/DSC_0001.ARW')
  })

  it('is just the root when the trail is empty', () => {
    expect(drivePath([])).toBe('/')
    expect(drivePath([], 'DSC_0001.ARW')).toBe('/DSC_0001.ARW')
  })

  // Drive names may carry slashes, and two of them next to each other
  // would read as an empty folder that does not exist.
  it('does not double a separator or invent an empty segment', () => {
    expect(drivePath([{ name: '/2025/' }], '/DSC_0001.ARW')).toBe('/2025/DSC_0001.ARW')
    expect(drivePath(TRAIL, '', null, undefined, '  ')).toBe('/Cernix/2025/Keepers')
  })
})

describe('counting and naming', () => {
  it('agrees with itself about one', () => {
    expect(count(1, 'file')).toBe('1 file')
    expect(count(0, 'file')).toBe('0 files')
    expect(count(2, 'file')).toBe('2 files')
  })

  it('takes an irregular plural', () => {
    expect(count(2, 'entry', 'entries')).toBe('2 entries')
  })

  it('names them all when there are few', () => {
    expect(nameList(['a', 'b'])).toBe('a, b')
    expect(nameList([])).toBe('')
  })

  // The log is read at full scale, but one move must not push the rest of
  // the session out of a 500-line buffer.
  it('names the first few and counts the rest', () => {
    expect(nameList(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e and 2 more')
    expect(nameList(['a', 'b', 'c'], 2)).toBe('a, b and 1 more')
  })
})
