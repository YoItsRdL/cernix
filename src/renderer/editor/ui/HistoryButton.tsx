import { useEffect, useRef, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { ParamsStore } from '../state/params-store'
import { HistoryPanel } from './HistoryPanel'

interface HistoryButtonProps {
  store: ParamsStore
}

/**
 * Edit history affordance.
 *
 * Header-mounted button that opens an anchored popover holding the
 * `HistoryPanel`. Sits next to Browse / Presets / Export. Same
 * pattern those use, so the history reads as a peer concern (a
 * workspace tool, not an adjustment slider).
 *
 * The button surfaces a live step counter as a small badge so the
 * user sees their depth-of-edit at a glance without opening the
 * popover; the badge is the only chrome at rest. Click toggles the
 * popover; click-outside / Esc dismiss.
 */
export function HistoryButton({ store }: HistoryButtonProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return store.subscribeHistory((_, currentIndex) => setStep(currentIndex))
  }, [store])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(v => !v)}
        className="gap-space-1 h-7 text-text-muted hover:text-text-emphatic px-space-2"
        title="Edit history"
      >
        <HistoryIcon size={12} />
        {/* Step counter badge: visible only when the user has
            actually edited (step > 0). Reads as "you are N steps
            into this edit" without forcing the popover open. */}
        {step > 0 && (
          <span className={cn(
            'text-metadata font-mono tabular-nums',
            'text-accent-primary',
          )}>
            {step}
          </span>
        )}
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-space-1 w-fit max-h-dropdown-lg bg-surface-raised border border-border-strong rounded-soft shadow-xl z-[60] overflow-hidden"
        >
          <HistoryPanel store={store} />
        </div>
      )}
    </div>
  )
}
