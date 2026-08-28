import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

/**
 * The right-hand detail panel.
 *
 * There were three of these, hand-rolled: the Workstation's metadata
 * inspector, Local Archive's batch summary, and the editor's adjustment
 * panel. They agreed on the idea and disagreed on the execution. 280px
 * against 288px, a raised header bar against a flat one, an uppercase
 * caption title against a body-weight one, and two different label/value
 * rows. Nothing chose those differences; they are just what three
 * authors reached for on three days.
 *
 * The frame lives here now, so a panel is a title, a body, and whatever
 * belongs in its header, not another aside to get right.
 *
 * Header height matches the toolbar's h-12 on purpose: the two meet at
 * the top-right corner and any difference reads as a misalignment.
 */
export interface InspectorProps extends React.HTMLAttributes<HTMLElement> {
  /** Shown uppercase in the header bar. */
  title: string
  /** Optional glyph before the title. */
  icon?: React.ReactNode
  /** Header-bar content on the right: a reset button, a filter. */
  actions?: React.ReactNode
  /**
   * Renders a close button after `actions`. Panels that cannot be
   * dismissed simply omit it rather than passing a no-op.
   */
  onClose?: () => void
}

export function Inspector({
  title, icon, actions, onClose, className, children, ...props
}: InspectorProps) {
  return (
    <aside
      className={cn(
        'w-aside h-full bg-surface-panel border-l border-border-strong',
        'flex flex-col shrink-0 z-10 overflow-hidden',
        className
      )}
      {...props}
    >
      <header className="h-12 shrink-0 flex items-center justify-between gap-space-2 px-space-4 border-b border-border-subtle bg-surface-raised">
        <span className="text-caption font-bold text-text-muted uppercase tracking-widest flex items-center gap-space-2 min-w-0 truncate">
          {icon}
          {title}
        </span>
        {(actions || onClose) && (
          <span className="flex items-center gap-space-1 shrink-0">
            {actions}
            {onClose && (
              <IconButton icon={<X size={14} />} aria-label={`Close ${title}`} onClick={onClose} />
            )}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

/**
 * A block within the panel, divided from the next by a rule rather than
 * by blank space. The panels are dense and a gap alone does not group.
 */
export function InspectorSection({
  className, children, ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-space-4 border-b border-border-subtle space-y-space-2', className)} {...props}>
      {children}
    </div>
  )
}

export interface InspectorRowProps {
  label: string
  value: React.ReactNode
  /** Tabular figures for anything countable or measurable. */
  mono?: boolean
  /** Colour role for the value, when one number matters more than its neighbours. */
  valueClassName?: string
}

export function InspectorRow({ label, value, mono, valueClassName }: InspectorRowProps) {
  return (
    <div className="flex items-center justify-between gap-space-3 py-1">
      <span className="text-caption text-text-muted font-bold tracking-wider min-w-0 truncate">{label}</span>
      <span
        className={cn(
          'text-metadata text-text-default max-w-metadata truncate shrink-0',
          mono && 'font-mono uppercase tracking-tight tabular-nums',
          valueClassName
        )}
      >
        {value}
      </span>
    </div>
  )
}
