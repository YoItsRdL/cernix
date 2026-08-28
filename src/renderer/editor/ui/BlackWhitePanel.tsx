import { Slider } from './Slider'
import type { BlackAndWhite, EditParams } from '@/types'
import { DEFAULT_PARAMS } from '../../../shared/edit-params'

type BwChannel = keyof Pick<BlackAndWhite, 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta'>

interface BlackWhitePanelProps {
  bw: BlackAndWhite
  onChange: (next: BlackAndWhite) => void
  /** Per-slider compare: each channel slider swaps only its own channel
   *  weight (e.g. bw.red) with its default. See HslPanel. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

/* eslint-disable no-restricted-syntax -- design-allow: the eight hue bands
   this panel edits, matching HSL_RANGES and Lightroom Classic. The hex is
   the value being shown, not chrome. */
const CHANNELS: { key: BwChannel; label: string; swatch: string }[] = [
  { key: 'red',     label: 'Red',     swatch: '#e74c3c' },
  { key: 'orange',  label: 'Orange',  swatch: '#e67e22' },
  { key: 'yellow',  label: 'Yellow',  swatch: '#f1c40f' },
  { key: 'green',   label: 'Green',   swatch: '#27ae60' },
  { key: 'aqua',    label: 'Aqua',    swatch: '#1abc9c' },
  { key: 'blue',    label: 'Blue',    swatch: '#2980b9' },
  { key: 'purple',  label: 'Purple',  swatch: '#8e44ad' },
  { key: 'magenta', label: 'Magenta', swatch: '#d63384' },
]
/* eslint-enable no-restricted-syntax */

export function BlackWhitePanel({ bw, onChange, onCompareChange }: BlackWhitePanelProps) {
  const patch = (fields: Partial<BlackAndWhite>) => onChange({ ...bw, ...fields })

  const cmp = (channel: BwChannel) =>
    onCompareChange
      ? () => onCompareChange((p) => ({
          ...p,
          bw: { ...p.bw, [channel]: DEFAULT_PARAMS.bw[channel] },
        }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <div className="py-1">
      <label className="flex items-center gap-space-2 px-space-5 py-space-2 text-metadata text-text-muted hover:text-text-emphatic cursor-pointer transition-colors">
        <input /* eslint-disable-line no-restricted-syntax -- design-allow: a real checkbox inside its label; the shared Checkbox is presentational and would take the keyboard with it */
          type="checkbox"
          checked={bw.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="accent-accent-primary"
        />
        <span className="font-medium">Enable</span>
      </label>

      {bw.enabled && (
        <>
          <label className="flex items-center gap-space-2 px-space-5 py-1.5 text-metadata text-text-muted hover:text-text-emphatic cursor-pointer transition-colors">
            <input /* eslint-disable-line no-restricted-syntax -- design-allow: a real checkbox inside its label; the shared Checkbox is presentational and would take the keyboard with it */
              type="checkbox"
              checked={bw.colorize}
              onChange={(e) => patch({ colorize: e.target.checked })}
              className="accent-accent-primary"
            />
            <span className="font-medium">Colorize</span>
            {bw.colorize && (
              <input /* eslint-disable-line no-restricted-syntax -- design-allow: a real checkbox inside its label; the shared Checkbox is presentational and would take the keyboard with it */
                type="color"
                value={bw.colorizeHex}
                onChange={(e) => patch({ colorizeHex: e.target.value })}
                className="ml-auto w-6 h-5 border border-border-strong rounded-sm bg-transparent cursor-pointer p-0"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </label>

          {CHANNELS.map(({ key, label, swatch }) => (
            <div key={key} className="flex items-stretch">
              {/* design-allow: Dynamic swatch rendering */}
              <div className="w-1 shrink-0" style={{ background: swatch, opacity: 0.6 }} />
              <div className="flex-1">
                <Slider
                  label={label}
                  value={bw[key]}
                  defaultValue={1}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(v) => patch({ [key]: v } as Partial<BlackAndWhite>)}
                  onReset={() => patch({ [key]: 1 } as Partial<BlackAndWhite>)}
                  format={(v) => v.toFixed(2)}
                  onCompareDown={cmp(key)}
                  onCompareUp={cmpUp}
                />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
