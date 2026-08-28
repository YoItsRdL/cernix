import { useEffect, useMemo, useRef, useState } from 'react'
import { clamp01 } from '@/lib/utils'
import { HSL_RANGES, type HslAdjustments, type HslRange } from '../../../shared/edit-params'
import type { ToneCurve, CurvePoint, Mask } from '@/types'

/**
 * Targeted Adjustment Tool overlay, and its routing.
 *
 * Lightroom's "click-and-drag on the photo to adjust the slider that
 * targets the underlying pixel" affordance. Two contexts:
 *
 *   - **HSL** (`hsl-h` / `hsl-s` / `hsl-l`): mouse-down samples the
 *     source pixel under the cursor, locks onto its hue band (the
 *     closest HSL_RANGES centre), then vertical drag adjusts that
 *     band's hue / sat / lum slider. The locked band and active
 *     sub-mode are baked into the props (T cycles them at the editor
 *     level), so this overlay has no modifier-key state of its own.
 *
 *   - **Curve**: mouse-down samples the pixel, computes its luma,
 *     locks an X-anchor on the luma curve. Vertical drag targets
 *     the curve's Y at that X. Snap-to-existing-point when the
 *     anchor is within ~3% of an existing control point so the user
 *     can re-edit a previously placed anchor instead of stacking
 *     duplicates; otherwise insert a new point on release.
 *
 * **Routing.** When a mask is selected and carries the
 * relevant block (`hsl` for HSL drags, `toneCurve` for curve drags),
 * the mutation lands on the *mask's* field via `onMaskHslChange` /
 * `onMaskToneCurveChange`. Otherwise the global path applies. The
 * mode-hint chip surfaces the routing target inline so the user
 * sees "Mask: HSL: Sat" vs "HSL: Sat" before they drag.
 *
 * **Reticle.** A floating crosshair + colour swatch
 * follows the cursor (rAF-throttled), sampling the pixel under the
 * pointer so the user can see what they're targeting before clicking.
 *
 * Pixel sampling uses a 1×1 offscreen canvas read off the source
 * bitmap. Cheaper than a WebGL readPixels round-trip and the
 * single-sample latency is well under one frame at typical input
 * rates. Drag delta in screen pixels maps to slider delta via a
 * per-sub-mode scaling factor calibrated to feel like LR's TAT
 * (small drags = subtle, large drags = decisive).
 */

export type TatMode = 'off' | 'hsl-h' | 'hsl-s' | 'hsl-l' | 'curve'

interface TatOverlayProps {
  /** Workspace dimensions in CSS pixels (the canvas's bounding rect). */
  containerRect: { width: number; height: number }
  imageWidth: number
  imageHeight: number
  /** Source bitmap for pixel sampling. Null while the editor is
   *  loading; the overlay no-ops during that window. */
  sourceBitmap: ImageBitmap | null
  mode: Exclude<TatMode, 'off'>
  /** Live HSL: the overlay reads the band and writes a delta back. */
  hsl: HslAdjustments
  onHslChange: (next: HslAdjustments) => void
  /** Live tone curve: the overlay inserts / updates a point on
   *  the luma channel only. Per-channel curves are out of scope. */
  toneCurve: ToneCurve
  onToneCurveChange: (next: ToneCurve) => void
 /** Active mask. When non-null and the mask carries the
   *  relevant block (`hsl` for HSL drags, `toneCurve` for curve drags),
   *  TAT routes the mutation to the mask via the `onMask*` callbacks
   *  rather than the global `onHsl*` / `onToneCurve*` ones. */
  activeMask: Mask | null
  onMaskHslChange: (next: HslAdjustments) => void
  onMaskToneCurveChange: (next: ToneCurve) => void
}

// Drag scaling. Vertical CSS pixels per unit slider movement.
// Tuned so ~150 px of drag = full slider sweep, matching LR's feel.
const DRAG_PX_PER_UNIT = 150
// Curve-mode snap distance: anchors within this normalised X of an
// existing point bind to it instead of inserting a new one.
const CURVE_SNAP_X = 0.03
// Hue centres in normalised space [0..1]. Indexed in the same order
// as HSL_RANGES so the band lookup table-drives off the same source.
const HUE_CENTRES: Record<HslRange, number> = {
  red: 0.000, orange: 0.083, yellow: 0.167, green: 0.333,
  aqua: 0.500, blue: 0.667, purple: 0.833, magenta: 0.917,
}

