/**
 * Separable Gaussian blur, FBO-backed.
 *
 * The mid-frequency adjustments (Texture, Clarity, Sharpening Radius,
 * NR Detail, Dehaze input) all want a blurred copy of the source at
 * configurable radius. A 4-tap cross. What the existing single-pass
 * shaders use. Is acceptable for ~1 px radii but breaks down for
 * the ~10–30 px radii those features want. Real Gaussian needs
 * neighbourhood sampling beyond what a fragment program can do in a
 * single pass without exploding the tap count.
 *
 * This module is the first FBO-backed pass in the pipeline; the
 * `PreviewPipeline` instantiates it (typically twice. Once at a
 * narrow radius for Texture, once wide for Clarity), runs the blur
 * before the main fragment program, then binds the output texture
 * onto a sampler the main shader reads.
 *
 * Design notes:
 * - **Separable.** Two passes (horizontal + vertical), each O(N) in
 *   kernel radius. ~5× cheaper than a 2-D kernel at the radii we
 *   target.
 * - **Linear-sampling trick.** Each tap reads two source samples by
 *   placing the sampler between them (offset by `t` such that the
 *   bilinear average matches the discrete 2-tap weighted sum).
 *   Halves the tap count for a given radius. See Bjorke 2007.
 * - **Stable output texture.** The blurred result lands in the same
 *   `outputTex` each frame; consumers bind by `texture` reference,
 *   not by a swapped name, so binder-style cache keys
 *   work as-is.
 * - **Identity short-circuit.** `run()` is only called when the
 *   feature using the blur is enabled. The caller checks the
 *   identity predicate before invoking. Zero cost when off.
 */

const VERTEX_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}`

// 1-D Gaussian. `u_direction` picks horizontal (1,0) or vertical (0,1).
// `u_sigma` is in pixels; the fragment program clamps the kernel
// radius so the tap count stays bounded at extreme values.
const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_input;
uniform vec2  u_direction;   // (1/w, 0) or (0, 1/h); already in UV space
uniform float u_sigma;       // in pixels (the caller multiplies by 1/w or 1/h before computing taps)
uniform int   u_taps;        // half the kernel; total taps = 2*u_taps + 1
out vec4 outColor;

void main() {
  if (u_sigma <= 0.0001) {
    outColor = texture(u_input, v_uv);
    return;
  }
  // Bilinear-sample trick: each "tap" reads two adjacent pixels by
  // placing the sampler between them. Weights for taps i = 1..N pair
  // up samples (2i-1) and (2i) with linear weights w_a, w_b; the
  // sampler's bilinear interpolation does the weighted sum for free
  // when offset by  t = w_b / (w_a + w_b)  in pixels.
  float invSigma2 = 1.0 / (2.0 * u_sigma * u_sigma);
  vec4 sum = texture(u_input, v_uv) * 1.0;
  float wsum = 1.0;
  for (int i = 1; i <= 64; i++) {
    if (i > u_taps) break;
    float p1 = float(2 * i - 1);
    float p2 = float(2 * i);
    float w1 = exp(-p1 * p1 * invSigma2);
    float w2 = exp(-p2 * p2 * invSigma2);
    float wTotal = w1 + w2;
    float t = p1 + w2 / wTotal; // bilinear offset in pixels
    vec2 off = u_direction * t;
    sum += (texture(u_input, v_uv + off) + texture(u_input, v_uv - off)) * wTotal;
    wsum += 2.0 * wTotal;
  }
  outColor = sum / wsum;
}`

const QUAD = new Float32Array([
  -1, -1, 0, 0,
   1, -1, 1, 0,
  -1,  1, 0, 1,
   1,  1, 1, 1,
])

const MAX_KERNEL_TAPS = 64 // safety cap; matches the shader loop bound

/** Maximum sigma we'll honour. Beyond ~50 px the perceptual gain
*  flattens and the tap count starts to dominate the frame budget. */
const MAX_SIGMA_PX = 50

export class GaussianBlurPass {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private uInput: WebGLUniformLocation | null
  private uDirection: WebGLUniformLocation | null
  private uSigma: WebGLUniformLocation | null
  private uTaps: WebGLUniformLocation | null

