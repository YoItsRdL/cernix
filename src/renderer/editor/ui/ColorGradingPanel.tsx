import { useState } from 'react'
import { Slider } from './Slider'
import { cn } from '@/lib/utils'
import type { ColorGrading, ColorGradingBand, EditParams } from '@/../shared/edit-params'
import { DEFAULT_COLOR_GRADING_BAND } from '@/../shared/edit-params'

interface ColorGradingPanelProps {
  value: ColorGrading
  onChange: (next: ColorGrading) => void
  /** Per-slider compare: each sub-slider installs a patcher that
   *  swaps only its own field (e.g. midtones.hue, or top-level
   *  blend) with its default. Holding "Midtones Hue" compare
   *  shows the image with that one value reverted while every
   *  other colour-grading value (including midtones.sat/lum and
   *  the other bands) stays edited. Mirrors the HSL/Selective
   *  Color/B&W wiring pattern. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

type BandKey = 'shadows' | 'midtones' | 'highlights' | 'global'

const BANDS: { key: BandKey; label: string }[] = [
  { key: 'shadows',    label: 'Shadows'    },
  { key: 'midtones',   label: 'Midtones'   },
  { key: 'highlights', label: 'Highlights' },
  // Global tint applies on top of every luminance band. Sits at the
  // end of the tab strip so it reads as a "finishing" wash rather
  // than another tonal region.
  { key: 'global',     label: 'Global'     },
]

const GLOBAL_DEFAULTS: { blend: number; balance: number } = { blend: 0.5, balance: 0 }

/**
 * Colour Grading panel. Lightroom-style three-band tonal tint.
 * Sliders-first interim UI; a colour-wheel widget can replace the
 * H/S sliders later without touching the schema or the shader.
 */
export function ColorGradingPanel({ value, onChange, onCompareChange }: ColorGradingPanelProps) {
  const [active, setActive] = useState<BandKey>('midtones')
  const band = value[active]

  const setBandField = (key: keyof ColorGradingBand, v: number) => {
    onChange({ ...value, [active]: { ...band, [key]: v } })
  }
  const resetBandField = (key: keyof ColorGradingBand) => setBandField(key, 0)

  const setGlobal = (key: 'blend' | 'balance', v: number) => {
    onChange({ ...value, [key]: v })
  }

  const cmpBand = (key: keyof ColorGradingBand) =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          colorGrading: {
            ...p.colorGrading,
            [active]: { ...p.colorGrading[active], [key]: DEFAULT_COLOR_GRADING_BAND[key] },
          },
        }))
      : undefined
  const cmpGlobal = (key: 'blend' | 'balance') =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          colorGrading: { ...p.colorGrading, [key]: GLOBAL_DEFAULTS[key] },
        }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <div className="py-1">
      {/* Band tabs, two per row.
          Four across does not fit. The panel is w-72, and after its
          px-space-5 padding and the gaps each of four cells gets 41px of
          text room while "Highlights" needs 67, so it ran under
          "Global". Dropping the padding to zero still leaves it 10px
          short, and three across with Global on its own row misses by 5,
          so there is no single-row layout at this label size. Two per row
          gives 104px and 37px of slack, which is enough that it will not
          creep back.

          Reading order still runs shadows to highlights, with Global
          last, so the sequence survives the wrap. */}
      <div className="px-space-5 mb-space-2 grid grid-cols-2 gap-space-1">
        {BANDS.map(b => {
          const v = value[b.key]
          const dirty = v.sat !== 0 || v.lum !== 0
          return (
            <button /* eslint-disable-line no-restricted-syntax -- design-allow: a wheel-and-swatch control drawn to the panel grid */
              key={b.key}
              onClick={() => setActive(b.key)}
              className={cn(
                'h-6 px-2 rounded-soft border text-caption font-medium transition-colors relative',
                active === b.key
                  ? 'border-border-focus text-text-emphatic bg-overlay-hover'
                  : 'border-border-subtle text-text-muted hover:text-text-emphatic hover:border-border-strong',
              )}
            >
              {b.label}
              {dirty && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-accent-primary shadow-md rounded-full" />}
            </button>
          )
        })}
      </div>

      {/* Active band controls */}
      <Slider
        label="Hue"
        value={band.hue}
        defaultValue={0}
        min={0}
        max={1}
        step={0.001}
        onChange={v => setBandField('hue', v)}
        onReset={() => resetBandField('hue')}
        format={v => `${Math.round(v * 360)}°`}
        onCompareDown={cmpBand('hue')}
        onCompareUp={cmpUp}
      />
      <Slider
        label="Saturation"
        value={band.sat}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={v => setBandField('sat', v)}
        onReset={() => resetBandField('sat')}
        format={v => `${Math.round(v * 100)}%`}
        onCompareDown={cmpBand('sat')}
        onCompareUp={cmpUp}
      />
      <Slider
        label="Luminance"
        value={band.lum}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={v => setBandField('lum', v)}
        onReset={() => resetBandField('lum')}
        onCompareDown={cmpBand('lum')}
        onCompareUp={cmpUp}
      />

      {/* Global blend + balance: separator above */}
      <div className="border-t border-border-subtle mt-space-2 pt-space-1">
        <Slider
          label="Blend"
          value={value.blend}
          defaultValue={0.5}
          min={0}
          max={1}
          step={0.01}
          onChange={v => setGlobal('blend', v)}
          onReset={() => setGlobal('blend', 0.5)}
          format={v => `${Math.round(v * 100)}%`}
          onCompareDown={cmpGlobal('blend')}
          onCompareUp={cmpUp}
        />
        <Slider
          label="Balance"
          value={value.balance}
          defaultValue={0}
          min={-1}
          max={1}
          step={0.01}
          onChange={v => setGlobal('balance', v)}
          onReset={() => setGlobal('balance', 0)}
          onCompareDown={cmpGlobal('balance')}
          onCompareUp={cmpUp}
        />
      </div>
    </div>
  )
}
