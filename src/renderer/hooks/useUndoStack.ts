import { useCallback, useEffect, useRef, useState } from 'react'

export interface UndoEntry {
  /** Shown in the toast and the shortcut hint, e.g. "Move 12 items". */
  label: string
  /** Reverses the action. Throwing marks the undo failed; the entry is still consumed. */
  undo: () => Promise<void> | void
}

export interface UseUndoStackOptions {
  /** Only bind Ctrl/Cmd+Z while this surface is on screen. */
  enabled?: boolean
  /** How many steps to remember. */
  depth?: number
}

/**
 * A stack of reversible actions, with Ctrl/Cmd+Z.
 *
 * The app moves and trashes files in someone's Drive. Before this there
 * was no way back from either: a mis-aimed drop relocated a folder and
 * the only recourse was drive.google.com. An action that cannot be taken
 * back is a design failure however good the button looks, so this exists
 * before any more destructive features do.
 *
 * Entries carry their own inverse rather than the stack knowing about
 * moves or trashes. That keeps it honest. Whoever performs an action
 * writes the undo for it at the same moment, with the information needed
 * to reverse it already in hand. A move knows the folder it came from;
 * ten minutes later nothing does.
 *
 * Undo is not itself undoable. Redo would need every inverse to have an
 * inverse, and the operations here are already round trips over the
 * network; a wrong redo is a worse failure than retyping the action.
 */
export function useUndoStack({ enabled = true, depth = 20 }: UseUndoStackOptions = {}) {
  const [stack, setStack] = useState<UndoEntry[]>([])
  // Guards against a second Ctrl+Z landing while the first is still in
  // flight. Undoing the same move twice would move the items back and
  // then move them back again from the wrong place.
  const runningRef = useRef(false)

  const push = useCallback((entry: UndoEntry) => {
    setStack(prev => [...prev.slice(-(depth - 1)), entry])
  }, [depth])

  const clear = useCallback(() => setStack([]), [])

  const stackRef = useRef(stack)
  useEffect(() => { stackRef.current = stack })

  const undo = useCallback(async (): Promise<UndoEntry | null> => {
    if (runningRef.current) return null
    // Read from the ref rather than capturing the entry inside a
    // setState updater and awaiting a microtask for it to land: the
    // updater ran for its return value and the capture was a side
    // effect of it, which is a lot of machinery to read one array.
    const entry = stackRef.current[stackRef.current.length - 1]
    if (!entry) return null
    setStack(prev => prev.slice(0, -1))
    runningRef.current = true
    try {
      await entry.undo()
      return entry
    } finally {
      runningRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z' && e.key !== 'Z') return
      // Never steal undo from a text field. The rename input lives on
      // the same surfaces, and Ctrl+Z there means the text, not the file.
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) return
      if (stackRef.current.length === 0) return
      e.preventDefault()
      void undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, undo])

  return {
    push,
    undo,
    clear,
    canUndo: stack.length > 0,
    /** Label of the action Ctrl+Z would reverse, for hints. */
    nextLabel: stack.length > 0 ? stack[stack.length - 1].label : null,
  }
}
