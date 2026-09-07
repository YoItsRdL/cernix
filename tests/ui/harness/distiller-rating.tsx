import { createRoot } from 'react-dom/client'
import { Distiller } from '@/components/Distiller'
import { AppToaster } from '@/components/ui/app-toaster'
import { installMockApi } from './mock-api'

/**
 * The Workstation over a library that has already been culled.
 *
 * A separate harness rather than seeding the shared one: ten suites mount
 * that, and while a rating changes nothing for them today, a fixture they
 * do not need is a fixture that will eventually explain a failure they
 * cannot see the cause of.
 *
 * Twelve files, `file-1`…`file-12`. Five of them are deliberately left
 * with no rating record at all, because that is the case the Workstation's
 * previous predicate let through unconditionally: it pushed an unrated
 * file before consulting the filter, so asking for five stars returned
 * the five-star frames plus everything nobody had looked at yet.
 */
;(window as unknown as { __seedRatings: unknown[] }).__seedRatings = [
  { fileId: 'file-1', userStars: 5, flag: null, updatedAt: 1 },
  { fileId: 'file-2', userStars: 4, flag: null, updatedAt: 1 },
  { fileId: 'file-3', userStars: 3, flag: null, updatedAt: 1 },
  { fileId: 'file-4', userStars: 2, flag: null, updatedAt: 1 },
  { fileId: 'file-5', userStars: 1, flag: null, updatedAt: 1 },
  // A pick with no stars: the flag is the fastest key in the viewer, so
  // an unrated pick is a normal state and not an edge case.
  { fileId: 'file-6', userStars: 0, flag: 'pick', updatedAt: 1 },
  { fileId: 'file-7', userStars: 5, flag: 'pick', updatedAt: 1 },
  // file-8 … file-12: no record.
]

installMockApi()

const w = window as unknown as Record<string, unknown>
/** The filter trigger, found the way a person would: by its name. */
w.__filterTrigger = () =>
  [...document.querySelectorAll('button')]
    .find(b => (b.getAttribute('aria-label') || '').startsWith('Filter by rating'))
/** What the trigger says it is set to, without opening it. */
w.__filterLabel = () => {
  const el = (w.__filterTrigger as () => HTMLElement | undefined)()
  return el ? (el.textContent || '').trim() : 'missing'
}
/**
 * The filtered total, read off the pager's own readout.
 *
 * Not the tile count: the grid pages, so twelve files show nine tiles on
 * the first page and a tile count cannot tell filtering from paging.
 * This is also the number the ticket asks the header to get right.
 */
w.__total = () => {
  const readout = (w.__ui as { pagerCount: () => string }).pagerCount()
  const m = /of (\d+)/.exec(readout)
  return m ? Number(m[1]) : readout
}

/**
 * How many items the selection holds, from the header's own readout.
 *
 * The tile-level count only sees the current page, and the question here
 * is whether the selection reaches past what is on screen.
 */
w.__selectedTotal = () => {
  const el = [...document.querySelectorAll('span')]
    .find(n => /^\d+ selected$/.test((n.textContent || '').trim()))
  return el ? Number((el.textContent || '').trim().split(' ')[0]) : 0
}

/** How many photograph tiles are on screen (folders excluded). */
w.__fileTiles = () =>
  [...document.querySelectorAll('[role="button"][aria-label]')]
    .filter(n => /^DSC_/.test(n.getAttribute('aria-label') || '')).length

createRoot(document.getElementById('root')!).render(
  <>
    <Distiller />
    <AppToaster />
  </>,
)
