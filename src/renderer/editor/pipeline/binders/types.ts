/**
 * Each feature group (curve, HSL, colour grading, mask, light leak, etc.)
 * implements this interface. The PreviewPipeline holds an ordered list of
 * binders, calls `init` once at program-link time to capture uniform
 * locations, and calls `apply` per render to push the current values.
 *
 * Adding a new feature now means: write one binder, register it in the
 * pipeline. No more N=30 hand-rolled uniform fields growing across three
 * locations in preview.ts every time.
 */
import type { AdjustmentParams } from '../types'

/** Per-render context passed alongside the adjustments. Optional:
 *  most binders ignore it; the brush-mask binder uses image dims to
 *  size its rasterised stroke textures. */
export interface BinderContext {
  imageWidth: number
  imageHeight: number
  /** The decoded source bitmap. Available because the pipeline owns
   *  it; binders that need the decoded source bitmap
   *  use this as the cache key (WeakMap keyed by ImageBitmap ref). */
  sourceBitmap?: ImageBitmap | null
  /** The source `WebGLTexture` (the upload of `sourceBitmap`).
   *  Multi-pass binders (Texture, Clarity, Dehaze) need it as the
   *  input to their FBO-backed pre-passes. */
  sourceTexture?: WebGLTexture | null
}

export interface FeatureBinder {
  /** Capture uniform locations from the linked program. Called once. */
  init(gl: WebGL2RenderingContext, program: WebGLProgram): void
  /** Push current values to the GPU. Called per render call. */
  apply(gl: WebGL2RenderingContext, adjustments: AdjustmentParams, ctx?: BinderContext): void
  /** Optional cleanup hook: releases GPU-side resources owned by the
   *  binder (e.g. brush mask textures). Called from PreviewPipeline.dispose. */
  dispose?(gl: WebGL2RenderingContext): void
}
