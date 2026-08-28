import type { ToneCurve, CurvePoint } from '@/types'
import { clamp01 } from '@/lib/utils'

/**
 * Builds a 256×1 RGBA lookup texture for the tone curves.
 * Channels: R = r curve, G = g curve, B = b curve, A = luma curve.
 * Each is a monotonic linear interpolation across the sorted control points.
 */
export function buildCurveLut(curve: ToneCurve): Uint8Array {
  const lut = new Uint8Array(256 * 4)
  const r = samplePoints(curve.r)
  const g = samplePoints(curve.g)
  const b = samplePoints(curve.b)
  const l = samplePoints(curve.luma)
  for (let i = 0; i < 256; i++) {
    lut[i * 4 + 0] = r[i]
    lut[i * 4 + 1] = g[i]
    lut[i * 4 + 2] = b[i]
    lut[i * 4 + 3] = l[i]
  }
  return lut
}

export function isIdentityCurve(pts: CurvePoint[]): boolean {
  return pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1
}

export function isIdentityToneCurve(c: ToneCurve): boolean {
  return isIdentityCurve(c.luma) && isIdentityCurve(c.r) && isIdentityCurve(c.g) && isIdentityCurve(c.b)
}

/**
 * Monotone-cubic interpolation (Fritsch–Carlson). Produces smooth curves
 * like Photopea/Lightroom without overshoot. A point dragged high does
 * not make neighbors dip below, and vice versa. Linear fallback when
 * only two points are present (identity curve stays a straight line).
 */
function samplePoints(points: CurvePoint[]): Uint8Array {
  const out = new Uint8Array(256)
  if (points.length === 0) {
    for (let i = 0; i < 256; i++) out[i] = i
    return out
  }
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const pts = sorted.map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }))
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y })
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: pts[pts.length - 1].y })

  const n = pts.length
  if (n === 2) {
    // Linear. Preserves identity and 2-point edits exactly.
    for (let i = 0; i < 256; i++) {
      const x = i / 255
      const span = pts[1].x - pts[0].x
      const t = span > 0 ? (x - pts[0].x) / span : 0
      out[i] = Math.round(clamp01(pts[0].y + (pts[1].y - pts[0].y) * t) * 255)
    }
    return out
  }

  // Fritsch–Carlson: compute tangents that preserve monotonicity.
  const dx = new Float64Array(n - 1)
  const dy = new Float64Array(n - 1)
  const m = new Float64Array(n - 1) // secant slopes
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i]
  }
  const t = new Float64Array(n) // tangent at each point
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0
    else t[i] = (m[i - 1] + m[i]) / 2
  }
  // Monotonicity correction
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const h = a * a + b * b
    if (h > 9) {
      const scale = 3 / Math.sqrt(h)
      t[i] = scale * a * m[i]
      t[i + 1] = scale * b * m[i]
    }
  }

  let j = 0
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    while (j < n - 2 && x > pts[j + 1].x) j++
    const x0 = pts[j].x, x1 = pts[j + 1].x
    const y0 = pts[j].y, y1 = pts[j + 1].y
    const h = x1 - x0
    const u = h > 0 ? (x - x0) / h : 0
    const u2 = u * u, u3 = u2 * u
    const h00 =  2 * u3 - 3 * u2 + 1
    const h10 =      u3 - 2 * u2 + u
    const h01 = -2 * u3 + 3 * u2
    const h11 =      u3 -     u2
    const y = h00 * y0 + h10 * h * t[j] + h01 * y1 + h11 * h * t[j + 1]
    out[i] = Math.round(clamp01(y) * 255)
  }
  return out
}

