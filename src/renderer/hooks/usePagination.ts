import { useCallback, useMemo, useState } from 'react'

/**
 * Which slice of a list is on screen. Both libraries page the same way,
 * so the arithmetic lives once.
 *
 * The page is clamped on every render, not only when the user asks for
 * another: resizes, filters and folder changes all move how many pages
 * exist, and a page number that outlives its list renders an empty grid
 * with no way to tell why.
 */

/** Offered in the pager. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

/**
 * The size to open at, from what the viewport holds. Snapped to a value
 * a person would have chosen, because ten wastes a 2560px window and
 * fifty is a scroll on a laptop.
 *
 * Replaced a "Fit to window" option: fitting moved the page boundaries
 * on every resize, so "page 12" meant a different set of photographs
 * before and after. A page is a place.
 *
 * Capped at 50, not 100. This is what the app opens with, not what it
 * allows, and a hundred thumbnails should be chosen deliberately.
 */
export function defaultPageSize(fits: number): number {
  const MIN = 10
  const MAX = 50
  const allowed = PAGE_SIZE_OPTIONS.filter(n => n >= MIN && n <= MAX)

  // Nearest, not the largest that fits: largest-that-fits opens a
  // twenty-four-row viewport at ten and leaves half the grid empty.
  // Nearest can overshoot by a row, which costs a little scrolling.
  return allowed.reduce((best, option) =>
    Math.abs(option - fits) < Math.abs(best - fits) ? option : best)
}

/**
 * The chosen size, remembered between sessions and shared by both
 * libraries: a preference about how much to see at once, not about which
 * folder you are in.
 *
 * Every access is guarded. localStorage throws outright in some
 * contexts, and a preference is never worth a blank window.
 */
const STORAGE_KEY = 'cernix.pageSize'

function readStoredSize(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value = Number(raw)
    // Anything not on the menu counts as absent: a stale or hand-edited
    // value should not put the app in a state its control cannot show.
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value) ? value : null
  } catch {
    return null
  }
}

function writeStoredSize(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // A preference that cannot be saved is still a preference for now.
  }
}

export interface Pagination {
  /** 0-based. */
  page: number
  pageCount: number
  /** Index range for `array.slice`. */
  start: number
  end: number
  /** 1-based, for display. `0` when the list is empty. */
  firstItem: number
  lastItem: number
  total: number
  /** Items per page in force right now. */
  pageSize: number
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  next: () => void
  prev: () => void
}

/**
 * @param fits How many items the viewport could hold. Used once, to pick
 *   the opening size when the user has never chosen one, not to track
 *   the window, which is what "fit" did and why it went.
 * @param identity What list this is; change it and paging starts over.
 *   Carry a page number into a folder just opened and page three of the
 *   old list silently becomes page three of a list nobody has seen.
 *   Clamping does not catch it: the number is usually still in range.
 */
export function usePagination(total: number, fits: number, identity?: unknown): Pagination {
  const [page, setPageRaw] = useState(0)
  /** What the user chose, here or in a previous session. */
  const [chosen, setChosen] = useState<number | null>(() => readStoredSize())

  // Settled once, the first time the viewport has a measurable size.
  // Re-deriving on resize would put the page boundaries back on the
  // window, which is what removing "fit" was for.
  const [derived, setDerived] = useState<number | null>(null)
  if (derived === null && fits > 0) setDerived(defaultPageSize(fits))

  // Adjusted during the render, not in an effect: an effect resets after
  // the paint, so the new list appears once at the old offset first.
  // State rather than a ref, which is React's own form for this. A ref
  // written mid-render is invisible to the compiler and to Strict Mode.
  const [lastIdentity, setLastIdentity] = useState(identity)
  if (lastIdentity !== identity) {
    setLastIdentity(identity)
    if (page !== 0) setPageRaw(0)
  }

  const pageSize = Math.max(1, chosen ?? derived ?? PAGE_SIZE_OPTIONS[0])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Clamped on read rather than written back: a resize that shrinks the
  // list must not strand the user past the end. Every reader goes
  // through `safePage`, so storing the clamp as well would only cost a
  // second render to reach the value this one already has.
  const safePage = Math.min(page, pageCount - 1)

  const setPage = useCallback((next: number) => {
    setPageRaw(Math.max(0, next))
  }, [])

  const setPageSize = useCallback((size: number) => {
    // Keep the first item of the current page in view. Resetting to page
    // one would cost anyone on page forty their place as the price of
    // asking for bigger pages.
    const firstVisible = safePage * pageSize
    setChosen(size)
    writeStoredSize(size)
    setPageRaw(Math.floor(firstVisible / Math.max(1, size)))
  }, [safePage, pageSize])

  return useMemo(() => {
    const start = safePage * pageSize
    const end = Math.min(total, start + pageSize)
    return {
      page: safePage,
      pageCount,
      start,
      end,
      firstItem: total === 0 ? 0 : start + 1,
      lastItem: end,
      total,
      pageSize,
      setPage,
      setPageSize,
      next: () => setPageRaw(p => Math.min(pageCount - 1, p + 1)),
      prev: () => setPageRaw(p => Math.max(0, p - 1)),
    }
  }, [safePage, pageCount, pageSize, total, setPage, setPageSize])
}

/**
 * The page numbers to draw. `null` is a gap, not a page.
 *
 * 5632 photographs is 282 pages at twenty a page, and no pager can show
 * 282 buttons. Keeping the ends, the current neighbourhood and the jumps
 * between them holds the control at one width from three pages to three
 * hundred, so it never reflows under the cursor.
 */
export function pageWindow(page: number, pageCount: number, radius = 1): (number | null)[] {
  if (pageCount <= 1) return [0]

  const wanted = new Set<number>([0, pageCount - 1])
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 0 && p < pageCount) wanted.add(p)
  }

  // Near an end the window is lopsided, which makes the control jitter
  // as it fills out. Top up from the same end to hold the count.
  const target = Math.min(pageCount, radius * 2 + 3)
  for (let p = 0; wanted.size < target && p < pageCount; p++) {
    if (page <= radius) wanted.add(p)
    else wanted.add(pageCount - 1 - p)
  }

  const sorted = [...wanted].sort((a, b) => a - b)
  const out: (number | null)[] = []
  let previous: number | null = null
  for (const p of sorted) {
    if (previous !== null && p - previous > 1) out.push(null)
    out.push(p)
    previous = p
  }
  return out
}
