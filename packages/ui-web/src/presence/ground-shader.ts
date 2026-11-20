import { FIELD_GAP, FIELD_REACH, FIELD_SPEED } from './field.ts'
import { ECHO_LENGTH, ECHO_STEP } from './life.ts'

/**
 * The window's ground on the graphics card: the same fine dots as the CSS ground (`dot-ground` in `app.css`), one
 * pixel every 18, landing on whole device pixels and fading out towards the window's edges, under a light that
 * lives. Soft pools of light drift over them, so the dots grow a little brighter and dimmer as they pass; the core
 * lights the dots round it in its accent; and where the core looks, a pool of its light falls.
 *
 * The voice goes on through the ground round the core (`field.ts`): its own voice travels out through the dots,
 * which light and swell a little as it passes, and the voice it hears travels in. The lens does it in soft light, as
 * a lamp lights a wall; the instrument draws it too, in fine rings of light. Nothing else the core does crosses its
 * edge, so the ground stays calm while it thinks and works.
 *
 * A pixel that is no dot and has none of that light is left at once, after a few operations: at rest only about one
 * pixel in three hundred works out the light, so the whole window costs little more than the dots did.
 */

/** The pitch of the dots, and where in each cell the dot sits, in CSS pixels, as the CSS ground draws them. */
const PITCH = 18
const DOT_AT = 9.5

/** How far across the light's pools are, in CSS pixels, and how fast they drift, in their own widths a second. */
const POOL_WIDTH = 560
const DRIFT = 0.016

/** The smallest radius a core's field is worked out from, in CSS pixels: a small core still fields a little way round it. */
const SMALLEST_FIELD = 40

/** Drawn over the whole canvas, by the vertex shader that covers it (`COVER` in `glsl.ts`). */

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
// The voice over the last second, one texel a sample, newest first: the core's own in red, the one it hears in
// green, halved to fit; and how far between two samples it is.
uniform sampler2D u_voice;
uniform float u_voiceShift;
// How much of the field is drawn in fine lines, as the instrument's, rather than in soft light, as the lens's.
uniform float u_fine;
// How much of each voice shows: its own going out, and the one it hears coming in.
uniform vec2 u_voices;
// How far the voice's rings have travelled since the last one left, to 1.
uniform float u_travel;

out vec4 color;

const float TAU = 6.28318530718;
const float REACH = ${FIELD_REACH.toFixed(3)};
const float SPEED = ${FIELD_SPEED.toFixed(3)};
const float GAP = ${FIELD_GAP.toFixed(3)};

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

// What the voice was a delay in seconds ago: x the core's own, y the one it hears.
vec2 voice(float delay) {
  float at = clamp(delay / ${ECHO_STEP.toFixed(6)} - u_voiceShift, 0.0, ${(ECHO_LENGTH - 1).toFixed(1)});
  return texture(u_voice, vec2((at + 0.5) / ${ECHO_LENGTH.toFixed(1)}, 0.5)).rg * 2.0;
}

// How much of a pixel a fine line covers, from how far from the line's middle the pixel is, in device pixels.
float fineLine(float apart) {
  return clamp(1.2 - abs(apart), 0.0, 1.0);
}

// What the voice lights at a place round the core: x, how much light falls there; y, how much of one of the
// instrument's fine lines passes there.
vec2 field(vec2 place) {
  vec2 rel = place - u_core.xy;
  float radius = max(u_core.z, ${SMALLEST_FIELD.toFixed(1)});
  float far = length(rel) / radius;
  // From just inside the core's edge, so the field starts under it.
  float beyond = far - 0.94;
  if (beyond < 0.0 || beyond > REACH) return vec2(0.0);
  // How many device pixels one of the core's radii is.
  float px = radius * u_ratio;
  float near = exp(-beyond / (REACH * 0.4));
  float edge = 1.0 - smoothstep(REACH * 0.7, REACH, beyond);
  float light = 0.0;
  float lines = 0.0;
  // Its own voice, going out: what it said a moment ago is here now, carried on rings that leave it one after the
  // other.
  if (u_voices.x > 0.001) {
    float said = voice(beyond / SPEED).x;
    float cell = fract(beyond / GAP - u_travel);
    light += said * near * edge * 1.1;
    lines += fineLine(min(cell, 1.0 - cell) * GAP * px) * said * near * edge * 0.9;
  }
  // The voice it hears, coming in: it shows at the field's edge and reaches the core a moment later.
  if (u_voices.y > 0.001) {
    float heard = voice((REACH - beyond) / SPEED).y;
    float cell = fract(beyond / GAP + u_travel);
    float coming = smoothstep(REACH, REACH * 0.45, beyond) * (0.35 + 0.65 * near);
    light += heard * coming;
    lines += fineLine(min(cell, 1.0 - cell) * GAP * px) * heard * coming * 0.8;
  }
  return vec2(light, lines);
}

