/**
 * Moving a mark from where it was made to where the file now lives.
 *
 * A photograph is rated in the Local Archive under a key made of its name,
 * size and time (shared/local-rating-key.ts); once it is on Drive the
 * Workstation knows it by its Drive id. When the upload finishes the mark
 * is copied across, so what you decided on the card is there in the
 * library. The local row is left where it is: inserting the same card
 * again shows the same marks.
 *
 * Nothing is overwritten. A Drive file that already carries a rating keeps
 * it, so a re-upload cannot undo a decision made later in the Workstation.
 */
import type { RatingRecord } from '../../shared/ipc-types'
import { localRatingKey, baseName } from '../../shared/local-rating-key'

interface RatingsLike {
  getRating(fileId: string): RatingRecord | null
  setUserStars(fileId: string, stars: RatingRecord['userStars']): void
  setFlag(fileId: string, flag: RatingRecord['flag']): void
}

/**
 * The upload of one file has finished: carry the mark made on the card.
 *
 * The upload's `fileName` is the file's path inside the archive
 * (`2017/September/02/IMG_0001.NEF`), not the bare name the mark was keyed
 * by, so the two never met and no rating ever reached Drive. The key is
 * built from the bare name, the size, and the file's modified time, which
 * the copy into the archive kept.
 */
export function carryUploadedRating(
  store: RatingsLike,
  job: { fileName: string; sizeBytes: number; driveFileId?: string | null },
  mtime: Date,
): boolean {
  return carryRating(
    store,
    localRatingKey({ name: baseName(job.fileName), sizeBytes: job.sizeBytes, mtime }),
    job.driveFileId ?? null,
  )
}

/** Returns whether anything was carried. */
export function carryRating(store: RatingsLike, localKey: string, driveFileId: string | null): boolean {
  if (!driveFileId) return false
  const mark = store.getRating(localKey)
  if (!mark || (mark.userStars === null && mark.flag === null)) return false
  const there = store.getRating(driveFileId)
  if (there && (there.userStars !== null || there.flag !== null)) return false
  if (mark.userStars !== null) store.setUserStars(driveFileId, mark.userStars)
  if (mark.flag !== null) store.setFlag(driveFileId, mark.flag)
  return true
}
