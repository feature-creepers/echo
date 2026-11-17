import { ECHO_LENGTH, ECHO_STEP } from './life.ts'

/** How many sides the polygon drawn round the lens has: enough that it hugs the circle, few enough to cost nothing. */
export const SIDES = 32

/** How far out the lens is drawn, in lens radii: the rim's bloom is gone by then. */
export const REACH = 1.2

/**
 * A polygon just round the lens and its bloom, as a fan from the centre, made from each vertex's number alone so
 * no buffer is needed. The corners of the canvas are never shaded at all.
 */
export const VERTEX = `#version 300 es
uniform float u_extent;
void main() {
  float turn = float(gl_VertexID - 1) * ${((2 * Math.PI) / SIDES).toFixed(8)};
  vec2 corner = gl_VertexID == 0 ? vec2(0.0) : vec2(cos(turn), sin(turn)) * u_extent;
  gl_Position = vec4(corner, 0.0, 1.0);
}`

/**
 * The lens, worked out for each pixel from its distance to the centre and its angle round it. Lengths are in
 * lens radii; `pixel` is one device pixel in those units, which is how every edge stays one pixel soft at any size.
 */
export const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 u_center;
uniform float u_radius;
uniform vec3 u_accent;
uniform float u_aperture;
uniform float u_heart;
uniform float u_iris;
uniform float u_rim;
uniform vec2 u_pools[3];
uniform vec2 u_sheen;
uniform vec2 u_gaze;
uniform vec2 u_orbit;
uniform float u_orbitStrength;
// The voice and the pulse over the last second, one texel a sample, newest first: outwards in red, inwards in
// green, halved to fit. The texture's own filtering blends neighbouring samples.
uniform sampler2D u_echo;
uniform float u_echoShift;
uniform float u_grain;

out vec4 color;

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

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

// A line of a given width centred on a radius, its edges smoothed over one pixel.
float line(float distance, float width, float pixel) {
  return clamp((width * 0.5 - abs(distance)) / pixel + 0.5, 0.0, 1.0);
}

// What travelled through the glass, as it was a delay in seconds ago: x outwards, y inwards.
vec2 echo(float delay) {
  float at = clamp(delay / ${ECHO_STEP.toFixed(6)} - u_echoShift, 0.0, ${(ECHO_LENGTH - 1).toFixed(1)});
  return texture(u_echo, vec2((at + 0.5) / ${ECHO_LENGTH.toFixed(1)}, 0.5)).rg * 2.0;
}

