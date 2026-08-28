import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoadingStateProps {
  /** Short status line: e.g. "Scanning files", "Rendering export". */
  label?: string
  /** Optional progress numbers: when both are present, we render a
   *  determinate progress bar + count instead of only a spinner. */
  done?: number
  total?: number
  /** Optional unit suffix for the count (e.g. "MB", "files"). */
  unit?: string
  /** Custom icon. Pass `null` to hide. Defaults to a spinning `Loader2`. */
  icon?: React.ReactNode | null
  className?: string
}

/**
 * The long-op treatment. Extracted from the editor's progress pattern
 * so every "please wait" surface reads the same. Switches between
 * indeterminate (spinner) and determinate (spinner + progress bar +
 * count) based on whether `total` is positive.
 */
export function LoadingState({ label, done, total, unit, icon, className }: LoadingStateProps) {
  const determinate = typeof total === 'number' && total > 0 && typeof done === 'number'
  const pct = determinate ? Math.min(100, Math.round((done! / total!) * 100)) : 0
  const fmt = (n: number) => unit === 'MB' ? (n / 1024 / 1024).toFixed(1) : n.toString()

  return (
    <div
      role="status"
      aria-busy="true"
      className={cn('flex flex-col items-center justify-center gap-space-3 p-space-6', className)}
    >
      {icon !== null && (
        <div className="text-text-muted">
          {icon ?? <Loader2 size={20} strokeWidth={1.5} className="animate-spin" />}
        </div>
      )}
      {label && (
        <div className="text-caption font-bold text-text-muted uppercase tracking-widest">{label}</div>
      )}
      {determinate && (
        <div className="w-48 space-y-space-2">
          <div className="h-0.5 w-full bg-border-subtle overflow-hidden">
            <div
              className="h-full bg-accent-primary/60 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-metadata text-text-disabled text-center">
            {fmt(done!)}{unit ? ` ${unit}` : ''} / {fmt(total!)}{unit ? ` ${unit}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
