import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Defringe. Chromatic-aberration cleanup. Two amounts (purple,
 * green) drive a fragment-shader pass that samples the source
 * neighbourhood, gates by luminance gradient (only edges) and a
 * per-fringe hue *range* (only the actual fringe colour), then
 * desaturates the flagged pixels toward the local luma. Zero cost
 * when both amounts are 0.
 */
export class DefringeBinder implements FeatureBinder {
  private uPurple: WebGLUniformLocation | null = null
  private uGreen: WebGLUniformLocation | null = null
  private uPurpleHueLo: WebGLUniformLocation | null = null
  private uPurpleHueHi: WebGLUniformLocation | null = null
  private uGreenHueLo: WebGLUniformLocation | null = null
  private uGreenHueHi: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uPurple       = gl.getUniformLocation(program, 'u_defringePurple')
    this.uGreen        = gl.getUniformLocation(program, 'u_defringeGreen')
    this.uPurpleHueLo  = gl.getUniformLocation(program, 'u_defringePurpleHueLo')
    this.uPurpleHueHi  = gl.getUniformLocation(program, 'u_defringePurpleHueHi')
    this.uGreenHueLo   = gl.getUniformLocation(program, 'u_defringeGreenHueLo')
    this.uGreenHueHi   = gl.getUniformLocation(program, 'u_defringeGreenHueHi')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uPurple)      gl.uniform1f(this.uPurple,      adj.defringePurple      ?? 0)
    if (this.uGreen)       gl.uniform1f(this.uGreen,       adj.defringeGreen       ?? 0)
    if (this.uPurpleHueLo) gl.uniform1f(this.uPurpleHueLo, adj.defringePurpleHueLo ?? 0.74)
    if (this.uPurpleHueHi) gl.uniform1f(this.uPurpleHueHi, adj.defringePurpleHueHi ?? 0.83)
    if (this.uGreenHueLo)  gl.uniform1f(this.uGreenHueLo,  adj.defringeGreenHueLo  ?? 0.27)
    if (this.uGreenHueHi)  gl.uniform1f(this.uGreenHueHi,  adj.defringeGreenHueHi  ?? 0.39)
  }
}
