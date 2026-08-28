/**
 * The heal tool's inspector panel: the spot list, the per-spot controls
 * and the diagnostic view.
 *
 * The panel is a pure view over a `HealSpot[]`. It never mutates a spot
 * in place; every edit rebuilds the array through `onChange`, because
 * `ParamsStore.set` bails on `this.current[key] === value`, a reference
 * comparison. Mutating a spot inside the array leaves that reference
 * unchanged, so the store would drop the edit and the canvas would keep
 * showing the old frame.
 *
 * Dragging the spots themselves happens on the canvas, not here, in
 * `HealHandle`. This panel only owns whether that overlay is mounted.
 */
import { Plus, Trash2, Bandage, Stamp, Check, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from './Slider'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { MAX_HEAL_SPOTS, DEFAULT_HEAL_SPOT } from '../../../shared/edit-params'
import type { HealSpot, HealMode } from '@/types'

interface HealPanelProps {
  spots: HealSpot[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (next: HealSpot[]) => void
  /** When true, the canvas overlay is mounted and the user can drag
   *  spot handles. The "Done" button is shown so the user can hide
   *  the handles without needing the H hotkey. */
  healMode: boolean
  onExitHealMode: () => void
 /** Visualise Spots: diagnostic Laplacian view. The
   *  toggle + sensitivity slider are only meaningful inside the heal
   *  tool, so they live here rather than in their own panel. State
   *  lives at EditorView (so the A hotkey can target it). */
  visualizeSpots: boolean
  onVisualizeSpotsChange: (next: boolean) => void
  visualizeSensitivity: number
  onVisualizeSensitivityChange: (next: number) => void
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function HealPanel({
  spots, selectedId, onSelect, onChange, healMode, onExitHealMode,
  visualizeSpots, onVisualizeSpotsChange, visualizeSensitivity, onVisualizeSensitivityChange,
}: HealPanelProps) {
  const add = () => {
    const radius = DEFAULT_HEAL_SPOT.radius
    const spot: HealSpot = {
      id: makeId(),
      destX: 0.5,
      destY: 0.5,
      srcX: 0.5 + radius * 3,
      srcY: 0.5,
      ...DEFAULT_HEAL_SPOT,
    }
    onChange([...spots, spot])
    onSelect(spot.id)
  }

  const remove = (id: string) => {
    onChange(spots.filter(s => s.id !== id))
    if (selectedId === id) onSelect(null)
  }

  const update = (id: string, patch: Partial<HealSpot>) => {
    onChange(spots.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  const selected = spots.find(s => s.id === selectedId) ?? null

  return (
    <div className="py-1">
      <div className="flex items-center gap-space-1 px-space-5 pb-space-2">
        <Button
          variant="outline"
          size="sm"
          disabled={spots.length >= MAX_HEAL_SPOTS}
          onClick={add}
          title="Add heal/clone spot"
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Plus size={10} /><Bandage size={12} />Add Spot
        </Button>
        {healMode && (
          <Button
            variant="neutral"
            size="sm"
            onClick={onExitHealMode}
            title="Hide handles on the canvas (H)"
            className="h-6 px-space-2 text-metadata gap-space-1 ml-auto"
          >
            <Check size={12} />Done
          </Button>
        )}
        {!healMode && spots.length >= MAX_HEAL_SPOTS && (
          <span className="ml-auto text-metadata text-text-muted">Max {MAX_HEAL_SPOTS}</span>
        )}
      </div>

 {/* Visualise Spots: only surfaced while the heal
          tool is active, mirroring LR's binding scope. The button is
          a toggle; the slider lives below it and only shows when the
          visualisation is engaged so the panel stays compact at rest. */}
      {healMode && (
        <div className="px-space-5 pb-space-2">
          <Button
            variant={visualizeSpots ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onVisualizeSpotsChange(!visualizeSpots)}
            title="Toggle high-contrast spot view (A)"
            className="h-6 px-space-2 text-metadata gap-space-1 w-full justify-start"
          >
            <Eye size={12} />
            Visualize Spots
            <span className="ml-auto font-mono text-text-muted">A</span>
          </Button>
          {visualizeSpots && (
            <Slider
              label="Sensitivity"
              value={visualizeSensitivity}
              defaultValue={0.5}
              min={0}
              max={1}
              step={0.01}
              onChange={onVisualizeSensitivityChange}
              onReset={() => onVisualizeSensitivityChange(0.5)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </div>
      )}

      {spots.length === 0 && (
        <p className="px-space-5 py-1 text-caption text-text-muted leading-tight">
          Add a spot, then drag the destination (solid circle) and source (dashed circle) on the canvas.
        </p>
      )}

      {spots.map((s, idx) => {
        const isSelected = s.id === selectedId
        const Icon = s.mode === 'heal' ? Bandage : Stamp
        return (
          <div key={s.id} className={cn('border-t border-border-subtle transition-colors',
            isSelected ? 'bg-accent-primary/10' : '',
          )}>
            <div
              className="flex items-center gap-space-2 px-space-4 py-1.5 cursor-pointer hover:bg-surface-workspace transition-colors"
              onClick={() => onSelect(isSelected ? null : s.id)}
            >
              <Icon size={14} className="text-accent-primary" />
              <span className="flex-1 text-body text-text-default">
                {s.mode === 'heal' ? 'Heal' : 'Clone'} #{idx + 1}
              </span>
              <IconButton
                icon={<Trash2 size={14} />}
                aria-label="Remove"
                onClick={(e) => { e.stopPropagation(); remove(s.id) }}
                className="w-6 h-6 p-0 bg-transparent hover:bg-transparent text-text-muted hover:text-status-danger"
              />
            </div>

            {isSelected && selected && (
              <div className="pb-1">
                <div className="flex items-center gap-space-2 px-space-5 py-1.5 text-metadata">
                  <span className="text-text-muted flex-1">Mode</span>
                  {(['heal', 'clone'] as const).map((m: HealMode) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={selected.mode === m ? 'secondary' : 'outline'}
                      onClick={() => update(s.id, { mode: m })}
                      className="h-5 px-space-2 text-metadata"
                    >
                      {m === 'heal' ? 'Heal' : 'Clone'}
                    </Button>
                  ))}
                </div>
                <Slider
                  label="Size"
                  value={selected.radius}
                  min={0.005}
                  max={0.25}
                  step={0.005}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                  onChange={(v) => update(s.id, { radius: v })}
                  onReset={() => update(s.id, { radius: DEFAULT_HEAL_SPOT.radius })}
                />
                <Slider
                  label="Feather"
                  value={selected.feather}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update(s.id, { feather: v })}
                  onReset={() => update(s.id, { feather: DEFAULT_HEAL_SPOT.feather })}
                />
                <Slider
                  label="Opacity"
                  value={selected.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update(s.id, { opacity: v })}
                  onReset={() => update(s.id, { opacity: DEFAULT_HEAL_SPOT.opacity })}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
