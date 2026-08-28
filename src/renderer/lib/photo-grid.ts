import { GRID_GUTTER, maxColumnsFor, defaultColumnsFor, pageSizeFor, usableWidth } from './grid'

const Gutter = GRID_GUTTER

/** Height of the filename + size caption beneath each thumbnail. Named
 *  because the page-size arithmetic needs it too, and an unexplained
 *  34 in two places is a number waiting to drift. */
export const CaptionHeight = 34

/** How many columns fit at the breaking point, minus the scrollbar. */
export function autoColumnCount(width: number): number {
  return maxColumnsFor(usableWidth(width))
}

/** What the grid opens with at this width, before any user override. */
export function defaultColumnCount(width: number): number {
  return defaultColumnsFor(usableWidth(width))
}

/** The vertical pitch of one row: the tile, its caption, and the gutter. */
function rowPitch(width: number, columnCount: number): number {
  const columnWidth = (usableWidth(width) / Math.max(1, columnCount)) - Gutter
  return columnWidth + CaptionHeight + Gutter
}

/**
 * How many tiles fill this viewport in whole rows.
 *
 * Exported so the surfaces that page the grid do not have to
 * reconstruct its geometry. The caption height and the scrollbar
 * reserve are this file's business, and a second copy of them
 * elsewhere is how the two grids disagreed about columns before.
 */
export function photoGridPageSize(width: number, height: number, columnCount: number): number {
  return pageSizeFor(height, rowPitch(width, columnCount), Math.max(1, columnCount))
}
