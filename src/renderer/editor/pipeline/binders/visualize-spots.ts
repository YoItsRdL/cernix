import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

/**
 * Visualise Spots binder.
 *
 * Diagnostic mode for the heal tool. When enabled, the shader
 * bypasses the adjustment pipeline at top-of-main and renders the
 * source's Laplacian-of-luma as a contrast-stretched grayscale.
 * Surfaces dust spots / sensor smudges / hot pixels that are
 * invisible against the normal preview, so the user can place heal
 * spots before flipping back to the normal view.
 *
 * State is transient (not persisted to EditParams or XMP); the
 * heal-tool UI owns the on/off flag and the sensitivity slider,
 * passes them through `AdjustmentParams` per render.
 */
export class VisualizeSpotsBinder implements FeatureBinder {
  private uVisualize: WebGLUniformLocation | null = null
  private uSensitivity: WebGLUniformLocation | null = null

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    this.uVisualize   = gl.getUniformLocation(program, 'u_visualizeSpots')
    this.uSensitivity = gl.getUniformLocation(program, 'u_visualizeSensitivity')
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    if (this.uVisualize)   gl.uniform1i(this.uVisualize, adj.visualizeSpots ? 1 : 0)
    if (this.uSensitivity) gl.uniform1f(this.uSensitivity, adj.visualizeSensitivity ?? 0.5)
  }
}
