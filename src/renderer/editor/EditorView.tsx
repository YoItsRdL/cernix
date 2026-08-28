import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { EditorCanvas } from './EditorCanvas'
import { SliderPanel } from './ui/SliderPanel'
import { DEFAULT_BRUSH_SETTINGS, type BrushSettings } from './ui/brush-settings'
import type { TatMode } from './ui/TargetedAdjustmentOverlay'
import { PresetGrid } from './ui/PresetGrid'
import { HistoryButton } from './ui/HistoryButton'
import { Button } from '@/components/ui/button'
import { ExportOptionsPopover, type ExportOptions } from './ui/ExportOptionsPopover'
import { EditorHeader } from './ui/EditorHeader'
import { ShortcutsOverlay } from './ui/ShortcutsOverlay'
import { StraightenCrosshair } from './ui/StraightenCrosshair'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState as UILoadingState } from '@/components/ui/loading-state'
import { ParamsStore } from './state/params-store'
import type { PreviewPipeline } from './pipeline/preview'
import { FULL_FRAME_CROP, IDENTITY_IMAGE_TRANSFORM, applyPresetOverCurrent } from '../../shared/edit-params'
import type { EditParams } from '../../shared/edit-params'
import { DURATION_FAST, EASE_STANDARD } from '@/lib/motion'

const FORMAT_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
}

export interface EditorFile {
  id: string
  name: string
  modifiedTime: string
  thumbnailLink?: string
  /** Absolute path to a local source file. When set, the editor reads
   *  params from this path directly instead of going through the Drive
   *  edit-cache. Used by the "Open File…" entry point to edit images
   *  that aren't part of the Drive-backed library. */
  localPath?: string
}

interface EditorViewProps {
  file: EditorFile
  onExit: () => void
}

type LoadState =
  | { phase: 'fetching'; done: number; total: number }
  | { phase: 'ready'; path: string }
  | { phase: 'error'; message: string }