void main() {
  // From the top left, in CSS pixels, as the page counts.
  vec2 css = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_ratio;
  vec2 within = mod(css, ${PITCH.toFixed(1)}) - ${DOT_AT.toFixed(1)};
  // Each dot is lit as one, from where it sits.
  vec2 at = floor(css / ${PITCH.toFixed(1)}) * ${PITCH.toFixed(1)} + ${DOT_AT.toFixed(1)};
  float apart = length(within);

  // The voice's field, where any of it shows: between the dots, the lens's soft light and the instrument's fine
  // lines; on a dot, the light that falls where the dot sits, under which it swells a little.
  bool fielded = u_live > 0.0 && u_core.z > 0.0 && u_voices.x + u_voices.y > 0.001;
  vec2 here = fielded ? field(css) : vec2(0.0);
  float falling = fielded && apart < 1.8 ? min(field(at).x, 1.4) : 0.0;
  float between = here.x * mix(0.05, 0.014, u_fine) + here.y * u_fine * 0.3;
  float swell = min(falling, 1.0) * 0.7;
  float dot = 1.0 - smoothstep(0.5 + swell, 0.8 + swell, apart);
  if (dot <= 0.0 && between < 0.002) {
    color = vec4(0.0);
    return;
  }
  vec4 drawn = vec4(u_accent, 1.0) * between;

  if (dot > 0.0) {
    vec2 window = u_size / u_ratio;
    // The fade towards the window's edges, as the CSS ground's mask: whole in the middle, gone at the edges.
    vec2 off = (at / window - vec2(0.5, 0.42)) / vec2(0.72, 0.7);
    float fade = 1.0 - smoothstep(0.35, 1.0, length(off));

    // The pools of light: a slow field, warped by another, so they drift and change shape and never repeat.
    vec2 q = at / ${POOL_WIDTH.toFixed(1)};
    float t = u_time * ${DRIFT.toFixed(4)};
    vec2 warp = vec2(fbm(q * 0.8 + vec2(0.0, t * 1.3)), fbm(q * 0.8 + vec2(3.7, -t * 1.05)));
    float pools = mix(1.0, 0.45 + 1.2 * smoothstep(0.36, 0.78, fbm(q + 1.6 * warp + vec2(t * 0.75, -t * 0.5))), u_live);

    // The core's own light on the dots round it, and the pool where it looks.
    float near = u_core.z > 0.0 ? exp(-pow(length(at - u_core.xy) / (u_core.z * 2.6), 2.0)) : 0.0;
    float spot = u_spot.w * exp(-pow(length(at - u_spot.xy) / max(u_spot.z, 1.0), 2.0));
    float lit = (near * 0.8 + spot * 0.75) * u_glow;

    float alpha = (0.1 * pools + 0.2 * lit + 0.6 * falling) * max(fade, max(lit * 0.8, min(falling, 1.0))) * dot;
    vec3 tone = mix(vec3(1.0), u_accent, clamp(lit * 1.8 + falling, 0.0, 0.9));
    // At the height of the instrument's field a dot is nearly white, as its brightest lines are.
    tone = mix(tone, vec3(1.0), u_fine * 0.4 * clamp(falling - 0.45, 0.0, 1.0));
    drawn += vec4(tone, 1.0) * alpha;
  }
  color = drawn;
}`
