import * as React from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { IconButton } from './icon-button'
import { TOOLBAR_CONTROL } from './toolbar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu'
import {
  pageWindow,
  PAGE_SIZE_OPTIONS,
  type Pagination,
} from '@/hooks/usePagination'

/**
 * The page control that sits under a grid or list.
 *
 * It wears the same chrome as the toolbars above it. A bordered group
 * on the workspace surface, controls at 28px, children rounded to nest
 * inside the group's padding, because it is the same kind of thing and
 * a second visual language for "a row of buttons" would be one too many.
 *
 * The count on the left is not decoration. Paging replaced scrolling,
 * and a scrollbar told you two things at once: where you are and how
 * much there is. "41–60 of 5632" is the half of that a row of page
 * numbers cannot say on its own.
 */
export interface PagerProps {
  pagination: Pagination
  /** What is being counted, singular. "photo", "file", "item". */
  noun?: string
  className?: string
}

export function Pager({ pagination, noun = 'item', className }: PagerProps) {
  const {
    page, pageCount, firstItem, lastItem, total,
    pageSize, setPage, setPageSize, next, prev,
  } = pagination

  // One page of results is not a thing to navigate. Showing a lone,
  // permanently-disabled control would be furniture, not information,
  // but the count still earns its place.
  const numbers = pageCount > 1 ? pageWindow(page, pageCount) : []

  return (
    <div
      className={cn(
        'h-10 shrink-0 px-space-4 flex items-center justify-between gap-space-3',
        'border-t border-border-subtle bg-surface-panel/50',
        className
      )}
    >
      <div className="flex items-center gap-space-3 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Items per page"
              title="Items per page"
              className={cn(
                'h-7 px-2 gap-1.5 text-metadata tabular-nums',
                'text-text-muted hover:text-text-default',
                TOOLBAR_CONTROL
              )}
            >
              {pageSize} per page
              <ChevronDown size={11} />
            </Button>
          </DropdownMenuTrigger>

          {/* Upwards: the control sits on the bottom edge of the window,
              so a menu opening downwards would have nowhere to go. */}
          <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-36">
            {PAGE_SIZE_OPTIONS.map(option => (
              <DropdownMenuItem
                key={option}
                onClick={() => setPageSize(option)}
                className="justify-between gap-space-3"
              >
                <span className="tabular-nums">{option} per page</span>
                {option === pageSize && <Check size={12} className="text-accent-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-metadata text-text-muted tabular-nums truncate min-w-0">
          {total === 0
            ? `No ${noun}s`
            : `${firstItem.toLocaleString()}–${lastItem.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
      </div>

      {numbers.length > 0 && (
        <nav
          aria-label="Pagination"
          className={cn('flex items-center h-7 p-0.5 gap-0.5 shrink-0', TOOLBAR_CONTROL)}
        >
          <IconButton
            icon={<ChevronLeft size={14} />}
            aria-label="Previous page"
            onClick={prev}
            disabled={page === 0}
            className="h-6 w-6 rounded-nested"
          />

          {numbers.map((n, i) =>
            n === null ? (
              // Not a button: there is no single page it would take you
              // to, and a clickable ellipsis that guesses is worse than
              // one that waits.
              <span
                key={`gap-${i}`}
                aria-hidden
                className="h-6 w-4 flex items-center justify-center text-metadata text-text-disabled"
              >
                …
              </span>
            ) : (
              <Button
                key={n}
                variant="ghost"
                size="sm"
                onClick={() => setPage(n)}
                aria-label={`Page ${n + 1}`}
                aria-current={n === page ? 'page' : undefined}
                className={cn(
                  'h-6 min-w-6 px-1.5 rounded-nested text-metadata tabular-nums',
                  n === page
                    ? 'bg-overlay-active text-text-emphatic font-semibold'
                    : 'text-text-muted hover:text-text-default'
                )}
              >
                {n + 1}
              </Button>
            )
          )}

          <IconButton
            icon={<ChevronRight size={14} />}
            aria-label="Next page"
            onClick={next}
            disabled={page >= pageCount - 1}
            className="h-6 w-6 rounded-nested"
          />
        </nav>
      )}
    </div>
  )
}
