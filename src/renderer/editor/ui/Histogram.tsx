import { useEffect, useRef } from 'react'

interface HistogramProps {
  /** Per-channel 256-bucket counts. Null = no data yet. */
  data: { r: Uint32Array; g: Uint32Array; b: Uint32Array } | null
  width?: number
  height?: number
}

export function Histogram({ data, width = 240, height = 60 }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    if (!data) return

    const max = Math.max(
      maxOf(data.r), maxOf(data.g), maxOf(data.b),
    )
    if (max === 0) return

    ctx.globalCompositeOperation = 'lighter'
    drawCurve(ctx, data.r, max, width, height, 'rgba(255, 80, 80, 0.55)') // design-allow
    drawCurve(ctx, data.g, max, width, height, 'rgba(80, 220, 80, 0.55)') // design-allow
    drawCurve(ctx, data.b, max, width, height, 'rgba(80, 120, 255, 0.55)') // design-allow
    ctx.globalCompositeOperation = 'source-over'
  }, [data, width, height])

  return <canvas ref={canvasRef} style={{ width, height }} className="block" />
}

function maxOf(arr: Uint32Array): number {
  let m = 0
  // Skip pure black + pure white spikes. They dominate and flatten the curve.
  for (let i = 1; i < 255; i++) if (arr[i] > m) m = arr[i]
  return m
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  data: Uint32Array,
  max: number,
  w: number,
  h: number,
  fill: string,
) {
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w
    const y = h - Math.min(h, (data[i] / max) * h)
    ctx.lineTo(x, y)
  }
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}
