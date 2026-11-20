import { type Drawing, glsl, PRELUDE, turned } from './glsl.ts'
import { HUD_DECKS, HUD_RINGS } from './life.ts'

/**
 * The instrument look: a holographic display, in space, drawn as a precise instrument rather than a show. A small
 * bright core is its one light source; round it, rings of light at different radii turn slowly at their own paces
 * and in opposite directions: close round the core a broken circle, a band of segments and a meter of bars that
 * follows the voice; further out a bezel of fine ticks with four markers on it, and a data ring; and outermost long
 * arcs and a still frame. Every line is one device pixel and the accent at partial strength, so the rings layer like
 * light; the core and a few segments are the brightest things in it. Its light is steady: nothing races round it,
 * glints or flickers.
 *
 * Seen from the front it is flat, as a drawing of light. But its rings float on five decks, each at its own depth:
 * nearest, the core's own rings; then the meter; the bezel; the data ring; and furthest, the arcs and the frame.
 * Each pixel is a ray from a camera in front of the instrument, and each deck is drawn where the ray meets its plane,
 * so the decks part as the instrument turns towards what it looks at, foreshorten as they lean, and soften a little
 * where they leave the depth they rest at.
 */

/** The instrument's radius, as a share of half the canvas. */
const HUD_SIZE = 0.8

/** Where each ring sits, as a share of the instrument's radius. */
const HUD_RADII = {
  coreRim: 0.08,
  broken: 0.14,
  band: 0.2,
  meter: 0.255,
  bezel: 0.465,
  data: 0.54,
  /** A fine rule between the data ring and the arcs, as the scale of an instrument. */
  rule: 0.635,
  arcs: 0.745,
  frame: 0.885
} as const

/** The long outer arcs, as where each starts and ends, in turns. */
const HUD_ARCS = [
  [0.03, 0.3],
  [0.36, 0.41],
  [0.53, 0.8],
  [0.86, 0.91]
] as const

/**
 * How far out of focus a point is drawn, in pixels of blur for each radius it stands off the depth its deck rests
 * at, on an instrument one pixel in radius.
 */
const FOCUS = 0.02

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
// How far it has woken, from 0 to 1.
uniform float u_wake;
// How far each ring has turned, in turns.
uniform float u_turns[${HUD_RINGS.length}];
// Each deck's own turn in space.
uniform mat3 u_deck[${HUD_DECKS.length}];

const float DEPTHS[${HUD_DECKS.length}] = float[${HUD_DECKS.length}](${HUD_DECKS.map((deck) => glsl(deck.depth)).join(', ')});
const vec2 ARCS[4] = vec2[4](${HUD_ARCS.map(([from, to]) => `vec2(${glsl(from)}, ${glsl(to)})`).join(', ')});

// Where this pixel falls on the deck being drawn: how far from its middle, in the instrument's radii, and how far
// round, in turns counter-clockwise from the right; how many pixels a radius is there, across the rings and along
// them, which differ once the deck leans; how far out of focus it is there, in pixels; and how far the deck's
// rings are drawn in or out round the core.
float RHO;
float AROUND;
float ACROSS;
float ALONG;
float BLUR;
float SPREAD;
// A small instrument keeps only what reads at its size: the finest rings go first, then the lesser ones.
float FINE;
float LESSER;

// How much of a pixel a line covers, from its distance to the line's middle and its width, in pixels. Out of
// focus, it spreads wider and fainter, keeping its light.
float line(float apart, float width) {
  float spread = width + BLUR * 1.6;
  return clamp((spread * 0.5 + 0.5 - abs(apart)) / (1.0 + BLUR * 0.5), 0.0, 1.0) * width / spread;
}

// A ring of the deck: a circle at a radius, a width in pixels.
float ring(float radius, float width) {
  return line((RHO - radius) * ACROSS, width);
}

// How much of a pixel lies between two radii of the deck.
float between(float inner, float outer) {
  float soft = 1.0 + BLUR;
  return clamp((RHO - inner) * ACROSS / soft + 0.5, 0.0, 1.0) * clamp((outer - RHO) * ACROSS / soft + 0.5, 0.0, 1.0);
}

