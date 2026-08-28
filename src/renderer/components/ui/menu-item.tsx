import * as React from 'react'
import { DropdownMenuItem } from './dropdown-menu'
import { cn } from '@/lib/utils'

export interface MenuItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuItem> {
  icon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const MenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenuItem>, MenuItemProps>(
  ({ className, icon, rightIcon, children, ...props }, ref) => {
    return (
      <DropdownMenuItem
        ref={ref}
        className={cn(
          'flex items-center gap-space-2 rounded-soft px-3 py-1.5 text-body cursor-pointer transition-colors focus:bg-overlay-hover focus:text-text-emphatic text-text-default hover:bg-overlay-hover data-[disabled]:opacity-40',
          className
        )}
        {...props}
      >
        {icon && <span className="text-text-muted">{icon}</span>}
        <span className="flex-1">{children}</span>
        {rightIcon && <span className="text-text-muted">{rightIcon}</span>}
      </DropdownMenuItem>
    )
  }
)
MenuItem.displayName = 'MenuItem'
