import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Camera calibration. Six scalars. Three primaries x
 * (hue, sat). Identity at all-zero is handled in-shader (early-out
 * if every uniform is 0), so binder can unconditionally upload.
 */
export class CalibrationBinder implements FeatureBinder {
  private uRedHue: WebGLUniformLocation | null = null
  private uRedSat: WebGLUniformLocation | null = null
  private uGreenHue: WebGLUniformLocation | null = null
  private uGreenSat: WebGLUniformLocation | null = null
  private uBlueHue: WebGLUniformLocation | null = null
  private uBlueSat: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uRedHue   = gl.getUniformLocation(program, 'u_calRedHue')
    this.uRedSat   = gl.getUniformLocation(program, 'u_calRedSat')
    this.uGreenHue = gl.getUniformLocation(program, 'u_calGreenHue')
    this.uGreenSat = gl.getUniformLocation(program, 'u_calGreenSat')
    this.uBlueHue  = gl.getUniformLocation(program, 'u_calBlueHue')
    this.uBlueSat  = gl.getUniformLocation(program, 'u_calBlueSat')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    const cal = adj.calibration
    if (this.uRedHue)   gl.uniform1f(this.uRedHue,   cal?.redHue   ?? 0)
    if (this.uRedSat)   gl.uniform1f(this.uRedSat,   cal?.redSat   ?? 0)
    if (this.uGreenHue) gl.uniform1f(this.uGreenHue, cal?.greenHue ?? 0)
    if (this.uGreenSat) gl.uniform1f(this.uGreenSat, cal?.greenSat ?? 0)
    if (this.uBlueHue)  gl.uniform1f(this.uBlueHue,  cal?.blueHue  ?? 0)
    if (this.uBlueSat)  gl.uniform1f(this.uBlueSat,  cal?.blueSat  ?? 0)
  }
}
