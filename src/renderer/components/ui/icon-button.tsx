import * as React from 'react'
import { Button, ButtonProps } from './button'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'aria-label'> {
  icon: React.ReactNode
  'aria-label': string // Forced by TypeScript to ensure accessibility
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, 'aria-label': ariaLabel, className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        className={cn('text-text-muted hover:text-text-emphatic', className)}
        {...props}
      >
        {icon}
      </Button>
    )
  }
)
IconButton.displayName = 'IconButton'
