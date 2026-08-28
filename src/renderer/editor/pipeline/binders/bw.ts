import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/** Black & white channel mixer. Always uploads `u_bwEnabled`; the heavy
 *  uniforms (tint, weights) are only set when the mixer is enabled.
 *  Eight per-hue luminance weights match the HSL band layout (and
 *  Lightroom Classic / Camera Raw) so a B&W preset imports without
 *  band reduction. */
export class BwBinder implements FeatureBinder {
  private uEnabled: WebGLUniformLocation | null = null
  private uColorize: WebGLUniformLocation | null = null
  private uTint: WebGLUniformLocation | null = null
  private uWeights: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uEnabled  = gl.getUniformLocation(program, 'u_bwEnabled')
    this.uColorize = gl.getUniformLocation(program, 'u_bwColorize')
    this.uTint     = gl.getUniformLocation(program, 'u_bwTint')
    this.uWeights  = gl.getUniformLocation(program, 'u_bwWeights')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const bw = adj.bw
    if (this.uEnabled) gl.uniform1i(this.uEnabled, bw ? 1 : 0)
    if (!bw) return
    if (this.uColorize) gl.uniform1i(this.uColorize, bw.colorize ? 1 : 0)
    if (this.uTint)     gl.uniform3f(this.uTint, bw.tint[0], bw.tint[1], bw.tint[2])
    if (this.uWeights)  gl.uniform1fv(this.uWeights, bw.weights)
  }
}
