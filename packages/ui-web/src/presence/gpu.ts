import type { Look } from '@repo/protocol'
import { createBloom } from './bloom.ts'
import type { Rgb } from './color.ts'
import { type Drawing, SIDES, VERTEX } from './glsl.ts'
import { HUD } from './hud-shader.ts'
import { LENS } from './lens-shader.ts'
import { BANDS, ECHO_LENGTH, LOOK_SHRINK, type Pose, TILT } from './life.ts'

/**
 * Draws the core on the graphics card: each look is one small fragment shader over a polygon just round it.
 * While one look gives way to another, both are drawn, each weighted by how far it is in effect, and added: a
 * cross-fade, with the outgoing look drawing back a little as the incoming one settles in. Then its light blooms
 * (`bloom.ts`), each look as much as it asks.
 */

/** Each look's drawing on the graphics card. */
export const DRAWINGS: Record<Look, Drawing> = { lens: LENS, hud: HUD }

export interface GpuCore {
  /**
   * Draws one frame: the pose from the life behind it, each look's accent as red, green and blue from 0 to 255 (a
   * look giving way keeps the accent it had), and the canvas's side in device pixels.
   */
  paint(pose: Pose, accents: Record<Look, Rgb>, side: number, scale?: number): void
  /** Lets the graphics card go at once, rather than when the page is collected. */
  dispose(): void
}

const SHARED = ['extent', 'center', 'radius', 'accent', 'weight', 'grain', 'echoShift', 'gaze', 'power', 'tilt'] as const

interface Program {
  program: WebGLProgram
  shared: Record<(typeof SHARED)[number], WebGLUniformLocation | null>
  own: Record<string, WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

function link(gl: WebGL2RenderingContext, vertex: WebGLShader, drawing: Drawing): Program | undefined {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, drawing.fragment)
  const program = gl.createProgram()
  if (!fragment || !program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('The core could not be drawn on the graphics card:', gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program))
    return undefined
  }
  gl.deleteShader(fragment)
  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'u_echo'), 0)
  const locate = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]))
  return { program, shared: locate(SHARED) as Program['shared'], own: locate(drawing.uniforms) }
}

/** Everything the core keeps on the graphics card, made again whenever the context comes back after being lost. */
function prepare(gl: WebGL2RenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const echo = gl.createTexture()
  if (!vertex || !echo) return undefined
  // Both looks are made at once, so a change of persona never waits on the graphics card.
  const lens = link(gl, vertex, LENS)
  const hud = link(gl, vertex, HUD)
  gl.deleteShader(vertex)
  if (!lens || !hud) return undefined

  gl.bindTexture(gl.TEXTURE_2D, echo)
  // Two rows: the voice's past, and its spectrum now.
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ECHO_LENGTH, 2)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const programs: Record<Look, Program> = { lens, hud }
  // Without a bloom, the core is drawn straight onto the canvas, sharp and without its halo.
  const bloom = createBloom(gl)
  return { programs, echo, bloom }
}

/**
 * Sets the core up on a canvas, or gives nothing when the graphics card cannot draw it there; it is then drawn on
 * a 2D canvas of its own (`painter.ts`). A machine without a usable graphics card is refused too, unless `force`
 * says otherwise: drawing on the processor would cost far more than the 2D drawing, every frame.
 */
export function createGpuCore(canvas: HTMLCanvasElement, force = false): GpuCore | undefined {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: !force
  })
  if (!gl) return undefined
  let ready = prepare(gl)
  if (!ready) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return undefined
  }

  const echo = new Uint8Array(ECHO_LENGTH * 2 * 2)
  let grain = 0

  // A lost context (the graphics card reset, or too many canvases at once) comes back empty: it is all made again.
  const onLost = (event: Event) => event.preventDefault()
  const onRestored = () => {
    ready = prepare(gl)
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    paint(pose, accents, side, scale = 1) {
      if (!ready || gl.isContextLost()) return
      gl.viewport(0, 0, side, side)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      // Each look gives its light already weighted, so adding them is the cross-fade.
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      grain = (grain + 17.31) % 256
      // The voice goes up halved, so a loud voice still fits in a byte.
      const byte = (value: number) => Math.round(Math.min(1, value / 2) * 255)
      for (let index = 0; index < ECHO_LENGTH * 2; index++) echo[index] = byte(pose.echo[index] ?? 0)
      for (let index = 0; index < ECHO_LENGTH * 2; index++) echo[ECHO_LENGTH * 2 + index] = index < BANDS * 2 ? byte(pose.spectrum[index] ?? 0) : 0
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, ready.echo)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ECHO_LENGTH, 2, gl.RG, gl.UNSIGNED_BYTE, echo)
      if (ready.bloom) {
        ready.bloom.begin(side)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE)
      }
      let glow = 0

      for (const look of Object.keys(DRAWINGS) as Look[]) {
        const weight = pose.looks[look]
        if (weight < 0.002) continue
        const drawing = DRAWINGS[look]
        const { program, shared, own } = ready.programs[look]
        const size = drawing.size * (1 - LOOK_SHRINK * (1 - weight)) * scale
        const [red, green, blue] = accents[look]
        gl.useProgram(program)
        // The polygon's sides must clear what is drawn, not only its corners.
        gl.uniform1f(shared.extent, Math.min(1.5, (size * drawing.reach) / Math.cos(Math.PI / SIDES)))
        gl.uniform2f(shared.center, side / 2, side / 2)
        gl.uniform1f(shared.radius, (side / 2) * size)
        gl.uniform3f(shared.accent, red / 255, green / 255, blue / 255)
        gl.uniform1f(shared.weight, weight)
        gl.uniform1f(shared.grain, grain)
        gl.uniform1f(shared.echoShift, pose.echoShift)
        gl.uniform2f(shared.gaze, pose.gaze[0], pose.gaze[1])
        gl.uniform1f(shared.power, pose.power)
        gl.uniform2f(shared.tilt, pose.gaze[0] * TILT, pose.gaze[1] * TILT)
        drawing.set(gl, own, pose, (side / 2) * size)
        gl.drawArrays(gl.TRIANGLE_FAN, 0, SIDES + 2)
        glow += drawing.bloom * weight
      }
      ready.bloom?.finish(glow, grain)
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (ready && !gl.isContextLost()) {
        for (const { program } of Object.values(ready.programs)) gl.deleteProgram(program)
        gl.deleteTexture(ready.echo)
        ready.bloom?.dispose()
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
