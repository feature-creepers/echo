/**
 * The bloom of the core's light: what is bright bleeds into a soft halo round it, as light does in a camera or in a
 * hologram, the brightest the widest. The core is drawn into a texture of its own; that texture is halved again
 * and again, each half blurred as it is made, then the halves are added back up from the smallest, and the sum is
 * laid over the drawing. It is the dual filter of real-time renderers: a few small passes, a fraction of a
 * millisecond for a core of 320 pixels at density 2.
 */

/** How many times the drawing is halved: the smallest half is a thirty-second of it, for the widest halo. */
const LEVELS = 5

const FULL = `#version 300 es
out vec2 v_at;
void main() {
  // One triangle over the whole target, made from each vertex's number alone.
  vec2 corner = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1));
  v_at = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`

// Halving: the middle and four corners half a texel out, so each pass blurs as it shrinks. The first pass keeps
// mostly what is bright, so faint lines glow little and bright ones much.
const DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_from;
uniform vec2 u_texel;
uniform float u_first;
in vec2 v_at;
out vec4 color;
vec4 bright(vec4 c) {
  if (u_first < 0.5) return c;
  float peak = max(c.r, max(c.g, c.b));
  return c * (0.06 + 0.94 * smoothstep(0.1, 0.75, peak));
}
void main() {
  vec4 sum = bright(texture(u_from, v_at)) * 4.0;
  sum += bright(texture(u_from, v_at + vec2(-1.0, -1.0) * u_texel));
  sum += bright(texture(u_from, v_at + vec2(1.0, -1.0) * u_texel));
  sum += bright(texture(u_from, v_at + vec2(-1.0, 1.0) * u_texel));
  sum += bright(texture(u_from, v_at + vec2(1.0, 1.0) * u_texel));
  color = sum / 8.0;
}`

// Doubling: eight taps round the texel, the nearer ones twice, added onto the larger half.
const UP = `#version 300 es
precision highp float;
uniform sampler2D u_from;
uniform vec2 u_texel;
in vec2 v_at;
out vec4 color;
void main() {
  vec4 sum = texture(u_from, v_at + vec2(-2.0, 0.0) * u_texel);
  sum += texture(u_from, v_at + vec2(2.0, 0.0) * u_texel);
  sum += texture(u_from, v_at + vec2(0.0, -2.0) * u_texel);
  sum += texture(u_from, v_at + vec2(0.0, 2.0) * u_texel);
  sum += texture(u_from, v_at + vec2(-1.0, -1.0) * u_texel) * 2.0;
  sum += texture(u_from, v_at + vec2(1.0, -1.0) * u_texel) * 2.0;
  sum += texture(u_from, v_at + vec2(-1.0, 1.0) * u_texel) * 2.0;
  sum += texture(u_from, v_at + vec2(1.0, 1.0) * u_texel) * 2.0;
  color = sum / 12.0;
}`

// Laying the halo over the drawing: light added to light. What only glows has as much opacity as its brightest
// colour, so it shows over the page as light, never as a dark veil. A grain under one step keeps it from banding.
const COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_glow;
uniform float u_strength;
uniform float u_grain;
in vec2 v_at;
out vec4 color;
void main() {
  vec4 scene = texture(u_scene, v_at);
  vec3 glow = texture(u_glow, v_at).rgb * u_strength;
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy + u_grain, vec2(0.06711056, 0.00583715)))) - 0.5;
  vec3 light = max(scene.rgb + glow + noise / 255.0, 0.0);
  color = vec4(light, max(scene.a, min(1.0, max(light.r, max(light.g, light.b)))));
}`

interface Target {
  texture: WebGLTexture
  frame: WebGLFramebuffer
  side: number
}

function program(gl: WebGL2RenderingContext, vertex: WebGLShader, source: string) {
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)
  const made = gl.createProgram()
  if (!fragment || !made) return undefined
  gl.shaderSource(fragment, source)
  gl.compileShader(fragment)
  gl.attachShader(made, vertex)
  gl.attachShader(made, fragment)
  gl.linkProgram(made)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) {
    console.warn('The core’s bloom could not be drawn on the graphics card:', gl.getProgramInfoLog(made))
    return undefined
  }
  return made
}

