/**
 * Interface zoom: the ladder, and where a keypress lands on it.
 *
 * The app draws in CSS pixels, and how many of those a screen offers is
 * decided by the desktop's scale setting, not by the app. A 2160x1440
 * panel at 150% reports 1440x960, so a third of the room is gone before
 * the first component renders and the interface reads as zoomed in.
 * Nothing in the app was wrong; there was simply no way to ask for more
 * room, because `Menu.setApplicationMenu(null)` removes Chromium's own
 * zoom accelerators along with the menu bar nobody wanted.
 *
 * `--force-device-scale-factor=1` is the flag people reach for and it
 * does not help: measured under Wayland it leaves the reported screen at
 * 1440x960 and only drops the rendering to 1x. Zoom is what buys room.
 * At 0.8 the same window measured 1750x1089 CSS pixels instead of
 * 1400x871.
 *
 * Pure, and separate from the window, so the ladder can be tested
 * without booting Electron.
 */

/**
 * Chromium's own zoom ladder, trimmed to the useful range.
 *
 * Discrete steps rather than multiplying by a factor: repeated
 * multiplication drifts, so "reset" and "nine steps down then nine up"
 * stop agreeing, and 1 has to be exactly 1 for the unzoomed case to be
 * reachable at all.
 */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

export const DEFAULT_ZOOM = 1

/** The step closest to an arbitrary value, by index. */
function nearestIndex(value: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < ZOOM_STEPS.length; i++) {
    const distance = Math.abs(ZOOM_STEPS[i] - value)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/**
 * One step up (`1`) or down (`-1`), stopping at the ends of the ladder.
 *
 * A value that is not itself a step: anything stored by an older build,
 * or set by a pinch: snaps to the nearest one first, so the ladder
 * cannot be wandered off.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const index = nearestIndex(current)
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))
  return ZOOM_STEPS[next]
}

/**
 * What came out of the meta store, made safe.
 *
 * The store holds text and has held it across versions, so this has to
 * survive absent, empty, `NaN`, negative and off-ladder without ever
 * handing Chromium a zoom factor of 0, which blanks the window.
 */
export function parseZoom(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_ZOOM
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ZOOM
  return ZOOM_STEPS[nearestIndex(value)]
}

/**
 * Does the app bind its own zoom shortcuts on this platform?
 *
 * Only where the default menu has been removed. `Menu.setApplicationMenu(null)`
 * runs everywhere except macOS, and the menu it removes carries the
 * `zoomin`, `zoomout` and `resetzoom` roles — verified by reading the
 * default menu back: "View: Actual Size [role=resetzoom] | Zoom In
 * [role=zoomin] | Zoom Out [role=zoomout]".
 *
 * So macOS never had the gap this fixes: it keeps its menu and with it
 * ⌘+, ⌘- and ⌘0. Binding them again there would put two mechanisms on
 * one keystroke, disagreeing about both the ladder and whether the
 * result is written down. Same shape, and the same reason, as
 * `drawsOwnCaptionButtons` in the renderer: macOS keeps its own and the
 * app must not draw a second.
 *
 * The cost is that zoom is not remembered across launches on macOS,
 * because the menu roles do not report through here. That is exactly
 * what macOS did before any of this, so it is a gap rather than a
 * regression, and closing it means rebuilding that menu with the app's
 * own handlers — which cannot be tested from a machine that is not a
 * Mac.
 */
export function bindsOwnZoomShortcuts(platform: string): boolean {
  return platform !== 'darwin'
}

/**
 * Which key, if any, this is. Null when the combination is not ours.
 *
 * Ctrl and not ⌘, because this is only ever consulted where
 * `bindsOwnZoomShortcuts` is true, and that is every platform except the
 * one whose modifier is ⌘. A Mac branch here would be a branch that
 * cannot run.
 *
 * Alt is excluded so this cannot swallow a binding that shares the key.
 */
export function zoomIntent(
  key: string,
  { control, alt }: { control: boolean; alt: boolean },
): 'in' | 'out' | 'reset' | null {
  if (alt || !control) return null

  // `=` and `+` are the same physical key; which one arrives depends on
  // Shift and on the layout, and a numeric keypad sends the glyph
  // directly. Accepting both halves is why this is a list rather than a
  // comparison.
  if (key === '-' || key === '_') return 'out'
  if (key === '=' || key === '+') return 'in'
  if (key === '0') return 'reset'
  return null
}
