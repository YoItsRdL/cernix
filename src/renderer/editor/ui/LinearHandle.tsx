import { useRef } from 'react'
import type { LinearMask } from '@/types'

interface LinearHandleProps {
  /** Container (canvas) dimensions in CSS pixels. */
  containerRect: { width: number; height: number }
  /** Native source image dimensions: drives the aspect-fit display rect. */
  imageWidth: number
  imageHeight: number
  mask: LinearMask
  onChange: (next: LinearMask) => void
}

/**
 * SVG overlay for the linear-gradient mask drag handles.
 *
 * Renders two parallel dashed lines (start = full effect, end = zero effect)
 * perpendicular to the gradient direction, each with a center drag handle.
 * A mid-point handle rotates/repositions the filter as a whole.
 *
 * All positions are kept in normalized UV coords [0..1] (matching the mask
 * stored in EditParams). The display rect mirrors the CropOverlay's
 * computeBaseScale approach so handles stay glued to the image.
 */
export function LinearHandle({
  containerRect, imageWidth, imageHeight, mask, onChange,
}: LinearHandleProps) {
  // Display rect: fit image into container, same math as CropOverlay and the
  // WebGL baseScale. Handles are always aligned with the rendered image.
  const cw = containerRect.width
  const ch = containerRect.height
  const imgAspect = imageWidth && imageHeight ? imageWidth / imageHeight : 1
  const conAspect = cw / ch
  const fitW = imgAspect > conAspect ? cw : ch * imgAspect
  const fitH = imgAspect > conAspect ? cw / imgAspect : ch
  const display = { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }

  // UV → CSS pixel (within the SVG / container coordinate system).
  const uvToPx = (u: number, v: number) => ({
    x: display.x + u * display.w,
    y: display.y + v * display.h,
  })

  const startPx = uvToPx(mask.startX, mask.startY)
  const endPx   = uvToPx(mask.endX,   mask.endY)

  // Direction vector of the gradient (start → end).
  const dx = endPx.x - startPx.x
  const dy = endPx.y - startPx.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular unit vector (to draw the line).
  const px = -dy / len
  const py =  dx / len
  // Half-length of the visible line: span across the full container diagonal.
  const halfLen = Math.hypot(cw, ch) / 2

  // Drag state: which handle is active and where it started.
  const dragRef = useRef<{
    kind: 'start' | 'end' | 'mid'
    startClientX: number
    startClientY: number
    startMask: LinearMask
  } | null>(null)

  // Keep a ref to the SVG so we can get the element's bounding rect on moves.
  const svgRef = useRef<SVGSVGElement>(null)

  const beginDrag = (kind: 'start' | 'end' | 'mid', e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { kind, startClientX: e.clientX, startClientY: e.clientY, startMask: { ...mask } }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !svgRef.current) return
    const { kind, startClientX, startClientY, startMask } = dragRef.current
    // Convert client-space delta to UV delta.
    const svgRect = svgRef.current.getBoundingClientRect()
    const dxClient = e.clientX - startClientX
    const dyClient = e.clientY - startClientY
    const du = dxClient / display.w
    const dv = dyClient / display.h

    if (kind === 'start') {
      onChange({ ...startMask, startX: startMask.startX + du, startY: startMask.startY + dv })
    } else if (kind === 'end') {
      onChange({ ...startMask, endX: startMask.endX + du, endY: startMask.endY + dv })
    } else {
      // Mid: translate both handles together.
      onChange({
        startX: startMask.startX + du,
        startY: startMask.startY + dv,
        endX:   startMask.endX   + du,
        endY:   startMask.endY   + dv,
      })
    }
    void svgRect // referenced to suppress exhaustive-deps warning
  }

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  }

  // Mid-point between start and end handles (for the translation handle).
  const midPx = { x: (startPx.x + endPx.x) / 2, y: (startPx.y + endPx.y) / 2 }

  const lineProps = {
    stroke: 'currentColor',
    className: 'text-accent-primary opacity-85',
    strokeWidth: 1.5,
    onPointerMove,
    onPointerUp: endDrag,
  }

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 25 }}
    >
      {/* Start line (mask = 1.0 / full effect): solid */}
      <line
        {...lineProps}
        style={{ pointerEvents: 'none' }}
        x1={startPx.x + px * halfLen} y1={startPx.y + py * halfLen}
        x2={startPx.x - px * halfLen} y2={startPx.y - py * halfLen}
      />
      {/* End line (mask = 0.0 / no effect): dashed */}
      <line
        {...lineProps}
        className="text-accent-primary opacity-40"
        style={{ pointerEvents: 'none' }}
        strokeDasharray="5 4"
        x1={endPx.x + px * halfLen} y1={endPx.y + py * halfLen}
        x2={endPx.x - px * halfLen} y2={endPx.y - py * halfLen}
      />
      {/* Connector line between the two center handles */}
      <line
        style={{ pointerEvents: 'none' }}
        x1={startPx.x} y1={startPx.y}
        x2={endPx.x}   y2={endPx.y}
        stroke="currentColor"
        className="text-accent-primary opacity-40"
        strokeWidth={1}
        strokeDasharray="2 3"
      />

      {/* Start center handle (solid circle = full-effect line) */}
      <circle
        cx={startPx.x} cy={startPx.y} r={7}
        fill="currentColor"
        stroke="currentColor"
        className="text-accent-primary fill-accent-primary opacity-90 stroke-scrim-medium"
        strokeWidth={1.5}
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onPointerDown={(e) => beginDrag('start', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      />
      <line
        style={{ pointerEvents: 'none' }}
        x1={startPx.x - 4} y1={startPx.y}
        x2={startPx.x + 4} y2={startPx.y}
        stroke="currentColor" className="text-black opacity-50" strokeWidth={1.5} // eslint-disable-line no-restricted-syntax -- design-allow: black SVG cross marker for readability over arbitrary imagery
      />
      <line
        style={{ pointerEvents: 'none' }}
        x1={startPx.x} y1={startPx.y - 4}
        x2={startPx.x} y2={startPx.y + 4}
        stroke="currentColor" className="text-black opacity-50" strokeWidth={1.5} // eslint-disable-line no-restricted-syntax -- design-allow: black SVG cross marker for readability over arbitrary imagery
      />

      {/* Mid handle (translate both) */}
      <circle
        cx={midPx.x} cy={midPx.y} r={5}
        fill="currentColor" stroke="currentColor"
        className="text-text-emphatic fill-text-emphatic opacity-80 stroke-scrim-medium"
        strokeWidth={1.5}
        style={{ pointerEvents: 'all', cursor: 'grab' }}
        onPointerDown={(e) => beginDrag('mid', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      />

      {/* End center handle (open circle = zero-effect line) */}
      <circle
        cx={endPx.x} cy={endPx.y} r={7}
        fill="currentColor" stroke="currentColor"
        className="text-accent-primary stroke-accent-primary fill-scrim-medium opacity-90"
        strokeWidth={2}
        style={{ pointerEvents: 'all', cursor: 'move' }}
        onPointerDown={(e) => beginDrag('end', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
      />

      {/* Label badges */}
      <text x={startPx.x + px * 18 + 6} y={startPx.y + py * 18 + 4}
        fill="currentColor"
        className="font-mono text-caption text-accent-primary opacity-90"
        style={{ pointerEvents: 'none', userSelect: 'none' }}>100%</text>
      <text x={endPx.x + px * 18 + 6} y={endPx.y + py * 18 + 4}
        fill="currentColor"
        className="font-mono text-caption text-accent-primary opacity-60"
        style={{ pointerEvents: 'none', userSelect: 'none' }}>0%</text>
    </svg>
  )
}
