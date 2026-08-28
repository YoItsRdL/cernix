import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Noise Reduction. Single-pass denoise. Two amounts:
 *   - `luma`: edge-aware (bilateral-like) blur on the luminance channel
 *   - `color`: wider, less edge-aware blur on the chroma channels
 *      (chroma noise is always lower frequency than luma noise).
 *
 * Single-pass approximation runs in the main fragment shader using a
 * 3×3 neighbourhood. Larger kernels / true non-local-means need an
 * FBO-backed multi-pass. That's a follow-up upgrade behind the same
 * binder API. Zero cost when both amounts are 0.
 */
export class NoiseReductionBinder implements FeatureBinder {
  private uLuma: WebGLUniformLocation | null = null
  private uColor: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uLuma  = gl.getUniformLocation(program, 'u_nrLuma')
    this.uColor = gl.getUniformLocation(program, 'u_nrColor')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uLuma)  gl.uniform1f(this.uLuma,  adj.nrLuma  ?? 0)
    if (this.uColor) gl.uniform1f(this.uColor, adj.nrColor ?? 0)
  }
}
