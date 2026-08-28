import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import { SC_RANGES } from '../../../../shared/edit-params'

/** Six per-band Selective Color (CMYK) tweaks. Skipped at identity. */
export class SelectiveColorBinder implements FeatureBinder {
  private uEnabled: WebGLUniformLocation | null = null
  private uBands: (WebGLUniformLocation | null)[] = []

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uEnabled = gl.getUniformLocation(program, 'u_scEnabled')
    this.uBands = SC_RANGES.map(b => gl.getUniformLocation(program, `u_sc_${b}`))
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const sc = adj.selectiveColor
    if (!sc) {
      if (this.uEnabled) gl.uniform1i(this.uEnabled, 0)
      return
    }
    if (this.uEnabled) gl.uniform1i(this.uEnabled, 1)
    for (let i = 0; i < SC_RANGES.length; i++) {
      const loc = this.uBands[i]
      if (loc) gl.uniform4f(loc, sc[i * 4], sc[i * 4 + 1], sc[i * 4 + 2], sc[i * 4 + 3])
    }
  }
}