void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
  float r = length(p);
  float pixel = 1.0 / u_radius;
  vec2 toward = p / max(r, 1e-4);
  // How much of this pixel the glass covers, so its edge is smoothed over one pixel.
  float cover = clamp((1.0 - r) / pixel + 0.5, 0.0, 1.0);

  // Thinking: a light runs round the pupil, and its glint round the rim, a bright head with a tail fading behind.
  // Worked out from the cosine and sine of the angle to it, which costs far less than the angle itself.
  float comet = 0.0;
  if (u_orbitStrength > 0.001) {
    float along = dot(toward, u_orbit);
    float behind = toward.x * u_orbit.y - toward.y * u_orbit.x;
    comet = exp((along - 1.0) * (behind < 0.0 ? 2.2 : 40.0)) * u_orbitStrength;
  }

  // The rim catches the light unevenly, and the unevenness turns slowly; the voice heard arrives at it first.
  float rimLight = u_rim * (0.85 + 0.15 * dot(vec2(toward.x * toward.x - toward.y * toward.y, 2.0 * toward.x * toward.y), u_sheen))
    + comet * 0.6 + echo(0.0).y * 0.5;
  float intensity = line(r - 1.0, max(pixel, 0.005), pixel) * rimLight;

  if (r > 1.0) {
    // Beyond the rim, only the least bloom, gone before the canvas's edge.
    float beyond = r - 1.0;
    intensity += (exp(-beyond / 0.016) * 0.09 + exp(-beyond / 0.06) * 0.02) * (1.0 - smoothstep(1.06, ${REACH.toFixed(2)}, r)) * rimLight;
  }
  if (cover > 0.0) {
    // The inner light sits a little deeper than the glass: it is centred on the gaze, which wanders by a hair.
    float d = length(p - u_gaze);
    float aperture = u_aperture;
    float outside = max(d - aperture, 0.0);
    float inner = 0.0;

    // Light drifting under the surface: three soft pools of it, wandering slowly.
    vec2 a = p - u_pools[0];
    vec2 b = p - u_pools[1];
    vec2 c = p - u_pools[2];
    float pool = min(1.0, exp(-dot(a, a) * 5.0) + exp(-dot(b, b) * 7.0) * 0.8 + exp(-dot(c, c) * 9.0) * 0.6);

    // The voice and the pulse travel through the glass: outwards from the pupil, or in from the rim while listening.
    float swell = 1.0;
    if (outside < 0.7) {
      float across = outside / (1.0 - aperture);
      swell += (echo(across * 0.9).x * 1.6 + echo((1.0 - across) * 0.9).y * 1.4) * (1.0 - smoothstep(0.45, 0.7, outside));
    }

    // The iris: fine radial fibres round the pupil, lit from behind and fading into the dark glass. A fibre
    // narrower than a couple of pixels fades to its average, so small eyes stay clean instead of shimmering.
    if (outside < 0.5) {
      float around = atan(p.y, p.x) / TAU + 0.5;
      float arc = TAU * d * u_radius;
      float fibres = mix(0.5, noise(vec2(around * 96.0, d * 6.0), 96.0), smoothstep(1.5, 3.5, arc / 96.0)) * 0.6
        + mix(0.5, noise(vec2(around * 210.0, d * 11.0 + 7.0), 210.0), smoothstep(1.5, 3.5, arc / 210.0)) * 0.4;
      inner += exp(-outside * 7.5) * (0.6 + 0.8 * fibres) * (0.7 + 0.6 * pool) * 0.34 * u_iris * swell * (1.0 - smoothstep(0.3, 0.5, outside));
      float ring = outside - 0.05;
      inner += comet * (line(ring, max(pixel * 1.4, 0.01), pixel) * 1.3 + exp(-ring * ring * 400.0) * (0.3 + 0.5 * fibres));
    }

    // Further out the glass is dark, with only a faint wisp of light where it pools.
    inner += pool * pool * 0.06 * exp(-outside * 2.2) * u_iris * swell;

    // The pupil: the light seen directly, white-hot at its heart and falling off as a real light does, quickly
    // and then slowly. Past its edge a little of it spills over the iris, so the edge is crisp but not cut out.
    if (outside < 0.35) {
      float edge = max(pixel * 0.6, 0.004);
      float pupil = 1.0 - smoothstep(aperture - edge, aperture + edge, d);
      float heart = d / (aperture * 0.32);
      float spill = outside / 0.025;
      inner += ((0.42 + 2.6 / (1.0 + heart * heart)) * pupil + 0.26 / (1.0 + spill * spill) * (1.0 - pupil)) * u_heart;
    }

    // A faint sheen just inside the rim, where the glass curves away.
    inner += exp(-(1.0 - r) / 0.07) * 0.14 * rimLight;
    intensity += inner * cover;
  }

  // One accent: brightness is how much light there is, and only the hottest light leans to white.
  float bright = 1.0 - exp(-intensity * 1.3);
  float hot = bright * bright * bright;
  vec3 tone = mix(u_accent * bright, vec3(bright), hot * hot * 0.85);
  // A grain under one step of colour, so the faint gradients do not band on a dark ground.
  tone = max(tone + (fract(52.9829189 * fract(dot(gl_FragCoord.xy + u_grain, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0, 0.0);
  // Inside the rim the glass is a dark body over the ground; outside, the light only adds.
  color = vec4(tone, max(0.86 * cover, max(tone.r, max(tone.g, tone.b))));
}`
