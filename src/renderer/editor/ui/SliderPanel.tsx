import { useEffect, useState } from 'react'
import { Sun, Palette, RotateCcw, Flame, ChevronDown } from 'lucide-react'
import { Inspector } from '@/components/ui/inspector'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Slider } from './Slider'
import { Histogram } from './Histogram'
import { ToneCurveEditor } from './ToneCurveEditor'
import { HslPanel } from './HslPanel'
import { SelectiveColorPanel } from './SelectiveColorPanel'
import { BlackWhitePanel } from './BlackWhitePanel'
import { ColorGradingPanel } from './ColorGradingPanel'
import { DefringePanel } from './DefringePanel'
import { DetailPanel } from './DetailPanel'
import { CalibrationPanel } from './CalibrationPanel'
import { GeometryPanel } from './GeometryPanel'
import { TransformPanel } from './TransformPanel'
import { FramePanel } from './FramePanel'
import { DimensionPanel } from './DimensionPanel'
import type { ParamsStore } from '../state/params-store'
import { DEFAULT_PARAMS } from '../../../shared/edit-params'
import type { EditParams } from '@/types'
import { SlidersHorizontal, Droplet, Grid3x3, Circle, Crop, Frame, Layers, CircleDot, Aperture, Sparkles } from 'lucide-react'
import { MaskPanel } from './MaskPanel'
import type { BrushSettings } from './brush-settings'
import { HealPanel } from './HealPanel'
import { Bandage } from 'lucide-react'
import { LightLeakPanel } from './LightLeakPanel'
import { VignettePanel } from './VignettePanel'
import { Button } from '@/components/ui/button'

interface SliderPanelProps {
  store: ParamsStore
  histogram: { r: Uint32Array; g: Uint32Array; b: Uint32Array } | null
  imageDims: { w: number; h: number } | null
  /** Currently selected mask ID for canvas handle display. */
  selectedMaskId: string | null
  onMaskSelect: (id: string | null) => void
  /** Currently selected heal/clone spot ID for canvas handle display. */
  selectedHealId: string | null
  onHealSelect: (id: string | null) => void
  /** Whether the heal/clone overlay is mounted on the canvas. The
   *  panel renders a "Done" button when true so the user can hide
   *  the handles without needing the H hotkey. */
  healMode: boolean
  onExitHealMode: () => void
 /** Visualise Spots: diagnostic Laplacian view scoped
   *  to the heal tool. The HealPanel renders the toggle + sensitivity
   *  slider; state lives at EditorView so the A hotkey can target it. */
  visualizeSpots: boolean
  onVisualizeSpotsChange: (next: boolean) => void
  visualizeSensitivity: number
  onVisualizeSensitivityChange: (next: number) => void
  /** Brush tool settings: lifted to EditorView so the canvas paint
   *  overlay reads the same values the panel renders sliders for. */
  brushSettings: BrushSettings
  onBrushSettingsChange: (next: BrushSettings) => void
  /** Source ImageBitmap accessor: used for preset thumbnails. */
  /** Fires when the user presses (and releases) a slider's eye affordance.
   *  Receives a patcher that maps current params to a one-field-swapped
   *  copy (the compared field at its default); `null` on release. Each
   *  slider builds its own patcher, so nested fields (HSL band, SC band,
   *  B&W channel) are handled without a central switch. */
  onCompareChange?: (fn: ((p: EditParams) => EditParams) | null) => void
}

