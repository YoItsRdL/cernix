import { useRef } from 'react'
import type { HealSpot } from '@/types'

interface HealHandleProps {
  containerRect: { width: number; height: number }
  imageWidth: number
  imageHeight: number
  spots: HealSpot[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (next: HealSpot[]) => void
}

/**
 * Canvas overlay for spot heal / clone. Each spot renders as two
 * circles connected by a line: the destination (solid) and the source
 * (dashed). Both are draggable. Clicking the destination selects the
 * spot. Clicking on empty canvas creates a new spot at that point with
 * the source auto-offset to a sensible neighbour.
 */
export function HealHandle({
  containerRect, imageWidth, imageHeight, spots, selectedId, onSelect, onChange,
}: HealHandleProps) {
  const cw = containerRect.width
  const ch = containerRect.height
  const imgAspect = imageWidth && imageHeight ? imageWidth / imageHeight : 1
  const conAspect = cw / ch
  const fitW = imgAspect > conAspect ? cw : ch * imgAspect
  const fitH = imgAspect > conAspect ? cw / imgAspect : ch
  const display = { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }

  const longEdgePx = Math.max(display.w, display.h)

  const uvToPx = (u: number, v: number) => ({
    x: display.x + u * display.w,
    y: display.y + v * display.h,
  })

  const screenToUv = (clientX: number, clientY: number, hostRect: DOMRect): { x: number; y: number } | null => {
    const localX = clientX - hostRect.left
    const localY = clientY - hostRect.top
    if (localX < display.x || localX > display.x + display.w) return null
    if (localY < display.y || localY > display.y + display.h) return null
    return {
      x: (localX - display.x) / display.w,
      y: (localY - display.y) / display.h,
    }
  }

  const dragRef = useRef<{
    spotId: string
    handle: 'dest' | 'src'
    startClientX: number
    startClientY: number
    startSpot: HealSpot
  } | null>(null)

  const beginDrag = (spotId: string, handle: 'dest' | 'src', e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const spot = spots.find(s => s.id === spotId)
    if (!spot) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { spotId, handle, startClientX: e.clientX, startClientY: e.clientY, startSpot: { ...spot } }
    onSelect(spotId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { spotId, handle, startClientX, startClientY, startSpot } = dragRef.current
    const du = (e.clientX - startClientX) / display.w
    const dv = (e.clientY - startClientY) / display.h
    onChange(spots.map(s => {
      if (s.id !== spotId) return s
      if (handle === 'dest') {
        return {
          ...s,
          destX: clamp01(startSpot.destX + du),
          destY: clamp01(startSpot.destY + dv),
        }
      }
      return {
        ...s,
        srcX: clamp01(startSpot.srcX + du),
        srcY: clamp01(startSpot.srcY + dv),
      }
    }))
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId)
    }
  }

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    // Reaches here only if no spot handle captured the event.
    const host = e.currentTarget as HTMLDivElement
    const rect = host.getBoundingClientRect()
    const pt = screenToUv(e.clientX, e.clientY, rect)
    if (!pt) return
    const radius = 0.04
    // Auto-pick the source by offsetting horizontally; flip toward the
    // image centre when the destination is near the right edge so the
    // source stays on-canvas.
    const offset = radius * 3
    const srcX = pt.x > 0.5 ? clamp01(pt.x - offset) : clamp01(pt.x + offset)
    const next: HealSpot = {
      id: makeId(),
      destX: pt.x,
      destY: pt.y,
      srcX,
      srcY: pt.y,
      radius,
      feather: 0.5,
      opacity: 1,
      mode: 'heal',
    }
    onChange([...spots, next])
    onSelect(next.id)
  }

  return (
    <div
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 25, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" width={cw} height={ch}>
        {spots.map((s) => {
          const dest = uvToPx(s.destX, s.destY)
          const src  = uvToPx(s.srcX, s.srcY)
          const rPx = s.radius * longEdgePx
          const isSelected = s.id === selectedId
          const stroke = isSelected ? '#fff' : 'rgba(255,255,255,0.7)' // eslint-disable-line no-restricted-syntax -- design-allow: heal source/dest stroke, editor tool handle on arbitrary imagery
          const strokeW = isSelected ? 2 : 1.5
          return (
            <g key={s.id}>
              <line
                x1={dest.x} y1={dest.y} x2={src.x} y2={src.y}
                stroke={stroke} strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
              />
              <circle
                cx={src.x} cy={src.y} r={rPx}
                fill="none" stroke={stroke} strokeWidth={strokeW} strokeDasharray="4 3"
                style={{ pointerEvents: 'all', cursor: 'grab' }}
                onPointerDown={(e) => beginDrag(s.id, 'src', e)}
              />
              <circle
                cx={dest.x} cy={dest.y} r={rPx}
                fill="none" stroke={stroke} strokeWidth={strokeW}
                style={{ pointerEvents: 'all', cursor: 'grab' }}
                onPointerDown={(e) => beginDrag(s.id, 'dest', e)}
              />
              <circle
                cx={dest.x} cy={dest.y} r={3}
                fill={stroke}
                style={{ pointerEvents: 'all' }}
                onPointerDown={(e) => beginDrag(s.id, 'dest', e)}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}
