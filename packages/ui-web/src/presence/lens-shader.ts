import { type Drawing, PRELUDE } from './glsl.ts'

/**
 * The lens look: a camera's eye, after the one in 2001: A Space Odyssey. From the outside in, a barrel of dark
 * gunmetal in fine steps, lit only as thin cool crescents; a dome of black glass with the lens elements inside it, each edge catching a sliver of light, and a window
 * reflected on its upper left; and deep inside, the lamp as the film shows it: a disc of amber yellow with a soft
 * edge, held in a saturated red that deepens quickly to maroon and then to black, all of it inside the glass. It is
 * a light seen within a dark volume, never a lamp lit in the room: nothing of it reaches past the glass. Only the
 * lamp is coloured: the metal and the glass reflect a neutral room.
 */

/** The lens's radius, as a share of half the canvas: the rest is room for its shadow. */
export const LENS_SIZE = 0.74

/**
 * How far the glass reaches, as a share of the lens's radius: all the way. The eye has no housing, no ring of metal
 * round it, which would read as a lamp in a fitting or a camera's aperture: it is a dome of black glass set flush
 * in the dark, its edge drawn only by the light it catches.
 */
export const GLASS = 1

/**
 * The lens elements inside the glass, from the outside in: their edge's radius as a share of the glass, how deep
 * they sit (the deeper, the further they shift as the view drifts and the lens looks about), where their edge
 * catches the window's light, in radians, and how fast that turns against the elements' clock, the neighbours
 * turning opposite ways.
 */
export const ELEMENTS = [
  { radius: 0.8, depth: 0.2, catches: 2.3, turn: 1 },
  { radius: 0.635, depth: 0.45, catches: 2.95, turn: -1.4 },
  { radius: 0.48, depth: 0.7, catches: 1.65, turn: 0.8 },
  { radius: 0.335, depth: 0.9, catches: 3.7, turn: -1.1 }
] as const

/**
 * The panels of cool light high in the room that the dome reflects along its upper rim: where round the glass they
 * sit, in radians counter-clockwise from the right, how far out, as a share of the glass, their half-width round it,
 * in radians, and how bright. The largest is on the upper left, where the room's light comes from.
 */
export const PANELS = [
  [2.3, 0.8, 0.34, 0.5],
  [1.66, 0.87, 0.22, 0.4],
  [1.08, 0.85, 0.2, 0.34],
  [0.5, 0.8, 0.15, 0.18]
] as const

/**
 * The catchlights over the lamp, the film's signature: where round the lamp, in radians, how far out, as a share of
 * ten of the disc's radii so they keep their place as the disc grows, their half-width round it, and how bright.
 * Two rows, the nearer three brighter.
 */
export const CATCHES = [
  [1.08, 0.2, 0.2, 0.7],
  [1.57, 0.205, 0.26, 0.85],
  [2.06, 0.2, 0.2, 0.7],
  [0.72, 0.262, 0.16, 0.42],
  [1.25, 0.272, 0.2, 0.6],
  [1.89, 0.272, 0.2, 0.6],
  [2.42, 0.262, 0.16, 0.42]
] as const

const glsl = (value: number) => value.toFixed(4)

