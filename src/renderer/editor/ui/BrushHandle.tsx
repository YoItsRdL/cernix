import { useRef, useState } from 'react'
import type { BrushMask, BrushStroke } from '@/types'

interface BrushHandleProps {
  containerRect: { width: number; height: number }
  imageWidth: number
  imageHeight: number
  mask: BrushMask
  /** Per-paint brush settings sourced from the parent MaskPanel. */
  settings: {
    radius: number    // 0..1, fraction of long edge
    hardness: number  // 0..1
    opacity: number   // 0..1
    mode: 'paint' | 'erase'
  }
  onChange: (next: BrushMask) => void
}

/**
 * Canvas overlay that captures pointer-driven brush strokes for the
 * selected brush mask. Strokes are stored as polylines in normalised
 * image UV; the rasteriser in the pipeline expands them into bitmaps
 * at render time. The overlay itself draws nothing. Feedback comes
 * from the rendered preview that updates as the stroke commits.
 */
export function BrushHandle({
  containerRect, imageWidth, imageHeight, mask, settings, onChange,
}: BrushHandleProps) {
  const cw = containerRect.width
  const ch = containerRect.height
  const imgAspect = imageWidth && imageHeight ? imageWidth / imageHeight : 1
  const conAspect = cw / ch
  const fitW = imgAspect > conAspect ? cw : ch * imgAspect
  const fitH = imgAspect > conAspect ? cw / imgAspect : ch
  const display = { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }

  /** Capture state for the in-progress stroke. Lives in a ref so
   *  every pointermove gets the latest accumulated points without
   *  triggering a re-render per sample. We push the committed mask
   *  on pointerup. */
  const drawingRef = useRef<{
    points: { x: number; y: number }[]
    settings: BrushHandleProps['settings']
  } | null>(null)

  const screenToUv = (clientX: number, clientY: number, hostRect: DOMRect): { x: number; y: number } | null => {
    const localX = clientX - hostRect.left
    const localY = clientY - hostRect.top
    // Reject points that fall outside the displayed image rect. The
    // rasteriser only knows about [0..1] image space.
    if (localX < display.x || localX > display.x + display.w) return null
    if (localY < display.y || localY > display.y + display.h) return null
    return {
      x: (localX - display.x) / display.w,
      y: (localY - display.y) / display.h,
    }
  }

  const beginStroke = (e: React.PointerEvent) => {
    e.preventDefault()
    const host = e.currentTarget as HTMLDivElement
    host.setPointerCapture(e.pointerId)
    const rect = host.getBoundingClientRect()
    const pt = screenToUv(e.clientX, e.clientY, rect)
    if (!pt) return
    drawingRef.current = { points: [pt], settings: { ...settings } }
    // Eagerly commit a single-point stamp so the user sees a dot on
    // a click without a drag.
    commit()
  }

  const extendStroke = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const host = e.currentTarget as HTMLDivElement
    const rect = host.getBoundingClientRect()
    const pt = screenToUv(e.clientX, e.clientY, rect)
    if (!pt) return
    const last = drawingRef.current.points[drawingRef.current.points.length - 1]
    // Skip subpixel duplicates so the stroke list stays compact.
    if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < 0.001) return
    drawingRef.current.points.push(pt)
    commit()
  }

  const endStroke = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    drawingRef.current = null
    const host = e.currentTarget as HTMLDivElement
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
  }

  /** Push the in-progress stroke into the mask. We replace the LAST
   *  stroke entry on every commit so live drag feedback stays smooth
   *  without ballooning the mask history. */
  const commit = () => {
    if (!drawingRef.current) return
    const live: BrushStroke = {
      points: drawingRef.current.points.map(p => ({ ...p })),
      radius: drawingRef.current.settings.radius,
      hardness: drawingRef.current.settings.hardness,
      opacity: drawingRef.current.settings.opacity,
      mode: drawingRef.current.settings.mode,
    }
    // Detect whether the last existing stroke is one we authored
    // during this drag (same mode + settings + a point continuation):
    // if so, replace it instead of appending. We tag in-progress
    // strokes by reference equality on a sentinel here.
    const prevStrokes = mask.strokes
    // Heuristic: if the last stroke shares the SAME first point as the
    // current drag, treat it as the in-progress one and replace.
    const lastStroke = prevStrokes[prevStrokes.length - 1]
    const same = lastStroke
      && lastStroke.mode === live.mode
      && lastStroke.points.length > 0
      && live.points.length > 0
      && lastStroke.points[0].x === live.points[0].x
      && lastStroke.points[0].y === live.points[0].y
    const next = same
      ? [...prevStrokes.slice(0, -1), live]
      : [...prevStrokes, live]
    onChange({ strokes: next })
  }

  // Brush-size preview. A thin ring at the actual brush radius. Same
  // visual idiom as Select Subject's outline, so the user sees the
  // brush footprint while tweaking the Size / Hardness / Opacity
  // sliders, not just while painting. Defaults to the canvas centre so
  // it stays visible when the pointer is over the right-panel sliders,
  // and snaps to the pointer when the user moves back over the image.
  // Pointer-events stay off the SVG so it can't interfere with stroke
  // capture.
  //
  // `hovered` is the live pointer position OR null when off-canvas.
  // The fallback `centre` is recomputed every render so it tracks
  // window resizes / image swaps without needing an effect.
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null)
  const centre = { x: display.x + display.w / 2, y: display.y + display.h / 2 }
  const cursor = hovered ?? centre
  const cursorRadius = settings.radius * Math.max(display.w, display.h)
  const trackCursor = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const lx = e.clientX - rect.left
    const ly = e.clientY - rect.top
    if (lx < display.x || lx > display.x + display.w
     || ly < display.y || ly > display.y + display.h) {
      if (hovered) setHovered(null)
      return
    }
    setHovered({ x: lx, y: ly })
  }

  return (
    <div
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 25, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={(e) => { trackCursor(e); beginStroke(e) }}
      onPointerMove={(e) => { trackCursor(e); extendStroke(e) }}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={() => setHovered(null)}
    >
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        width={cw}
        height={ch}
      >
        {/* White outer + brand-blue inner stroke: the white keeps the
            ring visible on any photo background. */}
        <circle
          cx={cursor.x}
          cy={cursor.y}
          r={Math.max(4, cursorRadius)}
          fill="none"
          stroke="white"
          strokeWidth={2}
          opacity={0.9}
        />
        <circle
          cx={cursor.x}
          cy={cursor.y}
          r={Math.max(4, cursorRadius)}
          fill="none"
          stroke="#0077ff" // eslint-disable-line no-restricted-syntax -- design-allow: brush cursor ring, editor affordance hardcoded for visibility over arbitrary canvas pixels
          strokeWidth={1.5}
        />
      </svg>
    </div>
  )
}
