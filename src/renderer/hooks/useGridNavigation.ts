import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Pagination } from './usePagination'

/**
 * Driving the grid from the keyboard.
 *
 * Paging made this urgent rather than merely nice. Scrolling could at
 * least be done with a keyboard by accident. The browser gives you
 * that. Page buttons cannot: replacing the scrollbar with them took
 * away the one way through a library that did not need a mouse, so the
 * way back has to be deliberate.
 *
 * The focused index is over the *whole* list, not the visible page, and
 * the page follows the focus rather than the other way round. That is
 * the difference between a grid you can cross and one that stops at
 * every page boundary and asks you to reach for the mouse. Arrow past
 * the last tile on a page and the next page arrives underneath you.
 *
 * Focus moves selection, the way Finder and Photos do: arrow alone
 * replaces the selection, so holding an arrow walks the library one
 * picture at a time. Shift extends from where the run began, so a range
 * can be swept out without touching the mouse.
 */
export interface GridNavigationOptions {
  /** Length of the full list, not the page. */
  total: number
  /** Tiles per row. 1 in list view. */
  columns: number
  pagination: Pagination
  /** Index -> the id or path this hook should report as selected. */
  idAt: (index: number) => string | undefined
  /** Replace the selection. Called as focus moves. */
  onSelect: (ids: string[]) => void
  /** Enter or Space on the focused item. */
  onActivate?: (index: number) => void
  /** Off while a modal, a rename field or a pending move owns the keys. */
  enabled?: boolean
}

export interface GridNavigation {
  /** Index into the full list, or null before the user has arrowed in. */
  focusedIndex: number | null
  setFocusedIndex: (index: number | null) => void
}

export function useGridNavigation({
  total, columns, pagination, idAt, onSelect, onActivate, enabled = true,
}: GridNavigationOptions): GridNavigation {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // The handler is bound once and reads through this, so that changing
  // page or column count does not tear down and rebuild the listener on
  // every render, and so a key pressed mid-render cannot act on a
  // stale page size.
  const latest = useRef({ total, columns, pagination, idAt, onSelect, onActivate, focusedIndex })
  // Synced in a layout effect, not during the render: the keydown
  // listener reads this, and a listener cannot fire between a commit and
  // the layout effect that follows it.
  useLayoutEffect(() => {
    latest.current = { total, columns, pagination, idAt, onSelect, onActivate, focusedIndex }
  })

  /** Move focus to `next`, bring its page up, and select it. */
  const focusTo = useCallback((next: number, extend: boolean) => {
    const { total: n, idAt: at, onSelect: select, pagination: p, focusedIndex: from } = latest.current
    if (n === 0) return
    const clamped = Math.max(0, Math.min(n - 1, next))

    // The page follows the focus. Without this an arrow at the edge of a
    // page moves a focus ring onto a tile that is not on screen.
    const wanted = Math.floor(clamped / p.pageSize)
    if (wanted !== p.page) p.setPage(wanted)

    setFocusedIndex(clamped)

    if (extend && from !== null) {
      const [lo, hi] = from <= clamped ? [from, clamped] : [clamped, from]
      const ids: string[] = []
      for (let i = lo; i <= hi; i++) {
        const id = at(i)
        if (id !== undefined) ids.push(id)
      }
      select(ids)
      return
    }

    const id = at(clamped)
    select(id === undefined ? [] : [id])
  }, [])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal a key from a text field. Rename inputs and the
      // terminal share these surfaces, and an arrow key belongs to the
      // caret whenever there is one.
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) return

      // Ctrl/Cmd combinations belong to the selection model (Ctrl+A) and
      // to undo. Only Shift means anything here.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const { columns: cols, total: n, pagination: p, focusedIndex: from, onActivate: activate } = latest.current
      if (n === 0) return

      // Before the first arrow there is no focus, so the first press
      // lands on the first tile of the page being looked at rather than
      // jumping to the top of the library.
      const current = from ?? p.start - 1

      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); focusTo(current + 1, e.shiftKey); break
        case 'ArrowLeft':  e.preventDefault(); focusTo(current - 1, e.shiftKey); break
        case 'ArrowDown':  e.preventDefault(); focusTo(current + cols, e.shiftKey); break
        case 'ArrowUp':    e.preventDefault(); focusTo(current - cols, e.shiftKey); break
        case 'Home':       e.preventDefault(); focusTo(0, e.shiftKey); break
        case 'End':        e.preventDefault(); focusTo(n - 1, e.shiftKey); break

        // Page keys move a page at a time and take the focus with them,
        // landing on the first tile of the page that arrives.
        case 'PageDown': {
          e.preventDefault()
          const target = Math.min(n - 1, (p.page + 1) * p.pageSize)
          focusTo(target, e.shiftKey)
          break
        }
        case 'PageUp': {
          e.preventDefault()
          focusTo(Math.max(0, (p.page - 1) * p.pageSize), e.shiftKey)
          break
        }

        case 'Enter':
        case ' ':
          if (from === null || !activate) return
          e.preventDefault()
          activate(from)
          break

        default:
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, focusTo])

  // A focus ring pointing past the end of a list that has just been
  // filtered or refreshed is worse than none. Clamped on read rather
  // than written back, the same way usePagination clamps its page: an
  // effect would paint the stale ring once before correcting it.
  const safeFocusedIndex =
    focusedIndex !== null && focusedIndex >= total
      ? (total === 0 ? null : total - 1)
      : focusedIndex

  return { focusedIndex: safeFocusedIndex, setFocusedIndex }
}
