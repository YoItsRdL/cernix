import { Slider } from './Slider'
import { cn } from '@/lib/utils'
import type { LightLeakParams, LightLeakPreset } from '@/types'
import { LIGHT_LEAK_PRESETS } from '../../../shared/edit-params'

interface LightLeakPanelProps {
  value: LightLeakParams
  onChange: (next: LightLeakParams) => void
}

export function LightLeakPanel({ value, onChange }: LightLeakPanelProps) {
  const setPreset = (preset: LightLeakPreset) => {
    onChange({ ...value, preset })
  }

  const setIntensity = (intensity: number) => {
    onChange({ ...value, intensity })
  }

  const resetIntensity = () => setIntensity(0.5)

  const setRotation = (rotation: number) => {
    onChange({ ...value, rotation })
  }

  const resetRotation = () => setRotation(0)

  const setSpread = (spread: number) => {
    onChange({ ...value, spread })
  }

  const resetSpread = () => setSpread(1)

  return (
    <div className="py-1">
      <div className="px-space-5 mb-space-3 grid grid-cols-4 gap-space-1.5">
        {LIGHT_LEAK_PRESETS.map((p) => (
          <button /* eslint-disable-line no-restricted-syntax -- design-allow: a preset tile whose gradient is the preset identity */
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={cn(
              'flex flex-col items-center gap-space-1.5 p-2 rounded-soft border transition-all text-center group',
              value.preset === p.id
                ? 'bg-accent-primary/10 border-accent-primary/40'
                : 'bg-surface-workspace border-border-subtle hover:bg-surface-panel hover:border-border-strong'
            )}
          >
            <div
              className={cn(
                'w-full aspect-square rounded-sm transition-transform group-hover:scale-105',
                p.id === 'none' ? 'bg-surface-workspace flex items-center justify-center' : 'bg-gradient-to-br',
                p.id === 'ember' && 'from-status-warn via-status-warn to-transparent',
                p.id === 'halo' && 'from-pink-500 via-purple-400 to-transparent', // eslint-disable-line no-restricted-syntax -- design-allow: film-leak preset gradient, specific colourway is the preset's identity
                p.id === 'arctic' && 'from-cyan-400 via-accent-primary to-transparent', // eslint-disable-line no-restricted-syntax -- design-allow: film-leak preset gradient, specific colourway is the preset's identity
                p.id === 'dusk' && 'from-status-danger via-status-warn to-transparent',
                p.id === 'prism' && 'from-status-danger via-status-success to-transparent',
                p.id === 'overburn' && 'from-status-warn via-status-warn to-status-warn',
              )}
            >
              {p.id === 'none' && <div className="w-4 h-px bg-border-strong rotate-45" />}
            </div>
            <span className={cn(
              'text-metadata font-medium leading-none truncate w-full',
              value.preset === p.id ? 'text-accent-primary' : 'text-text-muted group-hover:text-text-emphatic'
            )}>
              {p.label}
            </span>
          </button>
        ))}
      </div>

      <Slider
        label="Intensity"
        value={value.intensity}
        defaultValue={0.5}
        min={0}
        max={1}
        step={0.01}
        onChange={setIntensity}
        onReset={resetIntensity}
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={value.preset === 'none'}
      />
      <Slider
        label="Rotation"
        value={value.rotation ?? 0}
        defaultValue={0}
        min={-180}
        max={180}
        step={1}
        onChange={setRotation}
        onReset={resetRotation}
        format={(v) => `${v >= 0 ? '+' : ''}${Math.round(v)}°`}
        disabled={value.preset === 'none'}
      />
      <Slider
        label="Spread"
        value={value.spread ?? 1}
        defaultValue={1}
        min={0.3}
        max={2}
        step={0.01}
        onChange={setSpread}
        onReset={resetSpread}
        format={(v) => `${v.toFixed(2)}×`}
        disabled={value.preset === 'none'}
      />
    </div>
  )
}
