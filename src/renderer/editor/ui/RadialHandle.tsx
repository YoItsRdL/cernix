import { useRef } from 'react'
import { RotateCw } from 'lucide-react'
import type { RadialMask } from '@/types'

interface RadialHandleProps {
  containerRect: { width: number; height: number }
  imageWidth: number
  imageHeight: number
  mask: RadialMask
  onChange: (next: RadialMask) => void
}

export function RadialHandle({
  containerRect, imageWidth, imageHeight, mask, onChange,
}: RadialHandleProps) {
  const cw = containerRect.width
  const ch = containerRect.height
  const imgAspect = imageWidth && imageHeight ? imageWidth / imageHeight : 1
  const conAspect = cw / ch
  const fitW = imgAspect > conAspect ? cw : ch * imgAspect
  const fitH = imgAspect > conAspect ? cw / imgAspect : ch
  const display = { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }

  const uvToPx = (u: number, v: number) => ({
    x: display.x + u * display.w,
    y: display.y + v * display.h,
  })

  const cPx = uvToPx(mask.cx, mask.cy)
  
  // Real CSS pixel dimensions of the radii
  const rxPx = mask.rx * display.w
  const ryPx = mask.ry * display.h

  // Drag state
  const dragRef = useRef<{
    kind: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'feather'
    startClientX: number
    startClientY: number
    startMask: RadialMask
  } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  const beginDrag = (kind: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'feather', e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { kind, startClientX: e.clientX, startClientY: e.clientY, startMask: { ...mask } }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !svgRef.current) return
    const { kind, startClientX, startClientY, startMask } = dragRef.current
    const dxClient = e.clientX - startClientX
    const dyClient = e.clientY - startClientY
    const du = dxClient / display.w
    const dv = dyClient / display.h

    if (kind === 'center') {
      onChange({ ...startMask, cx: startMask.cx + du, cy: startMask.cy + dv })
    } else if (kind === 'right') {
      onChange({ ...startMask, rx: Math.max(0.01, startMask.rx + du) })
    } else if (kind === 'left') {
      onChange({ ...startMask, rx: Math.max(0.01, startMask.rx - du) })
    } else if (kind === 'bottom') {
      onChange({ ...startMask, ry: Math.max(0.01, startMask.ry + dv) })
    } else if (kind === 'top') {
      onChange({ ...startMask, ry: Math.max(0.01, startMask.ry - dv) })
    } else if (kind === 'feather') {
      // The feather handle is pinned straight above the ellipse's top
      // edge; the radial direction from the center to the handle is
      // therefore (0, -1) in screen coords. Project the drag onto that
      // axis so a drag DOWN (toward the centre) softens the mask. The
      // solid core shrinks, and a drag UP hardens it. One full top-
      // radius of travel maps to the full feather range, which feels
      // natural with the dashed inner ring as a live reference.
      const ryPxStart = startMask.ry * display.h
      if (ryPxStart < 1e-3) return
      const dFeather = dyClient / ryPxStart
      onChange({ ...startMask, feather: Math.max(0, Math.min(1, startMask.feather + dFeather)) })
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    dragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  }

  // The shader fades the mask over `[ (1 - feather) * radius, radius ]`
  // in normalised ellipse distance. The OUTER edge stays at `radii`
  // regardless of feather, and the "100% effect" solid core shrinks
  // inward as feather increases. We draw exactly that: one solid ring
  // at the hard edge, one dashed ring at the solid-core boundary
  // (aspect-preserving per axis, not a uniform offset). No outer
  // dashed ring. The previous version drew one at `r + featherPx`
  // and mis-sold the user on a falloff zone the GPU never renders.
  const solidFactor = Math.max(0, 1 - mask.feather)
  const innerRx = rxPx * solidFactor
  const innerRy = ryPx * solidFactor
  // Fixed gap above the top resize handle so the feather affordance
  // never collides with the shape handles and stays grabbable at
  // feather=0. The ring collapses to the centre at feather=1.
  const featherHandleY = cPx.y - ryPx - 14

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 25 }}>
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <ellipse
          cx={cPx.x} cy={cPx.y} rx={rxPx} ry={ryPx}
          stroke="currentColor" className="text-accent-primary opacity-85" strokeWidth={1.5} fill="none"
          style={{ pointerEvents: 'none' }}
        />
        {mask.feather > 0 && (
          <ellipse
            cx={cPx.x} cy={cPx.y} rx={innerRx} ry={innerRy}
            stroke="currentColor" className="text-accent-primary opacity-40" strokeWidth={1.5} strokeDasharray="5 4" fill="none"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Center handle */}
        <circle
          cx={cPx.x} cy={cPx.y} r={7}
          fill="currentColor" stroke="currentColor" className="text-text-emphatic fill-text-emphatic opacity-80 stroke-scrim-medium" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onPointerDown={(e) => beginDrag('center', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />

        {/* Top/bottom/left/right resize handles */}
        <circle
          cx={cPx.x + rxPx} cy={cPx.y} r={5}
          fill="currentColor" stroke="currentColor" className="text-accent-primary fill-accent-primary opacity-90 stroke-scrim-medium" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'ew-resize' }}
          onPointerDown={(e) => beginDrag('right', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
        <circle
          cx={cPx.x - rxPx} cy={cPx.y} r={5}
          fill="currentColor" stroke="currentColor" className="text-accent-primary fill-accent-primary opacity-90 stroke-scrim-medium" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'ew-resize' }}
          onPointerDown={(e) => beginDrag('left', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
        <circle
          cx={cPx.x} cy={cPx.y + ryPx} r={5}
          fill="currentColor" stroke="currentColor" className="text-accent-primary fill-accent-primary opacity-90 stroke-scrim-medium" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) => beginDrag('bottom', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
        <circle
          cx={cPx.x} cy={cPx.y - ryPx} r={5}
          fill="currentColor" stroke="currentColor" className="text-accent-primary fill-accent-primary opacity-90 stroke-scrim-medium" strokeWidth={1.5}
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) => beginDrag('top', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
        
        {/* Feather handle: fixed offset above the hard edge so it
            stays grabbable regardless of feather value. Drag down
            (toward centre) softens, drag up hardens. */}
        <circle
          cx={cPx.x} cy={featherHandleY} r={5}
          fill="currentColor" stroke="currentColor" className="text-accent-primary stroke-accent-primary fill-scrim-medium opacity-90" strokeWidth={2}
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) => beginDrag('feather', e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      </svg>
      {/* HTML controls (invert toggle) pinned near center handle */}
      <div
        className="absolute flex flex-col items-center pointer-events-none"
        style={{ left: cPx.x + 12, top: cPx.y - 12 }}
      >
        <button /* eslint-disable-line no-restricted-syntax -- design-allow: a canvas overlay handle, positioned over the photograph */
          className="pointer-events-auto flex items-center justify-center w-6 h-6 rounded-full bg-surface-floating shadow border border-border-strong text-text-muted hover:text-text-emphatic hover:bg-surface-panel transition-colors"
          onClick={() => onChange({ ...mask, invert: !mask.invert })}
          title="Invert mask"
        >
          <RotateCw size={12} className={mask.invert ? 'text-accent-primary' : ''} />
        </button>
      </div>
    </div>
  )
}
