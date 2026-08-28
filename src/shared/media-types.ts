/**
 * Single source of truth for media-type classification by file extension.
 *
 * Used by both the main process (thumbnail-cache short-circuits videos
 * the OS thumbnailer can't decode) and the renderer (PhotoGrid +
 * DistillerViewport pick the right thumbnail strategy per file). Add
 * a format here once and both processes pick it up on next build.
 *
 * MIME-type classification. Used by the Drive Distiller where the
 * API hands us a `mimeType` directly. Lives in
 * `src/renderer/components/distiller/utils/distiller-utils.tsx`.
 * The two routes are kept separate because the inputs are
 * fundamentally different (extension vs server-declared MIME).
 */

export const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] as const
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'tiff', 'webp'] as const

const VIDEO_RE = new RegExp(`\\.(${VIDEO_EXTS.join('|')})$`, 'i')
const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTS.join('|')})$`, 'i')

/** True when `path` ends in a known video extension (case-insensitive). */
export function isVideoPath(path: string): boolean {
  return VIDEO_RE.test(path)
}

/** True when `path` ends in a known image extension (case-insensitive). */
export function isImagePath(path: string): boolean {
  return IMAGE_RE.test(path)
}
