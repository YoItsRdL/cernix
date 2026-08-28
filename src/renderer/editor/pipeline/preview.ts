/**
 * WebGL2 preview pipeline.
 *
 * Thin orchestrator around a linked WebGL2 program. Three concerns live
 * here:
 *   1. Vertex/UV transform math (orientation, straighten, free-transform,
 *      crop, viewport pan/zoom). Small and tightly coupled to the draw call.
 *   2. The source-image texture lifecycle.
 *   3. Iterating a registry of `FeatureBinder`s, each of which owns the
 *      uniforms for one feature group (curve, HSL, colour grading, mask,
 *      etc.). Adding a new feature means writing one binder and adding
 *      it to the list. No more N hand-rolled uniform fields growing
 *      across three locations in this file.
 *
 * Param-pack helpers (cachedHsl / cachedSelectiveColor / cachedColorGrading
 * / packMasks / toAdjustments / toGeometry) live in `to-adjustments.ts`;
 * full-resolution export lives in `export-image.ts`.
 */

import type { AdjustmentParams, GeometryParams, PreviewViewport } from './types'
import { IDENTITY_GEOMETRY } from './types'
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders'

import { computeBaseScale } from '../utils/geometry-logic'

import type { FeatureBinder } from './binders/types'
import { BasicAdjustmentsBinder } from './binders/basic-adjustments'
import { CurveBinder } from './binders/curve'
import { HslBinder } from './binders/hsl'
import { SelectiveColorBinder } from './binders/selective-color'
import { ColorGradingBinder } from './binders/color-grading'
import { DefringeBinder } from './binders/defringe'
import { PresenceBinder } from './binders/presence'
import { CalibrationBinder } from './binders/calibration'
import { GeometryTransformBinder } from './binders/geometry-transform'
import { SharpeningBinder } from './binders/sharpening'
import { NoiseReductionBinder } from './binders/noise-reduction'
import { NoiseBinder } from './binders/noise'
import { BwBinder } from './binders/bw'
import { MaskBinder } from './binders/mask'
import { HealBinder } from './binders/heal'
import { LightLeakBinder } from './binders/light-leak'
import { VignetteBinder } from './binders/vignette'
import { VisualizeSpotsBinder } from './binders/visualize-spots'

// ── RE-EXPORTS: public API of the pipeline module ──

export * from './types'
export * from './shaders'
export { toAdjustments, toGeometry } from './to-adjustments'
export { exportImage } from './export-image'
export type { ExportOptions } from './export-image'

// ── DOMAIN: Pipeline Orchestrator ──

/**
 * Single-pass WebGL2 image renderer. Holds the program, the source
 * texture, and an ordered list of feature binders. `render()` is the
 * only path to the GPU.
 */
export class PreviewPipeline {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private texture: WebGLTexture | null = null
  private uTransform: WebGLUniformLocation
  private uStraighten: WebGLUniformLocation | null = null
  private uCropUV: WebGLUniformLocation | null = null
  private uSource: WebGLUniformLocation | null

  /** The CurveBinder owns its texture; kept on the field so we can
   *  dispose it on teardown. */
  private curveBinder = new CurveBinder()
  private binders: FeatureBinder[] = [
    // Perspective + lens distortion run first conceptually. The
    // shader applies them at the very top of main() so every
    // subsequent sampling site sees the geometrically-corrected
    // coords. Identity matrix when sliders are zero.
    new GeometryTransformBinder(),
    new HealBinder(),
    new BasicAdjustmentsBinder(),
    this.curveBinder,
    new HslBinder(),
    new SelectiveColorBinder(),
    new ColorGradingBinder(),
    new DefringeBinder(),
    new PresenceBinder(),
    new CalibrationBinder(),
    new NoiseReductionBinder(),
    new SharpeningBinder(),
    new NoiseBinder(),
    new BwBinder(),
    new MaskBinder(),
    new LightLeakBinder(),
    new VignetteBinder(),
    // Visualise Spots is a top-of-main diagnostic that short-circuits
    // the rest of the pipeline; binder order doesn't affect the
    // bypass, but logically it lives at the end of the list because
    // it's a debug overlay rather than an adjustment.
    new VisualizeSpotsBinder(),
  ]

  private imageWidth = 0
  private imageHeight = 0
  private canvasWidth = 0
  private canvasHeight = 0
  private sourceBitmap: ImageBitmap | null = null
  /** Whether this pipeline owns its `sourceBitmap`: i.e. is
   *  responsible for `close()`-ing it on dispose. The export
   *  pipeline shares the editor's bitmap (so the binders can use it
   *  as a cache key) but must NOT close it on teardown. */
  private ownsSourceBitmap = false

