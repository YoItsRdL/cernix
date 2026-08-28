import type { BinderContext, FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'
import { GaussianBlurPass } from '../passes/gaussian-blur'

/**
 * Sharpening.
 *
 * This once uploaded only the Amount and Masking scalars, and the
 * shader's unsharp mask used a fixed 4-tap cross as its high-pass
 * estimate. That matched Lightroom's identity at Radius=0 / Detail=25
 * and threw away the two sliders Lightroom presets routinely tune.
 *
 * So a third FBO-backed Gaussian blur is plugged in, a peer of the
 * presence narrow and wide blurs, sized at the user's Radius slider.
 * The shader samples it when Radius > 0 and falls back to the cross
 * below that, keeping the cheap path live for the identity case.
 *
 * Texture-unit map:
 *   13  u_blurSharpen: variable-σ Gaussian (Lightroom Radius 0.5..3.0)
 *
 * Identity short-circuit: when Amount or Radius is zero, the blur
 * pass is skipped entirely. The sampler stays bound to a 1x1
 * placeholder so the main shader always has a valid texture on
 * the unit (the shader's Radius == 0 fallback path doesn't sample
 * u_blurSharpen anyway).
 */
const SHARPEN_UNIT = 13

export class SharpeningBinder implements FeatureBinder {
  private uAmount:  WebGLUniformLocation | null = null
  private uRadius:  WebGLUniformLocation | null = null
  private uDetail:  WebGLUniformLocation | null = null
  private uMasking: WebGLUniformLocation | null = null
  private uBlur:    WebGLUniformLocation | null = null

  private blur: GaussianBlurPass | null = null
  private placeholderTex: WebGLTexture | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uAmount  = gl.getUniformLocation(program, 'u_sharpenAmount')
    this.uRadius  = gl.getUniformLocation(program, 'u_sharpenRadius')
    this.uDetail  = gl.getUniformLocation(program, 'u_sharpenDetail')
    this.uMasking = gl.getUniformLocation(program, 'u_sharpenMasking')
    this.uBlur    = gl.getUniformLocation(program, 'u_blurSharpen')
    this.blur = new GaussianBlurPass(gl)
    // See PresenceBinder.init() for the rationale on eager placeholder
    // creation. Lazy bindTexture on the wrong active unit can clobber
    // a previous binder's texture binding.
    this.placeholderTex = this.createPlaceholder(gl)
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams, ctx?: BinderContext): void {
    const amount  = adj.sharpenAmount  ?? 0
    const radius  = adj.sharpenRadius  ?? 0
    const detail  = adj.sharpenDetail  ?? 0
    const masking = adj.sharpenMasking ?? 0

    if (this.uAmount)  gl.uniform1f(this.uAmount,  amount)
    if (this.uRadius)  gl.uniform1f(this.uRadius,  radius)
    if (this.uDetail)  gl.uniform1f(this.uDetail,  detail)
    if (this.uMasking) gl.uniform1f(this.uMasking, masking)

    const sourceTex = ctx?.sourceTexture
    const w = ctx?.imageWidth ?? 0
    const h = ctx?.imageHeight ?? 0

    let blurTex: WebGLTexture | null = null
    const needsBlur = amount > 0.001 && radius > 0.001
    if (needsBlur && sourceTex && w > 0 && h > 0 && this.blur) {
      blurTex = this.blur.run(sourceTex, w, h, radius)
    }
    gl.activeTexture(gl.TEXTURE0 + SHARPEN_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, blurTex ?? this.placeholder(gl))
    if (this.uBlur) gl.uniform1i(this.uBlur, SHARPEN_UNIT)
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.blur) { this.blur.dispose(); this.blur = null }
    if (this.placeholderTex) { gl.deleteTexture(this.placeholderTex); this.placeholderTex = null }
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
