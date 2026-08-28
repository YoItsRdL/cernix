import type { FeatureBinder } from './types'
import type { AdjustmentParams } from '../types'

const KEYS = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'temperature', 'tint', 'vibrance', 'saturation',
] as const

type Key = typeof KEYS[number]

/** Ten scalar uniforms driving the global tone/colour panel. */
export class BasicAdjustmentsBinder implements FeatureBinder {
  private locs: Partial<Record<Key, WebGLUniformLocation | null>> = {}

  init(gl: WebGL2RenderingContext, program: WebGLProgram): void {
    for (const k of KEYS) this.locs[k] = gl.getUniformLocation(program, `u_${k}`)
  }

  apply(gl: WebGL2RenderingContext, adj: AdjustmentParams): void {
    for (const k of KEYS) {
      const loc = this.locs[k]
      if (loc) gl.uniform1f(loc, adj[k])
    }
  }
}
