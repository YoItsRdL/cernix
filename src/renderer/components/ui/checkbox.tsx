import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The box that says whether one thing is picked.
 *
 * There were four, and they agreed on almost nothing:
 *
 *   tile          16px, panel fill, accent when checked, tick in
 *                 --primary-foreground
 *   archive list  10px, panel fill, accent when checked, tick in
 *                 --text-emphatic
 *   drive list    10px, transparent, accent when checked, tick in
 *                 --text-emphatic
 *   viewer        12px, no fill, --viewer-text when checked, tick in
 *                 --accent-primary, inside a chip that also turned
 *                 accent, so the box vanished into its own container
 *
 * Three different ticks and three different empty states for one idea.
 * The tick is the tell: `--text-emphatic` is the workspace's ink, near
 * black in light mode, so two of the four put a dark check on an orange
 * fill. A fill and its foreground travel together or the contrast
 * drifts the moment either is re-pitched.
 *
 * Square on purpose. It is the one control in this app that is not
 * rounded, which is how a checkbox reads as a checkbox next to chips
 * and buttons that are.
 *
 * Opaque on purpose too: an empty box over a photograph took
 * `bg-overlay-hover`, the foreground at 7%, which is not a box but a
 * faint tint of whatever is behind it.
 *
 * What stays at the call site is behaviour, not appearance. The tile
 * fades its box until hover, the Drive list fades harder. Pass those
 * through `className`.
 */
export interface CheckboxProps {
  checked: boolean
  /** `sm` for a list row, `md` for a tile or the viewer's header. */
  size?: 'sm' | 'md'
  /**
   * Makes the box pressable in its own right, for surfaces where the
   * thing it sits on does something else with a click. Without it the
   * box is decorative and whatever contains it owns the gesture.
   */
  onToggle?: (e: React.MouseEvent) => void
  /** Required with `onToggle`: what the press does, for a screen reader. */
  label?: string
  className?: string
}

const BOX = { sm: 'w-2.5 h-2.5', md: 'w-4 h-4' } as const
const TICK = { sm: 8, md: 10 } as const

export function Checkbox({ checked, size = 'md', onToggle, label, className }: CheckboxProps) {
  const box = (
    <span
      aria-hidden
      className={cn(
        'border rounded-none flex items-center justify-center shrink-0 transition-all',
        BOX[size],
        checked
          ? 'bg-accent-primary border-accent-primary'
          : 'bg-surface-panel border-border-strong',
        className,
      )}
    >
      {checked && <Check size={TICK[size]} strokeWidth={3} className="text-primary-foreground" />}
    </span>
  )

  if (!onToggle) return box

  // `p-1 -m-1` grows the press target to 24px without moving the box a
  // pixel. A 16px target is under the floor in renderer.md, and this is
  // the smallest control on the surface people use most.
  //
  // A plain <button> rather than the Button component, and the reason
  // this wrapper lives in ui/ at all: Button brings a height, a hover
  // fill and a press nudge, all of which fight a box whose entire job
  // is to be exactly its own size.
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      title={label}
      onClick={(e) => { e.stopPropagation(); onToggle(e) }}
      className="p-1 -m-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
    >
      {box}
    </button>
  )
}
