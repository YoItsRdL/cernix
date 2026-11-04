/**
 * Moving the Local Archive to another folder (decision 20).
 *
 * These are the photographs, possibly the only copies once a card has been
 * formatted, so the rule is that nothing is removed until everything is
 * somewhere else and checked:
 *
 *   1. copy every file to the new folder, never over anything,
 *   2. check each copy (size and modified time, which the archive keeps),
 *   3. only then switch over (`commit`), and
 *   4. remove the old copies.
 *
 * A failure before step 3 leaves the old archive exactly as it was and takes
 * away only the copies this run made. A failure in step 4 leaves the new
 * archive complete and the old files in place, and says which.
 */
import fsp from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'

/** What went wrong, in words for the person; nothing was lost in any of them. */
export class ArchiveMoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveMoveError'
  }
}

export interface ArchiveFile {
  /** Relative to the archive root. */
  rel: string
  size: number
}

export interface MoveProgress {
  phase: 'counting' | 'copying' | 'checking' | 'removing'
  done: number
  total: number
}

export interface MoveOptions {
  from: string
  to: string
  onProgress?: (p: MoveProgress) => void
  /** Checked between files; true stops the move before the switch-over. */
  shouldCancel?: () => boolean
  /** Called once every copy is checked, before anything is removed. Persist the new location here. */
  commit: () => void | Promise<void>
}

export interface MoveResult {
  files: number
  bytes: number
  /** Old files that could not be removed. They are still there, and the new archive is complete. */
  leftovers: string[]
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Every regular file under `root`. Anything else (a link, a device) stops the move: it would not survive a copy intact. */
export async function listArchive(root: string): Promise<ArchiveFile[]> {
  // No archive yet is an empty one, not an error.
  if (!(await fsp.stat(root).then(() => true, () => false))) return []
  const out: ArchiveFile[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push({ rel: path.relative(root, full), size: (await fsp.stat(full)).size })
      else throw new ArchiveMoveError(`${full} is not an ordinary file, so the archive cannot be moved safely. Nothing was changed.`)
    }
  }
  await walk(root)
  return out
}

async function freeBytes(somewhere: string): Promise<number | null> {
  let dir = path.resolve(somewhere)
  for (;;) {
    try {
      const s = await fsp.statfs(dir)
      return Number(s.bavail) * Number(s.bsize)
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
}

/** Refuses a destination that cannot work, before a byte is copied. */
export async function checkDestination(from: string, to: string, bytes: number): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) throw new ArchiveMoveError('That is where the archive already is.')
  if (inside(to, from)) throw new ArchiveMoveError('The new folder cannot be inside the archive itself.')
  if (inside(from, to)) throw new ArchiveMoveError('The archive cannot move into a folder that contains it.')
  const existing = await fsp.readdir(to).catch(() => null)
  if (existing && existing.length > 0) throw new ArchiveMoveError('That folder is not empty. Choose a new or empty folder, so nothing is mixed in or overwritten.')
  const free = await freeBytes(to)
  // A margin, so a disk that fits the archive to the byte is not called enough.
  if (free !== null && free < bytes + 64 * 1024 * 1024) {
    throw new ArchiveMoveError('There is not enough free space there for the archive. Choose a disk with more room.')
  }
}

export async function moveArchive(opts: MoveOptions): Promise<MoveResult> {
  const { from, to, onProgress, shouldCancel, commit } = opts

  onProgress?.({ phase: 'counting', done: 0, total: 0 })
  const files = await listArchive(from)
  const bytes = files.reduce((n, f) => n + f.size, 0)
  await checkDestination(from, to, bytes)

  // Only what this run creates is ever removed again: the files it copied,
  // and the folders that are then empty. The destination was empty when the
  // run began, so any folder beneath it is the run's own.
  const created: string[] = []
  let createdRoot = false
  const pruneEmpty = async (dir: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await pruneEmpty(path.join(dir, e.name))
    }
    if (dir !== path.resolve(to) || createdRoot) await fsp.rmdir(dir).catch(() => {})
  }
  const undo = async () => {
    for (const f of [...created].reverse()) await fsp.rm(f, { force: true }).catch(() => {})
    await pruneEmpty(path.resolve(to))
  }

  try {
    const existed = await fsp.stat(to).then(() => true, () => false)
    if (!existed) {
      await fsp.mkdir(to, { recursive: true })
      createdRoot = true
    }

    for (const [i, f] of files.entries()) {
      if (shouldCancel?.()) throw new ArchiveMoveError('The move was stopped. Nothing was changed.')
      const src = path.join(from, f.rel)
      const dest = path.join(to, f.rel)
      const dir = path.dirname(dest)
      await fsp.mkdir(dir, { recursive: true })
      // COPYFILE_EXCL: never over anything, even something that appeared meanwhile.
      await fsp.copyFile(src, dest, fsConstants.COPYFILE_EXCL)
      created.push(dest)
      const stat = await fsp.stat(src)
      await fsp.utimes(dest, stat.atime, stat.mtime)
      onProgress?.({ phase: 'copying', done: i + 1, total: files.length })
    }

    for (const [i, f] of files.entries()) {
      const a = await fsp.stat(path.join(from, f.rel))
      const b = await fsp.stat(path.join(to, f.rel))
      // The time that was written is the source's time as a Date, in whole
      // milliseconds. Comparing the raw fractional values instead failed
      // good copies about half the time, where the disk keeps finer time.
      if (a.size !== b.size || a.mtime.getTime() !== b.mtime.getTime()) {
        throw new ArchiveMoveError(`The copy of ${f.rel} does not match the original, so the move was stopped. Nothing was changed.`)
      }
      onProgress?.({ phase: 'checking', done: i + 1, total: files.length })
    }

    if (shouldCancel?.()) throw new ArchiveMoveError('The move was stopped. Nothing was changed.')

    // Everything is in the new place and checked. From here the new archive
    // is the real one. A failure to record that undoes the copies, so the
    // old archive is still the only one.
    await commit()
  } catch (err) {
    await undo()
    if (err instanceof ArchiveMoveError) throw err
    const code = (err as NodeJS.ErrnoException).code
    const reason = code === 'ENOSPC' ? 'the disk ran out of space' : (err as Error).message
    throw new ArchiveMoveError(`The archive could not be copied (${reason}). Nothing was changed.`)
  }

  const leftovers: string[] = []
  for (const [i, f] of files.entries()) {
    const old = path.join(from, f.rel)
    await fsp.rm(old).catch(() => { leftovers.push(old) })
    onProgress?.({ phase: 'removing', done: i + 1, total: files.length })
  }
  // Empty folders, deepest first; one that still holds something stays.
  const dirs = Array.from(new Set(files.map(f => path.dirname(path.join(from, f.rel))))).sort((a, b) => b.length - a.length)
  for (const d of dirs) {
    let dir = d
    while (inside(dir, from)) {
      if (await fsp.rmdir(dir).then(() => false, () => true)) break
      dir = path.dirname(dir)
    }
  }

  return { files: files.length, bytes, leftovers }
}
