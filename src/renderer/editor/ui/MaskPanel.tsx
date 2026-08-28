import { useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, AlignJustify, Circle, Brush, Eraser, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BrushSettings } from './brush-settings'
import { Slider } from './Slider'
import {
  DEFAULT_MASK_ADJUSTMENTS, DEFAULT_RANGE_MASK, DEFAULT_BRUSH_MASK,
  DEFAULT_HSL, DEFAULT_COLOR_GRADING, DEFAULT_CALIBRATION, DEFAULT_TONE_CURVE,
} from '../../../shared/edit-params'
import type { Mask, LinearMask, RadialMask, BrushMask, ToneCurve } from '@/types'
import type { RangeMask, RangeMaskMode, HslAdjustments, ColorGrading, Calibration } from '@/../shared/edit-params'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { HslPanel } from './HslPanel'
import { ColorGradingPanel } from './ColorGradingPanel'
import { CalibrationPanel } from './CalibrationPanel'
import { ToneCurveEditor } from './ToneCurveEditor'


interface MaskPanelProps {
  masks: Mask[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (next: Mask[]) => void
  /** Tool-state brush settings, lifted to the parent so the canvas
   *  paint overlay can read the same values. */
  brushSettings: BrushSettings
  onBrushSettingsChange: (next: BrushSettings) => void
  /** Synchronous accessor for the current source ImageBitmap. Null
   *  when no image is loaded. */
}

/** Default linear-gradient shape: top half of the image at full strength, fades to centre. */
const DEFAULT_LINEAR_SHAPE: LinearMask = { startX: 0.5, startY: 0.0, endX: 0.5, endY: 0.5 }

/** Default radial shape: comfortable oval centred mid-frame, feather 0.5. */
const DEFAULT_RADIAL_SHAPE: RadialMask = { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.2, feather: 0.5, invert: false }

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

const fmtSigned2 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`

/** Per-mask sliders, grouped by global-panel section. The
 *  `section` field on the first slider of each group renders a tiny
 *  header in the expanded card; subsequent sliders sit under it. */
const MASK_ADJUSTMENT_SLIDERS = [
  { key: 'exposure'      as const, label: 'Exposure',      min: -3,    max: 3,    step: 0.05, fmt: fmtSigned2,                                                     section: 'Light' },
  { key: 'contrast'      as const, label: 'Contrast',      min: -0.5,  max: 0.5,  step: 0.01, fmt: fmtSigned2 },
  { key: 'highlights'    as const, label: 'Highlights',    min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'shadows'       as const, label: 'Shadows',       min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'whites'        as const, label: 'Whites',        min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'blacks'        as const, label: 'Blacks',        min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },

  { key: 'temperature'   as const, label: 'Temperature',   min: -5000, max: 5000, step: 50,   fmt: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}K`,           section: 'Color' },
  { key: 'tint'          as const, label: 'Tint',          min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'saturation'    as const, label: 'Saturation',    min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'vibrance'      as const, label: 'Vibrance',      min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },

  { key: 'texture'       as const, label: 'Texture',       min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2,                                                     section: 'Presence' },
  { key: 'clarity'       as const, label: 'Clarity',       min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'dehaze'        as const, label: 'Dehaze',        min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },

  { key: 'sharpenAmount' as const, label: 'Sharpen',       min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2,                                                     section: 'Detail' },
  { key: 'nrLuma'        as const, label: 'NR Luminance',  min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
  { key: 'nrColor'       as const, label: 'NR Color',      min: -1,    max: 1,    step: 0.01, fmt: fmtSigned2 },
] as const

/**
 * Panel listing all masks with add / toggle / delete controls, and
 * per-mask slider expansion when a card is selected.
 *
 * onChange is the only write path. It replaces the whole array so
 * ParamsStore can do reference equality checks cleanly.
 */
