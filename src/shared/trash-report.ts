/**
 * What happened to each file in a Local Archive trash, in words.
 *
 * `shell.trashItem` reports a failure as a bare message ("Operation was
 * aborted") that names neither the file nor the cause, and the handler
 * returned that string. A file that had already gone was reported as a
 * failure and its tile stayed; a file in use gave "Trashed 1, failed 1."
 * with nothing to act on.
 */

export type TrashFailureReason = 'forbidden' | 'refused'

export interface TrashFailure {
  path: string
  reason: TrashFailureReason
  /** For the person: why, without the platform's wording. */
  message: string
}

/**
 * Sorts a failed `trashItem` once it is known whether the file is still
 * there. A missing file is not a failure: it is where the user wanted it,
 * and the tile for it should go. Anything else the platform refused is
 * almost always a program holding the file open, or a permission.
 */
export function classifyTrashError(
  path: string,
  stillExists: boolean,
): { missing: true } | { missing: false; failure: TrashFailure } {
  if (!stillExists) return { missing: true }
  return {
    missing: false,
    failure: {
      path,
      reason: 'refused',
      message: 'Windows would not move it. Another program may have it open, or you may not have permission.',
    },
  }
}

export function forbiddenTrash(path: string): TrashFailure {
  return { path, reason: 'forbidden', message: 'it is outside the folders you chose in this session' }
}

/** One sentence naming the files and the cause, for a toast. */
export function summariseTrash(trashed: number, missing: number, failures: TrashFailure[]): string {
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (trashed > 0) parts.push(`Moved ${files(trashed)} to Trash`)
  if (missing > 0) parts.push(`${files(missing)} ${missing === 1 ? 'was' : 'were'} already gone`)
  if (failures.length > 0) {
    const name = (p: string) => p.split(/[\\/]/).pop() ?? p
    const first = failures[0]
    parts.push(
      failures.length === 1
        ? `${name(first.path)} stayed: ${first.message}`
        : `${failures.length} files stayed (${name(first.path)} and ${failures.length - 1} more): ${first.message}`,
    )
  }
  return parts.join('. ') + '.'
}