  /**
   * @param canvas the target render canvas
   * @param options optional GL context overrides. The default ships
   *   `preserveDrawingBuffer: false` because the on-screen pipeline
   *   is composited every frame. Preserving the buffer across
   *   composites would just add memory pressure. Offscreen consumers
   *   that need to read pixels back via `canvas.toBlob` (the
   *   `ThumbnailPipeline`, the export pipeline) pass `true` so the
   *   readback captures the actual rendered frame instead of a
   *   freshly-cleared buffer.
   */
  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    })
    if (!gl) throw new Error('WebGL2 not supported on this platform')
    this.gl = gl

    this.program = this.link(VERTEX_SHADER, FRAGMENT_SHADER)
    this.uTransform = gl.getUniformLocation(this.program, 'u_transform')!
    this.uStraighten = gl.getUniformLocation(this.program, 'u_straighten')
    this.uCropUV = gl.getUniformLocation(this.program, 'u_cropUV')
    this.uSource = gl.getUniformLocation(this.program, 'u_source')

    for (const b of this.binders) b.init(gl, this.program)

    const quad = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ])
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const posLoc = gl.getAttribLocation(this.program, 'a_position')
    const uvLoc = gl.getAttribLocation(this.program, 'a_uv')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uvLoc)
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8)
    gl.bindVertexArray(null)
  }

  uploadImage(bitmap: ImageBitmap, retain: boolean = true): void {
    const gl = this.gl
    if (this.texture) gl.deleteTexture(this.texture)
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    this.imageWidth = bitmap.width
    this.imageHeight = bitmap.height
    // Always keep the reference. The mask binder uses it as a cache
    // key for bitmap-backed masks. `retain` only controls whether
    // we own it for disposal: the editor's primary pipeline retains
    // (true) and closes on teardown; the export pipeline borrows
    // (false) without closing, since the editor still needs it.
    this.sourceBitmap = bitmap
    this.ownsSourceBitmap = retain
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const w = Math.floor(cssWidth * dpr)
    const h = Math.floor(cssHeight * dpr)
    if (this.gl.canvas.width !== w) (this.gl.canvas as HTMLCanvasElement).width = w
    if (this.gl.canvas.height !== h) (this.gl.canvas as HTMLCanvasElement).height = h
    this.canvasWidth = cssWidth
    this.canvasHeight = cssHeight
  }

  fitZoom(): number {
    if (!this.imageWidth || !this.canvasWidth) return 1
    const scaleX = this.canvasWidth / this.imageWidth
    const scaleY = this.canvasHeight / this.imageHeight
    return Math.min(scaleX, scaleY)
  }

  /**
   * Source-image accessor for off-screen pipelines (used by
   * `exportImage` to spin up a temporary high-res renderer that shares
   * the user's bitmap).
   */
  getSource(): { bitmap: ImageBitmap; imageWidth: number; imageHeight: number } | null {
    if (!this.sourceBitmap || !this.imageWidth || !this.imageHeight) return null
    return { bitmap: this.sourceBitmap, imageWidth: this.imageWidth, imageHeight: this.imageHeight }
  }

  /**
   * Single GPU draw. Computes the vertex/UV transforms for crop,
   * orientation, straighten, free-transform, and viewport pan/zoom,
   * then delegates feature uniform writes to each binder in the
   * registry.
   */
  render(
    viewport: PreviewViewport,
    adjustments: AdjustmentParams,
    geometry: GeometryParams = IDENTITY_GEOMETRY,
    bgColor: [number, number, number, number] = [0.02, 0.02, 0.02, 1],
    crop: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 },
    imageRect?: { x: number; y: number; w: number; h: number },
  ): void {
    const gl = this.gl
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], bgColor[3])
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (!this.texture || !this.imageWidth) return

    const cropW = Math.max(1e-6, crop.w)
    const cropH = Math.max(1e-6, crop.h)

    let cxClip = 0, cyClip = 0, halfW: number, halfH: number
    if (imageRect) {
      const centerX = imageRect.x + imageRect.w / 2
      const centerY = imageRect.y + imageRect.h / 2
      cxClip = (2 * centerX) / this.canvasWidth - 1
      cyClip = 1 - (2 * centerY) / this.canvasHeight
      halfW = imageRect.w / this.canvasWidth
      halfH = imageRect.h / this.canvasHeight
    } else {
      const { baseScaleX, baseScaleY } = computeBaseScale(
        this.imageWidth, this.imageHeight, geometry.orientation, cropW, cropH, this.canvasWidth, this.canvasHeight,
      )
      halfW = baseScaleX
      halfH = baseScaleY
    }
    const zoom = viewport.zoom
    const flipMul = geometry.flipH ? -1 : 1

    // VERTEX TRANSFORM: orientation + flip. Defines the logical
    // quadrant and aspect of the quad boundary.
    const vTheta = (geometry.orientation * Math.PI) / 180
    const vCos = Math.cos(vTheta)
    const vSin = Math.sin(vTheta)
    const sc = geometry.imageTransform.scale
    const tP_x = geometry.imageTransform.panX * 2
    const tP_y = -geometry.imageTransform.panY * 2

    const a = vCos * flipMul * halfW * zoom * sc
    const b = vSin * flipMul * halfH * zoom * sc
    const c = -vSin * halfW * zoom * sc
    const d = vCos * halfH * zoom * sc
    const tx = cxClip + (viewport.panX * 2) / this.canvasWidth + (a * tP_x + c * tP_y)
    const ty = cyClip - (viewport.panY * 2) / this.canvasHeight + (b * tP_x + d * tP_y)
    const m = new Float32Array([
      a, b, 0,
      c, d, 0,
      tx, ty, 1,
    ])

    // UV TRANSFORM: straighten. Rotates the pixels inside the quad
    // without tilting the boundary.
    const sTheta = (geometry.straightenDeg * Math.PI) / 180
    const sCos = Math.cos(sTheta)
    const sSin = Math.sin(sTheta)
    const sm = new Float32Array([
      sCos, sSin,
      -sSin, sCos,
    ])

    gl.useProgram(this.program)
    gl.uniformMatrix3fv(this.uTransform, false, m)
    if (this.uStraighten) gl.uniformMatrix2fv(this.uStraighten, false, sm)
    if (this.uCropUV) gl.uniform4f(this.uCropUV, crop.x, crop.y, cropW, cropH)

    const ctx = {
      imageWidth: this.imageWidth,
      imageHeight: this.imageHeight,
      sourceBitmap: this.sourceBitmap,
      sourceTexture: this.texture,
    }
    for (const binder of this.binders) binder.apply(gl, adjustments, ctx)

    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (this.uSource) gl.uniform1i(this.uSource, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  computeHistogram(): { r: Uint32Array; g: Uint32Array; b: Uint32Array } | null {
    const gl = this.gl
    if (!this.imageWidth) return null
    const w = gl.canvas.width
    const h = gl.canvas.height
    const CAP = 512
    const readW = Math.min(w, CAP)
    const readH = Math.min(h, CAP)
    if (readW < 4 || readH < 4) return null
    // Centre the readback window: the image is placed in the middle of
    // the viewport, but the surrounding workspace is cleared to
    // transparent. A corner-anchored window would miss the image
    // entirely on wide/tall canvases.
    const offsetX = Math.max(0, Math.floor((w - readW) / 2))
    const offsetY = Math.max(0, Math.floor((h - readH) / 2))
    const buf = new Uint8Array(readW * readH * 4)
    gl.readPixels(offsetX, offsetY, readW, readH, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    const r = new Uint32Array(256)
    const g = new Uint32Array(256)
    const b = new Uint32Array(256)
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] === 0) continue // ignore transparent workspace pixels
      r[buf[i]]++
      g[buf[i + 1]]++
      b[buf[i + 2]]++
    }
    return { r, g, b }
  }

  dispose(): void {
    const gl = this.gl
    if (this.texture) { gl.deleteTexture(this.texture); this.texture = null }
    for (const b of this.binders) b.dispose?.(gl)
    if (this.sourceBitmap) {
      // Borrowed bitmaps (export pipeline) must NOT be closed here.
      // The editor's primary pipeline still owns them.
      if (this.ownsSourceBitmap) this.sourceBitmap.close()
      this.sourceBitmap = null
      this.ownsSourceBitmap = false
    }
    gl.deleteProgram(this.program)
    gl.deleteVertexArray(this.vao)
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`Shader compile error: ${log}`)
      }
      return s
    }
    const vsObj = compile(gl.VERTEX_SHADER, vs)
    const fsObj = compile(gl.FRAGMENT_SHADER, fs)
    const program = gl.createProgram()!
    gl.attachShader(program, vsObj)
    gl.attachShader(program, fsObj)
    gl.linkProgram(program)
    gl.deleteShader(vsObj)
    gl.deleteShader(fsObj)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Program link error: ${log}`)
    }
    return program
  }
}
