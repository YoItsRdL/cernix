import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A placeholder for something still arriving.
 *
 * There were three ad-hoc pulses before this file. A Drive thumbnail,
 * a preset thumb waiting on WebGL, a video stream. Each written where
 * it was needed. This is the shared one.
 *
 * The pulse is what separates "loading" from "empty". Without it, a
 * grid of grey squares is indistinguishable from a folder with nothing
 * in it, and the difference matters most at exactly the moment it is
 * hardest to tell.
 *
 * The animation is `--animate-skeleton`, not Tailwind's `animate-pulse`:
 * symmetric ease-in-out over 1.6s with a shallow trough, so it reads as
 * a breath rather than a blink. Measured at 60fps the largest change
 * between frames is 0.02. Under Reduce Motion it stops, via the media
 * query in tokens.css; the shape still reads as a placeholder because
 * it has no content.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-skeleton rounded-soft bg-overlay-hover', className)}
      {...props}
    />
  )
}


export interface SkeletonCellsProps {
  count: number
  columnCount: number
  /** The grid's own columnWidth: pitch, gutter included. */
  columnWidth: number
  /** The grid's own rowHeight: equal to columnWidth in grid view. */
  rowHeight: number
  gutter: number
  /** `tile` fills the cell; `row` draws a chip and a name bar. */
  variant?: 'tile' | 'row'
  className?: string
}

/**
 * Placeholders laid out on the grid's exact geometry.
 *
 * The positioning below is the same arithmetic the real `Cell` applies
 * to react-window's rect. `+ gutter/2` on the offsets, `- gutter` on
 * the size, because anything else is a near miss. The first attempt
 * used a padded flexbox and landed eight pixels to the right of the
 * real tiles: the outer padding and the per-tile padding stacked, and
 * the difference was invisible until the two were screenshotted side by
 * side. Mirroring the formula makes them identical by construction
 * rather than by agreement.
 *
 * Grid and list are the same component with a different `rowHeight` and
 * a different thing drawn inside, because that is exactly how the real
 * viewport treats them. One Grid, `columnCount` of 1 in list view.
 */
export function SkeletonCells({
  count, columnCount, columnWidth, rowHeight, gutter, variant = 'tile', className,
}: SkeletonCellsProps) {
  const rows = Math.ceil(count / Math.max(1, columnCount))

  return (
    <div
      className={cn('relative w-full overflow-hidden', className)}
      style={{ height: rows * rowHeight }}
      role="status"
      aria-label="Loading folder"
    >
      {Array.from({ length: count }, (_, i) => {
        const col = i % columnCount
        const row = Math.floor(i / columnCount)
        // Staggered so the surface breathes across itself instead of
        // flashing as one block. Eight steps, then it repeats. Beyond
        // that the phase difference stops reading as rhythm.
        const delay = `${(i % 8) * 90}ms`

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: col * columnWidth + gutter / 2,
              top: row * rowHeight + gutter / 2,
              width: columnWidth - gutter,
              height: rowHeight - gutter,
            }}
          >
            {variant === 'tile' ? (
              <Skeleton
                className="w-full h-full border border-border-subtle"
                style={{ animationDelay: delay }}
              />
            ) : (
              <div className="w-full h-full flex items-center gap-space-3">
                <Skeleton
                  className="h-4 w-4 shrink-0 rounded-nested"
                  style={{ animationDelay: delay }}
                />
                <Skeleton
                  className="h-3 rounded-nested"
                  // Varied so it reads as a list of names rather than a
                  // bar chart. Derived from the index, not random: a
                  // width that changes every render is a flicker.
                  style={{ width: `${38 + ((i * 17) % 34)}%`, animationDelay: delay }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
