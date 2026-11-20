import type { Look } from '@repo/protocol'
import { createBloom } from './bloom.ts'
import type { Rgb } from './color.ts'
import { compile, type Drawing, link, SIDES, sampleSmoothly, VERTEX } from './glsl.ts'
import { HUD } from './hud-shader.ts'
import { LENS } from './lens-shader.ts'
import { BANDS, ECHO_LENGTH, LOOK_SHRINK, type Pose } from './life.ts'

/**
 * Draws the core on the graphics card: each look is one small fragment shader over a polygon just round it.
 * While one look gives way to another, both are drawn, each weighted by how far it is in effect, and added: a
 * cross-fade, with the outgoing look drawing back a little as the incoming one settles in. Then its light blooms
 * (`bloom.ts`), each look as much as it asks.
 *
 * Every core of the page is drawn in one context, on a canvas never put in the page, and copied into a canvas of its
 * own where it sits, so each keeps its place and depth in the page. A page holds only so many contexts before it
 * drops the oldest, and each would build the same programs again.
 */

const DRAWINGS: Record<Look, Drawing> = { lens: LENS, hud: HUD }

interface GpuCore {
  /**
   * Draws one frame into the core's canvas: the pose from the life behind it, each look's accent as red, green and
   * blue from 0 to 255 (a look giving way keeps the accent it had), the canvas's side in device pixels, and how large
   * the core is drawn in it, from 0 to 1.
   */
  paint(pose: Pose, accents: Record<Look, Rgb>, side: number, scale: number): void
  /** Stops drawing this core, and lets go of what was kept only for its size. */
  dispose(): void
}

const SHARED = ['extent', 'center', 'radius', 'accent', 'weight', 'grain', 'echoShift', 'tilt', 'time'] as const

interface Program {
  program: WebGLProgram
  shared: Record<(typeof SHARED)[number], WebGLUniformLocation | null>
  own: Record<string, WebGLUniformLocation | null>
}

function build(gl: WebGL2RenderingContext, vertex: WebGLShader, drawing: Drawing): Program | undefined {
  const program = link(gl, vertex, drawing.fragment, 'The core')
  if (!program) return undefined
  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'u_echo'), 0)
  const locate = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, `u_${name}`)]))
  return { program, shared: locate(SHARED) as Program['shared'], own: locate(drawing.uniforms) }
}

/** Everything the cores keep on the graphics card, made again whenever the context comes back after being lost. */
function prepare(gl: WebGL2RenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const echo = gl.createTexture()
  if (!vertex || !echo) return undefined
  // Both looks are made at once, so a change of persona never waits on the graphics card.
  const lens = build(gl, vertex, LENS)
  const hud = build(gl, vertex, HUD)
  gl.deleteShader(vertex)
  if (!lens || !hud) return undefined

  gl.bindTexture(gl.TEXTURE_2D, echo)
  // Two rows: the voice's past, and its spectrum now.
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ECHO_LENGTH, 2)
  sampleSmoothly(gl)
  const programs: Record<Look, Program> = { lens, hud }
  // Without a bloom, the core is drawn straight onto the canvas, sharp and without its halo.
  const bloom = createBloom(gl)
  return { programs, echo, bloom }
}

type Prepared = NonNullable<ReturnType<typeof prepare>>

/** The one context every core is drawn in, and what is kept there. */
interface Renderer {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  /** Nothing while the context is lost, or when what it needs could not be made again. */
  ready: Prepared | undefined
  /** The side each core was last drawn at, in device pixels. */
  sides: Map<object, number>
  echo: Uint8Array
  grain: number
}

/** Made for the first core; `null` once the graphics card refused it, so no other core asks again. */
let renderer: Renderer | null | undefined

/**
 * A machine without a usable graphics card is refused, unless `force` says otherwise: drawn on the processor, every
 * core would cost a share of it on every frame.
 */
function makeRenderer(force: boolean): Renderer | undefined {
  const canvas = document.createElement('canvas')
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
  const ready = prepare(gl)
  if (!ready) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return undefined
  }
  const made: Renderer = { canvas, gl, ready, sides: new Map(), echo: new Uint8Array(ECHO_LENGTH * 2 * 2), grain: 0 }
  // A lost context (the graphics card reset) stops every core at once, each on its last picture. It comes back
  // empty: the programs are made again, and the bloom's textures as each size is drawn.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    made.ready = undefined
  })
  canvas.addEventListener('webglcontextrestored', () => {
    made.ready = prepare(gl)
  })
  return made
}

