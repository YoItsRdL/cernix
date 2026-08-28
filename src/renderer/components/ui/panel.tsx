import * as React from 'react'
import { cn } from '@/lib/utils'

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode
  footer?: React.ReactNode
}

export function Panel({ className, header, footer, children, ...props }: PanelProps) {
  return (
    <div 
      className={cn('bg-surface-panel flex flex-col overflow-hidden h-full', className)}
      {...props}
    >
      {header && (
        <div className="bg-surface-panel/50 h-10 px-4 flex items-center border-b border-border-subtle text-caption text-text-muted sticky top-0 z-10 shrink-0">
          {header}
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {footer && (
        <div className="bg-surface-panel/30 p-4 border-t border-border-subtle shrink-0">
          {footer}
        </div>
      )}
    </div>
  )
}
