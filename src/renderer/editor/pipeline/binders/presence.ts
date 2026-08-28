import type { BinderContext, FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import { GaussianBlurPass } from '../passes/gaussian-blur'

/**
 * Presence binder. Runs the FBO-backed Gaussian blurs
 * that drive Texture and Clarity, then uploads the amount uniforms
 * and binds the blur outputs on dedicated texture units.
 *
 * Texture-unit map:
 *   11  u_blurNarrow. Narrow-radius Gaussian (~10 px sigma)
 *   12  u_blurWide. Wide-radius Gaussian   (~30 px sigma)
 * Total budget: source(0) + curveLut(1) + brush(2..9)
 *             + presence(11..12) + sharpenBlur(13) = 13. Well inside
 * the WebGL2 conformance minimum of 16. Unit 10 is unused.
 *
 * Identity short-circuit: when both `textureAmount` and
 * `clarityAmount` are zero, the blur passes are skipped entirely.
 * The samplers stay bound to a 1x1 placeholder so the main shader
 * always has a valid texture on the unit (sampling it costs nothing
 * because the multiplier is zero).
 */
const NARROW_UNIT = 11
const WIDE_UNIT = 12
const NARROW_SIGMA_PX = 10
const WIDE_SIGMA_PX = 30

export class PresenceBinder implements FeatureBinder {
  private uTextureAmount: WebGLUniformLocation | null = null
  private uClarityAmount: WebGLUniformLocation | null = null
  private uDehazeAmount: WebGLUniformLocation | null = null
  private uBlurNarrow: WebGLUniformLocation | null = null
  private uBlurWide: WebGLUniformLocation | null = null

  private narrow: GaussianBlurPass | null = null
  private wide: GaussianBlurPass | null = null

  /** 1x1 placeholder so the samplers always reference a real
   *  texture, even when both amounts are zero and the blur passes
   *  are skipped. */
  private placeholderTex: WebGLTexture | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uTextureAmount = gl.getUniformLocation(program, 'u_textureAmount')
    this.uClarityAmount = gl.getUniformLocation(program, 'u_clarityAmount')
    this.uDehazeAmount  = gl.getUniformLocation(program, 'u_dehazeAmount')
    this.uBlurNarrow    = gl.getUniformLocation(program, 'u_blurNarrow')
    this.uBlurWide      = gl.getUniformLocation(program, 'u_blurWide')

    this.narrow = new GaussianBlurPass(gl)
    this.wide   = new GaussianBlurPass(gl)
    // Eager placeholder creation: doing this lazily on first apply()
    // calls bindTexture against whatever active unit was last set by a
    // previous binder, silently rebinding their texture (e.g. the curve
    // LUT on TEXTURE1) to the placeholder. Creating it during init()
    //  (before uploadImage() and the first render()) keeps every
    // active-unit binding intact during the per-frame binder loop.
    this.placeholderTex = this.createPlaceholder(gl)
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams, ctx?: BinderContext): void {
    const tAmount = adj.textureAmount ?? 0
    const cAmount = adj.clarityAmount ?? 0
    const dAmount = adj.dehazeAmount  ?? 0

    if (this.uTextureAmount) gl.uniform1f(this.uTextureAmount, tAmount)
    if (this.uClarityAmount) gl.uniform1f(this.uClarityAmount, cAmount)
    if (this.uDehazeAmount)  gl.uniform1f(this.uDehazeAmount,  dAmount)

    const sourceTex = ctx?.sourceTexture
    const w = ctx?.imageWidth ?? 0
    const h = ctx?.imageHeight ?? 0

    // Texture pass. Narrow blur, only Texture consumes it.
    let narrowTex: WebGLTexture | null = null
    if (sourceTex && w > 0 && h > 0 && Math.abs(tAmount) > 0.001 && this.narrow) {
      narrowTex = this.narrow.run(sourceTex, w, h, NARROW_SIGMA_PX)
    }
    this.bindTextureToUnit(gl, NARROW_UNIT, narrowTex ?? this.placeholder(gl), this.uBlurNarrow)

    // Wide blur. Clarity AND Dehaze share it (both want a smooth
    // ~30 px estimate of local brightness). Run it whenever either
    // amount is non-zero so the placeholder doesn't substitute when
    // only one feature is engaged.
    let wideTex: WebGLTexture | null = null
    const wideNeeded = Math.abs(cAmount) > 0.001 || Math.abs(dAmount) > 0.001
    if (sourceTex && w > 0 && h > 0 && wideNeeded && this.wide) {
      wideTex = this.wide.run(sourceTex, w, h, WIDE_SIGMA_PX)
    }
    this.bindTextureToUnit(gl, WIDE_UNIT, wideTex ?? this.placeholder(gl), this.uBlurWide)
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.narrow) { this.narrow.dispose(); this.narrow = null }
    if (this.wide)   { this.wide.dispose();   this.wide   = null }
    if (this.placeholderTex) {
      gl.deleteTexture(this.placeholderTex)
      this.placeholderTex = null
    }
  }

  private bindTextureToUnit(
    gl: WebGL2RenderingContext,
    unit: number,
    tex: WebGLTexture,
    samplerLoc: WebGLUniformLocation | null,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (samplerLoc) gl.uniform1i(samplerLoc, unit)
  }

  private placeholder(gl: WebGL2RenderingContext): WebGLTexture {
    return this.placeholderTex ?? this.createPlaceholder(gl)
  }

  private createPlaceholder(gl: WebGL2RenderingContext): WebGLTexture {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    return tex
  }
}
