import * as React from 'react'
import { ChevronDown, Check, Star, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { TOOLBAR_CONTROL } from './toolbar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu'
import {
  RATING_FILTERS,
  ratingFilterLabel,
  ratingFilterDescription,
  isFiltering,
  type RatingFilter,
} from '@/lib/rating-filter'

/**
 * The rating filter, shared by both libraries.
 *
 * One component rather than one per surface, because Local Archive and
 * Workstation are the same idea over different storage, and every defect
 * of consequence in this codebase has been one of them drifting from the
 * other. The Workstation's previous five-star strip was the widest
 * control in its header and the first thing to be hidden as the panel
 * narrowed, which put a filter behind a window-resize; a trigger and a
 * menu costs one button of width on both.
 *
 * A menu, not a segmented group: seven options laid out flat is wider
 * than either header can hold, and both already drop controls at their
 * container breakpoints. The trigger carries the active filter as its
 * own label so the grid never looks unfiltered when it is not — which is
 * the failure this control exists to avoid, not a nicety.
 */
export function RatingFilterControl({
  value,
  onChange,
  className,
}: {
  value: RatingFilter
  onChange: (next: RatingFilter) => void
  className?: string
}) {
  const active = isFiltering(value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // The accessible name says what it does and what it is set to.
          // "≥ 3" alone is legible beside the other options and means
          // nothing read aloud on its own.
          aria-label={`Filter by rating: ${ratingFilterDescription(value)}`}
          title={ratingFilterDescription(value)}
          className={cn(
            'h-7 px-space-2 gap-space-1.5 text-metadata shrink-0',
            TOOLBAR_CONTROL,
            // Filtered is a state the header has to carry, not something
            // the user has to open the menu to discover.
            active
              ? 'text-text-emphatic bg-overlay-active hover:bg-overlay-active'
              : 'text-text-muted hover:text-text-default',
            className,
          )}
        >
          {value === 'picks'
            ? <Flag size={11} className="fill-accent-primary text-accent-primary" />
            : <Star size={11} className={cn(active && 'fill-status-warn text-status-warn')} />}
          <span className="tabular-nums">{ratingFilterLabel(value)}</span>
          <ChevronDown size={11} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={4} className="w-44">
        {RATING_FILTERS.map(option => (
          <DropdownMenuItem
            key={String(option)}
            onClick={() => onChange(option)}
            className="justify-between gap-space-3"
          >
            <span className="flex items-center gap-space-2">
              {option === 'picks' && <Flag size={11} className="text-accent-primary" />}
              {typeof option === 'number' && <Star size={11} className="text-status-warn" />}
              <span className="tabular-nums">{ratingFilterLabel(option)}</span>
            </span>
            {option === value && <Check size={12} className="text-accent-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
