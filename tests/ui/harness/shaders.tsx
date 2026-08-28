import { createRoot } from 'react-dom/client'
import { VERTEX_SHADER, FRAGMENT_SHADER } from '@/editor/pipeline/shaders'

/**
 * Does the editor's GLSL actually compile?
 *
 * The pipeline is 1500 lines of shader source assembled as a template
 * literal, so nothing type-checks it and no unit test can reach it: a
 * compile error is a runtime error inside a WebGL context. The symptom
 * is an editor that opens to a blank canvas, which is visible but only
 * to whoever opens the editor, and this is the one editor fault that
 * makes every other one unreachable.
 *
 * It needs a real GL context, which is why it lives here rather than in
 * Vitest.
 */
function compile(): { ok: boolean; vertex: string | null; fragment: string | null; renderer: string } {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return { ok: false, vertex: 'no webgl2 context', fragment: null, renderer: 'none' }

  const build = (type: number, src: string): string | null => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    const log = gl.getShaderParameter(s, gl.COMPILE_STATUS) ? null : (gl.getShaderInfoLog(s) || 'failed')
    gl.deleteShader(s)
    return log
  }

  const vertex = build(gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = build(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  return {
    ok: !vertex && !fragment,
    vertex,
    fragment,
    renderer: String(gl.getParameter(gl.RENDERER)),
  }
}

const result = compile()
const w = window as unknown as Record<string, unknown>
// The runner polls `window.__ready`. Compilation is synchronous here,
// so it is true by the time the bundle finishes evaluating.
w.__ready = true
w.__shaders = () => result.ok
// The compiler's own message, so a failure names the line rather than
// only reporting that something did not work.
w.__shaderError = () => (result.vertex || result.fragment || '').replace(/\s+/g, ' ').slice(0, 200)
w.__linked = () => {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return false
  const mk = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); return s }
  const p = gl.createProgram()!
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
  gl.linkProgram(p)
  return !!gl.getProgramParameter(p, gl.LINK_STATUS)
}

createRoot(document.getElementById('root')!).render(
  <div id="ready">{result.ok ? 'compiled' : 'failed'}</div>,
)
