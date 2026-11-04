/**
 * The order a card is reviewed in: oldest first, the way the shoot
 * happened (decision 41), matching the Workstation.
 *
 * By capture date where the scan found one, else by the file's own time.
 * It was documented as newest first by capture date, but the scan
 * returned no capture date, so it was file time, and a photograph dated
 * 2031 or 1970 sat among the rest. Equal times fall back to the name, so
 * a burst keeps its numbering.
 */
interface Orderable {
  relativePath: string
  mtime: Date | string
  captureDate?: Date | string
}

function timeOf(f: Orderable): number {
  const captured = f.captureDate ? new Date(f.captureDate).getTime() : 0
  return captured || new Date(f.mtime).getTime()
}

export function sortOldestFirst<T extends Orderable>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    const d = timeOf(a) - timeOf(b)
    return d !== 0 ? d : a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true })
  })
}
