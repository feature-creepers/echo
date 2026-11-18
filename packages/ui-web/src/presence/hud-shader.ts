import { type Drawing, PRELUDE } from './glsl.ts'
import { HUD_MOTES, HUD_RINGS } from './life.ts'

/**
 * The instrument look: a holographic display. A small bright core is its one light source; round it, rings of
 * light at different radii turn at their own paces and in opposite directions: close round the core a broken
 * circle, a band of segments and a meter of bars that follows the voice; further out a bezel of fine ticks with
 * four markers riding it, and a data ring; and outermost a ring of small glyphs, long arcs and a still frame. Every line is one device pixel and the accent at partial
 * strength, so the rings layer like light; the core and a few segments are the brightest things in it.
 */

/** The instrument's radius, as a share of half the canvas. */
export const HUD_SIZE = 0.8

/**
 * Where each ring sits, as a share of the instrument's radius. The painter draws the same rings from these.
 */
export const HUD_RADII = {
  coreRim: 0.08,
  broken: 0.14,
  band: 0.2,
  meter: 0.255,
  bezel: 0.465,
  data: 0.54,
  glyphs: 0.635,
  arcs: 0.745,
  frame: 0.885
} as const

/** The long outer arcs, as where each starts and ends, in turns. */
export const HUD_ARCS = [
  [0.03, 0.3],
  [0.36, 0.41],
  [0.53, 0.8],
  [0.86, 0.91]
] as const

/**
 * How many bars the meter round the core has at a size, the instrument's radius in device pixels: up to sixty,
 * fewer on a small instrument, so each bar stays at least three and a half pixels from the next and the voice
 * reads as bars rather than as a blur. Always an even number, so the two sides match.
 */
export function meterBars(radius: number): number {
  return Math.min(60, Math.max(24, Math.floor((Math.PI * 2 * HUD_RADII.meter * radius) / 3.5 / 2) * 2))
}

const glsl = (value: number) => value.toFixed(4)
const R = HUD_RADII

