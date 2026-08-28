import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn, clamp01 } from '@/lib/utils'
import type { CurvePoint, CurveChannel, ToneCurve } from '@/types'
import { IDENTITY_CURVE } from '../../../shared/edit-params'
import { buildCurveLut } from '../pipeline/curve-lut'
import { Button } from '@/components/ui/button'

interface ToneCurveEditorProps {
  curve: ToneCurve
  histogram: { r: Uint32Array; g: Uint32Array; b: Uint32Array } | null
  onChange: (next: ToneCurve) => void
}

const CHANNELS: { key: CurveChannel; label: string }[] = [
  // WebGL curve channel mappings
  { key: 'luma', label: 'L' },
  { key: 'r',    label: 'R' },
  { key: 'g',    label: 'G' },
  { key: 'b',    label: 'B' },
]

/**
 * Channel colour, three ways, all from the same four tokens.
 *
 * The literals these replace were fixed rgba, and the luma one was pure
 * white. Invisible against the light theme's cream plot. Written out as
 * whole class names rather than composed from the key, because Tailwind
 * scans source text: `stroke-curve-${key}` produces no CSS at all.
 */
const STROKE: Record<CurveChannel, string> = {
  luma: 'stroke-curve-luma', r: 'stroke-curve-r', g: 'stroke-curve-g', b: 'stroke-curve-b',
}
const TEXT: Record<CurveChannel, string> = {
  luma: 'text-curve-luma', r: 'text-curve-r', g: 'text-curve-g', b: 'text-curve-b',
}
/** The histogram is painted to a canvas, so that one needs a value. */
const CSS_VAR: Record<CurveChannel, string> = {
  luma: '--curve-luma', r: '--curve-r', g: '--curve-g', b: '--curve-b',
}

const SIZE = 196
const HIT = 8
const POINT_RADIUS = 4

