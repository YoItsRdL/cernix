import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * The ingest path.
 *
 * This is the code that reads a photographer's card and copies what it
 * finds. A bug here does not show a wrong colour, it loses a frame that
 * cannot be shot again, so the properties worth asserting are about
 * completeness rather than appearance: everything supported is found,
 * nothing unsupported is touched, and no file silently replaces another.
 */

let staging: string
vi.mock('electron', () => ({ app: { getPath: () => staging } }))
vi.mock('exiftool-vendored', () => ({
  exiftool: { read: async () => ({}) },   // no EXIF date; sweep falls back to mtime
}))

const { FileSweeper } = await import('./file-sweeper')

const db = { getUploadedKeys: () => new Set<string>() }

let root: string
let src_: string

function write(rel: string, bytes: number, when?: Date) {
  const p = path.join(src_, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(bytes, 1))
  if (when) fs.utimesSync(p, when, when)
  return p
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-sweep-'))
  src_ = path.join(root, 'card'); fs.mkdirSync(src_, { recursive: true })
  staging = path.join(root, 'userData')
  fs.mkdirSync(staging, { recursive: true })
  delete process.env['STAGING_DIR']
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

const sweeper = () => new FileSweeper(db as never)

describe('FileSweeper.scan', () => {
  it('finds supported media anywhere in the tree', async () => {
    write('DCIM/100MSDCF/DSC_0001.ARW', 16)
    write('DCIM/101MSDCF/DSC_0002.arw', 16)
    write('clips/a.MP4', 16)
    const found = await sweeper().scan(src_)
    expect(found.map(f => path.basename(f.absolutePath)).sort())
      .toEqual(['DSC_0001.ARW', 'DSC_0002.arw', 'a.MP4'])
  })

  it('ignores anything not a supported extension', async () => {
    write('DCIM/DSC_0001.ARW', 16)
    write('DCIM/notes.txt', 16)
    write('DCIM/secrets.kdbx', 16)
    write('DCIM/.hidden.ARW', 16)
    const found = await sweeper().scan(src_)
    const names = found.map(f => path.basename(f.absolutePath))
    expect(names).toContain('DSC_0001.ARW')
    expect(names).not.toContain('notes.txt')
    expect(names).not.toContain('secrets.kdbx')
  })

  it('does not descend into hidden or system directories', async () => {
    write('DCIM/DSC_0001.ARW', 16)
    write('.git/objects/DSC_0002.ARW', 16)
    write('System Volume Information/DSC_0003.ARW', 16)
    write('$Recycle.Bin/DSC_0004.ARW', 16)
    const names = (await sweeper().scan(src_)).map(f => path.basename(f.absolutePath))
    expect(names).toEqual(['DSC_0001.ARW'])
  })

  // MAX_SCAN_DEPTH is 32. A card cannot nest that far, but a folder the
  // user points at might, and an unbounded walk on a network path is how
  // a scan never returns.
  it('stops descending past the depth limit', async () => {
    write('a/'.repeat(40) + 'deep.ARW', 16)
    write('shallow.ARW', 16)
    const names = (await sweeper().scan(src_)).map(f => path.basename(f.absolutePath))
    expect(names).toContain('shallow.ARW')
    expect(names).not.toContain('deep.ARW')
  })

  it('reports the size the copier will rely on', async () => {
    write('DCIM/DSC_0001.ARW', 1234)
    const [f] = await sweeper().scan(src_)
    expect(f.sizeBytes).toBe(1234)
  })
})

describe('FileSweeper.sweep does not lose a photograph', () => {
  const stagedFiles = () => {
    const out: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p); else out.push(p)
      }
    }
    const stagingRoot = path.join(staging, 'staging', 'library')
    if (fs.existsSync(stagingRoot)) walk(stagingRoot)
    return out
  }

  it('copies a selected file into staging', async () => {
    write('DCIM/DSC_0001.ARW', 100, new Date('2026-05-01T10:00:00Z'))
    const s = sweeper()
    const files = await s.scan(src_)
    await s.sweep(src_, files.map(f => f.relativePath))
    expect(stagedFiles()).toHaveLength(1)
    expect(fs.statSync(stagedFiles()[0]).size).toBe(100)
  })

  /**
   * Two bodies, or one body past frame 9999, produce the same basename.
   *
   * The destination is `staging/<datePath>/<basename>`, so two different
   * photographs taken on the same day with the same name resolve to one
   * path. `isDuplicate` compares size only, so the larger one overwrites
   * the smaller and the smaller is gone.
   */
  it('keeps both files when two different photographs share a basename', async () => {
    const day = new Date('2026-05-01T10:00:00Z')
    write('CARD_A/DSC_0001.ARW', 100, day)
    write('CARD_B/DSC_0001.ARW', 250, day)
    const s = sweeper()
    const files = await s.scan(src_)
    expect(files).toHaveLength(2)
    await s.sweep(src_, files.map(f => f.relativePath))

    const sizes = stagedFiles().map(f => fs.statSync(f).size).sort((a, b) => a - b)
    expect(stagedFiles(), 'both photographs must survive staging').toHaveLength(2)
    expect(sizes).toEqual([100, 250])
  })

  /**
   * The same-size case is worse, because nothing is even attempted.
   * Two distinct frames of identical byte length collapse to one and the
   * sweep reports success.
   */
  it('keeps both when the colliding files are also the same size', async () => {
    const day = new Date('2026-05-01T10:00:00Z')
    const a = write('CARD_A/DSC_0001.ARW', 128, day)
    const b = write('CARD_B/DSC_0001.ARW', 128, day)
    fs.writeFileSync(a, Buffer.alloc(128, 0xAA))
    fs.writeFileSync(b, Buffer.alloc(128, 0xBB))
    fs.utimesSync(a, day, day); fs.utimesSync(b, day, day)

    const s = sweeper()
    const files = await s.scan(src_)
    await s.sweep(src_, files.map(f => f.relativePath))

    const contents = stagedFiles().map(f => fs.readFileSync(f)[0]).sort()
    expect(stagedFiles(), 'both frames must survive').toHaveLength(2)
    expect(contents).toEqual([0xAA, 0xBB])
  })

  /**
   * The other half of the contract, and the one the disambiguation
   * could easily break: sweeping the same card twice must not fill the
   * library with `-1`, `-2`, `-3` copies of every frame.
   */
  it('does not re-copy a file that is already staged', async () => {
    write('DCIM/DSC_0001.ARW', 100, new Date('2026-05-01T10:00:00Z'))
    const s = sweeper()
    const files = await s.scan(src_)
    await s.sweep(src_, files.map(f => f.relativePath))
    expect(stagedFiles()).toHaveLength(1)

    const again = sweeper()
    const files2 = await again.scan(src_)
    await again.sweep(src_, files2.map(f => f.relativePath))
    expect(stagedFiles(), 'a second sweep of the same card must add nothing').toHaveLength(1)
  })

  it('reports both frames as added when a name had to be disambiguated', async () => {
    const day = new Date('2026-05-01T10:00:00Z')
    write('CARD_A/DSC_0001.ARW', 100, day)
    write('CARD_B/DSC_0001.ARW', 250, day)
    const s = sweeper()
    const files = await s.scan(src_)
    const session = await s.sweep(src_, files.map(f => f.relativePath))
    expect(session.addedFiles).toHaveLength(2)
    expect(new Set(session.addedFiles).size, 'the two entries must be distinct paths').toBe(2)
  })

  /**
   * The case size alone cannot see.
   *
   * Two cards swept at different times, each holding a different frame
   * that happens to be the same length under the same name. By the
   * second sweep the first is fully written, so a size comparison says
   * "already staged" and the second frame is dropped without a word.
   * Only the bytes can tell them apart.
   */
  it('keeps a same-size frame swept after the first has fully landed', async () => {
    const day = new Date('2026-05-01T10:00:00Z')
    const a = write('CARD_A/DSC_0001.ARW', 128, day)
    fs.writeFileSync(a, Buffer.alloc(128, 0xAA)); fs.utimesSync(a, day, day)

    const first = sweeper()
    const f1 = await first.scan(src_)
    await first.sweep(src_, f1.map(f => f.relativePath))
    expect(stagedFiles()).toHaveLength(1)

    fs.rmSync(path.join(src_, 'CARD_A'), { recursive: true, force: true })
    const b2 = write('CARD_B/DSC_0001.ARW', 128, day)
    fs.writeFileSync(b2, Buffer.alloc(128, 0xBB)); fs.utimesSync(b2, day, day)

    const second = sweeper()
    const f2 = await second.scan(src_)
    await second.sweep(src_, f2.map(f => f.relativePath))

    const contents = stagedFiles().map(f => fs.readFileSync(f)[0]).sort()
    expect(stagedFiles(), 'the second frame must not be mistaken for the first').toHaveLength(2)
    expect(contents).toEqual([0xAA, 0xBB])
  })
})