export function MaskPanel({
  masks,
  selectedId,
  onSelect,
  onChange,
  brushSettings,
  onBrushSettingsChange,
}: MaskPanelProps) {
  /** Which mask rows have their adjustments open. */
  const [localSliders, setLocalSliders] = useState<Record<string, boolean>>({})

  const isExpanded = (id: string) => localSliders[id] ?? false
  const toggleExpand = (id: string) => setLocalSliders(s => ({ ...s, [id]: !s[id] }))

  const add = (type: 'linear' | 'radial' | 'brush') => {
    let shape: Mask['shape']
    if (type === 'linear')      shape = { ...DEFAULT_LINEAR_SHAPE }
    else if (type === 'radial') shape = { ...DEFAULT_RADIAL_SHAPE }
    else                        shape = { ...DEFAULT_BRUSH_MASK, strokes: [] }
    const mask: Mask = {
      id: makeId(),
      type,
      enabled: true,
      shape,
      adjustments: { ...DEFAULT_MASK_ADJUSTMENTS },
    }
    const next = [...masks, mask]
    onChange(next)
    onSelect(mask.id)
  }

  const remove = (id: string) => {
    onChange(masks.filter(m => m.id !== id))
    if (selectedId === id) onSelect(null)
  }

  const toggle = (id: string) => {
    onChange(masks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))
  }

  const updateAdjustment = (id: string, key: keyof Mask['adjustments'], value: number) => {
    onChange(masks.map(m =>
      m.id === id ? { ...m, adjustments: { ...m.adjustments, [key]: value } } : m,
    ))
  }

  const resetAdjustment = (id: string, key: keyof Mask['adjustments']) => {
    onChange(masks.map(m =>
      m.id === id ? { ...m, adjustments: { ...m.adjustments, [key]: 0 } } : m,
    ))
  }

  // ── Per-mask vector params ──
  // Each block (HSL / Color Grading / Calibration) is optional. Set
  // the field to add the panel; pass `undefined` to remove it. The
  // shader's identity short-circuit keeps the cost at zero when a
  // block is absent.
  const setMaskHsl = (id: string, hsl: HslAdjustments | undefined) => {
    onChange(masks.map(m => m.id === id ? { ...m, hsl } : m))
  }
  const setMaskColorGrading = (id: string, cg: ColorGrading | undefined) => {
    onChange(masks.map(m => m.id === id ? { ...m, colorGrading: cg } : m))
  }
  const setMaskCalibration = (id: string, cal: Calibration | undefined) => {
    onChange(masks.map(m => m.id === id ? { ...m, calibration: cal } : m))
  }
  const setMaskToneCurve = (id: string, curve: ToneCurve | undefined) => {
    onChange(masks.map(m => m.id === id ? { ...m, toneCurve: curve } : m))
  }

  const setRange = (id: string, patch: Partial<RangeMask>) => {
    onChange(masks.map(m => {
      if (m.id !== id) return m
      const current = m.range ?? { ...DEFAULT_RANGE_MASK }
      return { ...m, range: { ...current, ...patch } }
    }))
  }

  const setRangeMode = (id: string, mode: RangeMaskMode) => {
    setRange(id, { mode })
  }

  const clearBrushStrokes = (id: string) => {
    onChange(masks.map(m => {
      if (m.id !== id || m.type !== 'brush') return m
      return { ...m, shape: { ...DEFAULT_BRUSH_MASK, strokes: [] } }
    }))
  }

  const MAX = 8

  return (
    <div className="py-1">
      {/* Add buttons. flex-wrap so the 4 manual mask types reflow to
          a second row when the sidebar is narrow. */}
      <div className="flex flex-wrap items-center gap-space-1 px-space-5 pb-space-2">
        <Button
          variant="outline"
          size="sm"
          disabled={masks.length >= MAX}
          onClick={() => add('linear')}
          title="Add linear-gradient mask"
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Plus size={10} /><AlignJustify size={12} />Linear
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={masks.length >= MAX}
          onClick={() => add('radial')}
          title="Add radial mask"
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Plus size={10} /><Circle size={12} />Radial
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={masks.length >= MAX}
          onClick={() => add('brush')}
          title="Add brush mask"
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Plus size={10} /><Brush size={12} />Brush
        </Button>
        {masks.length >= MAX && (
          <span className="ml-auto text-metadata text-text-muted">Max {MAX}</span>
        )}
      </div>
      {masks.length === 0 && (
        <p className="px-space-5 py-1 text-caption text-text-muted leading-tight">
          Add a linear or radial mask, then use <kbd className="font-mono text-metadata bg-surface-workspace px-1 rounded-sm text-text-emphatic">A</kbd> to toggle handles on the canvas.
        </p>
      )}

      {/* Mask cards */}
      {masks.map((m) => {
        const isSelected = m.id === selectedId
        const expanded   = isExpanded(m.id)

        return (
          <div key={m.id} className={cn('border-t border-border-subtle transition-colors',
            isSelected ? 'bg-accent-primary/10' : '',
          )}>
            {/* Card header */}
            <div
              className="flex items-center gap-space-2 px-space-4 py-1.5 cursor-pointer hover:bg-surface-workspace transition-colors"
              // Always select on row click (never deselect) so the
              // brush preview / handle stays mounted when the user
              // clicks the row a second time to expand the options.
              // Deselection still happens implicitly when the user
              // clicks a *different* mask. Expand/collapse toggles
              // independently of selection.
              onClick={() => { onSelect(m.id); toggleExpand(m.id) }}
            >
              {/* Type icon */}
              {m.type === 'linear'     && <AlignJustify size={14} className={cn(m.enabled ? 'text-accent-primary' : 'text-text-disabled')} />}
              {m.type === 'radial'     && <Circle        size={14} className={cn(m.enabled ? 'text-accent-primary' : 'text-text-disabled')} />}
              {m.type === 'brush'      && <Brush         size={14} className={cn(m.enabled ? 'text-accent-primary' : 'text-text-disabled')} />}

              {/* Label */}
              <span className={cn('flex-1 text-body', m.enabled ? 'text-text-default' : 'text-text-muted')}>
                {m.type === 'linear' ? 'Linear'
                  : m.type === 'radial' ? 'Radial'
                  : 'Brush'}
              </span>

              {/* Has-adjustments dot */}
              {Object.values(m.adjustments).some(v => v !== 0) && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-primary/60" title="Has adjustments" />
              )}

              {/* Enable/disable toggle */}
              <IconButton
                icon={m.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                aria-label={m.enabled ? 'Disable' : 'Enable'}
                onClick={(e) => { e.stopPropagation(); toggle(m.id) }}
                className="w-6 h-6 p-0 bg-transparent hover:bg-transparent text-text-muted hover:text-text-emphatic"
              />

              {/* Delete */}
              <IconButton
                icon={<Trash2 size={14} />}
                aria-label="Remove"
                onClick={(e) => { e.stopPropagation(); remove(m.id) }}
                className="w-6 h-6 p-0 bg-transparent hover:bg-transparent text-text-muted hover:text-status-danger"
              />
            </div>

            {/* Per-mask sliders (expanded inline) */}
            {expanded && (
              <div className="pb-1">
                {m.type === 'brush' && (
                  <BrushSettingsControls
                    settings={brushSettings}
                    onChange={onBrushSettingsChange}
                    strokeCount={(m.shape as BrushMask).strokes.length}
                    onClearStrokes={() => clearBrushStrokes(m.id)}
                  />
                )}
                {MASK_ADJUSTMENT_SLIDERS.map((s) => (
                  <div key={s.key}>
                    {'section' in s && s.section && (
                      <div className="px-space-5 pt-space-2 pb-space-1 text-caption font-mono uppercase tracking-widest text-text-disabled">
                        {s.section}
                      </div>
                    )}
                    <Slider
                      label={s.label}
                      value={m.adjustments[s.key]}
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      format={s.fmt}
                      onChange={(v) => updateAdjustment(m.id, s.key, v)}
                      onReset={() => resetAdjustment(m.id, s.key)}
                    />
                  </div>
                ))}
 {/* Per-mask vector blocks. Each is opt-in:
                    "Add" buttons inflate to a full panel; "Remove"
                    drops the block (renders as identity, zero shader
                    cost). Mirrors the global panels exactly so the UX
                    transfers from Develop to Mask without learning. */}
                <MaskVectorSection
                  label="Color Mix"
                  isSet={!!m.hsl}
                  onAdd={() => setMaskHsl(m.id, { ...DEFAULT_HSL })}
                  onRemove={() => setMaskHsl(m.id, undefined)}
                >
                  {m.hsl && (
                    <HslPanel
                      hsl={m.hsl}
                      onChange={(next) => setMaskHsl(m.id, next)}
                    />
                  )}
                </MaskVectorSection>
                <MaskVectorSection
                  label="Color Grading"
                  isSet={!!m.colorGrading}
                  onAdd={() => setMaskColorGrading(m.id, JSON.parse(JSON.stringify(DEFAULT_COLOR_GRADING)))}
                  onRemove={() => setMaskColorGrading(m.id, undefined)}
                >
                  {m.colorGrading && (
                    <ColorGradingPanel
                      value={m.colorGrading}
                      onChange={(next) => setMaskColorGrading(m.id, next)}
                    />
                  )}
                </MaskVectorSection>
                <MaskVectorSection
                  label="Calibration"
                  isSet={!!m.calibration}
                  onAdd={() => setMaskCalibration(m.id, JSON.parse(JSON.stringify(DEFAULT_CALIBRATION)))}
                  onRemove={() => setMaskCalibration(m.id, undefined)}
                >
                  {m.calibration && (
                    <CalibrationPanel
                      value={m.calibration}
                      onChange={(next) => setMaskCalibration(m.id, next)}
                    />
                  )}
                </MaskVectorSection>
                <MaskVectorSection
                  label="Tone Curve"
                  isSet={!!m.toneCurve}
                  onAdd={() => setMaskToneCurve(m.id, JSON.parse(JSON.stringify(DEFAULT_TONE_CURVE)))}
                  onRemove={() => setMaskToneCurve(m.id, undefined)}
                >
                  {m.toneCurve && (
                    <div className="px-space-5 pb-space-2">
                      <ToneCurveEditor
                        curve={m.toneCurve}
                        histogram={null}
                        onChange={(next) => setMaskToneCurve(m.id, next)}
                      />
                    </div>
                  )}
                </MaskVectorSection>
                <RangeMaskControls
                  range={m.range ?? DEFAULT_RANGE_MASK}
                  onMode={(mode) => setRangeMode(m.id, mode)}
                  onChange={(patch) => setRange(m.id, patch)}
                />
              </div>
            )}
          </div>
        )
      })}

    </div>
  )
}

