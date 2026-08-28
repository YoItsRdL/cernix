import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/** Four-band tonal tint (shadows / midtones / highlights / global)
 *  plus blend and balance. Skipped at identity grade. */
export class ColorGradingBinder implements FeatureBinder {
  private uEnabled: WebGLUniformLocation | null = null
  private uShadows: WebGLUniformLocation | null = null
  private uMidtones: WebGLUniformLocation | null = null
  private uHighlights: WebGLUniformLocation | null = null
  private uGlobal: WebGLUniformLocation | null = null
  private uBlend: WebGLUniformLocation | null = null
  private uBalance: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uEnabled    = gl.getUniformLocation(program, 'u_cgEnabled')
    this.uShadows    = gl.getUniformLocation(program, 'u_cgShadows')
    this.uMidtones   = gl.getUniformLocation(program, 'u_cgMidtones')
    this.uHighlights = gl.getUniformLocation(program, 'u_cgHighlights')
    this.uGlobal     = gl.getUniformLocation(program, 'u_cgGlobal')
    this.uBlend      = gl.getUniformLocation(program, 'u_cgBlend')
    this.uBalance    = gl.getUniformLocation(program, 'u_cgBalance')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const cg = adj.colorGrading
    if (!cg) {
      if (this.uEnabled) gl.uniform1i(this.uEnabled, 0)
      return
    }
    if (this.uEnabled)    gl.uniform1i(this.uEnabled, 1)
    if (this.uShadows)    gl.uniform3f(this.uShadows,    cg.shadows[0],    cg.shadows[1],    cg.shadows[2])
    if (this.uMidtones)   gl.uniform3f(this.uMidtones,   cg.midtones[0],   cg.midtones[1],   cg.midtones[2])
    if (this.uHighlights) gl.uniform3f(this.uHighlights, cg.highlights[0], cg.highlights[1], cg.highlights[2])
    if (this.uGlobal)     gl.uniform3f(this.uGlobal,     cg.global[0],     cg.global[1],     cg.global[2])
    if (this.uBlend)      gl.uniform1f(this.uBlend,   cg.blend)
    if (this.uBalance)    gl.uniform1f(this.uBalance, cg.balance)
  }
}
