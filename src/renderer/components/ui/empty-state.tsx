import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Short, uppercase status line: e.g. "No files yet". */
  title: string
  /** Optional supporting detail guiding the user to a next step. */
  detail?: string
  /** Optional action: usually the primary verb that would populate this surface. */
  action?: React.ReactNode
  /** Optional icon. Pass `null` for no icon. */
  icon?: React.ReactNode | null
  className?: string
}

/**
 * The empty-surface treatment. Used wherever a view has nothing to
 * show (no presets, no ratings, no query results, etc.). Consistent
 * across the app so "nothing here" reads as a designed state rather
 * than a rendering failure. Pair with an action prop (e.g. a
 * `<Button>Create preset</Button>`) when the user can do something
 * about it.
 */
export function EmptyState({ title, detail, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-space-3 p-space-6 text-center', className)}
    >
      {icon !== null && icon && (
        <div className="text-text-muted">{icon}</div>
      )}
      <div className="space-y-space-1">
        <div className="text-caption font-bold text-text-muted uppercase tracking-widest">{title}</div>
        {detail && (
          <div className="text-metadata text-text-disabled max-w-md mx-auto">{detail}</div>
        )}
      </div>
      {action && <div className="mt-space-2">{action}</div>}
    </div>
  )
}