/** The shared canvas is as large as the largest core drawn, so every core fits in its bottom left corner. */
function fit({ canvas, sides }: Renderer) {
  const largest = Math.max(0, ...sides.values())
  if (largest > 0 && (canvas.width !== largest || canvas.height !== largest)) {
    canvas.width = largest
    canvas.height = largest
  }
}

/** Draws a core into the bottom left corner of the shared canvas, `side` device pixels across. */
function draw(shared: Renderer, ready: Prepared, pose: Pose, accents: Record<Look, Rgb>, side: number, scale: number) {
  const { gl, echo } = shared
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, side, side)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  // The bloom makes its textures first: making them binds each, which would take the voice's place.
  ready.bloom?.begin(side)
  // Each look gives its light already weighted, so adding them is the cross-fade.
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  shared.grain = (shared.grain + 17.31) % 256
  // The voice goes up halved, so a loud voice still fits in a byte.
  const byte = (value: number) => Math.round(Math.min(1, value / 2) * 255)
  for (let index = 0; index < ECHO_LENGTH * 2; index++) echo[index] = byte(pose.echo[index] ?? 0)
  for (let index = 0; index < ECHO_LENGTH * 2; index++) echo[ECHO_LENGTH * 2 + index] = index < BANDS * 2 ? byte(pose.spectrum[index] ?? 0) : 0
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, ready.echo)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ECHO_LENGTH, 2, gl.RG, gl.UNSIGNED_BYTE, echo)
  let glow = 0

  for (const look of Object.keys(DRAWINGS) as Look[]) {
    const weight = pose.looks[look]
    if (weight < 0.002) continue
    const drawing = DRAWINGS[look]
    const { program, shared: at, own } = ready.programs[look]
    const size = drawing.size * (1 - LOOK_SHRINK * (1 - weight)) * scale
    const [red, green, blue] = accents[look]
    gl.useProgram(program)
    // The polygon's sides must clear what is drawn, not only its corners.
    gl.uniform1f(at.extent, Math.min(1.5, (size * drawing.reach) / Math.cos(Math.PI / SIDES)))
    gl.uniform2f(at.center, side / 2, side / 2)
    gl.uniform1f(at.radius, (side / 2) * size)
    gl.uniform3f(at.accent, red / 255, green / 255, blue / 255)
    gl.uniform1f(at.weight, weight)
    gl.uniform1f(at.grain, shared.grain)
    gl.uniform1f(at.echoShift, pose.echoShift)
    const turn = drawing.turn(pose)
    gl.uniform2f(at.tilt, turn[0], turn[1])
    // The clock comes round every few hours, so its small steps stay exact.
    gl.uniform1f(at.time, pose.clock % 8192)
    drawing.set(gl, own, pose, (side / 2) * size)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, SIDES + 2)
    glow += drawing.bloom * weight
  }
  ready.bloom?.finish(glow, shared.grain)
}

/**
 * Sets a core up to be drawn into its canvas, or gives nothing when the graphics card cannot draw it: the core is
 * then painted on the canvas directly (`painter.ts`). The shared context is made for the first core.
 */
export function createGpuCore(canvas: HTMLCanvasElement, force: boolean): GpuCore | undefined {
  if (renderer === undefined) renderer = makeRenderer(force) ?? null
  const shared = renderer
  const context = shared && canvas.getContext('2d')
  if (!shared || !context) return undefined
  const core = {}
  // The bloom's textures for a size go with the last core drawn at it.
  const leave = (side: number | undefined) => {
    if (side !== undefined && ![...shared.sides.values()].includes(side)) shared.ready?.bloom?.release(side)
  }

  return {
    paint(pose, accents, side, scale) {
      const { ready } = shared
      // While the context is lost, the canvas keeps the last picture copied into it.
      if (!ready || shared.gl.isContextLost()) return
      const was = shared.sides.get(core)
      if (was !== side) {
        shared.sides.set(core, side)
        leave(was)
        fit(shared)
      }
      draw(shared, ready, pose, accents, side, scale)
      // The graphics card counts rows from the bottom: what was drawn is the bottom left square.
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(shared.canvas, 0, shared.canvas.height - side, side, side, 0, 0, side, side)
    },
    dispose() {
      const was = shared.sides.get(core)
      shared.sides.delete(core)
      leave(was)
      fit(shared)
    }
  }
}