const FRAGMENT = `${PRELUDE}
uniform float u_lamp;
uniform float u_heart;
uniform float u_iris;
uniform float u_catch;
uniform float u_room;
uniform float u_shimmer;
uniform float u_shimmerAt;
uniform float u_focus;
uniform float u_beat;
uniform float u_beatAt;
// Which way the room's light falls across the ring, and where each element's edge catches it.
uniform vec2 u_sheen;
uniform vec2 u_slivers[4];
uniform vec2 u_depth;
// How much of the voice each element catches, from the outer to the inner.
uniform vec4 u_voice;

const float GLASS = ${glsl(GLASS)};
// The panels of light high in the room, as the dome reflects them: where round it, in radians, how far out, how
// wide, and how bright.
const vec4 PANELS[4] = vec4[4](${PANELS.map(([at, out, wide, bright]) => `vec4(${glsl(at)}, ${glsl(out)}, ${glsl(wide)}, ${glsl(bright)})`).join(', ')});
// The catchlights over the lamp: where round it, in radians, how far out as a share of ten of the disc's radii, how
// wide, and how bright.
const vec4 CATCHES[7] = vec4[7](${CATCHES.map(([at, out, wide, bright]) => `vec4(${glsl(at)}, ${glsl(out)}, ${glsl(wide)}, ${glsl(bright)})`).join(', ')});
const vec2 ELEMENTS[4] = vec2[4](${ELEMENTS.map((element) => `vec2(${glsl(element.radius)}, ${glsl(element.depth)})`).join(', ')});

void main() {
  vec2 p = face((gl_FragCoord.xy - u_center) / u_radius);
  float r = length(p);
  vec2 toward = p / max(r, 1e-4);
  // The lamp's red: the accent, deepened until only its own colour is left.
  vec3 hue = pow(u_accent, vec3(3.2));
  hue /= max(hue.r, max(hue.g, hue.b));
  float cover = clamp((1.0 - r) * u_radius + 0.5, 0.0, 1.0);
  vec3 light = vec3(0.0);

  // Beyond the glass, only a soft shadow on the ground, falling a little below it.
  float shadow = 0.5 * (1.0 - smoothstep(0.96, 1.1, length(p + vec2(0.0, 0.03))));

  float inside = clamp((GLASS - r) * u_radius + 0.5, 0.0, 1.0);
  if (inside > 0.0) {
    vec2 g = p / GLASS;
    float gr = r / GLASS;
    float pixel = 1.0 / (u_radius * GLASS);
    vec3 glass = vec3(0.003, 0.004, 0.006);

    // The dome is a cap of a sphere: it reflects more as it turns away towards the housing. What it reflects: a dim
    // room, and high in it a few soft panels of cool light, which the curve of the glass draws out along its upper
    // rim, as the film's lens shows them. As the lens turns to look, the room slides the other way across it.
    float dome = sqrt(max(1.0 - gr * gr * 0.64, 0.0));
    float reflects = 0.25 + 3.0 * (1.0 - dome) * (1.0 - dome);
    vec2 seen = g - u_gaze * 0.05 + u_depth * 0.2;
    float seenAt = length(seen);
    float seenAround = atan(seen.y, seen.x);
    vec3 panels = vec3(0.0);
    for (int index = 0; index < 4; index++) {
      vec4 panel = PANELS[index];
      float across = abs(mod(seenAround - panel.x + TAU * 0.5, TAU) - TAU * 0.5) / panel.z;
      float outward = (seenAt - panel.y) / 0.065;
      float shape = exp(-pow(across, 3.0) - pow(abs(outward), 3.0));
      // Whiter at its heart, cooler at its edges, and brighter towards the rim, where the curve squeezes it.
      float grade = clamp(0.78 + 0.22 * outward, 0.55, 1.0);
      panels += mix(vec3(0.38, 0.64, 1.0), vec3(0.86, 0.94, 1.0), shape * shape) * shape * grade * panel.w;
    }
    float room = 0.005 + 0.022 * smoothstep(-0.3, 0.95, seen.y);
    glass += (vec3(0.5, 0.72, 0.98) * room * reflects + panels * (0.6 + 0.4 * reflects)) * u_room;
    // The rim: a fresnel line of cool light along the top of the dome, fading down its sides, and a broader,
    // fainter light just inside it. It is the only edge the eye has, and it is never a ring.
    float top = smoothstep(-0.15, 0.85, g.y / max(gr, 1e-3));
    glass += vec3(0.62, 0.8, 1.0) * (stroke((1.0 - gr) / pixel - 1.2, 1.3) * 0.22 + pow(gr, 18.0) * 0.06) * top * u_room;

    // The lamp, deep inside, as the film shows it. Round the disc, a saturated red that falls quickly; under it, a
    // maroon haze that fills the glass and goes to black towards the ring. Its own voice travels out through the
    // red, and while it works, a beat does.
    vec2 lampAt = g - u_depth;
    float d = length(lampAt);
    float voiced = echo(d * 0.8).x * (1.0 - smoothstep(0.1, 0.8, d));
    float beat = u_beat * exp(-pow((d - u_heart - u_beatAt * 0.55) / 0.045, 2.0)) * (1.0 - smoothstep(0.3, 1.1, u_beatAt));
    float near = exp(-pow(max(d - u_heart, 0.0) / (0.14 * u_iris), 1.15));
    float haze = exp(-d / (0.5 * u_iris));
    float glow = u_lamp * (1.75 * near + 0.95 * haze + 0.5 * beat) * (1.0 + voiced * 0.35);
    glow *= 1.0 - 0.9 * smoothstep(0.55, 0.98, gr);
    vec3 red = burn(glow, hue + vec3(0.0, 0.02, 0.012));
    // The disc: amber at its edge, yellow at its middle, its edge soft over a few pixels, with a faint highlight
    // a little above the middle, as the film's has.
    float disc = 1.0 - smoothstep(u_heart - 0.01 - pixel, u_heart + 0.008 + pixel, d);
    float middle = exp(-d * d / (u_heart * u_heart * 0.35));
    vec3 amber = burn(u_lamp * (2.6 + 2.4 * middle) * (1.0 + voiced * 0.25), hue + vec3(0.0, 0.3, 0.03));
    vec2 shine = (lampAt - vec2(-0.15, 0.2) * u_heart) / u_heart;
    amber += vec3(1.0, 0.8, 0.85) * exp(-dot(shine, shine) * 9.0) * 0.14 * u_room;
    glass += mix(red, amber, disc);

    // The film's catchlights: the room's light caught by the inner elements, two rows of small curved highlights
    // over the light, the nearer row the brighter. They sit deep in the glass with the lamp, and catch more of the
    // room's light while it listens.
    float caughtAt = length(lampAt);
    float caughtAround = atan(lampAt.y, lampAt.x);
    float catches = 0.0;
    for (int index = 0; index < 7; index++) {
      vec4 spot = CATCHES[index];
      float row = spot.y * u_heart * 10.0;
      float off = abs(mod(caughtAround - spot.x + TAU * 0.5, TAU) - TAU * 0.5);
      // A capsule along the arc: its length round it, its width across, its ends rounded.
      vec2 from = vec2(max(off - spot.z * 0.7, 0.0) * row, caughtAt - row);
      float thick = 0.016 + pixel * 0.8;
      float middle = 1.0 - 0.35 * pow(min(off / spot.z, 1.0), 2.0);
      catches += spot.w * middle * exp(-dot(from, from) / (thick * thick));
    }
    glass += vec3(0.66, 0.86, 1.0) * catches * u_room * min(u_catch, 1.6) * 0.95;

    // The lens elements: each edge a faint full circle, drawn in or out a hair as the lens hunts for focus,
    // catching the window as a sliver whose colours part a little, and the lamp's red on its far side. Each
    // catches its share of the voice. Thinking, a shimmer runs through them from the outside in.
    for (int index = 0; index < 4; index++) {
      vec2 element = ELEMENTS[index];
      vec2 q = g - u_depth * element.y;
      float qr = length(q);
      float at = element.x * u_focus;
      if (abs(qr - at) < 0.035 + pixel * 4.0) {
        float off = (qr - at) / pixel;
        float turned = dot(q / max(qr, 1e-4), u_slivers[index]);
        float shimmer = u_shimmer * exp(-pow((float(index) / 3.0 - u_shimmerAt) * 3.5, 2.0));
        float width = 1.1 + shimmer * 1.2;
        float split = element.x * 0.012 / pixel;
        vec3 edge = vec3(stroke(off - split, width), stroke(off, width), stroke(off + split, width));
        float sliver = pow(max(turned, 0.0), 16.0 - shimmer * 8.0);
        glass += edge * vec3(0.82, 0.9, 1.0) * (0.01 + sliver * (0.28 + 0.6 * shimmer)) * u_catch * u_room;
        float caught = pow(max(-turned, 0.0), 2.0) * 0.6 + 0.02 + u_voice[index] * 0.8;
        glass += burn(u_lamp * 0.9, hue) * stroke(off, width + 1.0) * caught * 0.22 * u_catch;
      }
    }
    // Thick glass seen at an angle: towards its edge, what is inside sinks into the dark.
    light += glass * inside;
  }

  finish(light, max(cover, shadow));
}`