export interface Bloom {
  /** Draw the core into the bloom's own texture from now on, for a canvas this many device pixels across. */
  begin(side: number): void
  /** Blur what was drawn and lay it, with its halo as strong as asked, over the canvas. */
  finish(strength: number, grain: number): void
  dispose(): void
}

export function createBloom(gl: WebGL2RenderingContext): Bloom | undefined {
  const vertex = gl.createShader(gl.VERTEX_SHADER)
  if (!vertex) return undefined
  gl.shaderSource(vertex, FULL)
  gl.compileShader(vertex)
  const down = program(gl, vertex, DOWN)
  const up = program(gl, vertex, UP)
  const compose = program(gl, vertex, COMPOSE)
  gl.deleteShader(vertex)
  if (!down || !up || !compose) return undefined
  const at = (made: WebGLProgram, name: string) => gl.getUniformLocation(made, name)
  const where = {
    down: { from: at(down, 'u_from'), texel: at(down, 'u_texel'), first: at(down, 'u_first') },
    up: { from: at(up, 'u_from'), texel: at(up, 'u_texel') },
    compose: { scene: at(compose, 'u_scene'), glow: at(compose, 'u_glow'), strength: at(compose, 'u_strength'), grain: at(compose, 'u_grain') }
  }

  let targets: Target[] = []
  const make = (side: number): Target | undefined => {
    const texture = gl.createTexture()
    const frame = gl.createFramebuffer()
    if (!texture || !frame) return undefined
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, side, side)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, frame, side }
  }
  const release = () => {
    for (const target of targets) {
      gl.deleteTexture(target.texture)
      gl.deleteFramebuffer(target.frame)
    }
    targets = []
  }
  // The scene at full size, then each half, made again only when the canvas changes size.
  const sized = (side: number) => {
    if (targets[0]?.side === side) return true
    release()
    for (let level = 0, each = side; level <= LEVELS; level++, each = Math.max(1, Math.floor(each / 2))) {
      const target = make(each)
      if (!target) return false
      targets.push(target)
    }
    return true
  }
  const pass = (made: WebGLProgram, from: Target, into: Target | null, side: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into?.frame ?? null)
    gl.viewport(0, 0, side, side)
    gl.useProgram(made)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, from.texture)
  }

  return {
    begin(side) {
      if (!sized(side)) return
      const scene = targets[0]
      if (!scene) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.frame)
      gl.viewport(0, 0, side, side)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    finish(strength, grain) {
      const scene = targets[0]
      if (!scene) return
      gl.disable(gl.BLEND)
      // Down, each half blurred from the one before.
      for (let level = 1; level <= LEVELS; level++) {
        const from = targets[level - 1]
        const into = targets[level]
        if (!from || !into) break
        pass(down, from, into, into.side)
        gl.uniform1i(where.down.from, 0)
        gl.uniform2f(where.down.texel, 0.5 / from.side, 0.5 / from.side)
        gl.uniform1f(where.down.first, level === 1 ? 1 : 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      // Up, each added onto the larger half, so the halo is the sum of every width.
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      for (let level = LEVELS; level >= 2; level--) {
        const from = targets[level]
        const into = targets[level - 1]
        if (!from || !into) continue
        pass(up, from, into, into.side)
        gl.uniform1i(where.up.from, 0)
        gl.uniform2f(where.up.texel, 0.5 / from.side, 0.5 / from.side)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      // Over the canvas: the drawing as it was, and its halo.
      gl.disable(gl.BLEND)
      const glow = targets[1]
      if (!glow) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, scene.side, scene.side)
      gl.useProgram(compose)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, scene.texture)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, glow.texture)
      gl.uniform1i(where.compose.scene, 0)
      gl.uniform1i(where.compose.glow, 1)
      gl.uniform1f(where.compose.strength, strength)
      gl.uniform1f(where.compose.grain, grain)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.activeTexture(gl.TEXTURE0)
    },
    dispose() {
      release()
      for (const made of [down, up, compose]) gl.deleteProgram(made)
    }
  }
}
