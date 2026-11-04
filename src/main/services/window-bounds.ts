/**
 * Where the window was, and whether it can go back there.
 *
 * The window always opened at 1400x900 in the default place, unmaximised,
 * whatever it had been when it closed. Now its normal bounds and its
 * maximised state are saved on close and restored at launch.
 *
 * A saved place is only used if enough of it is still on a screen: a
 * laptop that closed on an external monitor and opens without it would
 * otherwise put the window somewhere nobody can reach. The test is the
 * top strip, the part that is dragged, being at least partly on one
 * display's work area.
 *
 * Pure, and separate from the window, so it can be tested without
 * booting Electron.
 */

export interface Rect { x: number; y: number; width: number; height: number }

export interface SavedWindow extends Rect { maximized: boolean }

/** The smallest size restored; anything smaller is a broken record. */
const MIN = { width: 640, height: 400 }

/** How much of the top strip must be on a screen to count as reachable. */
const REACHABLE = { width: 120, height: 32 }

/**
 * The saved window, if it is whole and can be reached on these
 * displays; otherwise null, and the caller opens the default window.
 */
export function restorableWindow(raw: string | null | undefined, workAreas: Rect[]): SavedWindow | null {
  if (!raw) return null
  let saved: unknown
  try { saved = JSON.parse(raw) } catch { return null }
  if (!saved || typeof saved !== 'object') return null
  const { x, y, width, height, maximized } = saved as Record<string, unknown>
  if (![x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n))) return null
  const rect = { x: x as number, y: y as number, width: width as number, height: height as number }
  if (rect.width < MIN.width || rect.height < MIN.height) return null

  const strip = { x: rect.x, y: rect.y, width: rect.width, height: REACHABLE.height }
  const reachable = workAreas.some(area => {
    const w = Math.min(strip.x + strip.width, area.x + area.width) - Math.max(strip.x, area.x)
    const h = Math.min(strip.y + strip.height, area.y + area.height) - Math.max(strip.y, area.y)
    return w >= REACHABLE.width && h >= REACHABLE.height
  })
  if (!reachable) return null

  return { ...rect, maximized: maximized === true }
}

/** What is saved on close: the normal bounds, so a maximised window restores to its own size. */
export function serialiseWindow(normal: Rect, maximized: boolean): string {
  return JSON.stringify({ ...normal, maximized })
}

/**
 * How much bigger the window came out than asked, when that is only the
 * platform's rounding and frame. A larger difference is the window being
 * clamped to a smaller screen, which is not drift and is not undone.
 */
export function sizeDrift(asked: Rect, got: Rect): { width: number; height: number } {
  const small = (n: number) => (Math.abs(n) <= 16 ? n : 0)
  return { width: small(got.width - asked.width), height: small(got.height - asked.height) }
}
