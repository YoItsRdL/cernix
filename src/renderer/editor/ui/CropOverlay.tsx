import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn, clamp01 } from '@/lib/utils'
import { ASPECT_PRESETS, FULL_FRAME_CROP } from '@/../shared/edit-params'
import type { CropRect } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

// ── Crop overlays ──
//
// Lightroom-style compositional grids on the crop frame. The user
// cycles through overlays with the O key. Identity ("off") renders
// nothing; every other overlay is pure SVG inside the crop frame's
// pointer-events-none guide layer, so it never interferes with drag.
//
// Persistence: stored in localStorage rather than EditParams.
// Overlays are a viewer / workspace concern, not a per-photo edit.
// One choice survives across photos and reloads.
// Spiral overlay. Golden-spiral approximation that
// tightens into one of the four corners. Within the spiral overlay,
// Shift+O cycles the four orientations; standard O still moves to
// the next overlay kind. The spiral's path is drawn against a
// 100×100 viewBox with preserveAspectRatio="none", so non-golden
// crops distort the curve. This matches LR Classic's behaviour
// (LR also stretches the spiral instead of recomputing it per crop).
const OVERLAY_KINDS = ['thirds', 'phi', 'diagonal', 'triangle', 'spiral', 'off'] as const
type CropOverlayKind = (typeof OVERLAY_KINDS)[number]
const OVERLAY_STORAGE_KEY = 'cernix.editor.cropOverlay'

const SPIRAL_ORIENTATIONS = ['br', 'bl', 'tl', 'tr'] as const
type SpiralOrientation = (typeof SPIRAL_ORIENTATIONS)[number]
const SPIRAL_ORIENTATION_KEY = 'cernix.editor.spiralOrientation'

function loadOverlayKind(): CropOverlayKind {
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_KEY)
    if (raw && (OVERLAY_KINDS as readonly string[]).includes(raw)) {
      return raw as CropOverlayKind
    }
  } catch { /* private mode / quota: fall through */ }
  return 'thirds'
}

function persistOverlayKind(kind: CropOverlayKind): void {
  try { localStorage.setItem(OVERLAY_STORAGE_KEY, kind) } catch { /* ignore */ }
}

function loadSpiralOrientation(): SpiralOrientation {
  try {
    const raw = localStorage.getItem(SPIRAL_ORIENTATION_KEY)
    if (raw && (SPIRAL_ORIENTATIONS as readonly string[]).includes(raw)) {
      return raw as SpiralOrientation
    }
  } catch { /* fall through */ }
  return 'br'
}

function persistSpiralOrientation(o: SpiralOrientation): void {
  try { localStorage.setItem(SPIRAL_ORIENTATION_KEY, o) } catch { /* ignore */ }
}

interface CropOverlayProps {
  /** Container DOM rect in CSS pixels (the canvas's bounding rect). */
  containerRect: { width: number; height: number }
  /** Native source image dimensions (used to keep aspect-ratio math correct). */
  imageWidth: number
  imageHeight: number
  /** Scale factor applied to the fit-to-canvas display rect. 1 = fill, <1 = inset. */
  displayZoom?: number
  initial: CropRect
  onCommit: (next: CropRect) => void
  onCancel: () => void
}

type DragKind = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null

