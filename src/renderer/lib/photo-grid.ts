import { GRID_GUTTER, maxColumnsFor, defaultColumnsFor, pageSizeFor, usableWidth } from './grid'

const Gutter = GRID_GUTTER

/** How many columns fit at the breaking point, minus the scrollbar. */
export function autoColumnCount(width: number): number {
  return maxColumnsFor(usableWidth(width))
}

/** What the grid opens with at this width, before any user override. */
export function defaultColumnCount(width: number): number {
  return defaultColumnsFor(usableWidth(width))
}

/** The vertical pitch of one row: the tile and the gutter. Tiles are square;
 *  they used to reserve 34 px for a caption nothing drew. */
function rowPitch(width: number, columnCount: number): number {
  const columnWidth = (usableWidth(width) / Math.max(1, columnCount)) - Gutter
  return columnWidth + Gutter
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
