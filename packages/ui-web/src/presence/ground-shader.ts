/**
 * The window's ground on the graphics card: the same fine dots as the CSS ground (`dot-ground` in `app.css`), one
 * pixel every 18, landing on whole device pixels and fading out towards the window's edges, under a light that
 * lives. Soft pools of light drift over them, so the dots grow a little brighter and dimmer as they pass; the core
 * lights the dots round it in its accent; and where the core looks, a pool of its light falls.
 *
 * A pixel that is no dot is left at once, after a few operations: only about one pixel in three hundred works out
 * the light, so the whole window costs little more than the dots did.
 */

/** The pitch of the dots, and where in each cell the dot sits, in CSS pixels, as the CSS ground draws them. */
export const PITCH = 18
export const DOT_AT = 9.5

/** How far across the light's pools are, in CSS pixels, and how fast they drift, in their own widths a second. */
export const POOL_WIDTH = 560
export const DRIFT = 0.016

export const GROUND_VERTEX = `#version 300 es
void main() {
  // One triangle over the whole canvas, made from each vertex's number alone.
  vec2 corner = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID & 2) * 2 - 1));
  gl_Position = vec4(corner, 0.0, 1.0);
}`

export const GROUND_FRAGMENT = `#version 300 es
precision highp float;

// The canvas, in device pixels, and how many device pixels a CSS pixel is.
uniform vec2 u_size;
uniform float u_ratio;
// The light's own clock, in seconds: it runs faster as the computer works harder.
uniform float u_time;
// How much the light moves: none when less motion is asked for.
uniform float u_live;
uniform vec3 u_accent;
// The core: where it is and its radius, in CSS pixels from the top left; a radius of 0 when none is shown.
uniform vec3 u_core;
// How much light the core casts.
uniform float u_glow;
// Where the core looks: where, how wide its light falls there, and how strongly.
uniform vec4 u_spot;

out vec4 color;

float hash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), u.x), mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float weight = 0.5;
  for (int octave = 0; octave < 3; octave++) {
    sum += weight * noise(p);
    p = p * 2.03 + 17.1;
    weight *= 0.5;
  }
  return sum / 0.875;
}

void main() {
  // From the top left, in CSS pixels, as the page counts.
  vec2 css = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_ratio;
  vec2 within = mod(css, ${PITCH.toFixed(1)}) - ${DOT_AT.toFixed(1)};
  float dot = 1.0 - smoothstep(0.5, 0.8, length(within));
  if (dot <= 0.0) {
    color = vec4(0.0);
    return;
  }
  // Each dot is lit as one, from where it sits.
  vec2 at = floor(css / ${PITCH.toFixed(1)}) * ${PITCH.toFixed(1)} + ${DOT_AT.toFixed(1)};
  vec2 window = u_size / u_ratio;

  // The fade towards the window's edges, as the CSS ground's mask: whole in the middle, gone at the edges.
  vec2 off = (at / window - vec2(0.5, 0.42)) / vec2(0.72, 0.7);
  float fade = 1.0 - smoothstep(0.35, 1.0, length(off));

  // The pools of light: a slow field, warped by another, so they drift and change shape and never repeat.
  vec2 q = at / ${POOL_WIDTH.toFixed(1)};
  float t = u_time * ${DRIFT.toFixed(4)};
  vec2 warp = vec2(fbm(q * 0.8 + vec2(0.0, t * 1.3)), fbm(q * 0.8 + vec2(3.7, -t * 1.05)));
  float field = fbm(q + 1.6 * warp + vec2(t * 0.75, -t * 0.5));
  float pools = mix(1.0, 0.45 + 1.2 * smoothstep(0.36, 0.78, field), u_live);

  // The core's own light on the dots round it, and the pool where it looks.
  float near = u_core.z > 0.0 ? exp(-pow(length(at - u_core.xy) / (u_core.z * 2.6), 2.0)) : 0.0;
  float spot = u_spot.w * exp(-pow(length(at - u_spot.xy) / max(u_spot.z, 1.0), 2.0));
  float lit = (near * 0.8 + spot * 0.75) * u_glow;

  float alpha = (0.1 * pools + 0.2 * lit) * max(fade, lit * 0.8) * dot;
  vec3 tone = mix(vec3(1.0), u_accent, clamp(lit * 1.8, 0.0, 0.9));
  color = vec4(tone * alpha, alpha);
}`
