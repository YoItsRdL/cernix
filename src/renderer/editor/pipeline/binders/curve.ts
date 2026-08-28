import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Tone curve LUT. RGBA texture (256×1) where each channel encodes one
 * of R / G / B / luma curves. Lives on TEXTURE1; the source bitmap stays
 * on TEXTURE0. Skips re-upload when the underlying Uint8Array reference
 * is unchanged (cachedLut returns the same ref while no curve point has
 * moved).
 */
export class CurveBinder implements FeatureBinder {
  private uEnabled: WebGLUniformLocation | null = null
  private uSampler: WebGLUniformLocation | null = null
  private texture: WebGLTexture | null = null
  private lastLut: Uint8Array | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uEnabled = gl.getUniformLocation(program, 'u_curveEnabled')
    this.uSampler = gl.getUniformLocation(program, 'u_curveLut')
    // Create the texture + parameters eagerly. Lazy creation in apply()
    // would call bindTexture against whatever active unit a previous
    // binder left set, silently clobbering that unit's binding.
    this.texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const lut = adj.curveLut
    if (!lut) {
      if (this.uEnabled) gl.uniform1i(this.uEnabled, 0)
      return
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    if (this.lastLut !== lut) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
      this.lastLut = lut
    }
    if (this.uEnabled) gl.uniform1i(this.uEnabled, 1)
    if (this.uSampler) gl.uniform1i(this.uSampler, 1)
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.texture) { gl.deleteTexture(this.texture); this.texture = null }
    this.lastLut = null
  }
}
