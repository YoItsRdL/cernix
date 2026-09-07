/**
 * Narrowing a library by what the user decided about it.
 *
 * Culling is the verb this product is named for, and until now the app
 * recorded a decision it then ignored: you could spend an hour rating two
 * thousand frames and the grid still showed all of them, in the same
 * order. The Workstation had a five-star control, but it matched a rating
 * *exactly* — filtering to three hid your four- and five-star frames —
 * and unrated files bypassed it entirely, so filtering to five returned
 * the five-star frames plus everything nobody had looked at yet.
 *
 * Threshold, not equality. Photographers filter by "three and up"; an
 * exact match is a different question and a rarer one.
 *
 * Pure and shared, because Local Archive and Workstation must answer this
 * identically. The two surfaces have drifted on the grid sizing, the
 * trash, the scrollbar reserve and four divider styles, every time
 * because someone reasonable solved a solved problem.
 */
import type { RatingFlag, RatingStars } from '@/types'

/**
 * `all`, a star threshold, or the picks.
 *
 * A plain value rather than a tagged union: it is compared, stored, and
 * handed to `usePagination` as the identity that restarts paging, and all
 * three are simpler when the filter is one comparable thing.
 */
export type RatingFilter = 'all' | 'picks' | 1 | 2 | 3 | 4 | 5

/** Every option, in the order the control offers them. */
export const RATING_FILTERS: readonly RatingFilter[] = ['all', 1, 2, 3, 4, 5, 'picks']

/** What a rating looks like to this predicate. */
export interface RatingLike {
  userStars: RatingStars | null
  flag: RatingFlag
}

/**
 * Does this photograph survive the filter?
 *
 * `undefined` is a photograph nobody has rated, which is the case the old
 * Workstation predicate let through unconditionally. Unrated means zero
 * stars and no pick: it fails every threshold and it is not a pick. Only
 * `all` shows it.
 */
export function matchesRatingFilter(
  rating: RatingLike | undefined | null,
  filter: RatingFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'picks') return rating?.flag === 'pick'
  return (rating?.userStars ?? 0) >= filter
}

/**
 * The filter's name in the interface, and the same words in both
 * libraries. `≥` rather than "3+" because the control is a menu of
 * thresholds and the symbol says threshold without a legend.
 */
export function ratingFilterLabel(filter: RatingFilter): string {
  if (filter === 'all') return 'All'
  if (filter === 'picks') return 'Picks'
  return `≥ ${filter}`
}

/**
 * The same thing said in full, for a tooltip and for the accessible name.
 * "≥ 3" is legible beside the others and meaningless read aloud on its
 * own.
 */
export function ratingFilterDescription(filter: RatingFilter): string {
  if (filter === 'all') return 'Show everything'
  if (filter === 'picks') return 'Show only picks'
  return `Show ${filter} star${filter === 1 ? '' : 's'} and above`
}

/** Is the grid narrowed right now? Drives the header's "filtered" state. */
export function isFiltering(filter: RatingFilter): boolean {
  return filter !== 'all'
}