// How much of a pixel the ticks round a ring cover: a number of them, each a width in pixels. Where they come
// closer than a few pixels apart they fade to their average, so a small or a leaning ring stays clean.
float ticks(float around, float count, float width, float radius) {
  float pitch = TAU * radius * ALONG / count;
  return mix(line((fract(around * count) - 0.5) * pitch, width), width / pitch, smoothstep(4.0, 2.0, pitch));
}

// The core's own deck: the reactor, a crisp ring of light round the heart and a fainter one outside it, breathing
// with it; a broken circle of three arcs; and a band of segments, broken where a gap falls, a few of them brighter.
void reactor(inout float lines, inout float bright) {
  if (RHO > ${glsl(R.band + 0.04)}) return;
  // The reactor keeps its size while the rings draw in or out round it.
  float held = RHO * SPREAD;
  float lit = min(u_core, 1.2);
  bright += line((held - ${glsl(R.coreRim)} * u_size) * ACROSS / SPREAD, 1.6) * 1.1 * lit;
  bright += line((held - ${glsl(R.coreRim + 0.025)} * u_size) * ACROSS / SPREAD, 1.0) * 0.35 * lit;
  // Between the heart and the reactor ring, a faint disc of the accent, as light held in a lens.
  lines += (1.0 - smoothstep(${glsl(R.coreRim - 0.01)} * u_size, ${glsl(R.coreRim)} * u_size, held)) * 0.16 * lit;

  float v = fract(AROUND - u_turns[0]);
  float cell = fract(v * 3.0);
  lines += ring(${glsl(R.broken)}, 1.0) * clamp((min(cell, 1.0 - cell) / 3.0 - 0.018) * TAU * ${glsl(R.broken)} * ALONG + 0.5, 0.0, 1.0) * 0.62 * u_rings * LESSER;

  v = fract(AROUND - u_turns[1]);
  float index = floor(v * 16.0);
  float within = fract(v * 16.0) / 16.0;
  float gapAfter = step(0.45, hash(vec2(index, 3.0)));
  float gapBefore = step(0.45, hash(vec2(mod(index + 15.0, 16.0), 3.0)));
  float open = min(gapBefore > 0.5 ? within : 1.0, gapAfter > 0.5 ? 1.0 / 16.0 - within : 1.0) - 0.006;
  float segment = clamp(open * TAU * ${glsl(R.band)} * ALONG + 0.5, 0.0, 1.0);
  float band = ring(${glsl(R.band)}, max(0.02 * ACROSS, 2.0)) * segment;
  float charged = step(0.72, hash(vec2(index, 9.0)));
  lines += band * 0.62 * (1.0 - charged) * u_rings;
  bright += (band + exp(-abs(RHO - ${glsl(R.band)}) * ACROSS / 2.5) * 0.12 * segment) * charged * 1.25 * u_rings;
}

// The voice: a meter of bars round the reactor. At rest they are short and faint. Listening, they light from the
// top down both sides with the voice it hears; speaking, each follows a note of its own voice, the low notes at the
// top and the high ones down the sides, and its voice as it was a moment ago.
void voice(inout float lines, inout float bright) {
  if (RHO < ${glsl(R.meter - 0.03)} || RHO > ${glsl(R.meter + 0.11)}) return;
  float count = clamp(floor(TAU * ${glsl(R.meter)} * u_radius / 7.0) * 2.0, 24.0, 60.0);
  float v = fract(AROUND - 0.25);
  float index = floor(v * count);
  float centre = (index + 0.5) / count;
  float fromTop = min(centre, 1.0 - centre) * 2.0;
  vec2 note = spectrum(fromTop);
  float lit = clamp((u_gauge * 1.2 - fromTop) * 12.0, 0.0, 1.0);
  float said = (echo(fromTop * 0.9).x * 0.4 + note.x * 0.8) * u_wave;
  float reach = min(${glsl(R.meter)} + 0.02 + lit * 0.03 + note.y * 0.04 + said * 0.07, ${glsl(R.meter + 0.095)});
  float bar = ticks(v, count, 1.6, RHO) * between(${glsl(R.meter)}, reach);
  lines += bar * (0.3 * mix(0.35, 1.0, LESSER) + said * 0.7) * u_rings;
  bright += bar * lit * 0.8 * u_rings;
}