// ── Brush tool settings ──

interface BrushSettingsControlsProps {
  settings: BrushSettings
  onChange: (next: BrushSettings) => void
  strokeCount: number
  onClearStrokes: () => void
}

/**
 * Brush tool controls. Rendered inline at the top of an expanded brush
 * mask card. Settings are the *current* paint configuration (each
 * stroke captures its own copy at draw time, so changing settings
 * doesn't retroactively repaint history).
 */
function BrushSettingsControls({
  settings, onChange, strokeCount, onClearStrokes,
}: BrushSettingsControlsProps) {
  const setMode = (mode: 'paint' | 'erase') => onChange({ ...settings, mode })
  return (
    <div>
      <div className="px-space-5 pb-space-1 flex items-center gap-space-1">
        <Button
          variant={settings.mode === 'paint' ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setMode('paint')}
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Brush size={12} />Paint
        </Button>
        <Button
          variant={settings.mode === 'erase' ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setMode('erase')}
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Eraser size={12} />Erase
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearStrokes}
          disabled={strokeCount === 0}
          className="h-6 px-space-2 text-metadata gap-space-1 ml-auto text-text-muted hover:text-status-danger"
          title={`Clear ${strokeCount} stroke${strokeCount === 1 ? '' : 's'}`}
        >
          <Trash2 size={12} />Clear
        </Button>
      </div>
      <Slider
        label="Size"
        value={settings.radius}
        defaultValue={0.06}
        min={0.005}
        max={0.4}
        step={0.001}
        onChange={(v) => onChange({ ...settings, radius: v })}
        onReset={() => onChange({ ...settings, radius: 0.06 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Hardness"
        value={settings.hardness}
        defaultValue={0.5}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...settings, hardness: v })}
        onReset={() => onChange({ ...settings, hardness: 0.5 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Opacity"
        value={settings.opacity}
        defaultValue={0.9}
        min={0.05}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ ...settings, opacity: v })}
        onReset={() => onChange({ ...settings, opacity: 0.9 })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <div className="px-space-5 pt-space-1 pb-space-2 text-caption font-mono text-text-disabled">
        {strokeCount === 0
          ? 'Click + drag on the canvas to paint.'
          : `${strokeCount} stroke${strokeCount === 1 ? '' : 's'} painted`}
      </div>
    </div>
  )
}