const HANDLES: Exclude<DragKind, null | 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function CropOverlay({ containerRect, imageWidth, imageHeight, displayZoom = 1, initial, onCommit, onCancel }: CropOverlayProps) {
  // Crop rect lives in normalized [0..1] *source-image* coordinates.
  const [rect, setRect] = useState<CropRect>(initial)
  const imageAspect = imageWidth && imageHeight ? imageWidth / imageHeight : 1
  // Light a preset pill on open if the loaded crop already matches one, so
  // the toolbar reflects the rect rather than always defaulting to "Free".
  const [aspectIdx, setAspectIdx] = useState(() => detectPreset(initial, imageAspect))
  const aspectRatio = ASPECT_PRESETS[aspectIdx].ratio

  const pickAspect = (i: number) => {
    setAspectIdx(i)
    const ratio = ASPECT_PRESETS[i].ratio
    if (ratio == null) return
    setRect(prev => fitAspect(prev, ratio, imageAspect))
  }
  const dragRef = useRef<{ kind: Exclude<DragKind, null>; startX: number; startY: number; startRect: CropRect } | null>(null)

  // Map the source image into the container preserving aspect ratio (the
  // same fit-to-canvas math the WebGL preview uses when zoom = 1).
  const display = useMemo(() => {
    const cw = containerRect.width
    const ch = containerRect.height
    if (!cw || !ch || !imageWidth || !imageHeight) return { x: 0, y: 0, w: cw, h: ch }
    const imgAspect = imageWidth / imageHeight
    const conAspect = cw / ch
    const fitW = imgAspect > conAspect ? cw : ch * imgAspect
    const fitH = imgAspect > conAspect ? cw / imgAspect : ch
    const w = fitW * displayZoom
    const h = fitH * displayZoom
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
  }, [containerRect, imageWidth, imageHeight, displayZoom])

  // CSS-pixel rect of the crop box (relative to the container's top-left).
  const css = {
    x: display.x + rect.x * display.w,
    y: display.y + rect.y * display.h,
    w: rect.w * display.w,
    h: rect.h * display.h,
  }

  // Compositional overlay. Persisted across the session;
  // O cycles through the available kinds (Lightroom's binding).
  // Shift+O within the spiral overlay cycles the four orientations:
  // when a non-spiral overlay is active, Shift+O is
  // a no-op rather than fighting the regular O cycle.
  const [overlayKind, setOverlayKind] = useState<CropOverlayKind>(loadOverlayKind)
  const [spiralOrientation, setSpiralOrientation] = useState<SpiralOrientation>(loadSpiralOrientation)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === 'Enter')  { e.preventDefault(); onCommit(rect); return }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        if (e.shiftKey) {
          // Shift+O. Only meaningful while the spiral is active.
          // Cycle through the four corner orientations.
          setOverlayKind(prevKind => {
            if (prevKind !== 'spiral') return prevKind
            setSpiralOrientation(prevO => {
              const next = SPIRAL_ORIENTATIONS[(SPIRAL_ORIENTATIONS.indexOf(prevO) + 1) % SPIRAL_ORIENTATIONS.length]
              persistSpiralOrientation(next)
              return next
            })
            return prevKind
          })
          return
        }
        setOverlayKind(prev => {
          const next = OVERLAY_KINDS[(OVERLAY_KINDS.indexOf(prev) + 1) % OVERLAY_KINDS.length]
          persistOverlayKind(next)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rect, onCommit, onCancel])

  const beginDrag = (kind: Exclude<DragKind, null>, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startRect: { ...rect } }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { kind, startX, startY, startRect } = dragRef.current
    const dxNorm = (e.clientX - startX) / display.w
    const dyNorm = (e.clientY - startY) / display.h
    setRect(applyDrag(kind, startRect, dxNorm, dyNorm, aspectRatio, imageAspect))
  }

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const isDirty = rect.x !== initial.x || rect.y !== initial.y || rect.w !== initial.w || rect.h !== initial.h

  return (
    <>
      {/* Dim mask: four absolute rects around the crop rect. Uses
          surface-overlay at 60% so the crop region reads as the live
          zone and the rest visibly recedes. */}
      <div className="absolute pointer-events-none bg-surface-overlay/60" style={{ left: 0, top: 0, width: containerRect.width, height: Math.max(0, css.y) }} />
      <div className="absolute pointer-events-none bg-surface-overlay/60" style={{ left: 0, top: css.y + css.h, width: containerRect.width, height: Math.max(0, containerRect.height - (css.y + css.h)) }} />
      <div className="absolute pointer-events-none bg-surface-overlay/60" style={{ left: 0, top: css.y, width: Math.max(0, css.x), height: css.h }} />
      <div className="absolute pointer-events-none bg-surface-overlay/60" style={{ left: css.x + css.w, top: css.y, width: Math.max(0, containerRect.width - (css.x + css.w)), height: css.h }} />

      {/* Crop frame + interior drag-to-move */}
      <div
        onPointerDown={(e) => beginDrag('move', e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        className="absolute border-2 border-text-emphatic cursor-move shadow"
        style={{ left: css.x, top: css.y, width: css.w, height: css.h }}
      >
        {/* Compositional overlay: driven by the O hotkey cycle. The
            grid layer is pointer-events-none so the underlying
            move-drag still receives the mouse. */}
        <CropGuides kind={overlayKind} spiralOrientation={spiralOrientation} />
        {/* Handles */}
        {HANDLES.map(h => (
          <div
            key={h}
            onPointerDown={(e) => beginDrag(h, e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            className={cn('absolute w-4 h-4 bg-text-emphatic border-2 border-surface-workspace shadow', cursorFor(h), positionFor(h))}
            style={{ touchAction: 'none' }}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-space-1 px-1.5 py-1 rounded-full bg-surface-floating backdrop-blur-md border border-border-strong"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {ASPECT_PRESETS.map((p, i) => (
          <Button
            key={p.label}
            variant={aspectIdx === i ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => pickAspect(i)}
            className="h-6 px-space-3 text-body rounded-full"
          >{p.label}</Button>
        ))}
        <div className="w-px h-4 bg-border-strong mx-space-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRect(FULL_FRAME_CROP)}
          disabled={!isDirty}
          className="h-6 px-space-3 text-body rounded-full"
        >Reset</Button>
        <div className="w-px h-4 bg-border-strong mx-space-1" />
        <IconButton
          icon={<X size={14} />}
          aria-label="Cancel (Esc)"
          onClick={onCancel}
          className="h-6 w-6 rounded-full"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => onCommit(rect)}
          className="h-6 px-space-3 gap-space-1 text-body rounded-full"
          title="Commit (Enter)"
        ><Check size={14} /> Apply</Button>
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
  }
}

function positionFor(h: Exclude<DragKind, null | 'move'>): string {
  switch (h) {
    case 'nw': return '-left-2 -top-2'
    case 'n':  return 'left-1/2 -translate-x-1/2 -top-2'
    case 'ne': return '-right-2 -top-2'
    case 'e':  return '-right-2 top-1/2 -translate-y-1/2'
    case 'se': return '-right-2 -bottom-2'
    case 's':  return 'left-1/2 -translate-x-1/2 -bottom-2'
    case 'sw': return '-left-2 -bottom-2'
    case 'w':  return '-left-2 top-1/2 -translate-y-1/2'
  }
}

// ── Compositional overlay renderer ──
//
// Pure SVG inside a 100%×100% absolutely-positioned layer. We use a
// `viewBox="0 0 100 100"` so all guide math is in percent space and
// independent of the crop frame's actual pixel dimensions. The frame's
// aspect ratio still distorts diagonal/triangle/spiral geometry (their
// "true" form is square-cropped), which matches Lightroom. The spiral
// in LR is also drawn relative to the crop box, not pixel-square.
//
// stroke="white"/0.55 + a darker shadow stroke at 1.5× width keeps
// the lines legible over both bright and dark images. SVG handles the
// full draw. No canvas, no JS-side rendering.
const GUIDE_FILL = 'rgba(255, 255, 255, 0.55)'                              // design-allow
const GUIDE_SHADOW = 'rgba(0, 0, 0, 0.45)'                                  // design-allow

interface CropGuidesProps {
  kind: CropOverlayKind
  spiralOrientation: SpiralOrientation
}

function CropGuides({ kind, spiralOrientation }: CropGuidesProps) {
  if (kind === 'off') return null
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {/* Drop-shadow stroke: drawn first, slightly thicker, dark.
          The light stroke draws on top to read against bright zones. */}
      <g stroke={GUIDE_SHADOW} strokeWidth="0.45" fill="none" vectorEffect="non-scaling-stroke">
        <GuidePaths kind={kind} spiralOrientation={spiralOrientation} />
      </g>
      <g stroke={GUIDE_FILL} strokeWidth="0.3" fill="none" vectorEffect="non-scaling-stroke">
        <GuidePaths kind={kind} spiralOrientation={spiralOrientation} />
      </g>
      {/* Centre marker: small dot, only on the grid-style overlays
          where it reads as a focus point rather than visual noise. */}
      {(kind === 'thirds' || kind === 'phi') && (
        <circle cx="50" cy="50" r="0.7" fill={GUIDE_FILL} stroke={GUIDE_SHADOW} strokeWidth="0.2" />
      )}
    </svg>
  )
}

// Phi divisions. The long arm of the golden ratio puts the cross
// lines at 38.2% and 61.8% rather than the 33.3% / 66.7% of thirds.
const PHI = (1 + Math.sqrt(5)) / 2
const PHI_LO = 100 / (1 + PHI)        // ≈ 38.20
const PHI_HI = 100 - PHI_LO           // ≈ 61.80

function GuidePaths({ kind, spiralOrientation }: {
  kind: Exclude<CropOverlayKind, 'off'>
  spiralOrientation: SpiralOrientation
}) {
  if (kind === 'thirds') {
    return (
      <>
        <line x1="33.333" y1="0" x2="33.333" y2="100" />
        <line x1="66.667" y1="0" x2="66.667" y2="100" />
        <line x1="0" y1="33.333" x2="100" y2="33.333" />
        <line x1="0" y1="66.667" x2="100" y2="66.667" />
      </>
    )
  }
  if (kind === 'phi') {
    return (
      <>
        <line x1={PHI_LO} y1="0" x2={PHI_LO} y2="100" />
        <line x1={PHI_HI} y1="0" x2={PHI_HI} y2="100" />
        <line x1="0" y1={PHI_LO} x2="100" y2={PHI_LO} />
        <line x1="0" y1={PHI_HI} x2="100" y2={PHI_HI} />
      </>
    )
  }
  if (kind === 'diagonal') {
    // Two diagonals from corner to corner. Each cuts the frame into
    // two equal-area triangles. The classic 45° guide is what the
    // Renaissance painters used to anchor compositions on the
    // diagonals of the canvas.
    return (
      <>
        <line x1="0" y1="0" x2="100" y2="100" />
        <line x1="100" y1="0" x2="0" y2="100" />
      </>
    )
  }
  if (kind === 'triangle') {
    // Classical "armature". Main diagonal, plus two perpendiculars
    // dropped from the opposite corners onto it. Where the perps
    // meet the main diagonal are the natural focal points of a
    // triangular composition.
    //
    // Corner perpendiculars hit the main diagonal at (0.5, 0.5)?
    // No. For a perpendicular from (1,0) onto the y=x line, the
    // foot is at (0.5, 0.5). Same for (0,1). Both perps overlap,
    // so we instead draw perps from the corners into the main
    // diagonal at their nearest right-angle intersection, which
    // for a square is the centre. We extend them past the centre
    // to the opposite edges so the armature reads visually.
    return (
      <>
        <line x1="0" y1="0" x2="100" y2="100" />
        <line x1="100" y1="0" x2="50" y2="50" />
        <line x1="0" y1="100" x2="50" y2="50" />
      </>
    )
  }
  if (kind === 'spiral') {
    // Fibonacci spiral approximation. Four nested quarter-arcs whose
    // radii decrease by 1/φ each step. The base path tightens into
    // the bottom-right corner; the orientation transform mirrors it
    // into the other three corners (Shift+O cycle).
    //
    // The spiral is drawn against the 100×100 viewBox; the SVG's
    // `preserveAspectRatio="none"` stretches it onto whatever crop
    // ratio the user picks. Distortion on non-golden ratios matches
    // Lightroom Classic's behaviour. LR also draws the spiral
    // pre-stretched rather than recomputing per crop.
    return (
      <g transform={SPIRAL_TRANSFORMS[spiralOrientation]}>
        <path d={SPIRAL_PATH_BR} />
      </g>
    )
  }
  return null
}

/** Base spiral path that tightens into the bottom-right corner.
 *  Four quarter-arcs scaled by 1/φ each step. The orientation
 *  transforms (below) flip this into the other three corners. */
const SPIRAL_PATH_BR =
  'M 0 0 ' +
  'A 100 100 0 0 1 100 100 ' +   // outer arc: TL → BR via the bottom-left
  'A 61.8 61.8 0 0 1 100 38.2 ' + // tighten one step
  'A 38.2 38.2 0 0 1 61.8 38.2 ' +
  'A 23.6 23.6 0 0 1 61.8 61.8'

/** SVG transforms that flip SPIRAL_PATH_BR into each of the four
 *  corners. `scale(-1, 1) translate(-100, 0)` mirrors horizontally
 *  about x=50 within the 100-unit viewBox; the `tl` orientation is
 *  the both-axes mirror. */
const SPIRAL_TRANSFORMS: Record<SpiralOrientation, string> = {
  br: 'translate(0, 0)',
  bl: 'translate(100, 0) scale(-1, 1)',
  tr: 'translate(0, 100) scale(1, -1)',
  tl: 'translate(100, 100) scale(-1, -1)',
}

/**
 * Return the index of the aspect preset whose ratio matches the rect's
 * displayed aspect (within a small tolerance), or 0 (Free) if none do.
 */
function detectPreset(rect: CropRect, imageAspect: number): number {
  if (rect.w <= 0 || rect.h <= 0) return 0
  const rectAspect = (rect.w * imageAspect) / rect.h
  const tol = 0.01
  for (let i = 1; i < ASPECT_PRESETS.length; i++) {
    const r = ASPECT_PRESETS[i].ratio
    if (r != null && Math.abs(rectAspect - r) < tol) return i
  }
  return 0
}

/**
 * Reshape a crop rect to a target aspect ratio, keeping its center stable
 * and growing to the largest rect that fits inside the image. `ratio` is
 * width/height in real pixels; `imageAspect` is the source's own w/h.
 */
function fitAspect(prev: CropRect, ratio: number, imageAspect: number): CropRect {
  const normTarget = ratio / imageAspect // target w/h in normalized coords
  const cx = prev.x + prev.w / 2
  const cy = prev.y + prev.h / 2
  // Largest rect with this aspect that fits inside [0,1]² centered on (cx, cy):
  // limited by horizontal room (2·min(cx, 1-cx)) and vertical room (2·min(cy, 1-cy)).
  const maxW = 2 * Math.min(cx, 1 - cx)
  const maxH = 2 * Math.min(cy, 1 - cy)
  let w = Math.min(maxW, maxH * normTarget)
  let h = w / normTarget
  if (h > maxH) { h = maxH; w = h * normTarget }
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/**
 * Apply a normalized-coordinate drag to a crop rect, optionally enforcing an
 * aspect ratio. `dx` / `dy` are in normalized SOURCE coords (already divided
 * by the display dimensions) so the math is independent of zoom level.
 *
 * `aspectRatio` is width/height in image-pixel terms. `imageAspect` is the
 * source's own w/h. Needed because crop is normalized but aspect is in real
 * pixels, so an N:M crop rect's normalized w:h differs from N:M unless the
 * source itself is N:M.
 */
function applyDrag(
  kind: Exclude<DragKind, null>,
  start: CropRect,
  dx: number,
  dy: number,
  aspectRatio: number | null,
  imageAspect: number,
): CropRect {
  const { w, h } = start
  let { x, y } = start

  if (kind === 'move') {
    x = clamp01(x + dx)
    y = clamp01(y + dy)
    if (x + w > 1) x = 1 - w
    if (y + h > 1) y = 1 - h
    return { x, y, w, h }
  }

  // Compute candidate edges from the drag direction.
  const right = x + w
  const bottom = y + h
  let nx = x, ny = y, nr = right, nb = bottom

  if (kind.includes('w')) nx = clamp01(x + dx)
  if (kind.includes('e')) nr = clamp01(right + dx)
  if (kind.includes('n')) ny = clamp01(y + dy)
  if (kind.includes('s')) nb = clamp01(bottom + dy)

  if (nr - nx < 0.05) {
    if (kind.includes('w')) nx = nr - 0.05
    else nr = nx + 0.05
  }
  if (nb - ny < 0.05) {
    if (kind.includes('n')) ny = nb - 0.05
    else nb = ny + 0.05
  }

  const next: CropRect = { x: nx, y: ny, w: nr - nx, h: nb - ny }

  // Aspect lock. Enforced on every handle (corner AND edge) when a preset
  // is active, so the pill in the toolbar can't lie: "1:1" means 1:1 no
  // matter which handle the user grabs. Pick "Free" for axis-independent
  // edge drags.
  if (aspectRatio != null) {
    const normTarget = aspectRatio / imageAspect
    const isCorner = kind === 'nw' || kind === 'ne' || kind === 'se' || kind === 'sw'
    const isEdgeHoriz = kind === 'e' || kind === 'w'
    const isEdgeVert  = kind === 'n' || kind === 's'
    const oldCx = start.x + start.w / 2
    const oldCy = start.y + start.h / 2

    if (isCorner) {
      // Width drives height; keep opposite corner anchored.
      next.h = next.w / normTarget
      if (kind === 'nw' || kind === 'ne') next.y = nb - next.h
      if (next.y < 0) { next.y = 0; next.h = nb; next.w = next.h * normTarget }
      if (next.x + next.w > 1) { next.w = 1 - next.x; next.h = next.w / normTarget }
    } else if (isEdgeHoriz) {
      // E/W drag: width drives, height conforms centered on the old center Y.
      next.h = next.w / normTarget
      next.y = oldCy - next.h / 2
      if (next.y < 0)              { next.y = 0;           next.h = 2 * oldCy;       next.w = next.h * normTarget; next.x = Math.max(0, oldCx - next.w / 2) }
      if (next.y + next.h > 1)     { next.h = 2 * (1 - oldCy); next.y = 1 - next.h;  next.w = next.h * normTarget; next.x = Math.max(0, oldCx - next.w / 2) }
      if (next.x + next.w > 1)     { next.w = 1 - next.x;  next.h = next.w / normTarget; next.y = Math.max(0, oldCy - next.h / 2) }
    } else if (isEdgeVert) {
      // N/S drag: height drives, width conforms centered on the old center X.
      next.w = next.h * normTarget
      next.x = oldCx - next.w / 2
      if (next.x < 0)              { next.x = 0;           next.w = 2 * oldCx;       next.h = next.w / normTarget; next.y = Math.max(0, oldCy - next.h / 2) }
      if (next.x + next.w > 1)     { next.w = 2 * (1 - oldCx); next.x = 1 - next.w;  next.h = next.w / normTarget; next.y = Math.max(0, oldCy - next.h / 2) }
      if (next.y + next.h > 1)     { next.h = 1 - next.y;  next.w = next.h * normTarget; next.x = Math.max(0, oldCx - next.w / 2) }
    }
  }

  return next
}
