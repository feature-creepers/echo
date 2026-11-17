import { FRAGMENT, REACH, SIDES, VERTEX } from './lens-shader.ts'
import { ECHO_LENGTH, type Pose } from './life.ts'

/**
 * Draws the core as a lens with a living light behind it, on the graphics card: one small fragment shader over
 * a single triangle that covers the canvas.
 *
 * From the middle out: the pupil, where the light is seen directly, white-hot at its heart; the iris, fine radial
 * fibres lit from behind by light that pools and drifts under the surface; dark glass; and the thin rim of the
 * lens, with the least bloom beyond it. Inside the rim the lens is a dark body that hides the ground's dots, so it
 * reads as an object in front of them rather than a drawing on them. Everything is one accent: brightness comes
 * from how much light there is, and only the hottest light leans towards white, as a real light does.
 */

/** The lens's radius, as a share of half the canvas: the rest is room for the rim's bloom to fade out. */
export const LENS = 0.72

export interface Lens {
  /** Draws one frame: the pose from the life behind it, the accent as red, green and blue from 0 to 255, and the canvas's side in device pixels. */
  paint(pose: Pose, accent: readonly [number, number, number], side: number): void
  /** Lets the graphics card go at once, rather than when the page is collected. */
  dispose(): void
}

const UNIFORMS = [
  'extent',
  'center',
  'radius',
  'accent',
  'aperture',
  'heart',
  'iris',
  'rim',
  'pools',
  'sheen',
  'gaze',
  'orbit',
  'orbitStrength',
  'echoShift',
  'grain'
] as const
type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

/** Everything the lens keeps on the graphics card, made again whenever the context comes back after being lost. */
function prepare(gl: WebGL2RenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  const echo = gl.createTexture()
  if (!vertex || !fragment || !program || !echo) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('The core could not be drawn on the graphics card:', gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program))
    return undefined
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  gl.bindTexture(gl.TEXTURE_2D, echo)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ECHO_LENGTH, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'u_echo'), 0)
  const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])) as Uniforms
  return { program, echo, uniforms }
}

/**
 * Sets the lens up on a canvas, or gives nothing when the graphics card cannot draw it there; the core is then
 * drawn the simpler way, on a canvas of its own. A machine without a usable graphics card is refused too: drawing
 * the lens on the processor would cost far more than the simpler drawing, every frame.
 */
export function createLens(canvas: HTMLCanvasElement): Lens | undefined {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true
  })
  if (!gl) return undefined
  let ready = prepare(gl)
  if (!ready) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return undefined
  }

  const echo = new Uint8Array(ECHO_LENGTH * 2)
  const pools = new Float32Array(6)
  let grain = 0

  // A lost context (the graphics card reset, or too many canvases at once) comes back empty: it is all made again.
  const onLost = (event: Event) => event.preventDefault()
  const onRestored = () => {
    ready = prepare(gl)
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    paint(pose, [red, green, blue], side) {
      if (!ready || gl.isContextLost()) return
      const { program, uniforms } = ready
      gl.viewport(0, 0, side, side)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      // The polygon's sides must clear the bloom, not only its corners.
      gl.uniform1f(uniforms.extent, (LENS * pose.scale * REACH) / Math.cos(Math.PI / SIDES))
      gl.uniform2f(uniforms.center, side / 2, side / 2)
      gl.uniform1f(uniforms.radius, (side / 2) * LENS * pose.scale)
      gl.uniform3f(uniforms.accent, red / 255, green / 255, blue / 255)
      gl.uniform1f(uniforms.aperture, pose.aperture)
      gl.uniform1f(uniforms.heart, pose.heart)
      gl.uniform1f(uniforms.iris, pose.iris)
      gl.uniform1f(uniforms.rim, pose.rim)
      // The pools of light under the surface wander along slow curves that never quite repeat, and stay inside the lens.
      const drift = pose.drift
      pools[0] = Math.sin(drift * 0.21) * 0.42
      pools[1] = Math.cos(drift * 0.17 + 0.6) * 0.42
      pools[2] = Math.cos(drift * 0.13 + 2.1) * 0.5
      pools[3] = Math.sin(drift * 0.19 + 1.2) * 0.5
      pools[4] = Math.sin(drift * 0.11 + 4.2) * 0.38
      pools[5] = Math.sin(drift * 0.23 + 3.1) * 0.38
      gl.uniform2fv(uniforms.pools, pools)
      // The rim is a little brighter on two opposite sides, which turn slowly.
      gl.uniform2f(uniforms.sheen, Math.cos(drift * 0.12), Math.sin(drift * 0.12))
      gl.uniform2f(uniforms.gaze, pose.gaze[0], pose.gaze[1])
      gl.uniform2f(uniforms.orbit, Math.cos(pose.orbit), Math.sin(pose.orbit))
      gl.uniform1f(uniforms.orbitStrength, pose.orbitStrength)
      gl.uniform1f(uniforms.echoShift, pose.echoShift)
      grain = (grain + 17.31) % 256
      gl.uniform1f(uniforms.grain, grain)
      // The echo goes up halved, so the pulse and a loud voice together still fit in a byte.
      for (let index = 0; index < echo.length; index++) echo[index] = Math.round(Math.min(1, (pose.echo[index] ?? 0) / 2) * 255)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, ready.echo)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ECHO_LENGTH, 1, gl.RG, gl.UNSIGNED_BYTE, echo)
      gl.drawArrays(gl.TRIANGLE_FAN, 0, SIDES + 2)
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (ready && !gl.isContextLost()) {
        gl.deleteProgram(ready.program)
        gl.deleteTexture(ready.echo)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
