import type { BinderContext, FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import { MAX_HEAL_SPOTS } from '../../../../shared/edit-params'

/**
 * Heal / clone spot binder. Uploads the packed spot list to the
 * fragment shader's MAX_HEAL_SPOTS slots. The shader runs the spot
 * loop at the very top of `main()` so every subsequent adjustment
 * (white balance, tone, curves, masks, …) lands on the corrected
 * pixels instead of the original.
 *
 * Per-element uniform writes mirror the MaskBinder pattern: array
 * uniforms via `uniform*v` are flaky on some WebGL2 drivers, so we
 * capture per-slot locations once and push individually.
 */
export class HealBinder implements FeatureBinder {
  private uCount: WebGLUniformLocation | null = null
  private uDest: (WebGLUniformLocation | null)[] = []
  private uSrc: (WebGLUniformLocation | null)[] = []
  private uParams: (WebGLUniformLocation | null)[] = []
  private uMode: (WebGLUniformLocation | null)[] = []

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uCount = gl.getUniformLocation(program, 'u_heal_count')
    this.uDest = []
    this.uSrc = []
    this.uParams = []
    this.uMode = []
    for (let i = 0; i < MAX_HEAL_SPOTS; i++) {
      this.uDest.push(gl.getUniformLocation(program, `u_heal_dest[${i}]`))
      this.uSrc.push(gl.getUniformLocation(program, `u_heal_src[${i}]`))
      this.uParams.push(gl.getUniformLocation(program, `u_heal_params[${i}]`))
      this.uMode.push(gl.getUniformLocation(program, `u_heal_mode[${i}]`))
    }
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams, _ctx?: BinderContext): void {
    const spots = adj.healSpots
    if (!spots || spots.count === 0) {
      if (this.uCount) gl.uniform1i(this.uCount, 0)
      return
    }
    if (this.uCount) gl.uniform1i(this.uCount, spots.count)
    for (let i = 0; i < spots.count; i++) {
      const dLoc = this.uDest[i]
      if (dLoc) gl.uniform2f(dLoc, spots.dest[i * 2], spots.dest[i * 2 + 1])
      const sLoc = this.uSrc[i]
      if (sLoc) gl.uniform2f(sLoc, spots.src[i * 2], spots.src[i * 2 + 1])
      const pLoc = this.uParams[i]
      if (pLoc) gl.uniform3f(pLoc, spots.params[i * 3], spots.params[i * 3 + 1], spots.params[i * 3 + 2])
      const mLoc = this.uMode[i]
      if (mLoc) gl.uniform1i(mLoc, spots.mode[i])
    }
  }
}