// The scale: a bezel of fine ticks hanging in from a circle, longer every sixth and every thirtieth, over a faint
// band; four markers sit on the circle, pointing in. Asleep, the circle is the one ring left, breathing.
void scale(inout float lines, inout float bright) {
  if (RHO < 0.3 || RHO > ${glsl((R.bezel + R.data) / 2)}) return;
  float v = fract(AROUND - u_turns[3]);
  float nearest = floor(v * 120.0 + 0.5);
  float major = 1.0 - step(0.5, mod(nearest, 30.0));
  float middle = 1.0 - step(0.5, mod(nearest, 6.0));
  float hang = mix(mix(0.012, 0.02, middle), 0.034, major);
  float tick = ticks(v + 0.5 / 120.0, 120.0, 1.0, RHO) * between(${glsl(R.bezel)} - hang, ${glsl(R.bezel)});
  lines += tick * mix(mix(0.38, 0.55, middle), 0.55, major) * u_rings * mix(0.5, 1.0, FINE);
  bright += tick * major * 0.5 * u_rings;
  lines += between(${glsl(R.bezel - 0.034)}, ${glsl(R.bezel)}) * 0.05 * u_rings;
  lines += ring(${glsl(R.bezel)}, 1.0) * max(0.24 * u_rings, u_dormant * 0.5);
  // The markers, each a small triangle from the circle inwards.
  float beyond = (RHO - ${glsl(R.bezel)}) * ACROSS;
  float tall = 0.03 * ACROSS;
  float beside = abs(fract(fract(AROUND - u_turns[2]) * 4.0) - 0.5) / 4.0 * TAU * ${glsl(R.bezel)} * ALONG;
  bright += clamp(min((1.0 + beyond / tall) * 0.017 * ALONG - beside, min(-beyond, tall + beyond)) + 0.5, 0.0, 1.0) * 0.6 * u_rings * LESSER;
  // Fine hairline rings between the main ones, faint, as the scales of an instrument.
  lines += (ring(0.315, 1.0) + ring(0.405, 1.0)) * 0.08 * u_rings * FINE;
}

// The data: a line broken by gaps, with a few blocks on it, round which a slow chase runs while it works; and outside
// it a fine rule, as the scale of an instrument.
void data(inout float lines, inout float bright) {
  if (RHO < ${glsl((R.bezel + R.data) / 2)} || RHO > ${glsl((R.rule + R.arcs) / 2)}) return;
  float v = fract(AROUND - u_turns[4]);
  float index = floor(v * 36.0);
  float within = fract(v * 36.0);
  float cell = TAU * ${glsl(R.data)} * ALONG / 36.0;
  float gap = hash(vec2(index, 17.0)) < 0.3 ? clamp((abs(within - 0.5) - 0.35) * cell + 0.5, 0.0, 1.0) : 1.0;
  float block = hash(vec2(index, 23.0)) > 0.84 ? clamp((0.2 - abs(within - 0.5)) * cell + 0.5, 0.0, 1.0) : 0.0;
  float thick = ring(${glsl(R.data)}, 3.0);
  lines += (ring(${glsl(R.data)}, 1.0) * gap * 0.45 + thick * block * 0.6) * u_rings * LESSER;
  // Working, a chase goes slowly round it, counter-clockwise, its tail fading behind it, lighting the blocks it
  // passes.
  float trail = exp(-fract(u_chaseAt - AROUND) * 7.0) * u_chase;
  bright += (ring(${glsl(R.data)}, 1.5) * gap * 0.45 + thick * block * 0.55) * trail * u_rings * LESSER;
  lines += ring(${glsl(R.rule)}, 1.0) * 0.08 * u_rings * FINE;
}

