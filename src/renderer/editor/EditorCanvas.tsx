import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  calculateStageLayout,
  transformToCrop,
  cropToTransform,
  clamp,
  Mode,
  computeBaseScale,
  screenDeltaToPan,
} from './utils/geometry-logic'
import {
  toAdjustments,
  toGeometry,
  PreviewPipeline,
  type PreviewViewport,
} from './pipeline/preview'
import { CropOverlay } from './ui/CropOverlay'
import { TransformOverlay } from './ui/TransformOverlay'
import { LinearHandle } from './ui/LinearHandle'
import { RadialHandle } from './ui/RadialHandle'
import { BrushHandle } from './ui/BrushHandle'
import { HealHandle } from './ui/HealHandle'
import { TargetedAdjustmentOverlay } from './ui/TargetedAdjustmentOverlay'
import { DEFAULT_BRUSH_SETTINGS } from './ui/brush-settings'
import type { ParamsStore } from './state/params-store'
import { DEFAULT_PARAMS, FULL_FRAME_CROP, IDENTITY_IMAGE_TRANSFORM } from '../../shared/edit-params'
import type { ImageTransform } from '../../shared/edit-params'
import { findFrame } from '../../shared/frame-presets'
import { frameAssetUrl } from './frame-assets'
import type { EditParams, CropRect } from '@/types'
import { messageOf } from '../../shared/errors'

/**
 * Editor canvas.
 *
 * Two concepts, kept separate on purpose:
 *   • **workspace** (`stage.box`). The WebGL canvas's CSS rect. Usually
 *     the full container; in frame mode, the frame's cutout slot.
 *   • **document** (`stage.documentBox`). Where the photo's pixels sit
 *     inside the workspace at viewport identity. The render call places
 *     the quad at this exact rect (via the `imageRect` param) so a
 *     cropped image keeps its pre-crop visual size instead of being
 *     scaled up to fill the canvas.
 *
 * Everything else is derived from `(params, containerSize, mode)` in
 * one `stage` memo so preview and export paths can't drift.
 */

const CROP_ZOOM = 0.88
const FRAME_BG: [number, number, number, number] = [1, 1, 1, 1]
// Transparent clear in no-frame modes so the workspace checkerboard sitting
// behind the canvas shows through wherever the photo doesn't paint.
// Zoom-out / pan no longer produce opaque dark "voids" inside the canvas.
const EDITOR_BG: [number, number, number, number] = [0, 0, 0, 0]
const IDENTITY_VIEWPORT: PreviewViewport = { zoom: 1, panX: 0, panY: 0 }

interface EditorCanvasProps {
  sourcePath: string
  store: ParamsStore
  cropping: boolean
  transforming?: boolean
  maskMode?: boolean
  selectedMaskId?: string | null
  /** Tool-state brush settings, sourced from EditorView. The brush
   *  paint overlay reads them when capturing strokes. */
  brushSettings?: import('./ui/brush-settings').BrushSettings
  /** When true, the heal/clone overlay is mounted and the canvas
   *  captures clicks for new spots. */
  healMode?: boolean
  selectedHealId?: string | null
  onHealSelect?: (id: string | null) => void
 /** Visualise Spots: when true, the shader bypasses
   *  the pipeline and renders a Laplacian-of-luma diagnostic view.
   *  `visualizeSensitivity` is the contrast-stretch slider. Both
   *  pass straight through to AdjustmentParams; no other effect. */
  visualizeSpots?: boolean
  visualizeSensitivity?: number
 /** Targeted Adjustment Tool. When non-`off`, an
   *  invisible overlay layer mounts on top of the canvas and
   *  captures pointer events so click-and-drag adjusts the slider
   *  for the pixel under the cursor. */
  tatMode?: import('./ui/TargetedAdjustmentOverlay').TatMode
  /** When true, render the source image with `DEFAULT_PARAMS` so the
   *  user sees the untouched original. Controlled by the parent so the
   *  keyboard gesture (hold `\`) and the header "Compare" button drive
   *  the same state. */
  comparing?: boolean
  /** Per-slider compare: a patcher that maps current params to a
   *  one-field-swapped copy (that field's default) while every other
   *  field stays edited. `null` when no field is under compare. Each
   *  slider builds its own patcher so nested fields (HSL band, SC band,
   *  B&W channel) are handled without a central switch. Ignored when
   *  `comparing` is true. The global Compare wins. */
  compareOverride?: ((p: EditParams) => EditParams) | null
  onCroppingChange: (next: boolean) => void
  onTransformingChange?: (next: boolean) => void
  onHistogram?: (data: { r: Uint32Array; g: Uint32Array; b: Uint32Array } | null) => void
  onPipelineReady?: (pipeline: PreviewPipeline | null) => void
  /** Called once the source image is decoded so consumers can react to native dims. */
  onImageDims?: (dims: { w: number; h: number } | null) => void
}

