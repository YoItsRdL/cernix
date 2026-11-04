import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { moveArchive, listArchive, ArchiveMoveError } from './archive-mover'

/**
 * The archive may hold the only copy of a shoot. These run against real
 * folders in the temp directory and check what is left on disk, not what
 * the function says it did.
 */
let base: string
let from: string
let to: string

function seed() {
  const files: Record<string, string> = {
    '2026/October/24/a.jpg': 'aaaa',
    '2026/October/24/b.arw': 'bbbbbbbb',
    '2026/November/01/c.jpg': 'c',
  }
  let t = 1_700_000_000
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(from, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
    fs.utimesSync(full, t, t)
    t += 1000
  }
  return files
}
const tree = (root: string): Record<string, { size: number; mtime: number }> => {
  const out: Record<string, { size: number; mtime: number }> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else { const s = fs.statSync(f); out[path.relative(root, f).split(path.sep).join('/')] = { size: s.size, mtime: Math.floor(s.mtimeMs) } }
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-move-'))
  from = path.join(base, 'old', 'library')
  to = path.join(base, 'new', 'Cernix Archive')
  fs.mkdirSync(from, { recursive: true })
})
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

describe('moveArchive', () => {
  it('copies every file with its size and time, switches over, then removes the old ones', async () => {
    const files = seed()
    const before = tree(from)
    let committed = false
    const result = await moveArchive({ from, to, commit: () => { committed = true; expect(Object.keys(tree(from))).toHaveLength(3) } })
    expect(committed).toBe(true)
    expect(result).toMatchObject({ files: 3, bytes: Object.values(files).join('').length, leftovers: [] })
    expect(tree(to)).toEqual(before)
    expect(tree(from)).toEqual({})
    // the old root stays, with its empty year folders gone
    expect(fs.existsSync(from)).toBe(true)
    expect(fs.readdirSync(from)).toEqual([])
  })

  it('removes nothing until the switch-over has been recorded', async () => {
    seed()
    const seen: number[] = []
    await moveArchive({ from, to, commit: () => { seen.push(Object.keys(tree(from)).length) } })
    expect(seen).toEqual([3])
  })

  it('refuses a folder that already holds something, and touches nothing', async () => {
    seed()
    fs.mkdirSync(to, { recursive: true })
    fs.writeFileSync(path.join(to, 'mine.txt'), 'keep')
    await expect(moveArchive({ from, to, commit: () => {} })).rejects.toThrow('not empty')
    expect(Object.keys(tree(from))).toHaveLength(3)
    expect(fs.readFileSync(path.join(to, 'mine.txt'), 'utf8')).toBe('keep')
  })

  it('refuses a destination inside the archive, one that contains it, and the same folder', async () => {
    seed()
    await expect(moveArchive({ from, to: path.join(from, 'inner'), commit: () => {} })).rejects.toThrow('inside the archive')
    await expect(moveArchive({ from, to: path.dirname(from), commit: () => {} })).rejects.toThrow(/contains|not empty/)
    await expect(moveArchive({ from, to: from, commit: () => {} })).rejects.toThrow('already is')
    expect(Object.keys(tree(from))).toHaveLength(3)
  })

  it('stops on request, takes away only its own copies and leaves the old archive whole', async () => {
    seed()
    let n = 0
    await expect(moveArchive({ from, to, commit: () => {}, shouldCancel: () => ++n > 2 })).rejects.toBeInstanceOf(ArchiveMoveError)
    expect(Object.keys(tree(from))).toHaveLength(3)
    expect(fs.existsSync(to)).toBe(false)
  })

  it('leaves an empty destination folder the person made themselves', async () => {
    seed()
    fs.mkdirSync(to, { recursive: true })
    let n = 0
    await expect(moveArchive({ from, to, commit: () => {}, shouldCancel: () => ++n > 1 })).rejects.toThrow()
    expect(fs.existsSync(to)).toBe(true)
    expect(fs.readdirSync(to)).toEqual([])
  })

  it('undoes the copies when the switch-over cannot be recorded, and keeps the old archive', async () => {
    seed()
    await expect(moveArchive({ from, to, commit: () => { throw new Error('disk error') } })).rejects.toBeInstanceOf(ArchiveMoveError)
    expect(Object.keys(tree(from))).toHaveLength(3)
    expect(fs.existsSync(to)).toBe(false)
  })

  it('reports progress through every phase', async () => {
    seed()
    const phases = new Set<string>()
    await moveArchive({ from, to, commit: () => {}, onProgress: p => phases.add(p.phase) })
    expect([...phases]).toEqual(['counting', 'copying', 'checking', 'removing'])
  })

  it('does not call a good copy bad because the source time has a fraction of a millisecond', async () => {
    seed()
    // .9 of a millisecond: a Date rounds it up, and the raw value floors down.
    const file = path.join(from, '2026', 'October', '24', 'a.jpg')
    fs.utimesSync(file, 1_700_000_000.1239, 1_700_000_000.1239)
    const r = await moveArchive({ from, to, commit: () => {} })
    expect(r.files).toBe(3)
  })

  it('moves an empty archive without complaint', async () => {
    const r = await moveArchive({ from, to, commit: () => {} })
    expect(r.files).toBe(0)
    expect(fs.existsSync(to)).toBe(true)
  })
})

describe('listArchive', () => {
  it('refuses a link, which would not survive the copy as a file', async () => {
    seed()
    const target = path.join(base, 'elsewhere')
    fs.mkdirSync(target)
    fs.symlinkSync(target, path.join(from, 'link'), 'junction')
    await expect(listArchive(from)).rejects.toThrow()
  })
})