export function TargetedAdjustmentOverlay({
  containerRect, imageWidth, imageHeight, sourceBitmap,
  mode, hsl, onHslChange, toneCurve, onToneCurveChange,
  activeMask, onMaskHslChange, onMaskToneCurveChange,
}: TatOverlayProps) {
  // Routing decision. Where does this drag write to? The branch
  // happens at drag-start so the captured callbacks stay stable for
  // the duration of the gesture even if `activeMask` flips mid-drag.
  const routeToMaskHsl   = !!activeMask?.hsl
  const routeToMaskCurve = !!activeMask?.toneCurve
  const liveHsl       = routeToMaskHsl   && activeMask ? activeMask.hsl!       : hsl
  const liveToneCurve = routeToMaskCurve && activeMask ? activeMask.toneCurve! : toneCurve
  const writeHsl       = routeToMaskHsl   ? onMaskHslChange       : onHslChange
  const writeToneCurve = routeToMaskCurve ? onMaskToneCurveChange : onToneCurveChange
  const cw = containerRect.width
  const ch = containerRect.height
  // Aspect-fit the source bitmap into the workspace. The same math
  // every other overlay (lasso, heal, mask handles) uses.
  const display = useMemo(() => {
    if (!cw || !ch || !imageWidth || !imageHeight) return { x: 0, y: 0, w: cw, h: ch }
    const imgAspect = imageWidth / imageHeight
    const conAspect = cw / ch
    const fitW = imgAspect > conAspect ? cw : ch * imgAspect
    const fitH = imgAspect > conAspect ? cw / imgAspect : ch
    return { x: (cw - fitW) / 2, y: (ch - fitH) / 2, w: fitW, h: fitH }
  }, [cw, ch, imageWidth, imageHeight])

  // Drag state. Kept in a ref so move/up callbacks see the latest
  // anchor without rebinding effects on every prop change.
  const dragRef = useRef<{
    startY: number
    /** HSL: locked band; Curve: anchor X on the luma curve. */
    band?: HslRange
    anchorX?: number
    /** The slider's value at drag-start; deltas land on top of this. */
    startVal: number
    /** For curve mode: the original luma point list pre-drag, used
     *  to compose the updated point on every move. */
    startCurve?: CurvePoint[]
  } | null>(null)

  // Pixel sampler. Drawn once per drag-start; the 1×1 offscreen
  // canvas is allocated lazily and reused across drags.
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const samplePixel = (uv: { x: number; y: number }): [number, number, number] | null => {
    if (!sourceBitmap) return null
    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas')
      sampleCanvasRef.current.width = 1
      sampleCanvasRef.current.height = 1
    }
    const ctx = sampleCanvasRef.current.getContext('2d')
    if (!ctx) return null
    const sx = uv.x * sourceBitmap.width
    const sy = uv.y * sourceBitmap.height
    ctx.clearRect(0, 0, 1, 1)
    ctx.drawImage(sourceBitmap, sx, sy, 1, 1, 0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0] / 255, d[1] / 255, d[2] / 255]
  }

  // ── HSL helpers ──
  // Closest hue band in the canonical 8-band layout. Wraps at 0/1.
  const closestBand = (hue: number): HslRange => {
    let best: HslRange = 'red'
    let bestD = Infinity
    for (const r of HSL_RANGES) {
      const c = HUE_CENTRES[r]
      const d = Math.min(Math.abs(hue - c), 1 - Math.abs(hue - c))
      if (d < bestD) { bestD = d; best = r }
    }
    return best
  }

  // ── Drag plumbing ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !sourceBitmap) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const hostRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const uv = {
      x: clamp01((e.clientX - hostRect.left - display.x) / display.w),
      y: clamp01((e.clientY - hostRect.top - display.y) / display.h),
    }
    const rgb = samplePixel(uv)
    if (!rgb) return

    if (mode === 'curve') {
      const lum = luma(rgb)
      // Snap to an existing point if the anchor is close enough.
      // Lets the user re-edit prior placements instead of stacking
      // duplicates on each TAT click. Reads from the routed source
      // (mask curve when the mask carries one, else global).
      const existing = liveToneCurve.luma.find(p => Math.abs(p.x - lum) < CURVE_SNAP_X)
      const anchorX = existing ? existing.x : lum
      dragRef.current = {
        startY: e.clientY,
        anchorX,
        startVal: existing ? existing.y : lum,
        startCurve: liveToneCurve.luma.map(p => ({ ...p })),
      }
      return
    }

    // HSL: identify band, capture starting slider value from the
    // routed source (mask hsl when the mask carries one, else global).
    const hsv = rgb2hsv(rgb)
    const band = closestBand(hsv[0])
    const sub = (mode === 'hsl-h' ? 'h' : mode === 'hsl-s' ? 's' : 'l') as keyof typeof liveHsl[typeof band]
    dragRef.current = {
      startY: e.clientY,
      band,
      startVal: liveHsl[band][sub],
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    e.stopPropagation()
    // Up = positive delta (the gesture matches LR: drag up to
    // increase the slider; drag down to decrease). Pixel-to-unit
    // factor is constant per sub-mode for predictability.
    const dy = (drag.startY - e.clientY) / DRAG_PX_PER_UNIT

    if (mode === 'curve' && drag.anchorX != null && drag.startCurve) {
      const newY = clamp01(drag.startVal + dy * 0.5) // 0.5 = curve-feel scaling
      const next = upsertCurvePoint(drag.startCurve, drag.anchorX, newY)
      writeToneCurve({ ...liveToneCurve, luma: next })
      return
    }

    if (drag.band) {
      const sub = (mode === 'hsl-h' ? 'h' : mode === 'hsl-s' ? 's' : 'l') as 'h' | 's' | 'l'
      // HSL sliders run -1..+1 in our schema; full-screen drag should
      // sweep the whole range, so the per-pixel scaling doubles vs.
      // the curve mode (which is 0..1).
      const next = clampUnit(drag.startVal + dy)
      writeHsl({
        ...liveHsl,
        [drag.band]: { ...liveHsl[drag.band], [sub]: next },
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  }

  // ── Reticle ──
  // Floating crosshair + colour swatch + locked-band label, follows
  // the cursor on mousemove. rAF-throttled so we run the 1×1 pixel
  // sample once per frame at most. At typical mouse poll rates this
  // is well under the JND for cursor-tracking latency.
  const [reticle, setReticle] = useState<{
    cx: number; cy: number; rgb: [number, number, number]; band: HslRange; lum: number
  } | null>(null)
  const reticleRafRef = useRef<number | null>(null)
  const onPointerMoveTracking = (e: React.PointerEvent) => {
    // Drag handler runs first (higher priority); reticle just tracks
    // for visual feedback. Both can fire on the same event.
    onPointerMove(e)
    if (!sourceBitmap) return
    if (reticleRafRef.current != null) return // already queued for this frame
    const clientX = e.clientX
    const clientY = e.clientY
    const hostRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    reticleRafRef.current = requestAnimationFrame(() => {
      reticleRafRef.current = null
      const uv = {
        x: clamp01((clientX - hostRect.left - display.x) / display.w),
        y: clamp01((clientY - hostRect.top - display.y) / display.h),
      }
      const rgb = samplePixel(uv)
      if (!rgb) return setReticle(null)
      const hsv = rgb2hsv(rgb)
      setReticle({
        cx: clientX - hostRect.left,
        cy: clientY - hostRect.top,
        rgb,
        band: closestBand(hsv[0]),
        lum: luma(rgb),
      })
    })
  }
  const onPointerLeave = () => {
    if (reticleRafRef.current != null) {
      cancelAnimationFrame(reticleRafRef.current)
      reticleRafRef.current = null
    }
    setReticle(null)
  }
  // Cancel any pending rAF on unmount.
  useEffect(() => () => {
    if (reticleRafRef.current != null) cancelAnimationFrame(reticleRafRef.current)
  }, [])

  // Esc cancels. Drops the in-flight drag without committing the
  // last-rendered value (params already updated mid-drag, but the
  // user can hit \\ to undo via the existing history stack).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault()
        dragRef.current = null
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cursor hint surfaces the active mode + routing target without
  // needing the user to look at the panel. When TAT routes to the
  // active mask, the chip prepends "Mask: " so the
  // user sees the target inline before they drag.
  const subLabel =
    mode === 'curve'   ? 'Curve'      :
    mode === 'hsl-h'   ? 'HSL: Hue'   :
    mode === 'hsl-s'   ? 'HSL: Sat'   :
                         'HSL: Lum'
  const routedToMask = mode === 'curve' ? routeToMaskCurve : routeToMaskHsl
  const modeLabel = routedToMask ? `Mask: ${subLabel}` : subLabel

  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMoveTracking}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {/* Mode hint: small chip top-left, doesn't fight the canvas. */}
      <div className="absolute top-3 left-3 px-space-2 py-1 rounded-full bg-surface-floating backdrop-blur-md border border-border-strong text-metadata text-text-emphatic font-mono pointer-events-none">
        TAT: {modeLabel} <span className="text-text-muted ml-1">·  T cycles</span>
      </div>

 {/* Reticle: floating crosshair + colour swatch +
          locked-band / luma label. Positioned absolutely off the
          cursor; pointer-events-none so it never intercepts the
          drag. The colour swatch is one of the legitimate
          design-allow cases: the colour IS the value being shown. */}
      {reticle && <Reticle reticle={reticle} mode={mode} />}
    </div>
  )
}