export function ToneCurveEditor({ curve, histogram, onChange }: ToneCurveEditorProps) {
  const [channel, setChannel] = useState<CurveChannel>('luma')
  // The histogram is canvas-painted, so it cannot inherit a token the
  // way the SVG does. It reads the value once per paint. Without this
  // the backdrop would keep the old theme's colour until something else
  // happened to redraw it.
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick(t => t + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Paint histogram backdrop (channel-appropriate) to canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, SIZE, SIZE)
    if (!histogram) return
    const data = channel === 'r' ? histogram.r : channel === 'g' ? histogram.g : channel === 'b' ? histogram.b : sumRgb(histogram)
    const max = maxIgnoringEdges(data)
    if (!max) return
    // Alpha at paint time rather than a second set of tokens carrying
    // the same four colours at 15%.
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue(CSS_VAR[channel]).trim()
    ctx.globalAlpha = 0.15
    ctx.beginPath()
    ctx.moveTo(0, SIZE)
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * SIZE
      const y = SIZE - Math.min(SIZE, (data[i] / max) * SIZE)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(SIZE, SIZE)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }, [histogram, channel, themeTick])

  const points = curve[channel]

  const updatePoints = (next: CurvePoint[]) => {
    onChange({ ...curve, [channel]: sanitize(next) })
  }

  const pxToNorm = (e: { clientX: number; clientY: number }): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01(1 - (e.clientY - rect.top) / rect.height),
    }
  }

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragIdx(idx)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx == null) return
    const { x, y } = pxToNorm(e)
    const next = [...points]
    next[dragIdx] = { x, y }
    updatePoints(next)
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragIdx == null) return
    setDragIdx(null)
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  /**
   * Click on the curve background (not on an existing point) → drop a new
   * point at the cursor and immediately start dragging it. Photopea / Lightroom
   * default. Existing points' onPointerDown stops propagation so they steal
   * the gesture.
   */
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    const { x, y } = pxToNorm(e)
    const next = [...points, { x, y }]
    updatePoints(next)
    ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
    // The stored array is kept in click order (sanitize clamps but doesn't
    // sort). The appended point is the last element, so index = length - 1.
    setDragIdx(next.length - 1)
  }

  const handlePointRightClick = (e: React.MouseEvent, idx: number) => {
    e.preventDefault()
    // Don't allow removing the two anchor endpoints (first/last after sort).
    const sorted = [...points].sort((a, b) => a.x - b.x)
    const isEndpoint = points[idx] === sorted[0] || points[idx] === sorted[sorted.length - 1]
    if (isEndpoint) return
    const next = points.filter((_, i) => i !== idx)
    updatePoints(next)
  }

  const resetChannel = () => onChange({ ...curve, [channel]: [...IDENTITY_CURVE] })

  // Build SVG path tracing the actual LUT (monotone-cubic). Same math as the shader.
  const pathD = buildSmoothPathD(curve, channel, SIZE)
  const isIdentity = points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1
  const draggedPoint = dragIdx != null ? points[dragIdx] : null

  return (
    <div className="px-space-3 py-space-2">
      <div className="flex items-center justify-between mb-space-2">
        <div className="flex items-center gap-space-1">
          {CHANNELS.map(c => (
            <button /* eslint-disable-line no-restricted-syntax -- design-allow: a curve-channel selector drawn to the plot */
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={cn(
                'w-6 h-6 text-metadata font-mono font-bold border rounded-soft transition-colors',
                channel === c.key
                  ? cn('border-border-focus', TEXT[c.key])
                  : 'border-border-subtle text-text-muted hover:text-text-emphatic hover:border-border-strong',
              )}
              title={c.key}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetChannel}
          disabled={isIdentity}
          className="text-metadata uppercase tracking-widest px-2"
          title="Reset curve"
        >
          <RotateCcw size={12} className="mr-space-1" />Reset
        </Button>
      </div>
      <div
        className="relative border border-border-strong bg-surface-workspace"
        style={{ width: SIZE, height: SIZE }}
      >
        <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} className="absolute inset-0" />
        {/* Grid */}
        <svg width={SIZE} height={SIZE} className="absolute inset-0 pointer-events-none text-border-subtle">
          <line x1={SIZE/4} y1={0} x2={SIZE/4} y2={SIZE} stroke="currentColor" />
          <line x1={SIZE/2} y1={0} x2={SIZE/2} y2={SIZE} stroke="currentColor" />
          <line x1={3*SIZE/4} y1={0} x2={3*SIZE/4} y2={SIZE} stroke="currentColor" />
          <line x1={0} y1={SIZE/4} x2={SIZE} y2={SIZE/4} stroke="currentColor" />
          <line x1={0} y1={SIZE/2} x2={SIZE} y2={SIZE/2} stroke="currentColor" />
          <line x1={0} y1={3*SIZE/4} x2={SIZE} y2={3*SIZE/4} stroke="currentColor" />
          <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="currentColor" strokeDasharray="2 3" className="text-border-strong" />
        </svg>
        {/* Interactive curve: clicking empty area adds a point and starts drag */}
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <path d={pathD} className={STROKE[channel]} strokeWidth={1.5} fill="none" />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x * SIZE}
              cy={(1 - p.y) * SIZE}
              r={POINT_RADIUS}
              className={cn('fill-surface-panel cursor-grab active:cursor-grabbing', STROKE[channel])}
              strokeWidth={1.5}
              onPointerDown={(e) => handlePointerDown(e, i)}
              onContextMenu={(e) => handlePointRightClick(e, i)}
            />
          ))}
          {/* Larger invisible hit targets */}
          {points.map((p, i) => (
            <circle
              key={`hit-${i}`}
              cx={p.x * SIZE}
              cy={(1 - p.y) * SIZE}
              r={HIT}
              fill="transparent"
              onPointerDown={(e) => handlePointerDown(e, i)}
              onContextMenu={(e) => handlePointRightClick(e, i)}
              className="cursor-grab"
            />
          ))}
        </svg>
      </div>
      <div className="flex items-center justify-between text-caption font-mono text-text-muted mt-space-1">
        <span>click to add · right-click to remove</span>
        {draggedPoint && (
          <span className="text-text-emphatic tabular-nums">
            {Math.round(draggedPoint.x * 255)} → {Math.round(draggedPoint.y * 255)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──

function sanitize(points: CurvePoint[]): CurvePoint[] {
  return points.map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }))
}

/**
 * Build an SVG path that traces the compiled LUT of the given channel.
 * The LUT is what the shader actually samples, so the line in the UI
 * matches the rendered output pixel-for-pixel.
 */
function buildSmoothPathD(curve: ToneCurve, channel: CurveChannel, size: number): string {
  // buildCurveLut packs r,g,b,luma into RGBA; pick the right byte.
  const lut = buildCurveLut({
    ...curve,
    [channel]: curve[channel], // pass-through; channel offset handled below
  })
  const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3
  const step = size / 255
  let d = ''
  for (let i = 0; i <= 255; i++) {
    const x = i * step
    const y = (1 - lut[i * 4 + offset] / 255) * size
    d += (i === 0 ? 'M' : 'L') + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
  }
  return d
}

function sumRgb(h: { r: Uint32Array; g: Uint32Array; b: Uint32Array }): Uint32Array {
  const out = new Uint32Array(256)
  for (let i = 0; i < 256; i++) out[i] = h.r[i] + h.g[i] + h.b[i]
  return out
}

function maxIgnoringEdges(arr: Uint32Array): number {
  let m = 0
  for (let i = 1; i < 255; i++) if (arr[i] > m) m = arr[i]
  return m
}
