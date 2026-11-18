import { BANDS, ECHO_LENGTH, ECHO_STEP, type Pose } from './life.ts'

/**
 * What the two drawings of the core share on the graphics card: the polygon they are shaded in, the helpers
 * every pixel uses, and the voice's recent past.
 */

/** How many sides the polygon drawn round the core has: enough that it hugs the circle, few enough to cost nothing. */
export const SIDES = 32

/**
 * A polygon just round the drawing, as a fan from the centre, made from each vertex's number alone so no buffer is
 * needed. The corners of the canvas are never shaded at all.
 */
export const VERTEX = `#version 300 es
uniform float u_extent;
void main() {
  float turn = float(gl_VertexID - 1) * ${((2 * Math.PI) / SIDES).toFixed(8)};
  vec2 corner = gl_VertexID == 0 ? vec2(0.0) : vec2(cos(turn), sin(turn)) * u_extent;
  gl_Position = vec4(corner, 0.0, 1.0);
}`

/**
 * The uniforms and helpers both fragment shaders start with. Lengths are in the drawing's own radii, and `pixel`
 * is one device pixel in those units: that is how every edge stays one pixel soft at any size.
 */
export const PRELUDE = `#version 300 es
precision highp float;

uniform vec2 u_center;
// The drawing's radius, in device pixels.
uniform float u_radius;
uniform vec3 u_accent;
// How far this drawing is in effect, while one look gives way to the other.
uniform float u_weight;
uniform float u_grain;
// The voice over the last second, one texel a sample, newest first, on the first row; its spectrum now, from the
// low notes to the high, on the second. Its own voice in red, the voice it hears in green, halved to fit. The
// texture's own filtering blends neighbouring samples.
uniform sampler2D u_echo;
uniform float u_echoShift;
// Where the core looks, as a direction across the screen, up as up, each from -1 to 1.
uniform vec2 u_gaze;
// How hard the computer works, from 0 to 1, followed over a few seconds.
uniform float u_power;
// How far the drawing's face is turned, in radians: x to face right, y to face up.
uniform vec2 u_tilt;

out vec4 color;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Smooth value noise, wrapping every period cells across, so a pattern laid round the circle closes on itself.
float noise(vec2 p, float period) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(cell.x, period);
  float x1 = mod(cell.x + 1.0, period);
  return mix(mix(hash(vec2(x0, cell.y)), hash(vec2(x1, cell.y)), u.x), mix(hash(vec2(x0, cell.y + 1.0)), hash(vec2(x1, cell.y + 1.0)), u.x), u.y);
}

// Where a point of the screen, in the drawing's radii from its centre, falls on the drawing's face as the face
// turns: the ray from a small camera in front of it, through the point, meets the turned face there. Unturned, a
// point is where it was; turned, the near side grows a little and the far side shrinks, as a real face would.
vec2 face(vec2 screen) {
  const float CAMERA = 5.0;
  float ca = cos(u_tilt.x), sa = sin(u_tilt.x), cb = cos(u_tilt.y), sb = sin(u_tilt.y);
  vec3 normal = vec3(sa, sb * ca, cb * ca);
  float t = normal.z * CAMERA / (normal.z * CAMERA - normal.x * screen.x - normal.y * screen.y);
  vec3 at = vec3(t * screen, CAMERA - t * CAMERA);
  float depth = sb * at.y + cb * at.z;
  return vec2(ca * at.x - sa * depth, cb * at.y - sb * at.z);
}

// How much of a pixel a line covers, from its distance to the line's middle and its width, both in device
// pixels. A line one pixel wide covers exactly one pixel's worth, spread over two where it falls between them.
float stroke(float distance, float width) {
  return clamp(width * 0.5 + 0.5 - abs(distance), 0.0, 1.0);
}

// What the voice was a delay in seconds ago: x its own, y the one it hears.
vec2 echo(float delay) {
  float at = clamp(delay / ${ECHO_STEP.toFixed(6)} - u_echoShift, 0.0, ${(ECHO_LENGTH - 1).toFixed(1)});
  return texture(u_echo, vec2((at + 0.5) / ${ECHO_LENGTH.toFixed(1)}, 0.25)).rg * 2.0;
}

// The voice's spectrum at a note, from the lowest (0) to the highest (1): x its own, y the one it hears.
vec2 spectrum(float note) {
  float at = clamp(note, 0.0, 1.0) * ${(BANDS - 1).toFixed(1)};
  return texture(u_echo, vec2((at + 0.5) / ${ECHO_LENGTH.toFixed(1)}, 0.75)).rg * 2.0;
}

// Light from a source as warm as it is strong: its colour where faint, through the colours its filter leaks, to
// white where it burns. The response says how fast each channel fills; the strongest fills at the given pace.
vec3 burn(float intensity, vec3 response) {
  return 1.0 - exp(-intensity * response / max(response.r, max(response.g, response.b)));
}

// Hands a pixel over: light that adds to what is behind, over a dark body that hides it. A grain under one step
// of colour keeps faint gradients from banding on a dark ground.
void finish(vec3 light, float body) {
  light = max(light + (fract(52.9829189 * fract(dot(gl_FragCoord.xy + u_grain, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0, 0.0);
  color = vec4(light, max(body, max(light.r, max(light.g, light.b)))) * u_weight;
}
`

/** One look of the core as the graphics card draws it. */
export interface Drawing<Name extends string = string> {
  /** The fragment shader, starting with `PRELUDE`. */
  fragment: string
  /** The drawing's radius, as a share of half the canvas. */
  size: number
  /** How far out it is shaded, in its own radii: whatever it draws beyond its edge is gone by then. */
  reach: number
  /** How strongly its light blooms into a halo, from 0. */
  bloom: number
  /** The uniforms of its own, each written `u_` and this name in the shader. */
  uniforms: readonly Name[]
  /** Sets those uniforms for one frame, the drawing's radius given in device pixels. */
  set(gl: WebGL2RenderingContext, at: Record<Name, WebGLUniformLocation | null>, pose: Pose, radius: number): void
}
