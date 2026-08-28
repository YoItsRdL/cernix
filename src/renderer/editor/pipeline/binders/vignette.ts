import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/** Corner falloff. Five scalars; identity at amount = 0 is handled by
 *  the shader (multiplies by zero, so no early-out needed here). */
export class VignetteBinder implements FeatureBinder {
  private uAmount: WebGLUniformLocation | null = null
  private uRadius: WebGLUniformLocation | null = null
  private uSoftness: WebGLUniformLocation | null = null
  private uRoundness: WebGLUniformLocation | null = null
  private uHighlightContrast: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uAmount            = gl.getUniformLocation(program, 'u_vignetteAmount')
    this.uRadius            = gl.getUniformLocation(program, 'u_vignetteRadius')
    this.uSoftness          = gl.getUniformLocation(program, 'u_vignetteSoftness')
    this.uRoundness         = gl.getUniformLocation(program, 'u_vignetteRoundness')
    this.uHighlightContrast = gl.getUniformLocation(program, 'u_vignetteHighlightContrast')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uAmount)            gl.uniform1f(this.uAmount,            adj.vignetteAmount)
    if (this.uRadius)            gl.uniform1f(this.uRadius,            adj.vignetteRadius)
    if (this.uSoftness)          gl.uniform1f(this.uSoftness,          adj.vignetteSoftness)
    if (this.uRoundness)         gl.uniform1f(this.uRoundness,         adj.vignetteRoundness ?? 0)
    if (this.uHighlightContrast) gl.uniform1f(this.uHighlightContrast, adj.vignetteHighlightContrast ?? 0)
  }
}