const FRAGMENT = `${PRELUDE}
uniform float u_core;
uniform float u_size;
uniform float u_rings;
uniform float u_reach;
uniform float u_scan;
uniform float u_scanAt;
uniform float u_gauge;
uniform float u_wave;
uniform float u_dormant;
uniform float u_chase;
uniform float u_chaseAt;
// Where each mote is round its ring, in turns, and where the glint is along the outer arcs.
uniform float u_motes[${HUD_MOTES.length}];
uniform float u_glintAt;
// How far each ring has turned, in turns.
uniform float u_turns[${HUD_RINGS.length}];
uniform vec2 u_parallax;

const float HAIRLINES[5] = float[5](0.315, 0.345, 0.405, 0.59, 0.69);
// The rings the motes ride: the broken circle, the bezel's circle and the long arcs' circle.
const float MOTE_RINGS[3] = float[3](${glsl(R.broken)}, ${glsl(R.bezel)}, ${glsl(R.arcs)});
const vec2 ARCS[4] = vec2[4](${HUD_ARCS.map(([from, to]) => `vec2(${glsl(from)}, ${glsl(to)})`).join(', ')});

// How much of a pixel the ticks round a ring cover: a number of them, each a width in pixels, at a radius in
// pixels. Where they come closer than a few pixels apart they fade to their average, so a small ring stays clean.
float ticks(float around, float count, float width, float radiusPx) {
  float pitch = TAU * radiusPx / count;
  return mix(stroke(abs(fract(around * count) - 0.5) * pitch, width), width / pitch, smoothstep(4.0, 2.0, pitch));
}

// How much of a pixel lies between two radii, in the instrument's radii, its edges one pixel soft.
float between(float rr, float inner, float outer) {
  return clamp((rr - inner) * u_radius + 0.5, 0.0, 1.0) * clamp((outer - rr) * u_radius + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = face((gl_FragCoord.xy - u_center) / u_radius);
  // Where it looks, the core leans first and the rings after it by how near the core they are, the outermost
  // staying put: layers at different depths, so the instrument seems to turn towards what it looks at.
  p -= u_gaze * 0.06 * max(0.0, 1.0 - length(p) * 1.1);
  float r = length(p);
  vec2 toward = p / max(r, 1e-4);
  // Counter-clockwise from the right, in turns.
  float around = atan(p.y, p.x) / TAU;
  float lines = 0.0;
  float bright = 0.0;
  // A small instrument keeps only what reads at its size: the finest rings go first, then the lesser ones.
  float fine = smoothstep(40.0, 80.0, u_radius);
  float lesser = smoothstep(22.0, 44.0, u_radius);

  // The core: a tight white-hot heart, and round it the reactor, a crisp ring of light and a fainter one outside
  // it, breathing with it. Its glow is the bloom's: the heart itself stays small, so it reads as a light source
  // rather than a ball of light.
  float size = u_size;
  float core = u_core * (11.0 * exp(-r * r / (0.0006 * size * size)) + 0.8 / pow(1.0 + r * r / (0.0018 * size * size), 1.6)
    + 0.06 * exp(-r / (0.1 * size)));
  bright += stroke((r - ${glsl(R.coreRim)} * size) * u_radius, 1.6) * 1.1 * min(u_core, 1.2);
  bright += stroke((r - ${glsl(R.coreRim + 0.025)} * size) * u_radius, 1.0) * 0.35 * min(u_core, 1.2);
  // Between the heart and the reactor ring, a faint disc of the accent, as light held in a lens.
  lines += (1.0 - smoothstep(${glsl(R.coreRim - 0.01)} * size, ${glsl(R.coreRim)} * size, r)) * 0.16 * min(u_core, 1.2);

  // Each ring shifts a little with the view by its radius, as layers at different depths would; listening, they
  // all draw in round the core.
  float rr = r * (1.0 - dot(toward, u_parallax)) / u_reach;

  if (rr < ${glsl(R.band + 0.025)}) {
    // A broken circle round the core: three arcs.
    float v = fract(around - u_turns[0]);
    float cell = fract(v * 3.0);
    float arcs = clamp((min(cell, 1.0 - cell) / 3.0 - 0.018) * TAU * ${glsl(R.broken)} * u_radius + 0.5, 0.0, 1.0);
    lines += stroke((rr - ${glsl(R.broken)}) * u_radius, 1.0) * arcs * 0.62 * u_rings * lesser;

    // A band of segments, broken where a gap falls, a few of them brighter, with the least halo.
    v = fract(around - u_turns[1]);
    float index = floor(v * 16.0);
    float within = fract(v * 16.0) / 16.0;
    float gapAfter = step(0.45, hash(vec2(index, 3.0)));
    float gapBefore = step(0.45, hash(vec2(mod(index + 15.0, 16.0), 3.0)));
    float open = min(gapBefore > 0.5 ? within : 1.0, gapAfter > 0.5 ? 1.0 / 16.0 - within : 1.0) - 0.006;
    float segment = clamp(open * TAU * ${glsl(R.band)} * u_radius + 0.5, 0.0, 1.0);
    float band = stroke((rr - ${glsl(R.band)}) * u_radius, max(0.02 * u_radius, 2.0)) * segment;
    float lit = step(0.72, hash(vec2(index, 9.0)));
    lines += band * 0.62 * (1.0 - lit) * u_rings;
    bright += (band + exp(-abs(rr - ${glsl(R.band)}) * u_radius / 2.5) * 0.12 * segment) * lit * 1.25 * u_rings;
  } else if (rr < ${glsl(R.meter + 0.1)}) {
    // The meter: bars round the core. At rest they are short and faint. Listening, they light from the top down
    // both sides with the voice it hears; speaking, each follows its own voice as it was a moment ago, the newest
    // at the top, so the voice flows down round the core.
    float count = clamp(floor(TAU * ${glsl(R.meter)} * u_radius / 7.0) * 2.0, 24.0, 60.0);
    float v = fract(around - 0.25);
    float index = floor(v * count);
    float centre = (index + 0.5) / count;
    float fromTop = min(centre, 1.0 - centre) * 2.0;
    // Each bar also follows a note of the voice: the low notes at the top, the high ones at the bottom, so a
    // vowel opens the top and a hiss runs down the sides.
    vec2 note = spectrum(fromTop);
    float lit = clamp((u_gauge * 1.2 - fromTop) * 12.0, 0.0, 1.0);
    float said = (echo(fromTop * 0.9).x * 0.4 + note.x * 0.8) * u_wave;
    float reach = min(${glsl(R.meter)} + 0.02 + lit * 0.03 + note.y * 0.04 + said * 0.07, ${glsl(R.meter + 0.095)});
    float bar = ticks(v, count, 1.6, rr * u_radius) * between(rr, ${glsl(R.meter)}, reach);
    lines += bar * (0.3 * mix(0.35, 1.0, lesser) + said * 0.7) * u_rings;
    bright += bar * lit * 0.8 * u_rings;
  } else if (rr < ${glsl((R.bezel + R.data) / 2)}) {
    // A bezel of fine ticks hanging in from a circle, longer every sixth and every thirtieth, over a faint band;
    // four markers ride the circle, pointing in, at their own pace. Asleep, the circle is the one ring left,
    // breathing.
    float v = fract(around - u_turns[3]);
    float nearest = floor(v * 120.0 + 0.5);
    float major = 1.0 - step(0.5, mod(nearest, 30.0));
    float middle = 1.0 - step(0.5, mod(nearest, 6.0));
    float hang = mix(mix(0.012, 0.02, middle), 0.034, major);
    float tick = ticks(v + 0.5 / 120.0, 120.0, 1.0, rr * u_radius) * between(rr, ${glsl(R.bezel)} - hang, ${glsl(R.bezel)});
    lines += tick * mix(mix(0.38, 0.55, middle), 0.55, major) * u_rings * mix(0.5, 1.0, fine);
    bright += tick * major * 0.5 * u_rings;
    lines += between(rr, ${glsl(R.bezel - 0.034)}, ${glsl(R.bezel)}) * 0.05 * u_rings;
    float d = (rr - ${glsl(R.bezel)}) * u_radius - 0.5;
    lines += stroke(d, 1.0) * max(0.24 * u_rings, u_dormant * 0.5);
    float at = fract(around - u_turns[2]) * 4.0;
    float x = abs(fract(at) - 0.5) / 4.0 * TAU * ${glsl(R.bezel)} * u_radius;
    float y = -d / (0.03 * u_radius);
    bright += clamp(min((1.0 - y) * 0.017 * u_radius - x, min(-d, 0.03 * u_radius + d)) + 0.5, 0.0, 1.0) * 0.75 * u_rings * lesser;
  } else if (rr < ${glsl((R.data + R.glyphs) / 2)}) {
    // A data ring: a line broken by gaps, with a few blocks on it.
    float v = fract(around - u_turns[4]);
    float index = floor(v * 36.0);
    float within = fract(v * 36.0);
    float cell = TAU * ${glsl(R.data)} * u_radius / 36.0;
    float gap = hash(vec2(index, 17.0)) < 0.3 ? clamp((abs(within - 0.5) - 0.35) * cell + 0.5, 0.0, 1.0) : 1.0;
    float block = hash(vec2(index, 23.0)) > 0.84 ? clamp((0.2 - abs(within - 0.5)) * cell + 0.5, 0.0, 1.0) : 0.0;
    float d = (rr - ${glsl(R.data)}) * u_radius;
    lines += (stroke(d, 1.0) * gap * 0.45 + stroke(d, 3.0) * block * 0.6) * u_rings * lesser;
    // Working, a chase runs round it, counter-clockwise, its tail fading behind it, lighting the blocks it passes.
    float behind = fract(u_chaseAt - around);
    float trail = exp(-behind * 9.0) * u_chase;
    bright += (stroke(d, 1.5) * gap * 0.75 + stroke(d, 3.0) * block * 0.9) * trail * u_rings * lesser;
  } else if (rr < ${glsl((R.glyphs + R.arcs) / 2)}) {
    // A ring of small glyphs, one to a cell: tall and short ticks, dots and dashes. They come in groups with a gap
    // between groups, and some groups are missing, so the ring reads as a written line, not as noise.
    float v = fract(around - u_turns[5]);
    float pitch = TAU * rr * u_radius / 160.0;
    float index = floor(v * 160.0);
    float x = (fract(v * 160.0) - 0.5) * pitch;
    float height = 0.022 * u_radius;
    float y = (rr - ${glsl(R.glyphs)}) * u_radius;
    float kind = hash(vec2(index, 41.0));
    float glyph = 0.0;
    if (hash(vec2(floor(index / 8.0), 5.0)) > 0.3 && mod(index, 8.0) < 6.5 && abs(y) < height) {
      if (kind < 0.45) glyph = stroke(x, 1.0) * stroke(y, height * 2.0);
      else if (kind < 0.75) glyph = stroke(x, 1.0) * stroke(y - height * 0.5, height);
      else if (kind < 0.9) glyph = stroke(x, 1.5) * stroke(y, 1.5);
      else glyph = stroke(x, pitch * 0.7) * stroke(y + height * 0.6, 1.0);
    }
    glyph = mix(glyph, 0.1 * step(abs(y), height), smoothstep(4.5, 2.5, pitch));
    lines += glyph * 0.44 * u_rings * fine;
  } else if (rr < ${glsl((R.arcs + R.frame) / 2)}) {
    // Long outer arcs over a faint band, a short tick across each end; thinking, a scan sweeps along them, its
    // tail fading behind it.
    float v = fract(around - u_turns[6]);
    float d = (rr - ${glsl(R.arcs)}) * u_radius;
    float turnPx = ${glsl(R.arcs)} * u_radius * TAU;
    float arc = 0.0;
    float cap = 0.0;
    for (int index = 0; index < 4; index++) {
      vec2 span = ARCS[index];
      arc = max(arc, clamp(min(v - span.x, span.y - v) * turnPx + 0.5, 0.0, 1.0));
      cap = max(cap, stroke(min(abs(v - span.x), abs(v - span.y)) * turnPx, 1.0));
    }
    lines += (stroke(d, 1.5) * 0.55 + between(rr, ${glsl(R.arcs - 0.022)}, ${glsl(R.arcs + 0.022)}) * 0.06) * arc * u_rings;
    bright += cap * between(rr, ${glsl(R.arcs - 0.02)}, ${glsl(R.arcs + 0.02)}) * 0.5 * u_rings;
    // Now and then a glint runs along the arcs, as light along a wire.
    float glint = exp(-pow((v - u_glintAt) / 0.018, 2.0));
    bright += stroke(d, 1.5) * arc * glint * 1.1 * u_rings;
    float behind = fract(around - u_scanAt);
    bright += (stroke(d, 2.0) * exp(-behind * 7.0) * 0.9 + stroke(min(behind, 1.0 - behind) * turnPx, 2.0) * between(rr, ${glsl(R.arcs - 0.032)}, ${glsl(R.arcs + 0.032)})) * u_scan;
  } else {
    // The frame: a faint circle with eight short ticks out from it, still, the one thing that does not turn.
    float d = (rr - ${glsl(R.frame)}) * u_radius;
    lines += stroke(d, 1.0) * 0.14 * u_rings;
    float tick = ticks(around + 0.5 / 8.0, 8.0, 1.0, rr * u_radius) * between(rr, ${glsl(R.frame)}, ${glsl(R.frame + 0.025)});
    lines += tick * 0.32 * u_rings * lesser;
  }
  // Motes of light riding three rings, each with a short tail behind it, the way it came.
  for (int index = 0; index < 3; index++) {
    float ring = MOTE_RINGS[index];
    float across = (rr - ring) * u_radius;
    if (abs(across) < 4.0) {
      float way = index == 1 ? -1.0 : 1.0;
      float behind = fract((u_motes[index] - around) * way);
      float apart = min(behind, 1.0 - behind) * TAU * ring * u_radius;
      float body = exp(-across * across / 1.4);
      bright += body * (exp(-apart * apart / 2.2) * 1.6 + exp(-behind * TAU * ring * u_radius / 9.0) * step(behind, 0.5) * 0.55) * u_rings * lesser;
    }
  }

  // Fine hairline rings between the main ones, faint, as the scales of an instrument: they give it depth and
  // precision, and fade on a small instrument, where they would only blur.
  float hairlines = 0.0;
  for (int index = 0; index < 5; index++) {
    hairlines += stroke((rr - HAIRLINES[index]) * u_radius, 1.0);
  }
  lines += hairlines * 0.09 * u_rings * fine;

  // The scan lights the instrument faintly behind its head, as a sweep would.
  if (u_scan > 0.001 && rr > ${glsl(R.meter + 0.1)} && rr < ${glsl(R.arcs)}) {
    lines += exp(-fract(around - u_scanAt) * 12.0) * 0.07 * u_scan;
  }

  // The colour deepens with the distance from the heart: near it the accent is lifted towards white, far out it
  // sinks to a deeper, bluer shade of itself, so the rings read as layers of light at different depths.
  float farOut = smoothstep(0.18, 0.9, r);
  vec3 near = mix(u_accent, vec3(1.0), 0.22);
  vec3 deep = u_accent * vec3(0.7, 0.86, 1.0);
  vec3 hue = mix(near, deep, farOut);
  // A hologram's shimmer: its light rises and falls a little across it, slowly.
  float shimmer = 0.92 + 0.16 * noise(vec2(p.x * 2.2 + u_turns[6] * 3.0, p.y * 2.2 - u_turns[3] * 5.0), 64.0);
  vec3 light = burn(core, u_accent + 0.08) + hue * lines * shimmer + mix(hue, vec3(1.0), mix(0.45, 0.2, farOut)) * bright * shimmer;
  // A faint dark field behind the rings calms the ground's dots under them, so the finest lines read.
  finish(light, 0.55 * (1.0 - smoothstep(0.3, 0.98, r)) * max(u_rings, 0.3));
}`

