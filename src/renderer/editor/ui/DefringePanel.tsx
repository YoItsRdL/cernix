import { Slider } from './Slider'
import type { Defringe } from '@/../shared/edit-params'

interface DefringePanelProps {
  value: Defringe
  onChange: (next: Defringe) => void
}

/**
 * Defringe. Purple / green chromatic-aberration cleanup. Each fringe
 * has an amount and a hue range (lo / hi) so unusual fringe palettes
 * (older lenses, IR-pass filters) can be tuned beyond the defaults
 * that match Lightroom Classic's out-of-the-box behaviour.
 */
export function DefringePanel({ value, onChange }: DefringePanelProps) {
  const fmtPct = (v: number) => `${Math.round(v * 100)}%`
  const fmtHue = (v: number) => `${Math.round(v * 360)}°`
  return (
    <div className="py-1">
      <Slider
        label="Purple"
        value={value.purpleAmount}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, purpleAmount: v })}
        onReset={() => onChange({ ...value, purpleAmount: 0 })}
        format={fmtPct}
      />
      <Slider
        label="Purple Hue Lo"
        value={value.purpleHueLo}
        defaultValue={0.74}
        min={0}
        max={1}
        step={0.001}
        onChange={(v) => onChange({ ...value, purpleHueLo: v })}
        onReset={() => onChange({ ...value, purpleHueLo: 0.74 })}
        format={fmtHue}
      />
      <Slider
        label="Purple Hue Hi"
        value={value.purpleHueHi}
        defaultValue={0.83}
        min={0}
        max={1}
        step={0.001}
        onChange={(v) => onChange({ ...value, purpleHueHi: v })}
        onReset={() => onChange({ ...value, purpleHueHi: 0.83 })}
        format={fmtHue}
      />
      <Slider
        label="Green"
        value={value.greenAmount}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, greenAmount: v })}
        onReset={() => onChange({ ...value, greenAmount: 0 })}
        format={fmtPct}
      />
      <Slider
        label="Green Hue Lo"
        value={value.greenHueLo}
        defaultValue={0.27}
        min={0}
        max={1}
        step={0.001}
        onChange={(v) => onChange({ ...value, greenHueLo: v })}
        onReset={() => onChange({ ...value, greenHueLo: 0.27 })}
        format={fmtHue}
      />
      <Slider
        label="Green Hue Hi"
        value={value.greenHueHi}
        defaultValue={0.39}
        min={0}
        max={1}
        step={0.001}
        onChange={(v) => onChange({ ...value, greenHueHi: v })}
        onReset={() => onChange({ ...value, greenHueHi: 0.39 })}
        format={fmtHue}
      />
    </div>
  )
}
