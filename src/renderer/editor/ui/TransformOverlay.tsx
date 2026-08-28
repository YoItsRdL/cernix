import { useEffect, useRef, useState } from 'react'
import { Check, X, Undo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IDENTITY_IMAGE_TRANSFORM, type ImageTransform } from '@/../shared/edit-params'
import { screenDeltaToPan, panToScreenDelta } from '../utils/geometry-logic'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

interface TransformOverlayProps {
  baseDisplay: { x: number; y: number; w: number; h: number }
  initial: ImageTransform
  /** Shader rotation in degrees (orientation + straightenDeg). Used to
   *  map screen-space cursor deltas into image-local panX/panY. Without
   *  this, dragging on a 90°/180°/270° image inverts or swaps axes. */
  rotationDeg?: number
  /** Mirror horizontally; flips the X axis when converting screen→image. */
  flipH?: boolean
  onCommit: (next: ImageTransform) => void
  onCancel: () => void
  onChange?: (next: ImageTransform) => void
}

type DragKind = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | null
const HANDLES: Exclude<DragKind, null | 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function TransformOverlay({ baseDisplay, initial, rotationDeg = 0, flipH = false, onCommit, onCancel, onChange }: TransformOverlayProps) {
  const [transform, setTransform] = useState<ImageTransform>(initial)
  const dragRef = useRef<{ kind: Exclude<DragKind, null>; startX: number; startY: number; startTransform: ImageTransform } | null>(null)

  // Sync local state from `initial` when the parent pushes an external
  // change (wheel zoom, keyboard, Shift+C restore). Ignored mid-drag so
  // the live handle position isn't yanked out from under the cursor.
  useEffect(() => {
    if (!dragRef.current) setTransform(initial)
  }, [initial])

  // Forward-map the image-local pan into screen-pixel offsets so the
  // overlay rect tracks the image under rotation. At θ=0 this collapses
  // to the historical `panX*bw, panY*bh` shift.
  const { dxPixel: screenShiftX, dyPixel: screenShiftY } = panToScreenDelta(
    transform.panX, transform.panY,
    rotationDeg, flipH,
    baseDisplay.w, baseDisplay.h, transform.scale,
  )
  const css = {
    x: baseDisplay.x + baseDisplay.w / 2 + screenShiftX - (baseDisplay.w * transform.scale) / 2,
    y: baseDisplay.y + baseDisplay.h / 2 + screenShiftY - (baseDisplay.h * transform.scale) / 2,
    w: baseDisplay.w * transform.scale,
    h: baseDisplay.h * transform.scale,
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === 'Enter')  { e.preventDefault(); onCommit(transform) }
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transform, onCommit, onCancel])

  const beginDrag = (kind: Exclude<DragKind, null>, e: React.PointerEvent) => {
    if (e.button === 1) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startTransform: { ...transform } }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !baseDisplay.w) return
    const { kind, startX, startY, startTransform } = dragRef.current

    if (kind === 'move') {
      const { dpanX, dpanY } = screenDeltaToPan(
        e.clientX - startX, e.clientY - startY,
        rotationDeg, flipH,
        baseDisplay.w, baseDisplay.h, startTransform.scale,
      )
      const next = { ...startTransform, panX: startTransform.panX + dpanX, panY: startTransform.panY + dpanY }
      setTransform(next)
      onChange?.(next)
      return
    }

    // Scale from opposite corner. Screen-space diffs first. Growing the
    // bounding rect always reads the same way on screen regardless of
    // rotation, so the handle→scale relationship stays in screen space.
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const scaleDx = dx / baseDisplay.w
    const scaleDy = dy / baseDisplay.h

    let scaleDiffX = 0
    let scaleDiffY = 0

    if (kind === 'nw') { scaleDiffX = -scaleDx; scaleDiffY = -scaleDy }
    if (kind === 'ne') { scaleDiffX = scaleDx; scaleDiffY = -scaleDy }
    if (kind === 'sw') { scaleDiffX = -scaleDx; scaleDiffY = scaleDy }
    if (kind === 'se') { scaleDiffX = scaleDx; scaleDiffY = scaleDy }
    if (kind === 'n')  { scaleDiffY = -scaleDy }
    if (kind === 's')  { scaleDiffY = scaleDy }
    if (kind === 'w')  { scaleDiffX = -scaleDx }
    if (kind === 'e')  { scaleDiffX = scaleDx }

    // Use max axis diff for uniform aspect ratio scaling
    const scaleDiff = Math.abs(scaleDiffX) > Math.abs(scaleDiffY) ? scaleDiffX : scaleDiffY
    const newScale = Math.max(0.1, startTransform.scale + scaleDiff)

    // Anchor the opposite corner. (dirX, dirY) is the screen-space unit
    // vector pointing from image centre toward the DRAGGED corner; the
    // anchor is the opposite, so the pan shift is dir·ds/2, but in
    // image-local pan coords, which requires rotating the direction
    // through screenDeltaToPan for the same reason the 'move' branch
    // does.
    const dirX = kind.includes('w') ? -1 : (kind.includes('e') ? 1 : 0)
    const dirY = kind.includes('n') ? -1 : (kind.includes('s') ? 1 : 0)
    const halfDs = (newScale - startTransform.scale) / 2
    const { dpanX, dpanY } = screenDeltaToPan(
      dirX * halfDs * baseDisplay.w * startTransform.scale,
      dirY * halfDs * baseDisplay.h * startTransform.scale,
      rotationDeg, flipH,
      baseDisplay.w, baseDisplay.h, startTransform.scale,
    )

    const next = {
      scale: newScale,
      panX: startTransform.panX + dpanX,
      panY: startTransform.panY + dpanY,
    }
    setTransform(next)
    onChange?.(next)
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const isDirty = transform.scale !== 1 || transform.panX !== 0 || transform.panY !== 0

  return (
    <>
      {/* Composition grid: anchored to the DOCUMENT rect (the fixed
          export frame), not the image. Rule-of-thirds lines and the
          centre dot are compositional references; they should stay put
          as the user pans and scales the image underneath. */}
      <div
        className="absolute pointer-events-none"
        style={{ left: baseDisplay.x, top: baseDisplay.y, width: baseDisplay.w, height: baseDisplay.h }}
      >
        {/* design-allow: composition grid requires high contrast fixed alpha values */}
        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-overlay-strong" />
        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-overlay-strong" />
        <div className="absolute top-1/3 left-0 right-0 h-px bg-overlay-strong" />
        <div className="absolute top-2/3 left-0 right-0 h-px bg-overlay-strong" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent-primary" />
      </div>

      <div
        onPointerDown={(e) => beginDrag('move', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        className="absolute border border-accent-primary cursor-move shadow-lg"
        style={{ left: css.x, top: css.y, width: css.w, height: css.h }}
      >
        {HANDLES.map(h => (
          <div
            key={h}
            onPointerDown={(e) => beginDrag(h, e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            className={cn('absolute w-3 h-3 bg-white border border-accent-primary rounded-sm shadow', cursorFor(h), positionFor(h))} // eslint-disable-line no-restricted-syntax -- design-allow: pure-white handle dots sit over arbitrary imagery, visibility is non-negotiable
            style={{ touchAction: 'none' }}
          />
        ))}
      </div>

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-space-1 px-1.5 py-1 rounded-full bg-surface-floating backdrop-blur-md border border-border-strong"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setTransform(IDENTITY_IMAGE_TRANSFORM); onChange?.(IDENTITY_IMAGE_TRANSFORM) }}
          disabled={!isDirty}
          className="h-6 px-space-3 gap-space-1 rounded-full text-body"
        >
          <Undo size={14} /> Reset
        </Button>
        <div className="w-px h-4 bg-border-strong mx-space-1" />
        <IconButton
          icon={<X size={14} />}
          aria-label="Cancel (Esc)"
          onClick={onCancel}
          className="h-6 w-6 rounded-full hover:bg-overlay-active"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => onCommit(transform)}
          className="h-6 px-space-3 gap-space-1 rounded-full text-body ml-space-1"
          title="Commit (Enter)"
        >
          <Check size={14} /> Apply
        </Button>
      </div>
    </>
  )
}

function cursorFor(h: Exclude<DragKind, null | 'move'>): string {
  switch (h) {
    case 'nw': case 'se': return 'cursor-nwse-resize'
    case 'ne': case 'sw': return 'cursor-nesw-resize'
    case 'n':  case 's':  return 'cursor-ns-resize'
    case 'e':  case 'w':  return 'cursor-ew-resize'
    default: return ''
  }
}

function positionFor(h: Exclude<DragKind, null | 'move'>): string {
  switch (h) {
    case 'nw': return '-left-1.5 -top-1.5'
    case 'n':  return 'left-1/2 -translate-x-1/2 -top-1.5'
    case 'ne': return '-right-1.5 -top-1.5'
    case 'e':  return '-right-1.5 top-1/2 -translate-y-1/2'
    case 'se': return '-right-1.5 -bottom-1.5'
    case 's':  return 'left-1/2 -translate-x-1/2 -bottom-1.5'
    case 'sw': return '-left-1.5 -bottom-1.5'
    case 'w':  return '-left-1.5 top-1/2 -translate-y-1/2'
    default: return ''
  }
}
