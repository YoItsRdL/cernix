import { useState } from 'react'
import { Slider } from './Slider'
import { cn } from '@/lib/utils'
import type { EditParams, SelectiveColor, SelectiveColorRange, SelectiveColorBand } from '@/types'
import { SC_RANGES, DEFAULT_PARAMS } from '../../../shared/edit-params'

interface SelectiveColorPanelProps {
  value: SelectiveColor
  onChange: (next: SelectiveColor) => void
  /** Per-slider compare: each sub-slider swaps only its own band+field
   *  (e.g. selectiveColor.red.c) with its default. See HslPanel. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

/* eslint-disable no-restricted-syntax -- design-allow: the colour ranges
   this panel edits. The hex is the value being shown, not chrome. */
const SWATCHES: Record<SelectiveColorRange, string> = {
  red:     '#e74c3c',
  yellow:  '#f1c40f',
  green:   '#27ae60',
  cyan:    '#1abc9c',
  blue:    '#2980b9',
  magenta: '#c0398b',
}
/* eslint-enable no-restricted-syntax */

export function SelectiveColorPanel({ value, onChange, onCompareChange }: SelectiveColorPanelProps) {
  const [active, setActive] = useState<SelectiveColorRange>('red')
  const band = value[active]

  const setBand = (key: keyof SelectiveColorBand, v: number) => {
    onChange({ ...value, [active]: { ...band, [key]: v } })
  }
  const resetBand = (key: keyof SelectiveColorBand) => setBand(key, 0)

  const cmp = (field: keyof SelectiveColorBand) =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          selectiveColor: {
            ...p.selectiveColor,
            [active]: { ...p.selectiveColor[active], [field]: DEFAULT_PARAMS.selectiveColor[active][field] },
          },
        }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-space-5 mb-space-1.5">
        <div className="flex items-center gap-space-1">
          {SC_RANGES.map(r => {
            const b = value[r]
            const dirty = b.c !== 0 || b.m !== 0 || b.y !== 0 || b.k !== 0
            return (
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a colour-range swatch, not a labelled control */
                key={r}
                onClick={() => setActive(r)}
                className={cn(
                  'w-6 h-6 rounded-soft border transition-all relative',
                  active === r ? 'border-border-focus scale-110' : 'border-border-subtle hover:border-border-strong',
                )}
                // design-allow: Selective Color swatch background application
                style={{ background: SWATCHES[r] + (active === r ? '' : '99') }}
                title={r}
              >
                {dirty && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-text-emphatic shadow-md rounded-full" />}
              </button>
            )
          })}
        </div>
      </div>
      <Slider label="Cyan"    value={band.c} min={-1} max={1} onChange={v => setBand('c', v)} onReset={() => resetBand('c')} onCompareDown={cmp('c')} onCompareUp={cmpUp} />
      <Slider label="Magenta" value={band.m} min={-1} max={1} onChange={v => setBand('m', v)} onReset={() => resetBand('m')} onCompareDown={cmp('m')} onCompareUp={cmpUp} />
      <Slider label="Yellow"  value={band.y} min={-1} max={1} onChange={v => setBand('y', v)} onReset={() => resetBand('y')} onCompareDown={cmp('y')} onCompareUp={cmpUp} />
      <Slider label="Black"   value={band.k} min={-1} max={1} onChange={v => setBand('k', v)} onReset={() => resetBand('k')} onCompareDown={cmp('k')} onCompareUp={cmpUp} />
    </div>
  )
}
