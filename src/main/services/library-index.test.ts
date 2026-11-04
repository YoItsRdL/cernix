import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { indexLibrary, isInLibrary } from './library-index'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-lib-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('library index', () => {
  it('finds a file anywhere in the archive by name and size', async () => {
    fs.mkdirSync(path.join(root, '2026', '10-27'), { recursive: true })
    fs.writeFileSync(path.join(root, '2026', '10-27', 'IMG_0001.JPG'), 'twelve bytes')
    const index = await indexLibrary(root)
    expect(isInLibrary(index, 'E:/DCIM/100/IMG_0001.JPG', 12)).toBe(true)
  })

  it('does not match the same name at another size', async () => {
    fs.writeFileSync(path.join(root, 'IMG_0001.JPG'), 'twelve bytes')
    const index = await indexLibrary(root)
    expect(isInLibrary(index, 'E:/DCIM/IMG_0001.JPG', 99)).toBe(false)
  })

  it('ignores case in the name', async () => {
    fs.writeFileSync(path.join(root, 'img_0001.jpg'), 'abc')
    expect(isInLibrary(await indexLibrary(root), 'E:/IMG_0001.JPG', 3)).toBe(true)
  })

  it('is empty when there is no archive yet', async () => {
    const index = await indexLibrary(path.join(root, 'nope'))
    expect(isInLibrary(index, 'E:/IMG_0001.JPG', 3)).toBe(false)
  })
})
