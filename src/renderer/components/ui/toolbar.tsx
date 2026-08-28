import * as React from 'react'
import { cn } from '@/lib/utils'
import { Separator } from './separator'

/**
 * The chrome every toolbar control wears.
 *
 * Both headers already used this for their segmented groups. View
 * toggles, the column stepper, the filter tabs, while standalone
 * actions sat bare, as text or a naked icon. Same job, half of them
 * invisible until hovered.
 *
 * Applied to a group it reads as a segmented control; applied to a lone
 * button it reads as a button. Either way a person can see what they can
 * press without moving the mouse to find out.
 */
export const TOOLBAR_CONTROL =
  'bg-surface-workspace border border-border-subtle rounded-soft'

/**
 * The rule between two groups of toolbar controls.
 *
 * There were four ways of drawing this line. Workstation used a 16px
 * rule with 8px either side; Local Archive used a full-height
 * `border-l` with 16px of padding on one side and 32px at wide widths,
 * and elsewhere in the same header a 12px rule with no margin at all.
 * A divider is the most literal statement of "these things are not
 * those things", so four versions of it is four different claims about
 * how far apart two clusters are.
 *
 * Short and centred, not full-height: a rule that runs the whole height
 * of the bar reads as a structural edge (the boundary of a panel) 
 * rather than as a separator between neighbours.
 */
export function ToolbarSeparator({ className }: { className?: string }) {
  return (
    <Separator
      orientation="vertical"
      className={cn('h-4 mx-space-2 shrink-0', className)}
    />
  )
}

export interface ToolbarProps extends React.HTMLAttributes<HTMLElement> {
  left?: React.ReactNode
  center?: React.ReactNode
  right?: React.ReactNode
}

/**
 * A toolbar row: something identifying on the left, controls on the
 * right.
 *
 * `@container` is the important part. A toolbar lives inside a panel,
 * not inside the window, so `md:` and `lg:` (which ask the viewport) 
 * answer the wrong question. On a wide monitor with a narrow panel every
 * viewport breakpoint reads as "plenty of room" while the toolbar is
 * visibly out of it. Consumers should hide low-priority controls with
 * `@md:`, `@xl:` and friends, which ask this element instead.
 *
 * It renders a <header>, not a div. Every toolbar in this app is the
 * banner for the region beneath it, and Local Archive already said so in
 * markup while Workstation did not. Same role, different element, which
 * is the kind of inconsistency a screen reader notices before a person
 * does.
 *
 * The two sides are also no longer symmetric. They used to be `flex-1`
 * each, splitting the row in half; the right side is fixed-size controls
 * that cannot shrink, so anything past its half spilled leftwards over
 * the left content instead of being clipped. The right side now keeps
 * its intrinsic width and the left side is the one that gives, which is
 * the correct priority. A breadcrumb can truncate, a button cannot.
 */
export function Toolbar({ className, left, center, right, ...props }: ToolbarProps) {
  return (
    <header
      className={cn('@container h-12 shrink-0 px-4 flex items-center justify-between gap-space-3 border-b border-border-subtle bg-surface-panel/50', className)}
      {...props}
    >
      <div className="flex items-center gap-space-2 min-w-0 flex-1 overflow-hidden">
        {left}
      </div>
      
      {center && (
        <div className="flex items-center gap-space-2 justify-center min-w-0 shrink">
          {center}
        </div>
      )}

      <div className="flex items-center gap-space-2 justify-end shrink-0">
        {right}
      </div>
    </header>
  )
}
