import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Themed text input. Thin wrapper around the native `<input>` that
 * consumes role tokens so feature code can't drift from the rest of
 * the form surface. Focus ring uses `border-focus`; disabled state
 * honours the primitive state contract.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-soft border border-border-strong bg-surface-panel px-space-3 text-body text-text-emphatic placeholder:text-text-muted transition-colors',
        'focus-visible:outline-none focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-border-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
