import React from 'react'
import { createRoot } from 'react-dom/client'
import { SyncBadge } from '@/components/ui/sync-badge'
import type { SyncState } from '@/lib/sync-state'

/**
 * Every sync mark over the three worst grounds a photograph offers.
 *
 * White, black and mid grey, because a thumbnail's colour under a
 * corner is unknown and changes per pixel. A mark that clears all three
 * clears any photograph; one that clears only the mid grey is the
 * treatment this replaced.
 */
const GROUNDS = { white: '#ffffff', black: '#000000', grey: '#7f7f7f' }
/**
 * The only mark that appears over a photograph. `new` draws nothing
 * there, and the IMPORTED state that used to sit between them is gone:
 * the sweeper answered "imported" and "uploaded" from one ledger
 * lookup, so nothing could ever be in it.
 */
const STATES: SyncState[] = ['synced']

/** Relative luminance, sRGB, as WCAG defines it. */
function luminance([r, g, b]: number[]) {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * Composite a CSS colour over an opaque one and read back the sRGB it
 * actually paints.
 *
 * A canvas rather than arithmetic on the computed string, because these
 * tokens are `oklch()` and that is exactly what `getComputedStyle`
 * returns for them. Three numbers where a naive parser sees r, g, b
 * and reports every pair as 1.0:1. The browser already knows how to
 * turn a colour into pixels; asking it is both shorter and correct.
 */
function paint(colors: string[], ground: string): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, 1, 1)
  for (const c of colors) {
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
  }
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

function Harness() {
  const w = window as unknown as Record<string, unknown>

  /**
   * The contrast between a mark's glyph and what is actually behind it:
   * the chip's own translucent surface composited over the ground.
   */
  w.__markContrast = () => {
    const out: Record<string, number> = {}
    for (const [name, hex] of Object.entries(GROUNDS)) {
      for (const state of STATES) {
        const el = document.querySelector(`.probe-${name}-${state}`) as HTMLElement
        const cs = getComputedStyle(el)
        const chip = paint([cs.backgroundColor], hex)
        const ink = paint([cs.backgroundColor, cs.color], hex)
        const [hi, lo] = [luminance(ink), luminance(chip)].sort((a, b) => b - a)
        out[`${name}-${state}`] = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
      }
    }
    return out
  }

  /** The mark's box, which has to stay a 20px square. */
  w.__markBox = () => {
    const el = document.querySelector('.probe-grey-synced')!.getBoundingClientRect()
    return { w: Math.round(el.width), h: Math.round(el.height) }
  }

  React.useEffect(() => { w.__ready = true })

  return (
    <div>
      {Object.entries(GROUNDS).map(([name, hex]) => (
        <div key={name} style={{ background: hex, padding: 12, display: 'flex', gap: 8 }}>
          {STATES.map(state => (
            <SyncBadge key={state} state={state} onMedia className={`probe-${name}-${state}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