// ── Range-mask controls ──

const RANGE_MODES: { key: RangeMaskMode; label: string }[] = [
  { key: 'off',        label: 'Off'   },
  { key: 'luminance',  label: 'Luma'  },
  { key: 'color',      label: 'Color' },
]

function rgbTupleToHex(rgb: [number, number, number]): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
}

interface RangeMaskControlsProps {
  range: RangeMask
  onMode: (mode: RangeMaskMode) => void
  onChange: (patch: Partial<RangeMask>) => void
}

/**
 * Range-mask intersect picker. Shown inline at the bottom of each
 * expanded mask card. Mode tabs swap between off / luma-band / colour-
 * pick; the band sliders only render in the relevant mode so the panel
 * stays compact when the gate is off.
 */
function RangeMaskControls({ range, onMode, onChange }: RangeMaskControlsProps) {
  return (
    <div className="border-t border-border-subtle mt-space-2 pt-space-2">
      <div className="px-space-5 pb-space-2 text-caption font-mono uppercase tracking-widest text-text-disabled">
        Range
      </div>
      <div className="px-space-5 pb-space-2 grid grid-cols-3 gap-space-1">
        {RANGE_MODES.map(({ key, label }) => (
          <button /* eslint-disable-line no-restricted-syntax -- design-allow: a segmented range-mode control drawn to the panel grid */
            key={key}
            onClick={() => onMode(key)}
            className={cn(
              'h-6 px-2 rounded-soft border text-caption font-medium transition-colors',
              range.mode === key
                ? 'border-border-focus text-text-emphatic bg-overlay-hover'
                : 'border-border-subtle text-text-muted hover:text-text-emphatic hover:border-border-strong',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {range.mode === 'luminance' && (
        <>
          <Slider
            label="Min"
            value={range.min}
            defaultValue={0}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ min: v })}
            onReset={() => onChange({ min: 0 })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Max"
            value={range.max}
            defaultValue={1}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ max: v })}
            onReset={() => onChange({ max: 1 })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Feather"
            value={range.feather}
            defaultValue={0.2}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ feather: v })}
            onReset={() => onChange({ feather: 0.2 })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      )}

      {range.mode === 'color' && (
        <>
          <label className="flex items-center gap-space-2 px-space-5 py-1.5 text-metadata text-text-muted hover:text-text-emphatic cursor-pointer transition-colors">
            <span className="font-medium">Sample</span>
            <input /* eslint-disable-line no-restricted-syntax -- design-allow: a segmented range-mode control drawn to the panel grid */
              type="color"
              value={rgbTupleToHex(range.sampleColor)}
              onChange={(e) => onChange({ sampleColor: hexToRgbTuple(e.target.value) })}
              className="ml-auto w-6 h-5 border border-border-strong rounded-sm bg-transparent cursor-pointer p-0"
            />
          </label>
          <Slider
            label="Tolerance"
            value={range.feather}
            defaultValue={0.2}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ feather: v })}
            onReset={() => onChange({ feather: 0.2 })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      )}
    </div>
  )
}