  // Two FBO+texture pairs. The horizontal pass writes from the
  // input source into texPing; the vertical pass reads texPing and
  // writes texPong. texPong is the stable output every consumer
  // samples; texPing is internal scratch.
  private fboPing: WebGLFramebuffer | null = null
  private fboPong: WebGLFramebuffer | null = null
  private texPing: WebGLTexture | null = null
  private texPong: WebGLTexture | null = null
  private texW = 0
  private texH = 0

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = this.link(VERTEX_SRC, FRAGMENT_SRC)
    this.uInput     = gl.getUniformLocation(this.program, 'u_input')
    this.uDirection = gl.getUniformLocation(this.program, 'u_direction')
    this.uSigma     = gl.getUniformLocation(this.program, 'u_sigma')
    this.uTaps      = gl.getUniformLocation(this.program, 'u_taps')

    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const posLoc = gl.getAttribLocation(this.program, 'a_position')
    const uvLoc  = gl.getAttribLocation(this.program, 'a_uv')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uvLoc)
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8)
    gl.bindVertexArray(null)
  }

  /** Allocate (or reallocate) the FBO textures at the requested
   *  size. Called when the source dimensions change. */
  resize(width: number, height: number): void {
    if (this.texW === width && this.texH === height && this.texPing && this.texPong) return
    const gl = this.gl
    this.disposeTargets()
    this.texPing = this.makeTarget(width, height)
    this.texPong = this.makeTarget(width, height)
    this.fboPing = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPing, 0)
    this.fboPong = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPong)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texPong, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.texW = width
    this.texH = height
  }

  /** Run the blur. `sourceTex` is the input image at `sourceW x sourceH`
   *  pixels. `sigmaPx` is the Gaussian σ in pixels (clamped to a sane
   *  ceiling). Returns the texture holding the blurred result; the
   *  caller binds this on a texture unit for the main shader. */
  run(sourceTex: WebGLTexture, sourceW: number, sourceH: number, sigmaPx: number): WebGLTexture | null {
    if (!this.fboPing || !this.fboPong || !this.texPing || !this.texPong) return null
    if (this.texW !== sourceW || this.texH !== sourceH) this.resize(sourceW, sourceH)

    const gl = this.gl
    const sigma = Math.max(0, Math.min(sigmaPx, MAX_SIGMA_PX))
    // Tap count: enough for ~3σ coverage, capped at MAX_KERNEL_TAPS.
    const taps = Math.min(MAX_KERNEL_TAPS, Math.max(0, Math.ceil(sigma * 1.5)))

    // Snapshot of GL state we'll mutate; restore on the way out so
    // the main render pass doesn't see partial state.
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, sourceW, sourceH)
    if (this.uSigma) gl.uniform1f(this.uSigma, sigma)
    if (this.uTaps)  gl.uniform1i(this.uTaps,  taps)

    // Horizontal pass: source → texPing.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTex)
    if (this.uInput)     gl.uniform1i(this.uInput, 0)
    if (this.uDirection) gl.uniform2f(this.uDirection, 1.0 / sourceW, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Vertical pass: texPing → texPong.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPong)
    gl.bindTexture(gl.TEXTURE_2D, this.texPing)
    if (this.uDirection) gl.uniform2f(this.uDirection, 0, 1.0 / sourceH)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Restore GL state.
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo)
    gl.bindVertexArray(prevVao)
    gl.useProgram(prevProgram)
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3])
    return this.texPong
  }

  dispose(): void {
    const gl = this.gl
    this.disposeTargets()
    gl.deleteProgram(this.program)
    gl.deleteVertexArray(this.vao)
  }

  private disposeTargets(): void {
    const gl = this.gl
    if (this.fboPing) { gl.deleteFramebuffer(this.fboPing); this.fboPing = null }
    if (this.fboPong) { gl.deleteFramebuffer(this.fboPong); this.fboPong = null }
    if (this.texPing) { gl.deleteTexture(this.texPing); this.texPing = null }
    if (this.texPong) { gl.deleteTexture(this.texPong); this.texPong = null }
  }

  private makeTarget(w: number, h: number): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    return tex
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`GaussianBlurPass shader compile error: ${log}`)
      }
      return s
    }
    const v = compile(gl.VERTEX_SHADER, vs)
    const f = compile(gl.FRAGMENT_SHADER, fs)
    const p = gl.createProgram()!
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    gl.deleteShader(v)
    gl.deleteShader(f)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p)
      gl.deleteProgram(p)
      throw new Error(`GaussianBlurPass link error: ${log}`)
    }
    return p
  }
}