const UNIFORMS = [
  'core',
  'size',
  'rings',
  'reach',
  'scan',
  'scanAt',
  'chase',
  'chaseAt',
  'gauge',
  'wave',
  'dormant',
  'turns',
  'parallax',
  'motes',
  'glintAt'
] as const

const turns = new Float32Array(HUD_RINGS.length)

export const HUD: Drawing<(typeof UNIFORMS)[number]> = {
  fragment: FRAGMENT,
  size: HUD_SIZE,
  reach: 0.96,
  // A hologram: every line glows, the bright ones most.
  bloom: 0.95,
  uniforms: UNIFORMS,
  set(gl, at, { hud }) {
    gl.uniform1f(at.core, hud.core)
    gl.uniform1f(at.size, hud.size)
    gl.uniform1f(at.rings, hud.rings)
    gl.uniform1f(at.reach, hud.reach)
    gl.uniform1f(at.scan, hud.scan)
    gl.uniform1f(at.scanAt, hud.scanAngle / (Math.PI * 2))
    gl.uniform1f(at.chase, hud.chase)
    gl.uniform1f(at.chaseAt, hud.chaseAt)
    gl.uniform1f(at.gauge, hud.gauge)
    gl.uniform1f(at.wave, hud.wave)
    gl.uniform1f(at.dormant, hud.dormant)
    for (let index = 0; index < turns.length; index++) turns[index] = (hud.turns[index] ?? 0) / (Math.PI * 2)
    gl.uniform1fv(at.turns, turns)
    gl.uniform2f(at.parallax, hud.parallax[0], hud.parallax[1])
    gl.uniform1fv(at.motes, hud.motes)
    gl.uniform1f(at.glintAt, hud.glintAt)
  }
}
