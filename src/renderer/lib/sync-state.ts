/**
 * Where a file stands against the Drive ledger. One vocabulary, so the
 * grid and the list cannot drift apart again: the grid used to print
 * "Imported" in accent orange for a file the list called "SYNCED" in
 * green, off the same boolean.
 *
 * There is one axis, and it is whether the frame has reached Drive.
 * The same axis the tabs and the summary report. An IMPORTED state sat
 * between these two for a while, meaning "on this machine but not yet
 * uploaded", and the scan never produced it: the sweeper answers both
 * questions from one ledger lookup, so a file was imported exactly when
 * it was uploaded. A third word for a state nothing can be in.
 */
export type SyncState = 'new' | 'synced'

export function syncStateFor(file: { isUploaded: boolean }): SyncState {
  return file.isUploaded ? 'synced' : 'new'
}
