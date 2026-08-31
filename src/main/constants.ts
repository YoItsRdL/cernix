// ── Cernix Application Constants ──

/**
 * Voluntary support link. Cernix is free and MIT licensed; this buys
 * nothing and gates nothing. Opened in the system browser via
 * `shell.openExternal`. The app never contacts buymeacoffee.com itself,
 * which would contradict the zero-telemetry commitment in the privacy
 * policy.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/ibonescalap'

/** Interface theme. Light is the default. */
export type ThemeName = 'light' | 'dark'

/** Key in the app_meta store. Local to the machine, never synced. */
export const THEME_META_KEY = 'ui_theme'

/**
 * Window chrome colour per theme.
 *
 * BrowserWindow needs a literal at construction, so these cannot read
 * the CSS token. They are the resolved value of `--background` in each
 * mode and must move with it. `npm run check:contrast` fails if they
 * drift, so this is checked rather than trusted.
 *
 * This is what stops the launch flash: the window paints the theme's
 * own background before the renderer has drawn anything.
 */
export const WINDOW_BACKGROUND: Record<ThemeName, string> = {
  light: '#f3e5d6',
  dark: '#120f0c',
}

/**
 * Where macOS puts its three traffic lights, and how much room the app
 * reserves above its own rows so they are not sitting on the workbench
 * header.
 *
 * Positioned by us rather than left to `hiddenInset`'s default, because
 * the band has to match: the lights are placed `y` from the top, so a
 * band of `y + height + y` leaves exactly as much air below them as
 * above. Eyeballing the band against a default position is how it ended
 * up flush against the content underneath.
 *
 * `height` is Apple's, not ours: the buttons are 12px and the app does
 * not get a say. `x` is horizontal only and does not enter the band.
 *
 * The renderer is told the result rather than repeating the arithmetic:
 * see `MAC_TITLEBAR_BAND` and the preload. Two copies of a number that
 * must agree is the drift this codebase keeps paying for.
 */
export const MAC_TRAFFIC_LIGHTS = { x: 20, y: 14, height: 12 } as const

/**
 * The reserved band, in px. Equal air above and below the lights.
 * Read by the renderer as `--titlebar-inset`.
 */
export const MAC_TITLEBAR_BAND =
  MAC_TRAFFIC_LIGHTS.y * 2 + MAC_TRAFFIC_LIGHTS.height

/** Google Drive root folder name */
export const CERNIX_ROOT_FOLDER = 'Cernix'

/**
 * Sibling root for editor exports. Lives next to CERNIX_ROOT_FOLDER in Drive.
 * Edits mirror the source's folder path here so the "public-shareable" surface
 * is cleanly separable from the raw library. The root is made link-shareable
 * on first creation so every export inside it is automatically reachable.
 */
export const CERNIX_SHARED_FOLDER = 'Cernix Shared'

/** Month names for date-based folder organization (YYYY/Month/DD) */
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** Supported media file extensions for import */
export const SUPPORTED_EXTENSIONS = new Set([
  // Image
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif',
  // RAW
  '.raw', '.rw2', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.raf', '.srw', '.pef',
  // Video
  '.mp4', '.mov', '.avi', '.mkv', '.mts',
  // Sidecar
  '.xmp', '.xml',
])

// ── Limits ──

/** Max folder recursion depth for Drive scanning */
export const MAX_FOLDER_DEPTH = 20

/** Max files per directory scan depth */
export const MAX_SCAN_DEPTH = 32

/** Scan timeout in milliseconds */
export const SCAN_TIMEOUT_MS = 120_000

/** Concurrent file copies during sweep */
export const SWEEP_CONCURRENCY = 4

/** EXIF read timeout per file in milliseconds */
export const EXIF_TIMEOUT_MS = 3000

// ── Helpers ──

/** Build a date path from a Date object: "2017/May/08" */
export function datePath(d: Date): string {
  return `${d.getFullYear()}/${MONTHS[d.getMonth()]}/${String(d.getDate()).padStart(2, '0')}`
}

/** Normalize EXIF date string: "2016:04:03 04:25:08" → "2016-04-03 04:25:08" */
export function normalizeExifDate(raw: string): string {
  return raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
}