// ── Per-mask vector section ──
//
// Wraps an opt-in vector panel (HSL / Color Grading / Calibration)
// inside the per-mask UI. When the mask hasn't set the block, shows
// an "Add <Section>" button; when set, shows a header strip with a
// remove affordance and the embedded panel below. Reusing the global
// panels keeps the UX identical and avoids any per-mask duplication
// of slider behaviour.
interface MaskVectorSectionProps {
  label: string
  isSet: boolean
  onAdd: () => void
  onRemove: () => void
  children?: React.ReactNode
}

function MaskVectorSection({ label, isSet, onAdd, onRemove, children }: MaskVectorSectionProps) {
  if (!isSet) {
    return (
      <div className="px-space-5 pt-space-2 pb-space-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="h-6 px-space-2 text-metadata gap-space-1"
        >
          <Plus size={10} />Add {label}
        </Button>
      </div>
    )
  }
  return (
    <div className="border-t border-border-subtle mt-space-1">
      <div className="flex items-center px-space-5 pt-space-2 pb-space-1">
        <span className="text-caption font-mono uppercase tracking-widest text-text-disabled">
          {label}
        </span>
        <IconButton
          variant="ghost"
          aria-label={`Remove ${label}`}
          icon={<X size={10} />}
          onClick={onRemove}
          className="ml-auto w-5 h-5 p-0 text-text-muted hover:text-status-danger"
        />
      </div>
      {children}
    </div>
  )
}
