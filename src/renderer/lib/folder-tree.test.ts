import { describe, it, expect } from 'vitest'
import { folderTreeRows, MAX_INDENT_DEPTH } from './folder-tree'

const f = (id: string, name = id) => ({ id, name })

// The case from the report: three levels down, on a day folder that has
// nothing inside it. The sidebar said "No folders" and showed nothing at
// all about the two levels above.
const TRAIL = [f('root', 'Cernix'), f('y', '2026'), f('m', 'September'), f('d', '06')]

describe('the sidebar folder tree', () => {
  it('shows the whole trail even when the folder is empty', () => {
    const rows = folderTreeRows(TRAIL, [])
    expect(rows.map(r => r.name)).toEqual(['Cernix', '2026', 'September', '06'])
  })

  it('indents each level by one', () => {
    expect(folderTreeRows(TRAIL, []).map(r => r.depth)).toEqual([0, 1, 2, 3])
    expect(folderTreeRows(TRAIL, []).map(r => r.indentDepth)).toEqual([0, 1, 2, 3])
  })

  it('marks where you are, and only there', () => {
    const rows = folderTreeRows(TRAIL, [])
    expect(rows.filter(r => r.kind === 'current').map(r => r.name)).toEqual(['06'])
  })

  // An ancestor navigates by its position in the trail; only the trail
  // knows how far back it is.
  it('gives every ancestor its position in the trail, and the current none', () => {
    const rows = folderTreeRows(TRAIL, [])
    expect(rows.map(r => r.crumbIndex)).toEqual([0, 1, 2, undefined])
  })

  it('hangs the children one level below where the trail ended', () => {
    const rows = folderTreeRows(TRAIL, [f('c1', 'Keepers'), f('c2', 'Rejects')])
    expect(rows.filter(r => r.kind === 'child').map(r => [r.name, r.depth]))
      .toEqual([['Keepers', 4], ['Rejects', 4]])
  })

  it('keeps the trail first, so the tree reads downwards', () => {
    const rows = folderTreeRows(TRAIL, [f('c1', 'Keepers')])
    expect(rows.map(r => r.kind)).toEqual(['ancestor', 'ancestor', 'ancestor', 'current', 'child'])
  })

  // Before the root resolves there is no trail at all, and children
  // indented under nothing would sit in from the edge for no reason.
  it('puts children at the top level when there is no trail yet', () => {
    const rows = folderTreeRows([], [f('c1', 'Keepers')])
    expect(rows).toEqual([{ id: 'c1', name: 'Keepers', depth: 0, indentDepth: 0, kind: 'child' }])
  })

  it('is empty when there is nothing at all', () => {
    expect(folderTreeRows([], [])).toEqual([])
  })

  it('marks the root as current when that is where you are', () => {
    const rows = folderTreeRows([f('root', 'Cernix')], [f('y', '2026')])
    expect(rows.map(r => [r.name, r.kind, r.depth]))
      .toEqual([['Cernix', 'current', 0], ['2026', 'child', 1]])
  })

  // A listing that includes a folder already in the trail would draw it
  // twice, at two depths, and read as two different places.
  it('never lists the same folder twice', () => {
    const rows = folderTreeRows(TRAIL, [f('d', '06'), f('c1', 'Keepers')])
    expect(rows.map(r => r.id)).toEqual(['root', 'y', 'm', 'd', 'c1'])
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length)
  })

  it('keeps two folders that merely share a name', () => {
    const rows = folderTreeRows([f('a', 'September')], [f('b', 'September')])
    expect(rows.map(r => [r.id, r.kind])).toEqual([['a', 'current'], ['b', 'child']])
  })
})

/**
 * The sidebar is 208px wide and depth is the user's own Drive
 * structure, so it has no ceiling. Measured in the running panel, the
 * label loses 12px a level: 125px at the root, 65px at six, 5px at
 * eleven — an indent with nothing in it.
 */
describe('how far the indent goes', () => {
  const deep = (n: number) =>
    folderTreeRows(Array.from({ length: n }, (_, i) => f('d' + i, 'Folder ' + i)), [])

  it('stops indenting once a name would stop being readable', () => {
    const rows = deep(12)
    expect(Math.max(...rows.map(r => r.indentDepth))).toBe(MAX_INDENT_DEPTH)
  })

  // The clamp is a drawing decision. Telling a screen reader the folder
  // is six deep when it is eleven deep would lie about the tree to the
  // reader who can least afford it.
  it('still reports the true depth, which is what aria-level carries', () => {
    const rows = deep(12)
    expect(rows.map(r => r.depth)).toEqual([...Array(12).keys()])
    expect(rows[11].depth).toBe(11)
    expect(rows[11].indentDepth).toBe(MAX_INDENT_DEPTH)
  })

  it('leaves every level up to the cap alone', () => {
    const rows = deep(MAX_INDENT_DEPTH + 1)
    expect(rows.map(r => r.indentDepth)).toEqual(rows.map(r => r.depth))
  })

  it('clamps a child that falls past the cap too', () => {
    const rows = folderTreeRows(
      Array.from({ length: 9 }, (_, i) => f('d' + i)), [f('c', 'Keepers')])
    const child = rows[rows.length - 1]
    expect(child.depth).toBe(9)
    expect(child.indentDepth).toBe(MAX_INDENT_DEPTH)
  })
})