const UNIFORMS = ['lamp', 'heart', 'iris', 'catch', 'room', 'shimmer', 'shimmerAt', 'focus', 'beat', 'beatAt', 'sheen', 'slivers', 'depth', 'voice'] as const

const slivers = new Float32Array(ELEMENTS.length * 2)

export const LENS: Drawing<(typeof UNIFORMS)[number]> = {
  fragment: FRAGMENT,
  size: LENS_SIZE,
  reach: 1.12,
  // A lens: its light halates a little in the glass, as on film.
  bloom: 0.32,
  uniforms: UNIFORMS,
  set(gl, at, { lens }) {
    gl.uniform1f(at.lamp, lens.lamp)
    gl.uniform1f(at.heart, lens.heart)
    gl.uniform1f(at.iris, lens.iris)
    gl.uniform1f(at.catch, lens.catch)
    gl.uniform1f(at.room, lens.room)
    gl.uniform1f(at.shimmer, lens.shimmer)
    gl.uniform1f(at.shimmerAt, lens.shimmerAt)
    gl.uniform1f(at.focus, lens.focus)
    gl.uniform1f(at.beat, lens.beat)
    gl.uniform1f(at.beatAt, lens.beatAt)
    gl.uniform2f(at.sheen, Math.cos(lens.sheen), Math.sin(lens.sheen))
    ELEMENTS.forEach((element, index) => {
      slivers[index * 2] = Math.cos(element.catches + lens.turn * element.turn)
      slivers[index * 2 + 1] = Math.sin(element.catches + lens.turn * element.turn)
    })
    gl.uniform2fv(at.slivers, slivers)
    gl.uniform2f(at.depth, lens.depth[0], lens.depth[1])
    gl.uniform4f(at.voice, lens.voice[0], lens.voice[1], lens.voice[2], lens.voice[3])
  }
}
