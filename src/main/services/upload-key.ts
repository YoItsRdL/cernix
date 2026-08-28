/**
 * The identity of an uploaded file, shared by the ledger and the scanner.
 *
 * It lives in its own module for two reasons. It is the contract between
 * the code that writes an upload down and the code that later asks "have
 * I seen this?", and those two had drifted apart before. The writer
 * stored an OS path, the reader looked for a POSIX one, and the mismatch
 * was invisible until a card full of already-uploaded photographs
 * reported that none of them had ever been imported. And it holds no
 * database import, so it can be tested in plain Node rather than only
 * inside Electron.
 */

/**
 * Reduce a name or path to `basename|size`.
 *
 * Separator-agnostic on purpose. A finished upload records the file's
 * path relative to its source, which on Windows is
 * `2026\August\21\P1100463.JPG`; reconciling against Drive records the
 * bare name Drive reports. Splitting on both separators means neither
 * shape has to be normalised at the point it is written.
 *
 * Size is part of the key because a name alone is not unique. Cameras
 * roll their counter over, so DSC_0001.JPG comes round again every 9999
 * frames, and treating the new one as already imported would quietly
 * deselect a photograph that had never been backed up. A false negative
 * only costs a re-upload, which staging deduplicates anyway; a false
 * positive can cost the picture.
 *
 * Case-folded because the filesystems this ships on are
 * case-insensitive: a ledger written as `.JPG` must still match a card
 * that reports `.jpg`.
 */
export function uploadKey(nameOrPath: string, sizeBytes: number): string {
  const base = nameOrPath.split(/[\\/]/).pop() || nameOrPath
  return `${base.toLowerCase()}|${sizeBytes}`
}
