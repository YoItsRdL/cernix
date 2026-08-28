import { useEffect, useState } from 'react'
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts'

/**
 * Press `?` in the editor for the keyboard reference.
 *
 * The sheet itself is the app-wide one. This file used to carry its own
 * hand-written copy, and the copy had drifted: it promised "0–9 set star
 * rating", which the editor has never bound, and said nothing about H
 * for the healing brush. Keeping the binding here and the content in
 * lib/shortcuts.ts means there is only one list to be wrong.
 */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === '?') { e.preventDefault(); setOpen(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape is the dialog's own. Handling it here as well closed the
  // sheet and then fell through to leaving the editor.
  return <KeyboardShortcuts open={open} onOpenChange={setOpen} />
}
