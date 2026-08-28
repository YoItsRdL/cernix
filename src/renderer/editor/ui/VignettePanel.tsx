import { Slider } from './Slider'
import type { VignetteParams } from '../../../shared/edit-params'
import { DEFAULT_VIGNETTE } from '../../../shared/edit-params'

interface VignettePanelProps {
  value: VignetteParams
  onChange: (v: VignetteParams) => void
}

export function VignettePanel({ value, onChange }: VignettePanelProps) {
  return (
    <div className="space-y-1">
      <Slider
        label="Amount"
        value={value.amount}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, amount: v })}
        onReset={() => onChange({ ...value, amount: DEFAULT_VIGNETTE.amount })}
        format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`}
      />
      <Slider
        label="Radius"
        value={value.radius}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, radius: v })}
        onReset={() => onChange({ ...value, radius: DEFAULT_VIGNETTE.radius })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Softness"
        value={value.softness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, softness: v })}
        onReset={() => onChange({ ...value, softness: DEFAULT_VIGNETTE.softness })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Roundness"
        value={value.roundness}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, roundness: v })}
        onReset={() => onChange({ ...value, roundness: DEFAULT_VIGNETTE.roundness })}
        format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`}
      />
      <Slider
        label="Highlights"
        value={value.highlightContrast}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...value, highlightContrast: v })}
        onReset={() => onChange({ ...value, highlightContrast: DEFAULT_VIGNETTE.highlightContrast })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  )
}
