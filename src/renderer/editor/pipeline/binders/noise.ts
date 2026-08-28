import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/** Additive grain: amount, mono flag, distribution selector, plus
 *  Lightroom-style size + frequency knobs (default 0 = identity). */
export class NoiseBinder implements FeatureBinder {
  private uAmount: WebGLUniformLocation | null = null
  private uMono: WebGLUniformLocation | null = null
  private uDist: WebGLUniformLocation | null = null
  private uSize: WebGLUniformLocation | null = null
  private uFrequency: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uAmount    = gl.getUniformLocation(program, 'u_noiseAmount')
    this.uMono      = gl.getUniformLocation(program, 'u_noiseMono')
    this.uDist      = gl.getUniformLocation(program, 'u_noiseDist')
    this.uSize      = gl.getUniformLocation(program, 'u_noiseSize')
    this.uFrequency = gl.getUniformLocation(program, 'u_noiseFrequency')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uAmount)    gl.uniform1f(this.uAmount,    adj.noiseAmount ?? 0)
    if (this.uMono)      gl.uniform1i(this.uMono,      adj.noiseMono ? 1 : 0)
    if (this.uDist)      gl.uniform1i(this.uDist,      adj.noiseDist ?? 0)
    if (this.uSize)      gl.uniform1f(this.uSize,      adj.noiseSize ?? 0)
    if (this.uFrequency) gl.uniform1f(this.uFrequency, adj.noiseFrequency ?? 0)
  }
}
