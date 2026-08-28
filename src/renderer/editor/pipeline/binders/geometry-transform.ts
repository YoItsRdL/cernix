import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Geometry transforms. Perspective + lens distortion.
 * The CPU-side `to-adjustments.ts` composes the perspective sliders
 * into a 9-element column-major Float32Array; this binder uploads
 * it via `uniformMatrix3fv` and a single float for the lens
 * distortion coefficient. Identity uploads (matrix == identity,
 * coefficient == 0) cost a uniform write but no GPU cycles inside
 * the helpers. Both helpers early-out at identity.
 */
export class GeometryTransformBinder implements FeatureBinder {
  private uPerspective: WebGLUniformLocation | null = null
  private uLensDistortion: WebGLUniformLocation | null = null

  /** Identity 3x3, column-major. Uploaded when the adjustment lacks
   *  a `perspective` field or when the matrix would otherwise be
   *  undefined. Allocated once on init. */
  private identity = new Float32Array([1,0,0, 0,1,0, 0,0,1])

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uPerspective    = gl.getUniformLocation(program, 'u_perspective')
    this.uLensDistortion = gl.getUniformLocation(program, 'u_lensDistortion')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uPerspective) {
      gl.uniformMatrix3fv(this.uPerspective, false, adj.perspective ?? this.identity)
    }
    if (this.uLensDistortion) {
      gl.uniform1f(this.uLensDistortion, adj.lensDistortion ?? 0)
    }
  }
}
