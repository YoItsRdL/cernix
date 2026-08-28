import { useState } from 'react'
import { Slider } from './Slider'
import { cn } from '@/lib/utils'
import type { EditParams, HslAdjustments, HslRange, HslBand } from '@/types'
import { HSL_RANGES, DEFAULT_PARAMS } from '../../../shared/edit-params'

interface HslPanelProps {
  hsl: HslAdjustments
  onChange: (next: HslAdjustments) => void
  /** Per-slider compare: each sub-slider installs a patcher that swaps
   *  only its own band+field (e.g. `hsl.red.h`) with its default while
   *  every other HSL band/field stays edited. `null` on release. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

/* eslint-disable no-restricted-syntax -- design-allow: the eight hue bands
   this panel edits, matching Lightroom Classic and Camera Raw so preset
   libraries import 1:1. */
const SWATCHES: Record<HslRange, string> = {
  red:     '#e74c3c',
  orange:  '#e67e22',
  yellow:  '#f1c40f',
  green:   '#27ae60',
  aqua:    '#1abc9c',
  blue:    '#2980b9',
  purple:  '#8e44ad',
  magenta: '#d63384',
}
/* eslint-enable no-restricted-syntax */

export function HslPanel({ hsl, onChange, onCompareChange }: HslPanelProps) {
  const [active, setActive] = useState<HslRange>('red')
  const band = hsl[active]

  const setBand = (key: keyof HslBand, value: number) => {
    onChange({ ...hsl, [active]: { ...band, [key]: value } })
  }
  const resetBand = (key: keyof HslBand) => setBand(key, 0)

  // Each sub-slider swaps only its own band+field (e.g. hsl.red.h) with
  // its default. Holding "Red Hue" compare shows the image with red.h
  // reverted while every other HSL value (including red.s and red.l)
  // stays edited.
  const cmp = (field: keyof HslBand) =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          hsl: {
            ...p.hsl,
            [active]: { ...p.hsl[active], [field]: DEFAULT_PARAMS.hsl[active][field] },
          },
        }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-space-5 mb-space-1.5">
        <div className="flex items-center gap-space-1">
          {HSL_RANGES.map(r => {
            const dirty = hsl[r].h !== 0 || hsl[r].s !== 0 || hsl[r].l !== 0
            return (
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a 24px hue swatch, not a labelled control */
                key={r}
                onClick={() => setActive(r)}
                className={cn(
                  'w-6 h-6 rounded-soft border transition-all relative',
                  active === r ? 'border-border-focus scale-110' : 'border-border-subtle hover:border-border-strong',
                )}
                // design-allow: HSL swatch background application
                style={{ background: SWATCHES[r] + (active === r ? '' : '99') }}
                title={r}
              >
                {dirty && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-text-emphatic shadow-md rounded-full" />}
              </button>
            )
          })}
        </div>
      </div>
      <Slider label="Hue"        value={band.h} min={-1} max={1} onChange={v => setBand('h', v)} onReset={() => resetBand('h')} onCompareDown={cmp('h')} onCompareUp={cmpUp} />
      <Slider label="Saturation" value={band.s} min={-1} max={1} onChange={v => setBand('s', v)} onReset={() => resetBand('s')} onCompareDown={cmp('s')} onCompareUp={cmpUp} />
      <Slider label="Luminance"  value={band.l} min={-1} max={1} onChange={v => setBand('l', v)} onReset={() => resetBand('l')} onCompareDown={cmp('l')} onCompareUp={cmpUp} />
    </div>
  )
}