export function EditorView({ file, onExit }: EditorViewProps) {
  const [state, setState] = useState<LoadState>({ phase: 'fetching', done: 0, total: 0 })
  const [histogram, setHistogram] = useState<{ r: Uint32Array; g: Uint32Array; b: Uint32Array } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [transforming, setTransforming] = useState(false)
  const [straightening, setStraightening] = useState(false)
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null)
  /** ID of the currently selected mask (for canvas handle display). */
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null)
  /** When true, the mask handle overlay is visible. */
  const [maskMode, setMaskMode] = useState(false)
  /** ID of the currently selected heal/clone spot. */
  const [selectedHealId, setSelectedHealId] = useState<string | null>(null)
  /** When true, the heal/clone overlay is visible and the canvas
   *  captures clicks for new spots. */
  const [healMode, setHealMode] = useState(false)
 /** Visualise Spots: heal-tool diagnostic that swaps
   *  the preview for a contrast-stretched Laplacian-of-luma view.
   *  Transient state, not in EditParams. Sensitivity persists in
   *  localStorage so the user's calibrated value survives reloads.
   *
   *  The visualisation only makes sense alongside the heal tool, so
   *  the exposed `visualizeSpots` is derived: the raw toggle AND the
   *  heal-mode flag. Skipping the effect means React Compiler stays
   *  happy and the value is automatically false the moment the user
   *  exits heal mode. No side-effect, no transient flash.
   */
  const [rawVisualizeSpots, setVisualizeSpots] = useState(false)
  const visualizeSpots = healMode && rawVisualizeSpots
  const [visualizeSensitivity, setVisualizeSensitivity] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('cernix.editor.visualizeSensitivity')
      const n = raw ? parseFloat(raw) : NaN
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5
    } catch { return 0.5 }
  })
  useEffect(() => {
    try { localStorage.setItem('cernix.editor.visualizeSensitivity', String(visualizeSensitivity)) }
    catch { /* private mode: fall through */ }
  }, [visualizeSensitivity])
  // A hotkey toggles the visualisation, gated to heal mode (matches
  // Lightroom's binding scope).
  useEffect(() => {
    if (!healMode) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        setVisualizeSpots(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [healMode])

 /** Preset grid: when open, the visual thumbnail
   *  browser sits next to the dropdown. State lives at this level so
   *  hovering a preset card can install a `compareOverride` that
   *  applies the preset to the live viewport at full res. */
  const [presetGridOpen, setPresetGridOpen] = useState(false)
  /** Ref to the Presets trigger button: passed into the PresetGrid
   *  so its outside-click handler ignores clicks on the trigger,
   *  letting a second click on the button close the popover. */
  const presetTriggerRef = useRef<HTMLButtonElement>(null)

 /** Targeted Adjustment Tool. T cycles through HSL
   *  Hue → Sat → Lum → Curve → off. Persistent within the session;
   *  not in EditParams (workspace concern). */
  const [tatMode, setTatMode] = useState<TatMode>('off')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      // Bare T cycles TAT modes. Ctrl/⌘+Alt+T is free-transform (handled
      // in the mode-hotkeys effect below). Gate on no-modifiers so the
      // two don't fire together.
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setTatMode(prev => {
          const cycle: TatMode[] = ['off', 'hsl-h', 'hsl-s', 'hsl-l', 'curve']
          return cycle[(cycle.indexOf(prev) + 1) % cycle.length]
        })
      }
      if (e.key === 'Escape' && tatMode !== 'off') {
        e.preventDefault()
        setTatMode('off')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tatMode])
  /** Brush tool state: radius / hardness / opacity / mode. Lifted to
   *  EditorView so the canvas paint overlay and the panel sliders read
   *  the same source. Each captured stroke embeds its own copy. */
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(DEFAULT_BRUSH_SETTINGS)
  /** When true, the canvas renders the source at DEFAULT_PARAMS so the
   *  user sees the untouched original. Driven by the hold-`\` keyboard
   *  gesture and the header Compare button; both paths set the same
   *  state so the visual flows identically whichever the user prefers. */
  const [comparing, setComparing] = useState(false)
  /** Per-slider compare: a patcher built by each slider that maps the
   *  current params to a one-field-swapped copy (that field at its
   *  default). Null when no slider is under compare. Stored as a function,
   *  so the `useState` setter needs the lambda wrap to avoid React's
   *  updater-fn heuristic. */
  const [compareOverride, setCompareOverride] = useState<((p: EditParams) => EditParams) | null>(null)
  const handleCompareChange = useCallback((fn: ((p: EditParams) => EditParams) | null) => {
    setCompareOverride(() => fn)
  }, [])
  const pipelineRef = useRef<PreviewPipeline | null>(null)
  const store = useMemo(() => new ParamsStore(), [])

  // Mirror whether *any* geometry has been touched (crop, rotation, flip,
  // straighten, or imageTransform) so the header can show a "restore"
  // affordance only when there's something to restore.
  // Initial value is computed lazily in the useState initialiser so the
  // effect body only carries the subscribe; setState inside the
  // subscribe callback is event-driven and React-Compiler-clean.
  const [hasGeometry, setHasGeometry] = useState<boolean>(() => checkHasGeometry(store.get()))
  useEffect(() => {
    return store.subscribe(p => setHasGeometry(checkHasGeometry(p)))
  }, [store])

  // Restore the image to its original, un-touched geometry. Clears every
  // field that affects how the image maps onto the canvas. The user gets
  // the source photo back exactly as imported, regardless of what chain
  // of operations got them to the current state.
  const restoreOriginal = useCallback(() => {
    store.set('crop', FULL_FRAME_CROP)
    store.set('imageTransform', IDENTITY_IMAGE_TRANSFORM)
    store.set('orientation', 0)
    store.set('flipH', false)
    store.set('straightenDeg', 0)
    setCropping(false)
    setTransforming(false)
  }, [store])

  // Before/after compare. Hold `\` to preview the untouched source.
  // Matches the iOS Photos "touch and hold to see original" muscle
  // memory; release snaps the edit back. The header Compare button
  // drives the same state via pointer down/up, so the visual is
  // identical regardless of which input the user prefers.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== '\\' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      setComparing(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== '\\') return
      setComparing(false)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  // Single source of truth for mode hotkeys (work regardless of focus).
  //   • C            → toggle crop mode
  //   • Shift+C      → restore original geometry (full frame, no rotation, identity transform)
  //   • Ctrl/⌘+Alt+T → toggle free-transform mode
  //   • R            → toggle straighten crosshair tool
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isRestore = (e.key === 'c' || e.key === 'C') && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      const isCropKey = (e.key === 'c' || e.key === 'C') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      const isFreeTransform = (e.key === 't' || e.key === 'T') && (e.ctrlKey || e.metaKey) && e.altKey
      const isStraighten   = (e.key === 'r' || e.key === 'R') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      const isMaskKey      = (e.key === 'a' || e.key === 'A') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      const isHealKey      = (e.key === 'h' || e.key === 'H') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      if (!isCropKey && !isFreeTransform && !isRestore && !isStraighten && !isMaskKey && !isHealKey) return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      e.preventDefault()
      if (isRestore) {
        restoreOriginal()
      } else if (isCropKey) {
        setCropping(v => !v)
        setTransforming(false)
        setStraightening(false)
      } else if (isFreeTransform) {
        setTransforming(v => !v)
        setCropping(false)
        setStraightening(false)
      } else if (isStraighten) {
        setStraightening(v => !v)
        setCropping(false)
        setTransforming(false)
        setMaskMode(false)
      } else if (isMaskKey) {
        setMaskMode(v => !v)
        setHealMode(false)
        setCropping(false)
        setTransforming(false)
        setStraightening(false)
      } else if (isHealKey) {
        setHealMode(v => !v)
        setMaskMode(false)
        setCropping(false)
        setTransforming(false)
        setStraightening(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restoreOriginal])

  const handleExport = async (opts: ExportOptions) => {
    if (!pipelineRef.current || exporting) return
    setExporting(true)
    const tid = toast.loading('Rendering export…')
    try {
      await store.flush()
      const { toAdjustments, toGeometry, exportImage } = await import('./pipeline/preview')
      const { findFrame } = await import('@/../shared/frame-presets')
      const { loadFrameBitmap } = await import('./frame-assets')
      const params = store.get()
      const framePreset = findFrame(params.frame)
      const frameOpt = framePreset
        ? { outer: framePreset.outer, cutout: framePreset.cutout, bitmap: await loadFrameBitmap(framePreset.id) }
        : undefined
      const source = pipelineRef.current.getSource()
      if (!source) throw new Error('Source image not available for export')
      const blob = await exportImage(
        source,
        toAdjustments(params),
        toGeometry(params),
        params.crop,
        {
          format: opts.format,
          quality: opts.quality,
          maxLongEdge: opts.maxLongEdge || undefined,
          frame: frameOpt,
        },
      )
      const bytes = await blob.arrayBuffer()
      const stem = file.name.replace(/\.[^.]+$/, '')
      const ext = FORMAT_EXT[opts.format] || 'jpg'
      const frameSuffix = framePreset ? `-${framePreset.id}` : ''
      const baseName = `${stem}-edit${frameSuffix}.${ext}`
      const sourceCachePath = state.phase === 'ready' ? state.path : null
      const sizeLabel = `${(blob.size / 1024 / 1024).toFixed(1)} MB`

      if (opts.destination === 'local') {
        toast.loading(`Saving (${sizeLabel})…`, { id: tid })
        const result = await window.electronAPI.editorSaveExportLocal(bytes, baseName, sourceCachePath)
        if (!result.saved) {
          toast.dismiss(tid)
          return
        }
        const summary = `Saved to ${result.path}`
        if (result.warning) {
          toast.warning(`${summary}: ${result.warning}`, { id: tid, duration: 8000 })
        } else {
          toast.success(summary, { id: tid, duration: 6000 })
        }
        return
      }

      toast.loading(`Uploading to Drive (${sizeLabel})…`, { id: tid })
      const subpath = framePreset ? ['Framed', framePreset.label] : null
      const result = await window.electronAPI.editorUploadExport(file.id, bytes, baseName, sourceCachePath, subpath)
      const finalName = result.name || baseName
      const locationLabel = result.mirrorPath?.length
        ? `Cernix Shared/${result.mirrorPath.join('/')}`
        : 'Cernix Shared'
      const summary = `${finalName} → ${locationLabel}`
      if (result.warning) {
        toast.warning(`${summary}: ${result.warning}`, {
          id: tid,
          duration: 8000,
          action: result.webViewLink ? { label: 'Open', onClick: () => window.open(result.webViewLink!, '_blank') } : undefined,
        })
      } else if (result.webViewLink) {
        toast.success(summary, { id: tid, duration: 6000, action: { label: 'Open', onClick: () => window.open(result.webViewLink!, '_blank') } })
      } else {
        toast.success(summary, { id: tid })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed', { id: tid })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // Local-source path: skip the Drive edit-cache round-trip entirely.
    // The file is already on disk; just read params and bind.
    const sourcePromise = file.localPath
      ? Promise.resolve(file.localPath)
      : window.electronAPI.editorPrepareSource(file.id, file.modifiedTime, file.name)
    const unsubscribe = file.localPath
      ? () => {}
      : window.electronAPI.onEditorCacheProgress((p) => {
          if (cancelled || p.fileId !== file.id) return
          setState((prev) => prev.phase === 'fetching' ? { phase: 'fetching', done: p.done, total: p.total } : prev)
        })
    sourcePromise
      .then(async (path) => {
        if (cancelled) return
        const params = await window.electronAPI.editorReadParams(path)
        if (cancelled) return
        store.bind(path, params)
        setState({ phase: 'ready', path })
      })
      .catch((err) => { if (!cancelled) setState({ phase: 'error', message: err?.message || 'Failed to prepare source' }) })
    return () => {
      cancelled = true
      unsubscribe()
      store.flush().catch(() => {})
    }
  }, [file.id, file.modifiedTime, file.name, file.localPath, store])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION_FAST, ease: EASE_STANDARD }}
      className="absolute inset-0 z-40 flex flex-col bg-surface-workspace"
    >
      <EditorHeader
        fileName={file.name}
        store={state.phase === 'ready' ? store : null}
        onExit={onExit}
        onCrop={state.phase === 'ready' ? () => { setCropping(v => !v); setTransforming(false) } : undefined}
        cropping={cropping}
        hasCrop={state.phase === 'ready' ? hasGeometry : false}
        onClearCrop={state.phase === 'ready' ? restoreOriginal : undefined}
        comparing={comparing}
        onCompareDown={state.phase === 'ready' ? () => setComparing(true) : undefined}
        onCompareUp={state.phase === 'ready' ? () => setComparing(false) : undefined}
      >
        {state.phase === 'ready' && (
          <>
            {/* Presets: single entry point. The grid is the only
                way in: it carries the apply / save / import / rename
                / delete affordances that used to be split across a
                dropdown + grid pair. One button, one mental model. */}
            <div className="relative">
              <Button
                ref={presetTriggerRef}
                variant="outline"
                size="sm"
                onClick={() => setPresetGridOpen(v => !v)}
                className="h-7 px-space-2 text-text-muted hover:text-text-emphatic"
                title="Browse, apply, save, or import presets"
              >
                Presets
              </Button>
              {presetGridOpen && (
                <PresetGrid
                  getCurrentParams={() => store.get()}
                  onApply={(p) => store.applyAll(applyPresetOverCurrent(p, store.get()))}
                  onHoverPreview={(p) => {
                    if (p === null) {
                      handleCompareChange(null)
                    } else {
                      // Install a compareOverride that swaps in the
                      // preset's params merged over current. Same
                      // shape `applyPresetOverCurrent` produces, so
                      // the viewport shows exactly what clicking
                      // would render. Read live params each time so
                      // a slider edit between hover-enter and the
                      // next render still composes correctly.
                      handleCompareChange((cur) => applyPresetOverCurrent(p, cur))
                    }
                  }}
                  getSourceBitmap={() => pipelineRef.current?.getSource()?.bitmap ?? null}
                  onClose={() => setPresetGridOpen(false)}
                  triggerRef={presetTriggerRef}
                />
              )}
            </div>
            <HistoryButton store={store} />
            <ExportOptionsPopover exporting={exporting} onCommit={handleExport} localOnly={!!file.localPath} />
          </>
        )}
      </EditorHeader>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas surround: deliberately NOT bg-surface-workspace.
         *
         * This is the ground the photo is judged against. It was
         * achromatic and is deliberately no longer: in light it carries
         * a little of the palette's hue so the stage does not read as a
         * different application inside warm chrome. The cost is real
         * and is recorded on the token. A tinted ground shifts
         * perceived white balance, which is why Lightroom and Capture
         * One are neutral grey. The panels either side stay themed. */}
        <div className="flex-1 bg-canvas-surround flex items-center justify-center overflow-hidden relative">
          {state.phase === 'fetching' && (
            <UILoadingState
              label="Loading source"
              done={state.done}
              total={state.total}
              unit="MB"
              icon={<ImageIcon size={24} strokeWidth={1.5} />}
            />
          )}
          {state.phase === 'error' && (
            <ErrorState title="Load failed" detail={state.message} />
          )}
          {state.phase === 'ready' && (
            <EditorCanvas
              sourcePath={state.path}
              store={store}
              cropping={cropping}
              transforming={transforming}
              comparing={comparing}
              compareOverride={compareOverride}
              onCroppingChange={setCropping}
              onTransformingChange={setTransforming}
              onHistogram={setHistogram}
              onImageDims={setImageDims}
              onPipelineReady={(p) => { pipelineRef.current = p }}
              maskMode={maskMode}
              selectedMaskId={selectedMaskId}
              brushSettings={brushSettings}
              healMode={healMode}
              selectedHealId={selectedHealId}
              onHealSelect={setSelectedHealId}
              visualizeSpots={visualizeSpots}
              visualizeSensitivity={visualizeSensitivity}
              tatMode={tatMode}
            />
          )}
          {state.phase === 'ready' && straightening && (
            <StraightenCrosshair
              onAngle={(deg) => {
                store.set('straightenDeg', deg)
                setStraightening(false)
              }}
              onCancel={() => setStraightening(false)}
            />
          )}
        </div>
        {state.phase === 'ready' && (
          <SliderPanel
            store={store}
            histogram={histogram}
            imageDims={imageDims}
            selectedMaskId={selectedMaskId}
            onMaskSelect={(id) => { setSelectedMaskId(id); if (id) setMaskMode(true) }}
            selectedHealId={selectedHealId}
            onHealSelect={(id) => { setSelectedHealId(id); if (id) setHealMode(true) }}
            healMode={healMode}
            onExitHealMode={() => setHealMode(false)}
            visualizeSpots={visualizeSpots}
            onVisualizeSpotsChange={setVisualizeSpots}
            visualizeSensitivity={visualizeSensitivity}
            onVisualizeSensitivityChange={setVisualizeSensitivity}
            brushSettings={brushSettings}
            onBrushSettingsChange={setBrushSettings}
            onCompareChange={handleCompareChange}
          />
        )}
      </div>
      <ShortcutsOverlay />
    </motion.div>
  )
}

/**
 * "Has the user touched any geometry?" predicate. Lifted to file
 * scope so it can be called from a useState initialiser. Keeping
 * the effect body subscribe-only matches React Compiler's recommended
 * shape.
 */
function checkHasGeometry(p: EditParams): boolean {
  const { crop: c, imageTransform: t } = p
  const cropTouched = !(c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1)
  const transformTouched = !(t.scale === 1 && t.panX === 0 && t.panY === 0)
  return cropTouched || transformTouched || p.orientation !== 0 || p.flipH || p.straightenDeg !== 0
}

