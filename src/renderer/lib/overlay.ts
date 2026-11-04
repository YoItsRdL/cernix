/**
 * What is layered over the page right now, if anything.
 *
 * The grid, the selection and the viewer each listen for keys on the
 * window, because their keys work without anything focused. A window
 * listener also hears keys meant for whatever is on top of it, so Esc
 * that closed Settings also cleared the selection behind it, arrows in a
 * menu moved the grid, and Space in the viewer also toggled the tile
 * behind. Each listener now asks this first and stands down unless it is
 * the thing on top.
 *
 * "On top" is the last open dialog, menu or listbox in the document:
 * portals (Settings, menus) mount after the page, so later means above.
 */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

export function topOverlay(): Element | null {
  // A Radix menu or dialog that is closing stays in the document for its
  // exit animation, marked `data-state="closed"`: it is no longer on top.
  const open = Array.from(document.querySelectorAll(OVERLAY))
    .filter(el => el.getClientRects().length > 0 && el.getAttribute('data-state') !== 'closed')
  return open.length ? open[open.length - 1] : null
}

/** True when something other than `own` (and what is inside it) is on top. */
export function coveredBy(own: Element | null): boolean {
  const top = topOverlay()
  if (!top) return false
  return !(own && (own === top || own.contains(top)))
}
