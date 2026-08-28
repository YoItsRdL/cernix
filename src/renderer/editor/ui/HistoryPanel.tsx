import { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ParamsStore, HistoryEntry } from '../state/params-store'
import { Button } from '@/components/ui/button'

interface HistoryPanelProps {
  store: ParamsStore
}

/**
 * Edit history panel.
 *
 * Subscribes to the store's history list and renders entries
 * newest-first with a "jump to step" affordance per row. Entries
 * coalesce inside the store (same-label-within-500ms) so a slow
 * slider drag produces one entry, not a hundred.
 *
 * Session-scoped. History clears on photo open and never persists
 * to disk. Matches Lightroom Classic's history semantics: each
 * step is a one-line label, and the user can rewind to any prior
 * state with one click.
 */
export function HistoryPanel({ store }: HistoryPanelProps) {
  const [snapshot, setSnapshot] = useState(() => store.getHistory())

  useEffect(() => {
    return store.subscribeHistory((entries, currentIndex) => {
      // Pull a stable snapshot. The store's lists are mutated in
      // place but the listener fires after every change, so we
      // build a new array reference here for React's reconciler.
      setSnapshot({ entries: [...entries], currentIndex })
    })
  }, [store])

  const { entries, currentIndex } = snapshot

  if (entries.length <= 1) {
    return (
      <p className="px-space-5 py-1 text-caption text-text-muted leading-tight">
        Adjustments will appear here. Click any entry to rewind.
      </p>
    )
  }

  return (
    <div className="py-1 max-h-72 overflow-y-auto">
      {/* Newest first: matches LR's panel order. */}
      {entries.slice().reverse().map((entry, reverseIdx) => {
        const idx = entries.length - 1 - reverseIdx
        const isCurrent = idx === currentIndex
        const isPast = idx < currentIndex
        return (
          <button /* eslint-disable-line no-restricted-syntax -- design-allow: a left-aligned history row, not a chrome button */
            key={`${entry.timestamp}-${idx}`}
            onClick={() => store.jumpTo(idx)}
            className={cn(
              'w-full flex items-center gap-space-2 px-space-5 py-1 text-left transition-colors text-body',
              isCurrent
                ? 'bg-accent-primary/15 text-text-emphatic'
                : isPast
                  ? 'text-text-default hover:bg-surface-workspace'
                  : 'text-text-muted hover:bg-surface-workspace',
            )}
            title={`Step ${idx} · ${formatTime(entry.timestamp)}`}
          >
            <History
              size={11}
              className={cn(
                'shrink-0',
                isCurrent ? 'text-accent-primary' : 'text-text-muted',
              )}
            />
            <span className="flex-1 truncate">{entry.label}</span>
            <span className="text-metadata text-text-muted font-mono">
              {idx === 0 ? '·' : `#${idx}`}
            </span>
          </button>
        )
      })}
      {/* Footer affordance: one-click jump to step 0 (the on-disk
          baseline) for users who don't realise the entries are
          clickable. */}
      {currentIndex > 0 && (
        <div className="px-space-5 pt-space-2 border-t border-border-subtle">
          <Button
            variant="outline"
            size="sm"
            onClick={() => store.jumpTo(0)}
            className="h-6 px-space-2 text-metadata gap-space-1 w-full justify-center"
          >
            <RotateCcw size={10} />
            Revert to opened state
          </Button>
        </div>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// Re-export the entry type so callers don't have to reach into the store module.
export type { HistoryEntry }
