import { useState } from 'react'
import { Slider } from './Slider'
import { cn } from '@/lib/utils'
import type { Calibration, CalibrationPrimary, EditParams } from '@/../shared/edit-params'

interface CalibrationPanelProps {
  value: Calibration
  onChange: (next: Calibration) => void
  /** Per-slider compare: each sub-slider installs a patcher that
   *  swaps only its own primary+field with the default (zero) while
   *  every other calibration value stays edited. Mirrors the
   *  Colour Grading panel's pattern. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

type PrimaryKey = 'red' | 'green' | 'blue'

/* eslint-disable no-restricted-syntax -- design-allow: the RGB primaries calibration operates on. */
const PRIMARIES: { key: PrimaryKey; label: string; swatch: string }[] = [
  { key: 'red',   label: 'Red',   swatch: '#e74c3c' },
  { key: 'green', label: 'Green', swatch: '#27ae60' },
  { key: 'blue',  label: 'Blue',  swatch: '#2980b9' },
]
/* eslint-enable no-restricted-syntax */

/**
 * Camera Calibration panel. Three primary tabs, each with a Hue
 * and Saturation slider. The fragment shader applies these as a
 * colorimetric foundation before any creative tweak, so they read
 * as a baseline-correction layer rather than a creative effect.
 */
export function CalibrationPanel({ value, onChange, onCompareChange }: CalibrationPanelProps) {
  const [active, setActive] = useState<PrimaryKey>('red')
  const primary = value[active]

  const setField = (field: keyof CalibrationPrimary, v: number) => {
    onChange({ ...value, [active]: { ...primary, [field]: v } })
  }
  const reset = (field: keyof CalibrationPrimary) => setField(field, 0)

  const cmp = (field: keyof CalibrationPrimary) =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          calibration: {
            ...p.calibration,
            [active]: { ...p.calibration[active], [field]: 0 },
          },
        }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <div className="py-1">
      <div className="px-space-5 mb-space-2 grid grid-cols-3 gap-space-1">
        {PRIMARIES.map(p => {
          const v = value[p.key]
          const dirty = v.hue !== 0 || v.sat !== 0
          return (
            <button /* eslint-disable-line no-restricted-syntax -- design-allow: a hue swatch, not a labelled control */
              key={p.key}
              onClick={() => setActive(p.key)}
              className={cn(
                'h-6 px-2 rounded-soft border text-caption font-medium transition-colors relative',
                active === p.key
                  ? 'border-border-focus text-text-emphatic bg-overlay-hover'
                  : 'border-border-subtle text-text-muted hover:text-text-emphatic hover:border-border-strong',
              )}
              style={{ borderLeftColor: active === p.key ? p.swatch : undefined, borderLeftWidth: active === p.key ? 3 : 1 }}
            >
              {p.label}
              {dirty && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-accent-primary shadow-md rounded-full" />}
            </button>
          )
        })}
      </div>
      <Slider
        label="Hue"
        value={primary.hue}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={v => setField('hue', v)}
        onReset={() => reset('hue')}
        format={v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`}
        onCompareDown={cmp('hue')}
        onCompareUp={cmpUp}
      />
      <Slider
        label="Saturation"
        value={primary.sat}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={v => setField('sat', v)}
        onReset={() => reset('sat')}
        format={v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`}
        onCompareDown={cmp('sat')}
        onCompareUp={cmpUp}
      />
    </div>
  )
}
