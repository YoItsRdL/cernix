import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { startPath, rememberPick, forgetPicks, attachPickStore } from './dialog-folders'

describe('dialog folders', () => {
  beforeEach(forgetPicks)

  it('leaves the first dialog to Electron', () => {
    expect(startPath('import-folder')).toBeUndefined()
    expect(startPath('export', 'frame.jpg')).toBe('frame.jpg')
  })

  it('reopens beside what was picked last', () => {
    const card = path.join('E:', 'DCIM', '100MSDCF')
    rememberPick('import-folder', card)
    expect(startPath('import-folder')).toBe(path.dirname(card))
  })

  it('puts a save dialog in the last folder, under the new name', () => {
    rememberPick('export', path.join('D:', 'Delivery', 'first.jpg'))
    expect(startPath('export', 'second.jpg')).toBe(path.join('D:', 'Delivery', 'second.jpg'))
  })

  it('keeps each kind of dialog to itself', () => {
    rememberPick('import-folder', path.join('E:', 'DCIM', '100MSDCF'))
    expect(startPath('export', 'frame.jpg')).toBe('frame.jpg')
    expect(startPath('download')).toBeUndefined()
  })

  it('reopens a download or staging folder inside what was picked', () => {
    const dir = path.join('D:', 'Delivery', 'Smith')
    rememberPick('download', dir)
    rememberPick('stage', dir)
    expect(startPath('download')).toBe(dir)
    expect(startPath('stage')).toBe(dir)
  })

  it('remembers across launches: what was picked is stored, and loaded by the next run', () => {
    const rows = new Map<string, string>()
    const store = { getMeta: (k: string) => rows.get(k) ?? null, setMeta: (k: string, v: string) => { rows.set(k, v) } }
    attachPickStore(store)
    rememberPick('import-folder', path.join('E:', 'DCIM', '100MSDCF'))
    rememberPick('download', path.join('D:', 'Delivery'))

    forgetPicks()                        // a new launch: nothing in memory
    expect(startPath('import-folder')).toBeUndefined()
    attachPickStore(store)
    expect(startPath('import-folder')).toBe(path.join('E:', 'DCIM'))
    expect(startPath('download')).toBe(path.join('D:', 'Delivery'))
  })

  it('starts from nothing when the stored record is damaged', () => {
    attachPickStore({ getMeta: () => '{not json', setMeta: () => {} })
    expect(startPath('import-folder')).toBeUndefined()
  })
})
