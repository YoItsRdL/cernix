import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  /** Short, uppercase status line: e.g. "Load failed". */
  title: string
  /** Optional supporting detail. Usually the thrown error's message. */
  detail?: string
  /** Optional retry action. Label + handler pair. */
  action?: { label: string; onClick: () => void }
  /** Custom icon; defaults to `AlertTriangle`. Pass `null` for none. */
  icon?: React.ReactNode | null
  className?: string
}

/**
 * The "painted back of the cabinet" error surface. Consistent
 * treatment for every failure state so errors read as intentional
 * rather than broken. Matches the editor's existing `Load failed`
 * aesthetic: uppercase title in `status-danger`, mono detail in
 * `text-muted`, optional retry button.
 */
export function ErrorState({ title, detail, action, icon, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-space-3 p-space-6 text-center', className)}
    >
      {icon !== null && (
        <div className="text-status-danger">
          {icon ?? <AlertTriangle size={20} strokeWidth={1.5} />}
        </div>
      )}
      <div className="space-y-space-1">
        <div className="text-caption font-bold text-status-danger uppercase tracking-widest">{title}</div>
        {detail && (
          <div className="text-metadata font-mono text-text-muted max-w-md mx-auto">
            {detail}
          </div>
        )}
      </div>
      {action && (
        <Button variant="neutral" size="sm" onClick={action.onClick} className="mt-space-2">
          {action.label}
        </Button>
      )}
    </div>
  )
}
