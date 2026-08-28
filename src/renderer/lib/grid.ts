/**
 * How a thumbnail grid decides its column count.
 *
 * One home for this, because there were two: Workstation packed to a
 * 140px minimum with a 300px target, Local Archive packed to a 160px
 * minimum with no target at all. Same grid, same job, different answers,
 * and only one of them had been fixed when "as many as fit" turned out
 * to be the wrong default.
 *
 * Not in distiller-types.ts, where it started: nothing here is about
 * Drive, and leaving it there is what let the second copy appear.
 */

/** Gap between cells, in px. */
export const GRID_GUTTER = 16

/**
 * The narrowest a thumbnail is allowed to get.
 *
 * This is the breaking point: it decides how many columns physically fit
 * and therefore where the "more columns" control stops.
 */
export const GRID_MIN_THUMB = 140

/**
 * The size a thumbnail wants to be when nobody has asked for anything.
 *
 * The default count is derived from this rather than being a fixed
 * number, so it adapts to the panel: thumbnails stay a roughly constant,
 * judgeable size and the count is what changes. A fixed default is wrong
 * at both ends. Five columns is cramped at 600px and wastes a 2560px
 * window.
 *
 * Opening at the breaking point instead packs in as many columns as
 * technically fit and leaves them at 140px, which is too small to cull
 * from.
 */
export const GRID_TARGET_THUMB = 300

/**
 * A width worth doing arithmetic with.
 *
 * Both functions below are fed a measured rect, and a measurement can
 * arrive as 0 before layout or as NaN if whatever produced it did its
 * own arithmetic first. `maxColumnsFor` happened to survive NaN through
 * a `|| 1`; `defaultColumnsFor` returned NaN and handed it to the grid
 * as a column count. Two functions that must agree should not disagree
 * about their own inputs, so the guard is named and shared.
 */
function usableColumnWidth(width: number): number | null {
  return Number.isFinite(width) && width > 0 ? width : null
}

/** How many columns fit at the breaking point. Caps everything else. */
export function maxColumnsFor(width: number): number {
  const w = usableColumnWidth(width)
  if (w === null) return 1
  return Math.max(1, Math.floor(w / (GRID_MIN_THUMB + GRID_GUTTER)) || 1)
}

/**
 * Columns to open with at this width. The target size, clamped so it
 * never exceeds what actually fits.
 */
export function defaultColumnsFor(width: number): number {
  const w = usableColumnWidth(width)
  if (w === null) return 1
  const wanted = Math.round(w / (GRID_TARGET_THUMB + GRID_GUTTER))
  return Math.min(Math.max(1, wanted), maxColumnsFor(w))
}

/**
 * How many items belong on one page.
 *
 * A page is exactly what the viewport can hold in whole rows, so the
 * grid never asks the user to scroll *and* paginate. Two ways of
 * moving through the same list, each undoing the other's sense of
 * place. Widen the window or add a column and the pages re-flow.
 *
 * Whole rows, never a partial one: a page ending mid-row leaves a
 * ragged edge above the pager, and the eye reads that gap as "the end
 * of the photographs" rather than "the end of this page".
 *
 * At least one row, however short the viewport. Zero would divide the
 * page count by zero and leave the user on a page that cannot exist.
 */
export function pageSizeFor(viewportHeight: number, rowHeight: number, columns: number): number {
  if (rowHeight <= 0 || columns <= 0) return columns || 1
  const rows = Math.max(1, Math.floor(viewportHeight / rowHeight))
  return rows * columns
}

/**
 * How wide the vertical scrollbar is, measured once.
 *
 * A grid sized to its container's full width overflows the moment a
 * vertical scrollbar appears: the scrollbar takes its width from the
 * inside, so the columns that fitted a second ago no longer do, and the
 * grid grows a horizontal scrollbar it never wanted. Workstation
 * reserved nothing and did exactly this; Local Archive reserved a
 * hardcoded 16, which is a guess that is wrong on most platforms.
 *
 * Measured rather than assumed because the answer is not a constant:
 * ~15-17px on Windows, and 0 wherever scrollbars are overlays, where
 * reserving anything would waste a strip of every grid forever.
 *
 * Reserved whether or not a scrollbar is currently showing. See
 * SCROLL_GUTTER. Reserving it only when needed is circular: the
 * scrollbar depends on the content height, which depends on the row
 * height, which depends on the column width, which depends on the
 * scrollbar.
 */
let measured: number | null = null

export function scrollbarWidth(): number {
  if (measured !== null) return measured
  if (typeof document === 'undefined') return 0

  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(probe)
  measured = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return measured
}

/**
 * Keeps the scrollbar's space reserved even when nothing overflows, so
 * a short page and a long one lay their columns out identically. Pair
 * it with scrollbarWidth() on the same element.
 */
export const SCROLL_GUTTER = '[scrollbar-gutter:stable]'

/** The width a grid may actually use, once the scrollbar has its share. */
export function usableWidth(width: number): number {
  return Math.max(0, width - scrollbarWidth())
}

/**
 * The thumbnail edge to ask the OS thumbnailer for, at this cell width.
 *
 * Coarse-stepped to 128px so adjacent column widths share cache
 * entries, and floored at 128 so a very narrow tile still gets
 * something worth looking at.
 *
 * Exported because the viewer wants the SAME number the grid used. A
 * photograph opened from the grid can then show the thumbnail already
 * decoded while the full-size frame arrives, and a value computed twice
 * with two roundings would miss the cache every time.
 */
export function thumbEdgeFor(cellWidth: number, dpr = 1): number {
  return Math.max(128, Math.ceil((cellWidth * dpr) / 128) * 128)
}
