import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import { HSL_RANGES } from '../../../../shared/edit-params'

/** Six per-band HSL deltas (h, s, l). Skipped when every band is zero. */
export class HslBinder implements FeatureBinder {
  private uEnabled: WebGLUniformLocation | null = null
  private uBands: (WebGLUniformLocation | null)[] = []

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uEnabled = gl.getUniformLocation(program, 'u_hslEnabled')
    this.uBands = HSL_RANGES.map(b => gl.getUniformLocation(program, `u_hsl_${b}`))
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const hsl = adj.hsl
    if (!hsl) {
      if (this.uEnabled) gl.uniform1i(this.uEnabled, 0)
      return
    }
    if (this.uEnabled) gl.uniform1i(this.uEnabled, 1)
    for (let i = 0; i < HSL_RANGES.length; i++) {
      const loc = this.uBands[i]
      if (loc) gl.uniform3f(loc, hsl[i * 3], hsl[i * 3 + 1], hsl[i * 3 + 2])
    }
  }
}
