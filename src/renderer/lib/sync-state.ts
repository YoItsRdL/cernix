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
export type SyncState = 'new' | 'copied' | 'synced' | 'damaged'

/**
 * `copied` is the state the note above said nothing could be in, and
 * now something can: the scan checks the local archive as well as the
 * ledger, so a card copied with Drive off is not offered again as new
 * (decision 18). It is not on Drive, so it sits on the "not synced" side
 * of every count; it is only left unselected.
 */
export function syncStateFor(file: { isUploaded: boolean; isCopied?: boolean; damage?: string }): SyncState {
  // A broken file is not a sync state, but it is the one thing about it
  // the person needs before importing, so it takes the badge's place.
  if (file.damage) return 'damaged'
  if (file.isUploaded) return 'synced'
  return file.isCopied ? 'copied' : 'new'
}
