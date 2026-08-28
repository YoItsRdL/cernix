import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { EditCache } from './edit-cache'

/**
 * The cache key is built from renderer-supplied values.
 *
 * `getOrDownload` is reached straight from `editor:prepare-source`, which
 * takes its three arguments from the renderer and passes them through
 * untouched. The key is interpolated into a filename and handed to
 * `path.join`, so any separator or `..` in a component escapes the cache
 * directory and the download writes wherever it lands.
 */
describe('EditCache key handling', () => {
  let dir: string
  let asked: string[]

  const client = {
    downloadFileStreaming: async (_id: string, destPath: string) => {
      asked.push(destPath)
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.writeFileSync(destPath, 'payload')
      return 7
    },
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-cache-test-'))
    asked = []
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const cache = () => new EditCache(client as never, path.join(dir, 'edit-cache'))

  it('caches a normal file inside the cache directory', async () => {
    const root = path.join(dir, 'edit-cache')
    const out = await cache().getOrDownload('1a2b3c', '2026-08-28T10:00:00Z', 'DSC_0001.ARW')
    expect(path.resolve(out).startsWith(path.resolve(root) + path.sep)).toBe(true)
    expect(path.extname(out)).toBe('.ARW')
  })

  // The one that matters. A renderer that names a traversing fileId gets
  // attacker-chosen bytes written to an attacker-chosen path.
  it('refuses to write outside the cache directory whatever the fileId says', async () => {
    const root = path.resolve(path.join(dir, 'edit-cache'))
    const escapes = [
      '../../escaped',
      '..' + path.sep + 'escaped',
      'sub/nested',
      'sub' + path.sep + 'nested',
    ]
    for (const bad of escapes) {
      asked = []
      let out: string | null = null
      try { out = await cache().getOrDownload(bad, '2026-08-28T10:00:00Z', 'x.jpg') } catch { out = null }
      for (const written of asked) {
        expect(path.resolve(written).startsWith(root + path.sep), `wrote outside for ${JSON.stringify(bad)}: ${written}`).toBe(true)
      }
      if (out) {
        expect(path.resolve(out).startsWith(root + path.sep), `returned outside for ${JSON.stringify(bad)}`).toBe(true)
      }
    }
  })

  it('keeps distinct ids in distinct cache entries', async () => {
    const a = await cache().getOrDownload('idA', '2026-08-28T10:00:00Z', 'x.jpg')
    const b = await cache().getOrDownload('idB', '2026-08-28T10:00:00Z', 'x.jpg')
    expect(a).not.toBe(b)
  })
})
