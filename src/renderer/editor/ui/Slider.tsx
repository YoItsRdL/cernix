import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  onReset: () => void
  format?: (v: number) => string
  disabled?: boolean
  /** The value considered "default": drives the dirty/active visuals and
   *  whether the eye affordance appears. Most sliders reset to 0 (the
   *  default), but some (e.g. B&W channel weights) reset to 1. */
  defaultValue?: number
  /** Press-and-hold to compare: enter on pointer down, release on pointer up.
   *  Same semantics as the global header Compare, while held the canvas
   *  renders *this* field at its default while all other params stay
   *  edited. Omit both to hide the affordance. */
  onCompareDown?: () => void
  onCompareUp?: () => void
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onReset, format, disabled, defaultValue = 0, onCompareDown, onCompareUp }: SliderProps) {
  const dragRef = useRef<{ startX: number; startValue: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const display = format ? format(value) : value.toFixed(value === Math.round(value) ? 0 : 2)
  const pct = ((value - min) / (max - min)) * 100
  // Fill pivots around the slider's default value (not hardcoded 0), so
  // sliders whose range doesn't cross zero. E.g. Spread at 0.3..2 with
  // default 1, or B&W channels at 0..2 with default 1. Still render a
  // correct fill from the rest-point outward toward the current value.
  const centerPct = ((defaultValue - min) / (max - min)) * 100
  const trackWidth = Math.abs(pct - centerPct)
  const trackLeft = Math.min(pct, centerPct)
  const active = value !== defaultValue && !disabled

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startValue: value }
    setDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const trackEl = e.currentTarget as HTMLDivElement
    const rect = trackEl.getBoundingClientRect()
    const dx = e.clientX - dragRef.current.startX
    const range = max - min
    const sensitivity = e.shiftKey ? 0.25 : 1
    const next = clamp(dragRef.current.startValue + (dx / rect.width) * range * sensitivity, min, max)
    onChange(roundToStep(next, step))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    setDragging(false)
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const nudge = e.shiftKey ? 0.1 : 0.01
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(roundToStep(value - nudge, step), min, max)) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(roundToStep(value + nudge, step), min, max)) }
    if (e.key === '0') { e.preventDefault(); onReset() }
  }

  return (
    <div className={cn('px-space-5 py-space-2 group/slider', disabled && 'opacity-30 pointer-events-none')}>
      <div className="flex items-center justify-between text-metadata mb-space-1.5">
        <div className="flex items-center gap-space-1.5 min-w-0">
          <span className="text-text-muted font-medium tracking-tight truncate">{label}</span>
          {onCompareDown && onCompareUp && active && (
            // Press-and-hold to see this field's before/after in isolation.
            // Only surfaces on hover + when the param is dirty. No eye
            // appears on a slider already at its default.
            <button /* eslint-disable-line no-restricted-syntax -- design-allow: a press-and-hold compare affordance inside the slider row */
              type="button"
              onPointerDown={(e) => { e.preventDefault(); onCompareDown() }}
              onPointerUp={onCompareUp}
              onPointerLeave={onCompareUp}
              onPointerCancel={onCompareUp}
              className="opacity-0 group-hover/slider:opacity-100 focus-visible:opacity-100 text-text-muted hover:text-text-emphatic transition-opacity select-none touch-none"
              title={`Hold to compare ${label} with its default`}
              aria-label={`Compare ${label} with its default`}
            >
              <Eye size={10} />
            </button>
          )}
        </div>
        <button /* eslint-disable-line no-restricted-syntax -- design-allow: a press-and-hold compare affordance inside the slider row */
          onClick={onReset}
          className={cn(
            'tabular-nums text-metadata font-medium transition-colors',
            active ? 'text-text-emphatic hover:text-text-muted' : 'text-text-disabled',
          )}
          title={active ? 'Reset (0)' : ''}
        >
          {display}
        </button>
      </div>
      <div
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={onReset}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative h-5 cursor-ew-resize select-none focus:outline-none',
          dragging && 'cursor-grabbing',
        )}
      >
        {/* Base rail */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-border-subtle -translate-y-1/2 rounded-full" />
        {/* Fill from center pivot */}
        <div
          className={cn(
            'absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-colors',
            active ? 'bg-text-muted' : 'bg-border-strong',
          )}
          style={{ left: `${trackLeft}%`, width: `${trackWidth}%` }}
        />
        {/* Centre tick: shown whenever the default sits strictly
            inside the range (so the user has a visual home-point). */}
        {defaultValue > min && defaultValue < max && (
          <div
            className="absolute top-1/2 w-px h-1.5 bg-border-focus -translate-y-1/2 -translate-x-1/2"
            style={{ left: `${centerPct}%` }}
          />
        )}
        {/* Handle */}
        <div
          className={cn(
            'absolute top-1/2 w-3 h-3 -translate-y-1/2 -translate-x-1/2 rounded-full transition-transform',
            'bg-text-emphatic shadow-md',
            dragging ? 'scale-110' : 'group-hover/slider:scale-110',
          )}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function roundToStep(v: number, step: number): number {
  return Math.round(v / step) * step
}
