import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Pagination } from './usePagination'
import { topOverlay } from '@/lib/overlay'

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
 *
 * Except with `moveOnly`: the Local Archive starts with everything
 * selected, the import being what is selected, and one arrow press
 * turned 678 files into 1 without a word. There, plain moves only move
 * the focus; shift is the deliberate gesture that still selects a range.
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
  /** Off while a modal, a rename field or a pending move owns the keys. */
  enabled?: boolean
  /** A plain move leaves the selection alone; shift still selects a range. */
  moveOnly?: boolean
}

export interface GridNavigation {
  /** Index into the full list, or null before the user has arrowed in. */
  focusedIndex: number | null
  setFocusedIndex: (index: number | null) => void
}

export function useGridNavigation({
  total, columns, pagination, idAt, onSelect, enabled = true, moveOnly = false,
}: GridNavigationOptions): GridNavigation {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

  // The handler is bound once and reads through this, so that changing
  // page or column count does not tear down and rebuild the listener on
  // every render, and so a key pressed mid-render cannot act on a
  // stale page size.
  const latest = useRef({ total, columns, pagination, idAt, onSelect, focusedIndex, moveOnly })
  // Synced in a layout effect, not during the render: the keydown
  // listener reads this, and a listener cannot fire between a commit and
  // the layout effect that follows it.
  useLayoutEffect(() => {
    latest.current = { total, columns, pagination, idAt, onSelect, focusedIndex, moveOnly }
  })

  /**
   * Where a shift run began. The range used to be taken from the
   * previous focus, so each shift+arrow selected that tile and the new
   * one, and a run never held more than two. Set by every plain move;
   * a shift move extends from it and leaves it where it is.
   */
  const anchor = useRef<number | null>(null)

  /** A key moved the focus: the tile itself should take DOM focus once it is on screen. */
  const domFocusWanted = useRef(false)

  /** Move focus to `next`, bring its page up, and select it. */
  const focusTo = useCallback((next: number, extend: boolean) => {
    const { total: n, idAt: at, onSelect: select, pagination: p, focusedIndex: from, moveOnly: onlyMove } = latest.current
    if (n === 0) return
    const clamped = Math.max(0, Math.min(n - 1, next))

    // The page follows the focus. Without this an arrow at the edge of a
    // page moves a focus ring onto a tile that is not on screen.
    const wanted = Math.floor(clamped / p.pageSize)
    if (wanted !== p.page) p.setPage(wanted)

    setFocusedIndex(clamped)
    domFocusWanted.current = true

    const start = anchor.current ?? from
    if (extend && start !== null) {
      anchor.current = start
      const [lo, hi] = start <= clamped ? [start, clamped] : [clamped, start]
      const ids: string[] = []
      for (let i = lo; i <= hi; i++) {
        const id = at(i)
        if (id !== undefined) ids.push(id)
      }
      select(ids)
      return
    }

    anchor.current = clamped
    if (onlyMove) return
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

      // A key someone else already handled is theirs, and so is one meant
      // for a dialog, menu or the viewer on top: arrows in a menu moved
      // the grid behind it.
      if (e.defaultPrevented || topOverlay()) return

      // Enter and Space are not handled here. They press whatever has
      // focus, and a tile that has focus handles its own: Enter opens,
      // Space ticks. This listener once took them from every button in
      // the app and opened the viewer instead.
      const { columns: cols, total: n, pagination: p, focusedIndex: from } = latest.current
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

        default:
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, focusTo])

  // DOM focus follows the arrows. They used to move only a drawn ring, so
  // Enter or Space on a tile reached with Tab acted on a different
  // photograph than the one in focus (F-070). Now there is one focus.
  useEffect(() => {
    if (!domFocusWanted.current || focusedIndex === null) return
    const id = latest.current.idAt(focusedIndex)
    if (id === undefined) return
    const find = () => document.querySelector<HTMLElement>(`[data-grid-key="${CSS.escape(id)}"]`)
    const el = find()
    if (el) {
      domFocusWanted.current = false
      el.focus()
      return
    }
    // The page that holds it may not have mounted yet.
    const raf = requestAnimationFrame(() => {
      domFocusWanted.current = false
      find()?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [focusedIndex, pagination.page])

  // ...and the other way: a tile focused any other way (Tab, a click)
  // is where the arrows continue from.
  useEffect(() => {
    if (!enabled) return
    const onFocusIn = (e: FocusEvent) => {
      const tile = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-grid-key]') : null
      const key = tile?.dataset.gridKey
      if (key === undefined) return
      const { total: n, idAt: at } = latest.current
      for (let i = 0; i < n; i++) {
        if (at(i) === key) {
          anchor.current = i
          setFocusedIndex(i)
          return
        }
      }
    }
    window.addEventListener('focusin', onFocusIn)
    return () => window.removeEventListener('focusin', onFocusIn)
  }, [enabled])

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
