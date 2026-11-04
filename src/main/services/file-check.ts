/**
 * Whether a file on the card is whole enough to be worth importing.
 *
 * Empty and truncated files were scanned, preselected and staged like
 * the rest, and showed as a blank tile. Only the cheap checks are made:
 * size zero for everything, and the opening bytes for the formats whose
 * signature is fixed. Anything else is trusted, so an unusual but good
 * file is never marked.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FileDamage } from '../../shared/ipc-types'

const TIFF_BASED = new Set(['.tif', '.tiff', '.cr2', '.nef', '.arw', '.dng', '.pef', '.srw', '.orf', '.rw2'])
const HEAD_BYTES = 8

function startsWith(head: Buffer, sig: number[]): boolean {
  return head.length >= sig.length && sig.every((b, i) => head[i] === b)
}

/** `head` is the file's first bytes; only the signature checks read it. */
export function damageOf(name: string, sizeBytes: number, head: Buffer): FileDamage | undefined {
  if (sizeBytes === 0) return 'empty'
  const ext = path.extname(name).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') {
    return startsWith(head, [0xff, 0xd8, 0xff]) ? undefined : 'unreadable'
  }
  if (ext === '.png') {
    return startsWith(head, [0x89, 0x50, 0x4e, 0x47]) ? undefined : 'unreadable'
  }
  if (TIFF_BASED.has(ext)) {
    const le = startsWith(head, [0x49, 0x49])
    const be = startsWith(head, [0x4d, 0x4d])
    // Panasonic RW2 and Olympus ORF carry their own magic after "II".
    return le || be ? undefined : 'unreadable'
  }
  return undefined
}

export async function checkFile(absolutePath: string, sizeBytes: number): Promise<FileDamage | undefined> {
  if (sizeBytes === 0) return 'empty'
  let head = Buffer.alloc(0)
  try {
    const fh = await fsp.open(absolutePath, 'r')
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
      head = buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  } catch {
    return 'unreadable'
  }
  return damageOf(absolutePath, sizeBytes, head)
}