export function SliderPanel({ store, histogram, imageDims, selectedMaskId, onMaskSelect, selectedHealId, onHealSelect, healMode, onExitHealMode, visualizeSpots, onVisualizeSpotsChange, visualizeSensitivity, onVisualizeSensitivityChange, brushSettings, onBrushSettingsChange, onCompareChange }: SliderPanelProps) {
  const [params, setParams] = useState<EditParams>(store.get())

  useEffect(() => store.subscribe(setParams), [store])

  const dirty = (Object.keys(DEFAULT_PARAMS) as (keyof EditParams)[]).some(k => params[k] !== DEFAULT_PARAMS[k])

  // Tiny helpers so every scalar Slider's compare wiring is one word.
  // `cmp(key)` builds a patcher that swaps a single top-level field to
  // its default; `cmpUp` clears the override on release. Both are noops
  // when the parent didn't supply an `onCompareChange`.
  const cmp = <K extends keyof EditParams>(key: K) =>
    onCompareChange
      ? () => onCompareChange((p) => ({ ...p, [key]: DEFAULT_PARAMS[key] }))
      : undefined
  const cmpUp = onCompareChange ? () => onCompareChange(null) : undefined

  return (
    <Inspector
      title="Adjustments"
      icon={<SlidersHorizontal size={12} className="text-text-muted" />}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const previous = { ...store.get() }
            store.reset()
            toast('All adjustments reset', {
              action: { label: 'Undo', onClick: () => {
                for (const k of Object.keys(previous) as (keyof EditParams)[]) store.set(k, previous[k])
              }},
              duration: 5000,
            })
          }}
          disabled={!dirty}
          className="gap-space-1 text-metadata text-text-muted hover:text-text-emphatic px-2"
          title="Reset all adjustments"
        >
          <RotateCcw size={12} />
          Reset
        </Button>
      }
      className="w-72"
    >
      <>
        {histogram && (
          <div className="px-space-4 pt-space-3 pb-space-2 border-b border-border-subtle">
            <Histogram data={histogram} width={248} height={44} />
          </div>
        )}
        {/* ── Global tone & colour ──
            The bedrock of any edit: exposure shape, white balance,
            the curve. Top of the panel because every photo gets
            touched here, and getting these right first means every
            downstream group operates on a sound base. */}
        <Group icon={<Sun size={12} />} label="Light">
          <Slider label="Exposure" value={params.exposure} min={-3} max={3} step={0.05} onChange={v => store.set('exposure', v)} onReset={() => store.reset('exposure')} format={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`} onCompareDown={cmp('exposure')} onCompareUp={cmpUp} />
          <Slider label="Contrast"   value={params.contrast}   min={-0.5} max={0.5} onChange={v => store.set('contrast', v)}   onReset={() => store.reset('contrast')} onCompareDown={cmp('contrast')} onCompareUp={cmpUp} />
          <Slider label="Highlights" value={params.highlights} min={-1} max={1} onChange={v => store.set('highlights', v)} onReset={() => store.reset('highlights')} onCompareDown={cmp('highlights')} onCompareUp={cmpUp} />
          <Slider label="Shadows"    value={params.shadows}    min={-1} max={1} onChange={v => store.set('shadows', v)}    onReset={() => store.reset('shadows')} onCompareDown={cmp('shadows')} onCompareUp={cmpUp} />
          <Slider label="Whites"     value={params.whites}     min={-1} max={1} onChange={v => store.set('whites', v)}     onReset={() => store.reset('whites')} onCompareDown={cmp('whites')} onCompareUp={cmpUp} />
          <Slider label="Blacks"     value={params.blacks}     min={-1} max={1} onChange={v => store.set('blacks', v)}     onReset={() => store.reset('blacks')} onCompareDown={cmp('blacks')} onCompareUp={cmpUp} />
        </Group>
        <Group icon={<Palette size={12} />} label="Color">
          <Slider label="Temperature" value={params.temperature} min={-5000} max={5000} step={50} onChange={v => store.set('temperature', v)} onReset={() => store.reset('temperature')} format={v => `${v >= 0 ? '+' : ''}${v.toFixed(0)}K`} onCompareDown={cmp('temperature')} onCompareUp={cmpUp} />
          <Slider label="Tint"        value={params.tint}        min={-1} max={1} onChange={v => store.set('tint', v)}        onReset={() => store.reset('tint')} onCompareDown={cmp('tint')} onCompareUp={cmpUp} />
          <Slider label="Vibrance"    value={params.vibrance}    min={-1} max={1} onChange={v => store.set('vibrance', v)}    onReset={() => store.reset('vibrance')} onCompareDown={cmp('vibrance')} onCompareUp={cmpUp} />
          <Slider label="Saturation"  value={params.saturation}  min={-1} max={1} onChange={v => store.set('saturation', v)}  onReset={() => store.reset('saturation')} onCompareDown={cmp('saturation')} onCompareUp={cmpUp} />
        </Group>
        <Group icon={<SlidersHorizontal size={12} />} label="Curves">
          <ToneCurveEditor curve={params.toneCurve} histogram={histogram} onChange={(c) => store.set('toneCurve', c)} />
        </Group>

        {/* ── Colour refinement ──
            Per-hue, per-band, and tonal-band tinting. Sits between
            global colour and detail because these are creative
            choices that read against the global tone. Black & White
            anchors the bottom of this block: once you flip to mono
            the per-hue controls become a channel mixer rather than
            a colour edit. */}
        <Group icon={<Droplet size={12} />} label="HSL">
          <HslPanel
            hsl={params.hsl}
            onChange={(h) => store.set('hsl', h)}
            onCompareChange={onCompareChange}
          />
        </Group>
        <Group icon={<Layers size={12} />} label="Selective Color">
          <SelectiveColorPanel
            value={params.selectiveColor}
            onChange={(v) => store.set('selectiveColor', v)}
            onCompareChange={onCompareChange}
          />
        </Group>
        <Group icon={<Palette size={12} />} label="Colour Grading">
          <ColorGradingPanel
            value={params.colorGrading}
            onChange={(cg) => store.set('colorGrading', cg)}
            onCompareChange={onCompareChange}
          />
        </Group>
        <Group icon={<Circle size={12} />} label="Black & White">
          <BlackWhitePanel
            bw={params.bw}
            onChange={(b) => store.set('bw', b)}
            onCompareChange={onCompareChange}
          />
        </Group>

        {/* ── Detail & corrections ──
            Sharpening, noise reduction, defringe: all are
            corrective rather than creative. They sit before local
            adjustments because mask-driven tweaks should land on
            already-clean pixels. */}
        <Group icon={<Sparkles size={12} />} label="Detail">
          <DetailPanel
            sharpening={params.sharpening}
            noiseReduction={params.noiseReduction}
            texture={params.texture}
            clarity={params.clarity}
            dehaze={params.dehaze}
            onSharpeningChange={(s) => store.set('sharpening', s)}
            onNoiseReductionChange={(n) => store.set('noiseReduction', n)}
            onTextureChange={(v) => store.set('texture', v)}
            onClarityChange={(v) => store.set('clarity', v)}
            onDehazeChange={(v) => store.set('dehaze', v)}
          />
        </Group>
        {/* ── Local adjustments ──
            Mask-driven tone (non-destructive) and heal/clone (local
            pixels, destructive). Ordered by escalating commitment. */}
        <Group icon={<Layers size={12} />} label="Masks">
          <MaskPanel
            masks={params.masks}
            selectedId={selectedMaskId}
            onSelect={onMaskSelect}
            onChange={(next) => store.set('masks', next)}
            brushSettings={brushSettings}
            onBrushSettingsChange={onBrushSettingsChange}
          />
        </Group>
        <Group icon={<Bandage size={12} />} label="Heal & Clone">
          <HealPanel
            spots={params.healSpots}
            selectedId={selectedHealId}
            onSelect={onHealSelect}
            onChange={(next) => store.set('healSpots', next)}
            healMode={healMode}
            onExitHealMode={onExitHealMode}
            visualizeSpots={visualizeSpots}
            onVisualizeSpotsChange={onVisualizeSpotsChange}
            visualizeSensitivity={visualizeSensitivity}
            onVisualizeSensitivityChange={onVisualizeSensitivityChange}
          />
        </Group>
        {/* ── Lens & geometry ──
            Defringe leads the block: it's a chromatic-aberration
            correction (a lens fix), so it groups with Geometry /
            Transform / Lens Distortion rather than the global
            colour adjustments above. Crop / rotate / straighten and
            output sizing live near the bottom: Lightroom convention.
            Re-cropping mid-edit is uncommon enough that the panel
            space up top should go to the controls users actually
            return to. The decorative Frame slot rounds out the
            output block since it's applied at export. */}
        <Group icon={<Aperture size={12} />} label="Defringe">
          <DefringePanel value={params.defringe} onChange={(d) => store.set('defringe', d)} />
        </Group>
        <Group icon={<Crop size={12} />} label="Geometry">
          <GeometryPanel
            orientation={params.orientation}
            flipH={params.flipH}
            straightenDeg={params.straightenDeg}
            imageDims={imageDims}
            onOrientationChange={(v) => store.set('orientation', v)}
            onFlipChange={(v) => store.set('flipH', v)}
            onStraightenChange={(v) => store.set('straightenDeg', v)}
            onStraightenReset={() => store.reset('straightenDeg')}
            onCropChange={(v) => {
              // The GeometryPanel computes an "inscribed auto-crop" for
              // straighten angles. However, when a frame is active, the
              // composition is already constrained by the frame cutout and
              // the user expects their manual pan/zoom to be preserved.
              // We skip the auto-crop reset in frame mode.
              if (!params.frame) store.set('crop', v)
            }}
          />
        </Group>
        <Group icon={<Crop size={12} />} label="Transform">
          <TransformPanel
            perspective={params.perspective}
            lensDistortion={params.lensDistortion}
            onPerspectiveChange={(p) => store.set('perspective', p)}
            onLensDistortionChange={(v) => store.set('lensDistortion', v)}
          />
        </Group>
        <Group icon={<Crop size={12} />} label="Dimensions">
          <DimensionPanel
            crop={params.crop}
            imageDims={imageDims}
            onChange={(v) => store.set('crop', v)}
          />
        </Group>
        <Group icon={<Frame size={12} />} label="Frame">
          <FramePanel value={params.frame} onChange={(v) => store.set('frame', v)} />
        </Group>

        {/* ── Stylise / finish ──
            Subtle to dramatic. Vignette is the gentlest finish,
            grain adds surface texture, film leaks are the strongest
            stylisation. Ordered low-to-high so a user reading
            top-to-bottom can stop at the level they want. */}
        <Group icon={<CircleDot size={12} />} label="Vignette">
          <VignettePanel value={params.vignette} onChange={(v) => store.set('vignette', v)} />
        </Group>
        <Group icon={<Grid3x3 size={12} />} label="Grain">
          <Slider
            label="Amount"
            value={params.noiseAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => store.set('noiseAmount', v)}
            onReset={() => store.reset('noiseAmount')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Size"
            value={params.noiseSize}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => store.set('noiseSize', v)}
            onReset={() => store.reset('noiseSize')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Frequency"
            value={params.noiseFrequency}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => store.set('noiseFrequency', v)}
            onReset={() => store.reset('noiseFrequency')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="px-space-5 py-1.5">
            <div className="flex items-center gap-space-2 text-metadata">
              <span className="text-text-muted flex-1">Distribution</span>
              {(['uniform', 'gaussian'] as const).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={params.noiseDistribution === d ? 'secondary' : 'outline'}
                  onClick={() => store.set('noiseDistribution', d)}
                  className="h-6 px-space-2 text-metadata capitalize"
                >
                  {d}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-space-2 px-space-5 py-1.5 text-metadata text-text-muted hover:text-text-emphatic cursor-pointer transition-colors">
            <input /* eslint-disable-line no-restricted-syntax -- design-allow: a panel micro-control drawn to the row, not a chrome button */
              type="checkbox"
              checked={params.noiseMono}
              onChange={(e) => store.set('noiseMono', e.target.checked)}
              className="accent-accent-primary"
            />
            <span className="font-medium">Monochromatic</span>
          </label>
        </Group>
        <Group icon={<Flame size={12} />} label="Film Effects">
          <LightLeakPanel value={params.lightLeak} onChange={(v) => store.set('lightLeak', v)} />
        </Group>

        {/* ── Calibration ──
            PV2012 per-primary hue + sat biases. Sits last in the
            panel because it's a colorimetric foundation, not a
            creative tweak: most users never open it, but premium
            Lightroom presets bake on top of these values so we
            need them for accurate import. */}
        <Group icon={<Aperture size={12} />} label="Calibration">
          <CalibrationPanel
            value={params.calibration}
            onChange={(c) => store.set('calibration', c)}
            onCompareChange={onCompareChange}
          />
        </Group>
      </>
    </Inspector>
  )
}

// Per-group expanded state, persisted in localStorage so the user's
// chosen layout survives reloads. Keyed by label. Labels are stable
// human strings that double as natural identifiers.
const GROUPS_STORAGE_KEY = 'cernix.editor.panelGroups'

function loadGroupsState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUPS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // Malformed JSON or storage unavailable. Fall through to defaults.
  }
  return {}
}

function persistGroupsState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota / privacy mode. Collapse state just won't persist.
  }
}

function Group({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState<boolean>(() => loadGroupsState()[label] ?? true)

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev
      const all = loadGroupsState()
      all[label] = next
      persistGroupsState(all)
      return next
    })
  }

  return (
    <section className="border-b border-border-subtle py-space-3">
      <button /* eslint-disable-line no-restricted-syntax -- design-allow: a panel micro-control drawn to the row, not a chrome button */
        type="button"
        onClick={toggle}
        className={cn(
          'w-full px-space-5 flex items-center gap-space-1.5 text-metadata font-medium text-text-muted uppercase tracking-widest hover:text-text-emphatic transition-colors',
          // The gap belongs to the header's relationship with its
          // children, so it goes when they do. Kept unconditionally it
          // sat under a collapsed group with nothing beneath it, and
          // the section's own symmetric py-space-3 then read as 12px
          // above the label against 20px below. A row of collapsed
          // groups all looking a little high in their own box.
          expanded && 'pb-space-2',
        )}
        aria-expanded={expanded}
      >
        {icon}
        {label}
        <ChevronDown
          size={12}
          className={cn('ml-auto transition-transform', !expanded && '-rotate-90')}
        />
      </button>
      {expanded && children}
    </section>
  )
}