export function EditorCanvas({ sourcePath, store, cropping, transforming, maskMode, selectedMaskId, brushSettings, healMode, selectedHealId, onHealSelect, visualizeSpots = false, visualizeSensitivity = 0.5, tatMode = 'off', comparing = false, compareOverride = null, onCroppingChange, onTransformingChange, onHistogram, onPipelineReady, onImageDims }: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pipelineRef = useRef<PreviewPipeline | null>(null)
  const rafRef = useRef<number | null>(null)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })
  const [params, setParams] = useState<EditParams>(() => store.get())
  const [zoomPct, setZoomPct] = useState(100)
  /** Viewport revision counter: increments on every zoom or pan
   *  change. Used to trigger re-renders of UI overlays (mask handles,
   *  Point Mask click dots) that need to track the image's actual
   *  displayed position, since `viewportRef` is a ref (no auto re-
   *  render). The render path reads `viewportRef.current` at use
   *  sites; this counter just forces React to re-evaluate them when
   *  the viewport changes. */
  const [viewportRev, setViewportRev] = useState(0)
  const bumpViewport = useCallback(() => setViewportRev((r) => r + 1), [])
  // Reference the counter so React's dependency tracking knows the
  // component re-renders on viewport changes (and so eslint doesn't
  // flag it as unused).
  void viewportRev
  const [frameHint, setFrameHint] = useState(false)
  // Interactive modes collapsed into one enum. By construction only one
  // mode can be active at a time.
  const mode: Mode = transforming ? 'transforming' : cropping ? 'cropping' : healMode ? 'healing' : maskMode ? 'masking' : 'idle'

  // Viewport = inspection-only zoom/pan (no frame active). For frame mode
  // the user's pan/zoom is persisted into `imageTransform`; the viewport
  // stays at identity there.
  const viewportRef = useRef<PreviewViewport>({ ...IDENTITY_VIEWPORT })

  const onPipelineReadyRef = useRef(onPipelineReady)
  const onHistogramRef = useRef(onHistogram)
  const onImageDimsRef = useRef(onImageDims)
  useEffect(() => { onPipelineReadyRef.current = onPipelineReady }, [onPipelineReady])
  useEffect(() => { onHistogramRef.current = onHistogram }, [onHistogram])
  useEffect(() => { onImageDimsRef.current = onImageDims }, [onImageDims])

  // Store subscription. Single reactive view of params.
  useEffect(() => store.subscribe(setParams), [store])

  // Pipeline lifecycle + source image upload.
  useEffect(() => {
    if (!canvasRef.current) return
    let disposed = false
    let pipeline: PreviewPipeline
    try { pipeline = new PreviewPipeline(canvasRef.current) }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reports an async init failure
    catch (err) { setLoadError(messageOf(err) || 'WebGL2 unavailable'); return }
    pipelineRef.current = pipeline
    onPipelineReadyRef.current?.(pipeline)

    const load = async () => {
      try {
        const mediaUrl = `cernix-media://local/${encodeURIComponent(sourcePath)}`
        const resp = await fetch(mediaUrl)
        if (!resp.ok) throw new Error(`Failed to fetch source (${resp.status})`)
        const blob = await resp.blob()
        const bitmap = await createImageBitmap(blob)
        if (disposed) { bitmap.close(); return }
        pipeline.uploadImage(bitmap)
        const dims = { w: bitmap.width, h: bitmap.height }
        setImageDims(dims)
        onImageDimsRef.current?.(dims)
      } catch (err) {
        if (!disposed) { setLoadError(messageOf(err) || 'Failed to decode image'); onImageDimsRef.current?.(null) }
      }
    }
    load()

    return () => {
      disposed = true
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      pipeline.dispose()
      pipelineRef.current = null
      onPipelineReadyRef.current?.(null)
    }
  }, [sourcePath])

  // Container resize observer. Seeds + keeps containerSize in sync.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const r0 = el.getBoundingClientRect()
    if (r0.width && r0.height) setContainerSize({ width: r0.width, height: r0.height })
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setContainerSize({ width: r.width, height: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Single source of truth for layout. Everything else reads from here.
  //
  // The three fields are pulled out rather than passing `params` whole:
  // calculateStageLayout declares a parameter type of exactly these, and
  // depending on the whole object would recompute the layout on every
  // slider tick.
  const { orientation, frame, crop } = params
  const stage = useMemo(
    () => calculateStageLayout(
      containerSize, imageDims, { orientation, frame, crop },
      mode, findFrame, FULL_FRAME_CROP, CROP_ZOOM,
    ),
    [containerSize, imageDims, mode, orientation, frame, crop],
  )

  // Reset viewport whenever the stage's logical shape changes. A new
  // mode, a new frame, or a new committed crop makes any leftover pan/
  // zoom meaningless. The cropping-mode "pull back" is baked into
  // documentBox now, not the viewport, so the viewport stays at
  // identity here.
  /* eslint-disable react-hooks/set-state-in-effect -- the readout follows
     a viewport reset, which is an imperative change to a ref rather than
     anything derivable from props */
  useEffect(() => {
    viewportRef.current = { ...IDENTITY_VIEWPORT }
    setZoomPct(100)
    bumpViewport()
  }, [mode, frame, crop, bumpViewport])
  /* eslint-enable react-hooks/set-state-in-effect */

  // rAF render. The callback reads `stage`, `mode`, and `effectiveParams`
  // from refs rather than closure. If we closed over them, a re-render
  // that happens AFTER `requestRender` was called (e.g. a layout-effect-
  // driven seed on transform-mode entry) would find its follow-up
  // `requestRender` deduped and the pending rAF would draw the stale
  // pre-seed state. A one-frame flicker of the uncropped original. Ref
  // reads eliminate that race; the callback always draws what's true
  // at paint time.
  const effectiveParams = useMemo(() => {
    if (comparing) return DEFAULT_PARAMS
    if (compareOverride) return compareOverride(params)
    return params
  }, [comparing, compareOverride, params])
  const stageRef = useRef(stage)
  const modeRef = useRef(mode)
  const effectiveParamsRef = useRef(effectiveParams)
  const selectedMaskIdRef = useRef(selectedMaskId)
  // Refs so the draw closure reads the latest props without being
  // rebound every time one of them changes: rebinding the WebGL render
  // loop per slider tick is the cost this avoids.
  const visualizeSpotsRef = useRef(visualizeSpots)
  const visualizeSensitivityRef = useRef(visualizeSensitivity)

  // Synced in a layout effect rather than during the render. Every one of
  // these is read only inside the draw closure, which runs from a RAF.
  // After this effect has committed, so the closure still sees the
  // current values, and the render itself stays free of ref writes.
  useLayoutEffect(() => {
    stageRef.current = stage
    modeRef.current = mode
    effectiveParamsRef.current = effectiveParams
    selectedMaskIdRef.current = selectedMaskId ?? null
    visualizeSpotsRef.current = visualizeSpots
    visualizeSensitivityRef.current = visualizeSensitivity
  })

  const requestRender = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const s = stageRef.current
      if (!s) return
      const bg = s.frame ? FRAME_BG : EDITOR_BG
      // Non-frame modes pass the explicit document rect so the image
      // stays at its intrinsic visual size (the crop's actual footprint
      // in the workspace) instead of being aspect-fit-scaled to fill the
      // whole canvas. Free-transform is the one exception: it renders
      // the *full* image at its natural fit so the user can re-frame
      // beyond the current crop; the document rect is drawn as an
      // overlay instead. Frame mode keeps the aspect-fit default because
      // the cutout *is* the document placement.
      const placeRect = modeRef.current === 'transforming' ? s.imageFitBox : s.documentBox
      const imageRect = s.frame
        ? undefined
        : {
            x: placeRect.x - s.box.x,
            y: placeRect.y - s.box.y,
            w: placeRect.w,
            h: placeRect.h,
          }
      const ep = effectiveParamsRef.current
      const adj = toAdjustments(ep)
      // Resolve the selected mask ID to its slot index for the
      // outline pass. -1 = no outline (shader fast-paths the block).
      const selId = selectedMaskIdRef.current
      adj.outlineMaskSlot = selId ? ep.masks.findIndex(m => m.id === selId) : -1
      // pipe the Visualise Spots flag straight through.
      // Refs avoid re-binding the render closure on every prop change;
      // the values are read on the next render tick.
      adj.visualizeSpots = visualizeSpotsRef.current
      adj.visualizeSensitivity = visualizeSensitivityRef.current
      pipelineRef.current?.render(
        viewportRef.current,
        adj,
        toGeometry(ep),
        bg,
        s.sampleCrop,
        imageRect,
      )
      // Histogram readback MUST happen here, in the same rAF as the
      // render. The WebGL context doesn't set `preserveDrawingBuffer`,
      // so once the browser composites this frame the drawing buffer is
      // cleared to transparent. Any deferred `readPixels` (e.g. from a
      // setTimeout) reads all zeros. render is already rAF-throttled so
      // running histogram each frame during a drag is fine.
      if (onHistogramRef.current) {
        const data = pipelineRef.current?.computeHistogram() ?? null
        onHistogramRef.current(data)
      }
    })
  }
  // Both of these live below `requestRender` rather than beside the
  // layout they react to: reading a `const` declared further down works
  // only because effects run after the render, which is not a thing to
  // rely on.
  //
  // Resize the pipeline when the stage's box changes, before anything
  // asks for a frame at the new size.
  useEffect(() => {
    const pipeline = pipelineRef.current
    if (!pipeline || !stage) return
    pipeline.resize(stage.box.w, stage.box.h, window.devicePixelRatio || 1)
    requestRender()
  }, [stage])

  useEffect(() => { requestRender() }, [effectiveParams, stage, selectedMaskId, visualizeSpots, visualizeSensitivity])

  // Before/after compare lives in EditorView. The hold-`\` keyboard
  // handler and the header Compare button both drive the same state,
  // passed down here as the `comparing` prop.

  // Wheel zoom.
  //   • Idle + frame → bake into imageTransform (edit state, exported).
  //   • Transforming → bake into imageTransform too; the whole point of
  //     free-transform is positioning the image inside the document rect,
  //     and scroll is the most natural scale gesture alongside the
  //     overlay handles.
  //   • Idle + no frame → viewport (view-only inspection).
  //   • Cropping → ignored; the crop rect isn't meant to move during
  //     handle dragging.
  const handleWheel = (e: React.WheelEvent) => {
    if (mode === 'cropping' || !stage) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const rect = (canvasRef.current ?? (e.currentTarget as HTMLDivElement)).getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2

    if (stage.frame || mode === 'transforming') {
      const t = params.imageTransform
      const { baseScaleX, baseScaleY } = computeBaseScale(
        imageDims.w, imageDims.h, params.orientation,
        stage.sampleCrop.w, stage.sampleCrop.h,
        stage.box.w, stage.box.h,
      )
      const newScale = clamp(t.scale * factor, 0.1, 20)
      const cxClip = (cx * 2) / stage.box.w
      const cyClip = (-cy * 2) / stage.box.h
      const dInv = (1 / newScale - 1 / t.scale) / 2
      store.set('imageTransform', {
        scale: newScale,
        panX: t.panX + (cxClip / baseScaleX) * dInv,
        panY: t.panY - (cyClip / baseScaleY) * dInv,
      })
      setZoomPct(Math.round(newScale * 100))
    } else {
      // Idle, no frame. Zoom freely in both directions. The checkerboard
      // "document background" makes zoom < 1 read as "image floating on a
      // workspace" (Photopea-style) instead of a dark void.
      const vp = viewportRef.current
      const newZoom = clamp(vp.zoom * factor, 0.1, 20)
      if (newZoom === vp.zoom) return
      vp.panX = cx - ((cx - vp.panX) * newZoom) / vp.zoom
      vp.panY = cy - ((cy - vp.panY) * newZoom) / vp.zoom
      vp.zoom = newZoom
      setZoomPct(Math.round(vp.zoom * 100))
      bumpViewport()
      requestRender()
    }
  }

  // Drag pan.
  //   • Middle-click → always viewport (inspection scroll, even in frame).
  //   • Left-click + frame → imageTransform (edit state).
  //   • Left-click + no frame → viewport, but only when zoomed past fit.
  type Drag =
    | { kind: 'viewport'; x: number; y: number; panX: number; panY: number }
    | {
        kind: 'imageTransform'
        x: number; y: number
        panX: number; panY: number
        bw: number; bh: number
        scale: number
        rotationDeg: number
        flipH: boolean
      }
  const dragRef = useRef<Drag | null>(null)
  // Mirrored as state purely so the cursor can react to it. The ref
  // alone changed nothing on screen until some other update happened
  // to re-render, so a press without a move still read 'grab'.
  const [dragging, setDragging] = useState(false)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'idle' || !stage) return
    const isMiddle = e.button === 1
    if (isMiddle) {
      e.preventDefault()
      dragRef.current = { kind: 'viewport', x: e.clientX, y: e.clientY, panX: viewportRef.current.panX, panY: viewportRef.current.panY }
      setDragging(true)
    } else if (stage.frame) {
      const t = params.imageTransform
      const { baseScaleX, baseScaleY } = computeBaseScale(
        imageDims.w, imageDims.h, params.orientation,
        stage.sampleCrop.w, stage.sampleCrop.h,
        stage.box.w, stage.box.h,
      )
      setDragging(true)
      dragRef.current = {
        kind: 'imageTransform', x: e.clientX, y: e.clientY,
        panX: t.panX, panY: t.panY,
        // `bw`/`bh` are the image's screen-axis dimensions at identity.
        // Canvas size scaled by the aspect-fit factor. `screenDeltaToPan`
        // divides by these (and by scale) internally.
        bw: stage.box.w * baseScaleX,
        bh: stage.box.h * baseScaleY,
        scale: t.scale,
        rotationDeg: params.orientation + params.straightenDeg,
        flipH: params.flipH,
      }
    } else {
      dragRef.current = { kind: 'viewport', x: e.clientX, y: e.clientY, panX: viewportRef.current.panX, panY: viewportRef.current.panY }
      setDragging(true)
    }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.kind === 'imageTransform') {
      const { dpanX, dpanY } = screenDeltaToPan(
        dx, dy,
        d.rotationDeg, d.flipH,
        d.bw, d.bh, d.scale,
      )
      store.set('imageTransform', {
        scale: d.scale,
        panX: d.panX + dpanX,
        panY: d.panY + dpanY,
      })
    } else {
      viewportRef.current.panX = d.panX + dx
      viewportRef.current.panY = d.panY + dy
      bumpViewport()
      requestRender()
    }
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    setDragging(false)
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
  }

  // Double-click "fit". Resets whichever state is driving positioning.
  // Allowed in idle and local-adjust modes (the latter just shows handle
  // overlays on top of the normal canvas, so fitting is always safe).
  // Cropping / transforming have their own commit flows and run their
  // own viewports, so we stay out of their way.
  const fitToCanvas = () => {
    if (!stage) return
    if (mode !== 'idle' && mode !== 'masking') return
    if (stage.frame) {
      store.set('imageTransform', IDENTITY_IMAGE_TRANSFORM)
    } else {
      viewportRef.current = { ...IDENTITY_VIEWPORT }
      bumpViewport()
      requestRender()
    }
    setZoomPct(100)
  }

  // Commit handlers for overlays.
  const commitCrop = (next: CropRect) => { store.set('crop', next); onCroppingChange(false) }
  const cancelCrop = () => onCroppingChange(false)

  // Free-transform apply (non-frame): bake the current imageTransform
  // into a *new crop rect*. The portion of the image currently inside
  // the document rectangle becomes what the export will contain, and
  // everything that ended up outside the document gets trimmed. The
  // imageTransform is reset to identity so the edit state stays in the
  // crop field (where it belongs). In frame mode, imageTransform is
  // meaningful on its own (cutout positioning) and we persist it
  // directly without touching crop.
  const transformEntryRef = useRef<ImageTransform>(IDENTITY_IMAGE_TRANSFORM)
  // useLayoutEffect (not useEffect) so the seed commits synchronously
  // before paint. Under useEffect the first frame paints with the
  // uncropped original and flickers as the seed applies on the next
  // frame. Here the seed's re-render flushes inside the same commit
  // cycle, so the user only ever sees the committed-crop view.
  useLayoutEffect(() => {
    if (!transforming) return
    const current = store.get()
    transformEntryRef.current = current.imageTransform
    // Seed the imageTransform so the entry view matches the committed
    // crop. Without this, sampleCrop drops to FULL_FRAME in transform
    // mode and the user sees their uncropped original, which reads as
    // a "reset." Only seed when state is pristine (crop is non-trivial,
    // imageTransform is identity, no active frame) so re-entering
    // mid-session after a cancel doesn't clobber the prior seed, and
    // framed edits (where imageTransform drives cutout fill) are left
    // alone.
    if (!stage || stage.frame) return
    const c = current.crop
    const t = current.imageTransform
    const isFullCrop = c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1
    const isIdentity = t.scale === 1 && t.panX === 0 && t.panY === 0
    if (!isFullCrop && isIdentity) {
      store.set('imageTransform', cropToTransform(c, stage.imageFitBox, stage.documentBox))
    }
  }, [transforming, store, stage])
  const commitTransform = (next: ImageTransform) => {
    if (stage && !stage.frame) {
      store.set('crop', transformToCrop(next, stage.imageFitBox, stage.documentBox))
      store.set('imageTransform', IDENTITY_IMAGE_TRANSFORM)
    } else {
      store.set('imageTransform', next)
    }
    onTransformingChange?.(false)
  }
  const cancelTransform = () => {
    // Revert any in-progress drag updates (the overlay writes to the
    // store live via onChange) to the transform that was in effect when
    // the user entered the mode.
    store.set('imageTransform', transformEntryRef.current)
    onTransformingChange?.(false)
  }

  // Both effects below branch on whether a frame is active and re-run
  // when it changes identity, so those are the two values they depend on:
  // reaching through `stage?.frame?.preset.id` while reading
  // `stage?.frame` is what made the dependency list disagree with the
  // body.
  const frameActive = !!stage?.frame
  const framePresetId = stage?.frame?.preset.id ?? null

  // Brief hint when a frame becomes active. setState in an effect is the
  // point here: the hint is on a timer, so there is nothing to derive.
  /* eslint-disable react-hooks/set-state-in-effect -- the hint is timed */
  useEffect(() => {
    if (!frameActive) { setFrameHint(false); return }
    setFrameHint(true)
    const t = setTimeout(() => setFrameHint(false), 2500)
    return () => clearTimeout(t)
  }, [frameActive, framePresetId])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep the zoom readout in sync with imageTransform.scale when a frame
  // is active: overlay commits and an XMP load both change scale from
  // outside this component. Not derivable. The same readout is written
  // by wheel zoom and fit-to-canvas.
  /* eslint-disable react-hooks/set-state-in-effect -- mirrors state owned
     outside this component */
  useEffect(() => {
    if (frameActive) setZoomPct(Math.round(params.imageTransform.scale * 100))
  }, [params.imageTransform.scale, frameActive])
  /* eslint-enable react-hooks/set-state-in-effect */

  const canvasStyle = stage
    ? { left: stage.box.x, top: stage.box.y, width: stage.box.w, height: stage.box.h }
    : { display: 'none' as const }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={fitToCanvas}
      className="w-full h-full relative overflow-hidden touch-none group/canvas"
      style={{
        cursor: dragging ? 'grabbing' : (mode === 'idle' ? 'grab' : 'default'),
        // Photopea-style "document background". The empty space around an
        // aspect-fit canvas reads as *outside the image* instead of as
        // broken editor chrome. Skipped in frame mode, where the frame
        // card already visually occupies that space.
        backgroundImage: stage?.frame ? 'none' : 'repeating-conic-gradient(#161616 0deg 90deg, #1d1d1d 90deg 180deg)', // design-allow: Document-background checker, fixed hex for predictable tiling
        backgroundSize: '16px 16px',
      }}
    >
      {/* Single canvas: its CSS box is `stage.box` and nothing else.
          Canvas aspect always equals the export's aspect at this mode,
          so letterbox can't hide inside it. */}
      <canvas ref={canvasRef} className="absolute" style={canvasStyle} />

      {/* Frame PNG overlay: sits over the full frame card, its own alpha
          cutout letting the WebGL canvas at the cutout slot show through. */}
      {stage?.frame && (
        <img
          src={frameAssetUrl(stage.frame.preset.id) ?? ''}
          alt=""
          draggable={false}
          className="absolute pointer-events-none select-none"
          style={{ left: stage.frame.boxX, top: stage.frame.boxY, width: stage.frame.boxW, height: stage.frame.boxH }}
        />
      )}

      {frameHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-scrim-heavy backdrop-blur border border-overlay-active text-body text-text-default font-medium pointer-events-none transition-opacity">
          Drag to position · Scroll to scale
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-body text-status-danger/80">{loadError}</div>
        </div>
      )}

      {mode === 'cropping' && containerSize.width > 0 && (
        <CropOverlay
          containerRect={containerSize}
          imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
          imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
          displayZoom={CROP_ZOOM}
          initial={params.crop ?? FULL_FRAME_CROP}
          onCommit={commitCrop}
          onCancel={cancelCrop}
        />
      )}

      {mode === 'transforming' && stage && (
        <TransformOverlay
          baseDisplay={stage.imageFitBox}
          initial={params.imageTransform}
          rotationDeg={params.orientation + params.straightenDeg}
          flipH={params.flipH}
          onChange={(t) => store.set('imageTransform', t)}
          onCommit={commitTransform}
          onCancel={cancelTransform}
        />
      )}

      {/* Document boundary. The document is the fixed rect the crop will
          be baked to on Apply: the image is a layer the user scales/
          moves over it. Styled as a subtle white dashed outline so it
          reads as "canvas edge," distinct from the blue transform frame. */}
      {mode === 'transforming' && stage && !stage.frame && (
        <div
          className="absolute pointer-events-none border border-dashed border-border-strong"
          style={{
            left: stage.documentBox.x,
            top: stage.documentBox.y,
            width: stage.documentBox.w,
            height: stage.documentBox.h,
          }}
        />
      )}

      {mode === 'masking' && stage && selectedMaskId && containerSize.width > 0 && (() => {
        const m = store.get().masks.find(x => x.id === selectedMaskId)
        if (!m) return null
        if (m.type === 'linear') {
          const shape = m.shape as import('./../../shared/edit-params').LinearMask
          return (
            <LinearHandle
              containerRect={containerSize}
              imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
              imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
              mask={shape}
              onChange={(nextShape) => {
                const next = store.get().masks.map(x =>
                  x.id === selectedMaskId ? { ...x, shape: nextShape } : x,
                )
                store.set('masks', next)
              }}
            />
          )
        } else if (m.type === 'radial') {
          const shape = m.shape as import('./../../shared/edit-params').RadialMask
          return (
            <RadialHandle
              containerRect={containerSize}
              imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
              imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
              mask={shape}
              onChange={(nextShape) => {
                const next = store.get().masks.map(x =>
                  x.id === selectedMaskId ? { ...x, shape: nextShape } : x,
                )
                store.set('masks', next)
              }}
            />
          )
        } else if (m.type === 'brush') {
          const shape = m.shape as import('./../../shared/edit-params').BrushMask
          return (
            <BrushHandle
              containerRect={containerSize}
              imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
              imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
              mask={shape}
              settings={brushSettings ?? DEFAULT_BRUSH_SETTINGS}
              onChange={(nextShape) => {
                const next = store.get().masks.map(x =>
                  x.id === selectedMaskId ? { ...x, shape: nextShape } : x,
                )
                store.set('masks', next)
              }}
            />
          )
        }
        return null
      })()}

      {mode === 'healing' && stage && containerSize.width > 0 && (
        <HealHandle
          containerRect={containerSize}
          imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
          imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
          spots={params.healSpots}
          selectedId={selectedHealId ?? null}
          onSelect={(id) => onHealSelect?.(id)}
          onChange={(next) => store.set('healSpots', next)}
        />
      )}

 {/* Targeted Adjustment Tool. Mounted on
          top of the canvas while the user is in TAT mode; the overlay
          is fully transparent and only captures pointer events for the
          click-and-drag adjustment gesture. Off when mode === 'off'.
          Routing: when a mask is selected and carries the relevant
          block (hsl / toneCurve), the overlay writes into the mask
          instead of the global field via the onMask* callbacks. */}
      {/* eslint-disable-next-line react-hooks/refs -- reads the pipeline's
          source bitmap during render. The overlay only mounts on a user
          action, by which point the pipeline has loaded, and mirroring
          the bitmap into state would duplicate what the pipeline owns. */}
      {tatMode !== 'off' && stage && containerSize.width > 0 && (() => {
        const activeMask = selectedMaskId
          ? params.masks.find(m => m.id === selectedMaskId) ?? null
          : null
        const writeMaskField = <K extends 'hsl' | 'toneCurve'>(key: K, value: NonNullable<EditParams['masks'][number][K]>) => {
          if (!activeMask) return
          store.set('masks', params.masks.map(m =>
            m.id === activeMask.id ? { ...m, [key]: value } : m,
          ))
        }
        return (
          <TargetedAdjustmentOverlay
            containerRect={containerSize}
            imageWidth={(params.orientation === 90 || params.orientation === 270) ? imageDims.h : imageDims.w}
            imageHeight={(params.orientation === 90 || params.orientation === 270) ? imageDims.w : imageDims.h}
            sourceBitmap={pipelineRef.current?.getSource()?.bitmap ?? null}
            mode={tatMode}
            hsl={params.hsl}
            onHslChange={(next) => store.set('hsl', next)}
            toneCurve={params.toneCurve}
            onToneCurveChange={(next) => store.set('toneCurve', next)}
            activeMask={activeMask}
            onMaskHslChange={(next) => writeMaskField('hsl', next)}
            onMaskToneCurveChange={(next) => writeMaskField('toneCurve', next)}
          />
        )
      })()}

      {(mode === 'idle' || mode === 'masking' || mode === 'healing') && (
        <div
          className="absolute bottom-4 right-4 flex items-center gap-1 px-1 py-1 rounded-full bg-scrim-heavy backdrop-blur border border-overlay-active opacity-0 group-hover/canvas:opacity-100 transition-opacity duration-200"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-body text-text-muted tabular-nums px-2 font-medium">{zoomPct}%</span>
          <button /* eslint-disable-line no-restricted-syntax -- design-allow: a zoom-bar pill, not a chrome button */
            onClick={fitToCanvas}
            className="flex items-center gap-1 h-6 px-2 text-body text-text-default hover:text-text-emphatic hover:bg-overlay-active rounded-full transition-colors"
            title="Fit to view (double-click canvas)"
          >
            <Maximize2 size={11} />
            Fit
          </button>
        </div>
      )}

    </div>
  )
}

