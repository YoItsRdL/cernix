/**
 * What is already in the local archive, by name and size.
 *
 * A card whose files were copied but not uploaded (Drive off, or an
 * interrupted import) was offered again as all new, preselected, and
 * the sweep then deduped them one by one. The scan now says which are
 * already in the archive so the review can mark them and leave them
 * unselected. Decision 18: basename and size against the library, not a
 * byte comparison; the sweep still compares bytes before it reuses a
 * name, so a false match here costs a mark, never a lost photograph.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'

export type LibraryIndex = Map<string, Set<number>>

/** Lower-cased: the card's name for a file and the archive's may differ in case on some systems. */
const keyOf = (name: string) => name.toLowerCase()

export async function indexLibrary(root: string): Promise<LibraryIndex> {
  const index: LibraryIndex = new Map()
  let entries
  try {
    entries = await fsp.readdir(root, { recursive: true, withFileTypes: true })
  } catch {
    return index // no archive yet
  }
  const files = entries.filter(e => e.isFile())
  const CHUNK = 64
  for (let i = 0; i < files.length; i += CHUNK) {
    await Promise.all(files.slice(i, i + CHUNK).map(async e => {
      try {
        const { size } = await fsp.stat(path.join(e.parentPath, e.name))
        const k = keyOf(e.name)
        const sizes = index.get(k) ?? new Set<number>()
        sizes.add(size)
        index.set(k, sizes)
      } catch { /* gone since the listing: not in the archive */ }
    }))
  }
  return index
}

export function isInLibrary(index: LibraryIndex, absolutePath: string, sizeBytes: number): boolean {
  return index.get(keyOf(path.basename(absolutePath)))?.has(sizeBytes) ?? false
}
