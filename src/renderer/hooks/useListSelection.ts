import { useCallback, useEffect, useRef } from 'react'

export interface ListSelectionOptions {
  /**
   * Ids in the order they appear on screen. Ranges follow this, so it
   * must be the filtered, sorted list the user is actually looking at,
   * not the underlying data.
   */
  orderedIds: string[]
  /** The current selection. This hook is controlled; the caller owns it. */
  selected: Set<string>
  /** Replace the whole selection. */
  onChange: (ids: string[]) => void
  /**
   * Whether this surface is the one on screen. Two mounted surfaces
   * would otherwise both answer Cmd+A.
   */
  enabled?: boolean
}

/**
 * One selection model for every list and grid in the app.
 *
 * This started as Local Archive's implementation and was the only one:
 * Workstation's click handler took the same MouseEvent and ignored every
 * modifier on it, so the same gesture did different things depending on
 * which tab you were in. Extracted rather than copied. Two copies of a
 * selection model drift, and the drift is invisible until someone tries
 * to select a range in the wrong tab.
 *
 * The modifier mapping is deliberately *swapped* from the Finder/Photos
 * convention, per the preference already established in Local Archive:
 *
 *   plain click     replace the selection with this one item
 *   Ctrl/Cmd+click  range from the anchor to this item
 *   Shift+click     toggle this item, keeping the rest
 *
 * A plain click means one of two things, and which one depends on what
 * the tile is. Where a separate checkbox does the selecting, the tile's
 * own click replaces the selection. `handleSelectClick`. Where the tile
 * IS the checkbox, it ticks and unticks. `handleToggleClick`. The
 * modifiers never change meaning between them.
 *
 * `metaKey` is Cmd on macOS and `ctrlKey` is Ctrl elsewhere; both mean
 * "range" here.
 *
 * The anchor lives in a ref because moving it must not re-render.
 * Only the resulting selection drives the UI. It survives Shift-clicks
 * so a range can be re-drawn from the same starting point, which is the
 * behaviour Finder and Photos have and the thing people miss most when
 * it is absent.
 */
export function useListSelection({
  orderedIds,
  selected,
  onChange,
  enabled = true,
}: ListSelectionOptions) {
  const anchor = useRef<string | null>(null)

  // The handlers below read the current list and selection through this
  // ref rather than closing over them, so their identities stay stable.
  // That matters: DistillerViewport memoises its rows on the actions
  // object, and a handler that changed every render would re-render a
  // grid of thousands on each keystroke.
  //
  // Synced in an effect, not during render. Writing a ref while
  // rendering is a React rule violation and `npm run lint` says so.
  // Effects flush before any user event can fire, so the handlers never
  // see a stale list.
  const latest = useRef({ orderedIds, selected, onChange })
  useEffect(() => {
    latest.current = { orderedIds, selected, onChange }
  })

  /**
   * Adds or removes one item, whatever the modifiers.
   *
   * This is what a checkbox means. Routing the tile's checkbox through
   * handleSelectClick made a plain click *replace* the selection, so
   * clicking an already-checked box re-selected only that item and there
   * was no way to uncheck it by clicking it.
   */
  const toggle = useCallback((id: string) => {
    const next = new Set(latest.current.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    latest.current.onChange([...next])
    anchor.current = id
  }, [])

  const handleSelectClick = useCallback(
    (id: string, e: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => {
      const { orderedIds: ids, onChange: set } = latest.current
      const isRange = e.metaKey || e.ctrlKey
      const isToggle = e.shiftKey

      if (isRange && anchor.current !== null) {
        const from = ids.indexOf(anchor.current)
        const to = ids.indexOf(id)
        if (from < 0 || to < 0) {
          // The anchor has been filtered out of the visible list. A range
          // to something that is not there would select nothing, so fall
          // back to a plain click and re-anchor.
          set([id])
          anchor.current = id
          return
        }
        const [lo, hi] = from < to ? [from, to] : [to, from]
        set(ids.slice(lo, hi + 1))
        // Anchor preserved, so the range can be redrawn from here.
        return
      }

      if (isToggle) {
        toggle(id)
        return
      }

      set([id])
      anchor.current = id
    },
    [toggle],
  )

  /**
   * A click on a surface where the tile *is* the checkbox.
   *
   * Local Archive has no separate checkbox to press: the whole tile is
   * the control, and a control that ticks on a click has to untick on
   * the next one. It routed through `handleSelectClick`, where a plain
   * click replaces the selection, so clicking a selected photograph
   * re-selected it and the only way to drop one was Escape and start
   * again.
   *
   * Workstation keeps `handleSelectClick` on the tile, because there
   * the tile's plain click focuses rather than selects and the chip is
   * the checkbox. Same model, two entry points, one place to read what
   * a gesture means. The alternative was a second modifier map inside
   * ReviewView, which is how the two libraries came apart last time.
   *
   * Modifiers keep their meaning either way: range and add/remove are
   * the same everywhere.
   */
  const handleToggleClick = useCallback(
    (id: string, e: Pick<React.MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        handleSelectClick(id, e)
        return
      }
      toggle(id)
    },
    [handleSelectClick, toggle],
  )

  const selectAll = useCallback(() => {
    const { orderedIds: ids, onChange: set } = latest.current
    set([...ids])
  }, [])

  const clear = useCallback(() => {
    latest.current.onChange([])
    anchor.current = null
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal a key while the user is typing. Rename fields and
      // the terminal input live on these same surfaces.
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing) return

      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        selectAll()
        return
      }
      if (e.key === 'Escape' && latest.current.selected.size > 0) {
        // Only when there is something to clear, so Escape still reaches
        // whatever is layered above (a modal, the lightbox) otherwise.
        e.preventDefault()
        clear()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, selectAll, clear])

  return { handleSelectClick, handleToggleClick, toggle, selectAll, clear, anchor }
}