// The frame: long arcs over a faint band, a short tick across each end, along which a soft scan goes slowly round
// while it thinks; and a faint circle with eight short ticks out from it.
void frame(inout float lines, inout float bright) {
  if (RHO < ${glsl((R.rule + R.arcs) / 2)}) return;
  float v = fract(AROUND - u_turns[5]);
  float turnPx = ${glsl(R.arcs)} * ALONG * TAU;
  float arc = 0.0;
  float cap = 0.0;
  for (int index = 0; index < 4; index++) {
    vec2 span = ARCS[index];
    arc = max(arc, clamp(min(v - span.x, span.y - v) * turnPx + 0.5, 0.0, 1.0));
    cap = max(cap, stroke(min(abs(v - span.x), abs(v - span.y)) * turnPx, 1.0));
  }
  float wire = ring(${glsl(R.arcs)}, 1.5);
  lines += (wire * 0.55 + between(${glsl(R.arcs - 0.022)}, ${glsl(R.arcs + 0.022)}) * 0.06) * arc * u_rings;
  bright += cap * between(${glsl(R.arcs - 0.02)}, ${glsl(R.arcs + 0.02)}) * 0.4 * u_rings;
  // Thinking, the arcs light softly behind the scan's head as it goes round: no bright tip, only the light passing.
  bright += wire * arc * exp(-fract(AROUND - u_scanAt) * 5.0) * 0.4 * u_scan;
  lines += ring(${glsl(R.frame)}, 1.0) * 0.14 * u_rings;
  lines += ticks(AROUND + 0.5 / 8.0, 8.0, 1.0, RHO) * between(${glsl(R.frame)}, ${glsl(R.frame + 0.025)}) * 0.32 * u_rings * LESSER;
}

