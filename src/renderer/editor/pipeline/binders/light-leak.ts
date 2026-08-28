import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/** Film-style light leak: preset index, master intensity, rotation, spread. */
export class LightLeakBinder implements FeatureBinder {
  private uPreset: WebGLUniformLocation | null = null
  private uIntensity: WebGLUniformLocation | null = null
  private uRotation: WebGLUniformLocation | null = null
  private uSpread: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uPreset    = gl.getUniformLocation(program, 'u_llPreset')
    this.uIntensity = gl.getUniformLocation(program, 'u_llIntensity')
    this.uRotation  = gl.getUniformLocation(program, 'u_llRotation')
    this.uSpread    = gl.getUniformLocation(program, 'u_llSpread')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uPreset)    gl.uniform1i(this.uPreset,    adj.llPreset    ?? 0)
    if (this.uIntensity) gl.uniform1f(this.uIntensity, adj.llIntensity ?? 0)
    if (this.uRotation)  gl.uniform1f(this.uRotation,  adj.llRotation  ?? 0)
    if (this.uSpread)    gl.uniform1f(this.uSpread,    adj.llSpread    ?? 1)
  }
}
