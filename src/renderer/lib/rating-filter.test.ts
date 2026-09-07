import { describe, it, expect } from 'vitest'
import {
  matchesRatingFilter, ratingFilterLabel, ratingFilterDescription,
  isFiltering, RATING_FILTERS, type RatingFilter,
} from './rating-filter'
import type { RatingStars } from '@/types'

const rated = (userStars: RatingStars | null, flag: 'pick' | null = null) => ({ userStars, flag })

describe('filtering a library by rating', () => {
  it('shows everything when nothing is asked for', () => {
    expect(matchesRatingFilter(rated(0), 'all')).toBe(true)
    expect(matchesRatingFilter(rated(5), 'all')).toBe(true)
    expect(matchesRatingFilter(undefined, 'all')).toBe(true)
  })

  // The Workstation's old predicate compared for equality, so asking for
  // three hid the four- and five-star frames: the opposite of what
  // culling to a threshold means.
  it('is a threshold, so a better rating still passes', () => {
    for (const stars of [3, 4, 5] as RatingStars[]) {
      expect({ stars, shown: matchesRatingFilter(rated(stars), 3) })
        .toEqual({ stars, shown: true })
    }
  })

  it('excludes anything below the threshold', () => {
    for (const stars of [0, 1, 2] as RatingStars[]) {
      expect({ stars, shown: matchesRatingFilter(rated(stars), 3) })
        .toEqual({ stars, shown: false })
    }
  })

  // The old predicate pushed an unrated file before consulting the
  // filter, so filtering to five returned the five-star frames plus
  // everything nobody had looked at yet, which reads as a broken filter.
  it('does not let an unrated photograph through a threshold', () => {
    expect(matchesRatingFilter(undefined, 1)).toBe(false)
    expect(matchesRatingFilter(null, 5)).toBe(false)
    expect(matchesRatingFilter(rated(null), 1)).toBe(false)
  })

  it('shows only picks when asked for picks', () => {
    expect(matchesRatingFilter(rated(0, 'pick'), 'picks')).toBe(true)
    expect(matchesRatingFilter(rated(5, null), 'picks')).toBe(false)
    expect(matchesRatingFilter(undefined, 'picks')).toBe(false)
  })

  // A pick is a decision of its own, not a rating. An unrated pick is a
  // common state: the flag is the fastest key in the viewer.
  it('treats a pick as independent of the stars', () => {
    expect(matchesRatingFilter(rated(null, 'pick'), 'picks')).toBe(true)
    expect(matchesRatingFilter(rated(null, 'pick'), 1)).toBe(false)
  })

  it('offers every threshold and both ends of the scale', () => {
    expect(RATING_FILTERS).toEqual(['all', 1, 2, 3, 4, 5, 'picks'])
    expect(matchesRatingFilter(rated(5), 5)).toBe(true)
    expect(matchesRatingFilter(rated(4), 5)).toBe(false)
    expect(matchesRatingFilter(rated(1), 1)).toBe(true)
  })

  it('knows when the grid is narrowed', () => {
    expect(isFiltering('all')).toBe(false)
    for (const f of RATING_FILTERS.filter(f => f !== 'all')) expect(isFiltering(f)).toBe(true)
  })
})

describe('naming the filter', () => {
  it('labels every option, and never blankly', () => {
    for (const f of RATING_FILTERS) {
      expect({ f, label: ratingFilterLabel(f).length > 0 }).toEqual({ f, label: true })
      expect({ f, said: ratingFilterDescription(f).length > 0 }).toEqual({ f, said: true })
    }
  })

  it('says threshold rather than an exact count', () => {
    expect(ratingFilterLabel(3)).toBe('≥ 3')
    expect(ratingFilterDescription(3)).toBe('Show 3 stars and above')
  })

  // Read aloud, "≥ 1" is not a sentence and "1 stars" is not English.
  it('gets the singular right', () => {
    expect(ratingFilterDescription(1)).toBe('Show 1 star and above')
  })

  it('gives every option a distinct label', () => {
    const labels = RATING_FILTERS.map(f => ratingFilterLabel(f as RatingFilter))
    expect(new Set(labels).size).toBe(labels.length)
  })
})