interface ReticleState {
  cx: number; cy: number
  rgb: [number, number, number]
  band: HslRange
  lum: number
}

/** Reticle popover: small crosshair, colour swatch, contextual label.
 *  Lifted to its own component so the parent's render keeps cleanly
 *  reading; positioning math is just CSS translate offsets off the
 *  current cursor coordinates the parent passes through. */
function Reticle({ reticle, mode }: { reticle: ReticleState; mode: Exclude<TatMode, 'off'> }) {
  const [r, g, b] = reticle.rgb.map(v => Math.round(v * 255))
  // design-allow: the swatch colour IS the semantic. It's the
  // value the user is targeting, not a UI surface.
  const swatchStyle = { background: `rgb(${r}, ${g}, ${b})` }
  const label = mode === 'curve' ? `L ${reticle.lum.toFixed(2)}` : reticle.band
  return (
    <div
      className="absolute pointer-events-none flex items-center gap-space-1 px-space-2 py-1 rounded-soft bg-surface-floating backdrop-blur-md border border-border-strong text-metadata text-text-emphatic font-mono"
      style={{
        // design-allow: cursor-relative positioning. Translate offset
        // is computed per frame from the live cursor pos.
        left: reticle.cx + 14,
        top: reticle.cy + 14,
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block w-3 h-3 rounded-sm border border-border-subtle"
        style={swatchStyle}
      />
      <span>{label}</span>
    </div>
  )
}

// ── Helpers ──

function luma(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/** Standard RGB → HSV. Returns [h, s, v] each in [0..1]. */
function rgb2hsv(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  const s = max < 1e-6 ? 0 : d / max
  return [h, s, max]
}

/**
 * Insert a point at `x` (or update the existing one within snap
 * range) and re-sort. The endpoints (0 and 1) are preserved so the
 * curve never gets shorter than two points.
 */
function upsertCurvePoint(curve: CurvePoint[], x: number, y: number): CurvePoint[] {
  const next = curve.map(p => ({ ...p }))
  const existing = next.findIndex(p => Math.abs(p.x - x) < 0.005)
  if (existing >= 0) {
    next[existing] = { x, y }
  } else {
    next.push({ x, y })
    next.sort((a, b) => a.x - b.x)
  }
  return next
}
