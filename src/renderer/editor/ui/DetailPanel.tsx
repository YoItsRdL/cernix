import { Slider } from './Slider'
import type { Sharpening, NoiseReduction } from '@/../shared/edit-params'

interface DetailPanelProps {
  sharpening: Sharpening
  noiseReduction: NoiseReduction
  texture: number
  clarity: number
  dehaze: number
  onSharpeningChange: (next: Sharpening) => void
  onNoiseReductionChange: (next: NoiseReduction) => void
  onTextureChange: (next: number) => void
  onClarityChange: (next: number) => void
  onDehazeChange: (next: number) => void
}

/**
 * Detail recovery. Sharpening + noise reduction grouped with the
 * Lightroom Presence sliders (Texture, Clarity). All amount sliders
 * read 0–100% / ±100; the shader handles edge gating internally and
 * the presence binder runs FBO-backed Gaussian blurs only when the
 * matching amount is non-zero.
 */
export function DetailPanel({
  sharpening, noiseReduction, texture, clarity, dehaze,
  onSharpeningChange, onNoiseReductionChange, onTextureChange, onClarityChange, onDehazeChange,
}: DetailPanelProps) {
  const fmtSigned = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`
  return (
    <div className="py-1">
      <div className="px-space-5 pb-space-1 text-caption font-mono uppercase tracking-widest text-text-disabled">
        Presence
      </div>
      <Slider
        label="Texture"
        value={texture}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={onTextureChange}
        onReset={() => onTextureChange(0)}
        format={fmtSigned}
      />
      <Slider
        label="Clarity"
        value={clarity}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={onClarityChange}
        onReset={() => onClarityChange(0)}
        format={fmtSigned}
      />
      <Slider
        label="Dehaze"
        value={dehaze}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={onDehazeChange}
        onReset={() => onDehazeChange(0)}
        format={fmtSigned}
      />

      <div className="px-space-5 pt-space-2 pb-space-1 text-caption font-mono uppercase tracking-widest text-text-disabled border-t border-border-subtle mt-space-1">
        Sharpen
      </div>
      <Slider
        label="Amount"
        value={sharpening.amount}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onSharpeningChange({ ...sharpening, amount: v })}
        onReset={() => onSharpeningChange({ ...sharpening, amount: 0 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Radius"
        value={sharpening.radius}
        defaultValue={1.0}
        min={0}
        max={3}
        step={0.1}
        onChange={(v) => onSharpeningChange({ ...sharpening, radius: v })}
        onReset={() => onSharpeningChange({ ...sharpening, radius: 1.0 })}
        format={(v) => `${v.toFixed(1)} px`}
      />
      <Slider
        label="Detail"
        value={sharpening.detail}
        defaultValue={0.25}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onSharpeningChange({ ...sharpening, detail: v })}
        onReset={() => onSharpeningChange({ ...sharpening, detail: 0.25 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Masking"
        value={sharpening.masking}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onSharpeningChange({ ...sharpening, masking: v })}
        onReset={() => onSharpeningChange({ ...sharpening, masking: 0 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />

      <div className="px-space-5 pt-space-2 pb-space-1 text-caption font-mono uppercase tracking-widest text-text-disabled border-t border-border-subtle mt-space-1">
        Noise Reduction
      </div>
      <Slider
        label="Luminance"
        value={noiseReduction.luminance}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onNoiseReductionChange({ ...noiseReduction, luminance: v })}
        onReset={() => onNoiseReductionChange({ ...noiseReduction, luminance: 0 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Color"
        value={noiseReduction.color}
        defaultValue={0}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onNoiseReductionChange({ ...noiseReduction, color: v })}
        onReset={() => onNoiseReductionChange({ ...noiseReduction, color: 0 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  )
}
