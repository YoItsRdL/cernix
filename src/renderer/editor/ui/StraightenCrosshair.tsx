import { useEffect, useRef, useState } from 'react'

interface Point { x: number; y: number }

interface StraightenCrosshairProps {
  /** Called with the computed straighten angle (degrees, bounded to ±45) once
   *  the user clicks the second point. The overlay exits automatically after. */
  onAngle: (deg: number) => void
  /** Called when the user cancels (Esc or right-click) without committing. */
  onCancel: () => void
}

/**
 * Full-canvas overlay for the R-key straighten crosshair tool.
 *
 * Interaction:
 *   1. First click. Anchors point A.
 *   2. Mouse move. Draws a live guide line A → cursor.
 *   3. Second click. Computes the angle of line A→B relative to horizontal,
 *      clamps to ±45°, fires onAngle, and the parent unmounts the overlay.
 *   4. Esc / right-click. Fires onCancel, no angle written.
 *
 * The angle sign convention matches straightenDeg: positive rotates the image
 * clockwise (right side up → tilts right), so a line drawn left-to-right
 * that slopes upward yields a positive correction.
 */
export function StraightenCrosshair({ onAngle, onCancel }: StraightenCrosshairProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [anchor, setAnchor] = useState<Point | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)

  // Keyboard cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toSvgPoint = (e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    setCursor(toSvgPoint(e))
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    // Right-click cancels.
    if (e.button !== 0) { onCancel(); return }
    e.preventDefault()
    const pt = toSvgPoint(e)
    if (!anchor) {
      setAnchor(pt)
      setCursor(pt)
    } else {
      // Second click. Compute angle and commit.
      const dx = pt.x - anchor.x
      const dy = pt.y - anchor.y
      // atan2 gives the angle of the line A→B. Positive y is downward in screen
      // coords, so a rightward-upward slope gives negative dy → negative atan2.
      // We want: a line sloping up to the right means the horizon is tilted and
      // the image needs clockwise rotation (positive straightenDeg), so negate.
      const rawDeg = -(Math.atan2(dy, dx) * 180) / Math.PI
      // Clamp to the ±45° slider range; also reject near-zero lengths to avoid
      // accidental single-pixel clicks producing 0° commits.
      if (Math.hypot(dx, dy) < 8) { onCancel(); return }
      const clamped = Math.max(-45, Math.min(45, rawDeg))
      onAngle(parseFloat(clamped.toFixed(1)))
    }
  }

  const hasLine = anchor && cursor

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: 'crosshair', zIndex: 30 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      {/* Guide line */}
      {hasLine && (
        <line
          x1={anchor.x}
          y1={anchor.y}
          x2={cursor.x}
          y2={cursor.y}
          stroke="currentColor"
          className="text-accent-primary opacity-90"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}

      {/* Anchor dot */}
      {anchor && (
        <>
          <circle cx={anchor.x} cy={anchor.y} r={5} fill="none" stroke="currentColor" className="text-accent-primary opacity-90" strokeWidth={1.5} />
          <circle cx={anchor.x} cy={anchor.y} r={1.5} fill="currentColor" className="text-accent-primary opacity-90" />
        </>
      )}

      {/* Cursor dot: only while hovering before second click */}
      {cursor && anchor && (
        <>
          <circle cx={cursor.x} cy={cursor.y} r={4} fill="none" stroke="currentColor" className="text-accent-primary opacity-70" strokeWidth={1.5} />
          <circle cx={cursor.x} cy={cursor.y} r={1.5} fill="currentColor" className="text-accent-primary opacity-70" />
        </>
      )}

      {/* Instruction badge: positioned once anchor is set, otherwise top-center */}
      <foreignObject
        x={hasLine ? Math.min(anchor!.x, cursor!.x) + Math.abs(cursor!.x - anchor!.x) / 2 - 80 : '50%'}
        y={anchor ? anchor.y - 36 : 16}
        width={160}
        height={28}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div className="flex items-center justify-center h-full pointer-events-none">
          <span className="bg-surface-floating border border-border-strong rounded-full backdrop-blur-md px-space-3 py-1 text-body font-medium text-text-emphatic whitespace-nowrap shadow-lg">
            {anchor ? 'Click second point · Esc cancel' : 'Click along the horizon · Esc cancel'}
          </span>
        </div>
      </foreignObject>
    </svg>
  )
}
