/**
 * The id a photograph's rating is kept under before it has a Drive id.
 *
 * Culling in the Local Archive happens on files that are not on Drive yet,
 * so there is no file id to key by (decision 21). The key is the file's
 * name, size and modified time: stable when the same card is inserted
 * again (a different drive letter changes the path, not these), and
 * unchanged by the copy into the archive, which keeps the modified time.
 * Two cards that reuse a name and a size differ in time. If a copy had to
 * be renamed to avoid a collision, the key does not match and the rating
 * is simply not carried: a mark that fails to follow, never one that
 * lands on the wrong photograph.
 */
export function localRatingKey(file: { name: string; sizeBytes: number; mtime: Date | string | number }): string {
  const ms = new Date(file.mtime).getTime()
  return `local:${file.name.toLowerCase()}|${file.sizeBytes}|${Math.floor(ms)}`
}

/** The file name out of a path with either separator. */
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