void main() {
  vec2 s = (gl_FragCoord.xy - u_center) / u_radius;
  float px = 1.0 / u_radius;
  FINE = smoothstep(40.0, 80.0, u_radius);
  LESSER = smoothstep(22.0, 44.0, u_radius);
  // The instrument, turned to where it looks: the camera and this pixel's ray, as seen from it, and the rays of
  // the pixels beside and above, which say how far a pixel reaches on each deck.
  mat3 whole = turned(u_tilt);
  vec3 eye = vec3(0.0, 0.0, CAMERA) * whole;
  vec3 ray = vec3(s, -CAMERA) * whole;
  vec3 rayX = vec3(s + vec2(px, 0.0), -CAMERA) * whole;
  vec3 rayY = vec3(s + vec2(0.0, px), -CAMERA) * whole;
  // The colour deepens with the distance from the heart: near it the accent is lifted towards white, far out it
  // sinks to a deeper, bluer shade of itself, so the rings read as layers of light.
  vec3 nearHue = mix(u_accent, vec3(1.0), 0.22);
  vec3 deepHue = u_accent * vec3(0.7, 0.86, 1.0);
  vec3 light = vec3(0.0);

  for (int k = 0; k < ${HUD_DECKS.length}; k++) {
    mat3 deck = u_deck[k];
    vec3 from = (eye - vec3(0.0, 0.0, DEPTHS[k])) * deck;
    vec3 d0 = ray * deck;
    vec3 dx = rayX * deck;
    vec3 dy = rayY * deck;
    if (abs(d0.z) < 1e-4 || abs(dx.z) < 1e-4 || abs(dy.z) < 1e-4) continue;
    float t = -from.z / d0.z;
    if (t <= 0.0) continue;
    // Listening, the rings draw in round the heart.
    SPREAD = u_reach;
    vec2 at = (from.xy + d0.xy * t) / SPREAD;
    RHO = length(at);
    if (RHO > 1.0) continue;
    vec2 beside = (from.xy - dx.xy * (from.z / dx.z)) / SPREAD - at;
    vec2 above = (from.xy - dy.xy * (from.z / dy.z)) / SPREAD - at;
    vec2 outward = at / max(RHO, 1e-5);
    vec2 sideways = vec2(-outward.y, outward.x);
    ACROSS = 1.0 / max(length(vec2(dot(beside, outward), dot(above, outward))), 1e-6);
    ALONG = 1.0 / max(length(vec2(dot(beside, sideways), dot(above, sideways))), 1e-6);
    AROUND = atan(at.y, at.x) / TAU;
    // How much nearer the camera this point of the deck stands than where the deck rests, in radii: what leaves
    // that depth softens, and what comes forward brightens.
    float forward = CAMERA * (1.0 - t) - DEPTHS[k];
    BLUR = abs(forward) * ${glsl(FOCUS)} * u_radius;

    float lines = 0.0;
    float bright = 0.0;
    if (k == 0) reactor(lines, bright);
    else if (k == 1) voice(lines, bright);
    else if (k == 2) scale(lines, bright);
    else if (k == 3) data(lines, bright);
    else frame(lines, bright);

    // Waking, the rings draw themselves on from the inside out, each from the top round to the right, a little
    // brighter where it is being drawn.
    if (u_wake < 1.0) {
      float drawn = clamp((u_wake - 0.14 - RHO * 0.5) / 0.32, 0.0, 1.0);
      float along = fract(0.25 - AROUND);
      float shown = clamp((drawn - along) * 60.0 + 0.5, 0.0, 1.0);
      float head = exp(-pow((along - drawn) / 0.02, 2.0)) * step(0.002, drawn) * (1.0 - drawn * drawn);
      bright = bright * shown + (lines + bright) * head * 0.8;
      lines *= shown;
    }
    float farOut = smoothstep(0.18, 0.9, RHO * SPREAD);
    vec3 hue = mix(nearHue, deepHue, farOut);
    light += (hue * lines + mix(hue, vec3(1.0), mix(0.45, 0.2, farOut)) * bright) * (1.0 + clamp(forward * 1.5, -0.4, 0.35));
  }

  // The heart: a tight white-hot point where the core's deck meets the instrument's axis. Its glow is the bloom's:
  // the heart itself stays small, so it reads as a source of light rather than a ball of it.
  vec3 heart = whole * vec3(0.0, 0.0, DEPTHS[0]);
  float r = length(s - heart.xy * CAMERA / (CAMERA - heart.z));
  float core = u_core * (11.0 * exp(-r * r / (0.0006 * u_size * u_size)) + 0.8 / pow(1.0 + r * r / (0.0018 * u_size * u_size), 1.6)
    + 0.06 * exp(-r / (0.1 * u_size)));

  // A faint dark field behind the rings calms the ground's dots under them, so the finest lines read.
  float body = 0.55 * (1.0 - smoothstep(0.3, 0.98, length(s))) * max(u_rings, 0.3);
  // Waking, the heart's light rises steadily, without a flash, as the rings are drawn on round it.
  if (u_wake < 1.0) {
    core *= smoothstep(0.0, 0.2, u_wake);
    body *= smoothstep(0.0, 0.3, u_wake);
  }
  finish(light + burn(core, u_accent + 0.08), body);
}`

const UNIFORMS = ['core', 'size', 'rings', 'reach', 'scan', 'scanAt', 'chase', 'chaseAt', 'gauge', 'wave', 'dormant', 'turns', 'wake', 'deck'] as const

const turns = new Float32Array(HUD_RINGS.length)
const decks = new Float32Array(HUD_DECKS.length * 9)

/** How far the instrument turns towards what it looks at, in radians, at the edge of its gaze: a nod, not a lean. */
const TURN = 0.16

export const HUD: Drawing<(typeof UNIFORMS)[number]> = {
  fragment: FRAGMENT,
  size: HUD_SIZE,
  // What comes forward as a deck leans grows, so it is shaded a little beyond its own radius.
  reach: 1.1,
  // A hologram: its bright lines glow, softly, so the drawing stays crisp.
  bloom: 0.7,
  uniforms: UNIFORMS,
  // Towards what it looks at, and a little with the drift of the view.
  turn: ({ gaze, hud }) => [gaze[0] * TURN + hud.parallax[0] * 5, gaze[1] * TURN + hud.parallax[1] * 5],
  set(gl, at, { hud, wake }) {
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
    gl.uniform1f(at.wake, wake.hud)
    for (let index = 0; index < HUD_DECKS.length; index++) turned(hud.decks[index * 2] ?? 0, hud.decks[index * 2 + 1] ?? 0, decks, index * 9)
    gl.uniformMatrix3fv(at.deck, false, decks)
  }
}
