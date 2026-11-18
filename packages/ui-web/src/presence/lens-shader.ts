import { type Drawing, PRELUDE } from './glsl.ts'

/**
 * The lens look: the eye of 2001: A Space Odyssey as the film shows it close, a deep lens of smoky black glass in a
 * thin rounded seat of dark blue-grey metal. The seat is soft and dark, shaded by the room's light: a hard or light
 * grey ring would read as a lamp in its fitting, and steps or grooves as a camera's aperture.
 *
 * From the front to the back: the dome reflects a dim room, a few soft panels of cool light along its upper rim and a
 * fresnel line on its edge. Behind it, the optical stack: six lens elements at different depths, each a fine edge of
 * light catching the room's light as a thin crescent of its coating's colour, green, magenta, amber or blue, as the
 * elements of a real lens do; the deeper an element, the further it shifts as the lens looks about, so the stack reads
 * as depth. Deepest of all, the lamp as the film shows it: a disc of amber yellow in a saturated red that deepens to
 * maroon and to black, the faint ghost rings its light leaves on the glass, a small ghost of the disc opposite the
 * room's light, and over the disc the film's catchlights, two rows of small curved highlights. Only the lamp is warm;
 * everything else reflects a cool room.
 */

/** The lens's radius, as a share of half the canvas: the rest is room for its shadow. */
export const LENS_SIZE = 0.74

/**
 * How far the glass reaches, as a share of the lens's radius. Round it sits the seat, a thin rounded lip of dark
 * blue-grey metal, as round the film's eye: soft, never a hard or light grey ring.
 */
export const SEAT = 0.92

/** The glass's radius, as the painter draws it, as a share of the lens's radius. */
export const GLASS = SEAT

/**
 * The optical stack, from the front element to the back: each edge's radius as a share of the glass, how deep it
 * sits (the deeper, the further it shifts as the view drifts and the lens looks about), the colour of its coating
 * (an index into the shader's coats), where its edge catches the room's light, in radians, how fast that turns
 * against the elements' clock, the neighbours turning opposite ways, and how much of the light it catches. A
 * convex surface shows the room's light on the side it comes from, a concave one on the other: the stack alternates.
 */
export const ELEMENTS = [
  { radius: 0.9, depth: 0.08, coat: 1, catches: 2.3, turn: 0.6, strength: 0.8 },
  { radius: 0.76, depth: 0.22, coat: 0, catches: 5.45, turn: -0.9, strength: 1 },
  { radius: 0.63, depth: 0.38, coat: 2, catches: 2.0, turn: 1.1, strength: 0.85 },
  { radius: 0.5, depth: 0.55, coat: 3, catches: 5.75, turn: -1.3, strength: 0.9 },
  { radius: 0.38, depth: 0.72, coat: 0, catches: 2.65, turn: 0.8, strength: 0.75 },
  { radius: 0.27, depth: 0.88, coat: 1, catches: 5.1, turn: -1.1, strength: 0.65 }
] as const

/**
 * The panels of cool light high in the room that the dome reflects along its upper rim: where round the glass they
 * sit, in radians counter-clockwise from the right, how far out, as a share of the glass, their half-width round it,
 * in radians, and how bright. The largest is on the upper left, where the room's light comes from.
 */
export const PANELS = [
  [2.3, 0.82, 0.3, 0.34],
  [1.66, 0.88, 0.2, 0.26],
  [1.08, 0.86, 0.18, 0.22],
  [0.52, 0.81, 0.13, 0.12]
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

/** The coatings' colours, as the room's light comes back off them, from 0 to 1: green, magenta, amber and blue. */
export const COATS = [
  [0.34, 0.95, 0.66],
  [0.88, 0.4, 1],
  [1, 0.72, 0.36],
  [0.44, 0.68, 1]
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
// Which way the room's light comes from, and where each element's edge catches it.
uniform vec2 u_sheen;
uniform vec2 u_slivers[6];
uniform vec2 u_depth;
// How much of the voice the elements catch, from the outer ones to the inner.
uniform vec4 u_voice;

const float SEAT = ${glsl(SEAT)};
const vec4 PANELS[4] = vec4[4](${PANELS.map(([at, out, wide, bright]) => `vec4(${glsl(at)}, ${glsl(out)}, ${glsl(wide)}, ${glsl(bright)})`).join(', ')});
const vec4 CATCHES[7] = vec4[7](${CATCHES.map(([at, out, wide, bright]) => `vec4(${glsl(at)}, ${glsl(out)}, ${glsl(wide)}, ${glsl(bright)})`).join(', ')});
// Each element: its radius, its depth, its coat, and how much light it catches.
const vec4 ELEMENTS[6] = vec4[6](${ELEMENTS.map((element) => `vec4(${glsl(element.radius)}, ${glsl(element.depth)}, ${glsl(element.coat)}, ${glsl(element.strength)})`).join(', ')});
// The coatings' colours, as the room's light comes back off them.
const vec3 COATS[4] = vec3[4](${COATS.map(([red, green, blue]) => `vec3(${glsl(red)}, ${glsl(green)}, ${glsl(blue)})`).join(', ')});

void main() {
  vec2 p = face((gl_FragCoord.xy - u_center) / u_radius);
  float r = length(p);
  vec2 toward = p / max(r, 1e-4);
  float px = 1.0 / u_radius;
  // The lamp's red: the accent, deepened until only its own colour is left.
  vec3 hue = pow(u_accent, vec3(3.2));
  hue /= max(hue.r, max(hue.g, hue.b));
  // Every edge of the lens is a pixel and a half soft: crisp, never hard.
  float cover = clamp((1.0 - r) / (px * 1.6) + 0.5, 0.0, 1.0);
  // Beyond the lens, only a soft shadow on the ground, falling a little below it.
  float shadow = 0.42 * (1.0 - smoothstep(0.97, 1.12, length(p + vec2(0.0, 0.03))));
  vec3 light = vec3(0.0);
  float facing = dot(toward, u_sheen);

  // The seat: a flat ring of dark anodised metal that holds the glass, as round the film's eye, with a narrow chamfer
  // at each edge. Its finish is polished and finely brushed round the ring, so the room's light catches it as two soft
  // wedges along the way the light comes, over a very fine grain; each chamfer catches a thin line of light, the
  // outer one on the lit side, the inner one on the far side. It stays dark, and has no step and no groove: a light
  // grey ring round a glow would make the eye a lamp in its fitting, and steps a camera's aperture.
  float seated = smoothstep(SEAT - px * 1.5, SEAT + px * 1.5, r);
  float lip = cover * seated;
  if (lip > 0.0) {
    float across = clamp((r - SEAT) / (1.0 - SEAT), 0.0, 1.0);
    float width = (1.0 - SEAT) * u_radius;
    // Flat, but for the chamfers: one pixel and a half each at least, a sixth of the ring on a large lens.
    float bevel = max(1.5 / max(width, 1.0), 0.16);
    float inner = 1.0 - smoothstep(0.0, bevel, across);
    float outer = smoothstep(1.0 - bevel, 1.0, across);
    float plain = 1.0 - max(inner, outer);
    // The brushing: long streaks round the ring, fine across it, as a turned and polished face; on a small lens
    // they fade to their average.
    float around = atan(p.y, p.x) / TAU + 0.5;
    float grain = mix(0.5, noise(vec2(around * 36.0, r * u_radius * 1.3), 36.0), smoothstep(5.0, 14.0, width));
    // The wedges of polish, along the light and, fainter, opposite it, and a fainter pair across.
    float side = dot(toward, vec2(-u_sheen.y, u_sheen.x));
    float wedges = pow(abs(facing), 7.0) * (facing > 0.0 ? 1.0 : 0.5) + pow(abs(side), 18.0) * 0.18;
    float shade = 0.026 * (0.7 + 0.3 * smoothstep(-0.8, 0.8, facing)) + wedges * 0.19 * (0.7 + 0.6 * grain);
    shade *= plain * (0.94 + 0.12 * grain) + (1.0 - plain) * 0.6;
    // The chamfers' lines of light.
    shade += outer * pow(max(facing, 0.0), 2.0) * 0.2 + inner * pow(max(-facing, 0.0), 2.0) * 0.1;
    vec3 metal = mix(vec3(0.33, 0.42, 0.55), vec3(0.66, 0.77, 0.9), clamp(wedges, 0.0, 1.0)) * shade * u_room;
    // The lamp's red reaches its inner chamfer from inside the glass, faintly.
    metal += hue * u_lamp * inner * 0.05;
    light += metal * lip;
  }

  float inside = cover * (1.0 - seated);
  if (inside > 0.0) {
    vec2 g = p / SEAT;
    float gr = r / SEAT;
    float pixel = px / SEAT;
    // Smoky black glass, a little lighter towards its edge, where it turns to the room.
    vec3 glass = vec3(0.005, 0.007, 0.01) + vec3(0.016, 0.022, 0.032) * gr * gr * gr;

    // The front of the dome. It reflects more as it turns away towards its edge: a dim room, a little brighter
    // above, and high in it a few soft panels of cool light, which its curve draws out along its upper rim. As the
    // lens turns to look, the room slides the other way across it.
    float dome = sqrt(max(1.0 - gr * gr * 0.64, 0.0));
    float reflects = 0.22 + 3.0 * (1.0 - dome) * (1.0 - dome);
    vec2 seen = g - u_gaze * 0.05 + u_depth * 0.15;
    float seenAt = length(seen);
    float seenAround = atan(seen.y, seen.x);
    vec3 panels = vec3(0.0);
    for (int index = 0; index < 4; index++) {
      vec4 panel = PANELS[index];
      float across = abs(mod(seenAround - panel.x + TAU * 0.5, TAU) - TAU * 0.5) / panel.z;
      float outward = (seenAt - panel.y) / 0.045;
      float shape = exp(-pow(across, 6.0) - pow(abs(outward), 4.0));
      panels += mix(vec3(0.36, 0.62, 1.0), vec3(0.84, 0.93, 1.0), shape * shape) * shape * clamp(0.8 + 0.2 * outward, 0.55, 1.0) * panel.w;
    }
    float room = 0.004 + 0.02 * smoothstep(-0.3, 0.95, seen.y);
    glass += (vec3(0.5, 0.72, 0.98) * room * reflects + panels * (0.55 + 0.45 * reflects)) * u_room;
    // The rim: a fresnel line of cool light along the top of the dome, fading down its sides. It is the only edge
    // the eye has, and it is never a ring.
    float top = smoothstep(-0.15, 0.85, g.y / max(gr, 1e-3));
    glass += vec3(0.62, 0.8, 1.0) * (stroke((1.0 - gr) / pixel - 1.2, 1.3) * 0.2 + pow(gr, 18.0) * 0.05) * top * u_room;

    // The lamp, deepest of all, as the film shows it: round the disc, a saturated red that falls quickly; under
    // it, a maroon haze that fills the glass and sinks to black towards the edge, as thick glass seen at an angle.
    // Its light leaves faint ghost rings on the inner surfaces, which its own voice and the working beat run through.
    vec2 lampAt = g - u_depth;
    float d = length(lampAt);
    // Seen off its axis, the lamp dims a little, as a deep light does through glass.
    float onAxis = 1.0 - 0.15 * min(1.0, length(u_gaze));
    float voiced = echo(d * 0.8).x * (1.0 - smoothstep(0.1, 0.8, d));
    float beat = u_beat * exp(-pow((d - u_heart - u_beatAt * 0.55) / 0.045, 2.0)) * (1.0 - smoothstep(0.3, 1.1, u_beatAt));
    float near = exp(-pow(max(d - u_heart, 0.0) / (0.14 * u_iris), 1.15));
    // The haze is the glass itself lit, so it shifts far less than the lamp as the lens looks about; the ghosts sit
    // between them.
    float hazed = length(g - u_depth * 0.4);
    float haze = exp(-hazed / (0.5 * u_iris));
    float ghosted = length(g - u_depth * 0.7);
    float ghosts = exp(-pow((ghosted - 0.34 * u_iris) / 0.035, 2.0)) * 0.22 + exp(-pow((ghosted - 0.57 * u_iris) / 0.045, 2.0)) * 0.14;
    ghosts *= 1.0 + echo(d * 1.1).x * 1.2 + beat * 2.0;
    float glow = u_lamp * onAxis * (1.55 * near + 0.85 * haze + 0.5 * beat + ghosts) * (1.0 + voiced * 0.35);
    glow *= 1.0 - 0.9 * smoothstep(0.55, 0.98, gr);
    vec3 red = burn(glow, hue + vec3(0.0, 0.02, 0.012));
    // The disc: amber at its edge, yellow at its middle, its edge a pixel and a half soft, with a faint highlight a
    // little above the middle, as the film's has.
    float disc = clamp((u_heart - d) / (pixel * 1.6) + 0.5, 0.0, 1.0);
    float middle = exp(-d * d / (u_heart * u_heart * 0.35));
    vec3 amber = burn(u_lamp * (2.6 + 2.4 * middle) * (1.0 + voiced * 0.25), hue + vec3(0.0, 0.3, 0.03));
    vec2 shine = (lampAt - vec2(-0.15, 0.2) * u_heart) / u_heart;
    amber += vec3(1.0, 0.8, 0.85) * exp(-dot(shine, shine) * 9.0) * 0.14 * u_room;
    glass += mix(red, amber, disc);
    // A small ghost of the disc, reflected back off the front of the glass, opposite the room's light: it moves the
    // other way as the lens looks about, as a reflection does.
    vec2 ghostAt = -u_sheen * 0.34 - u_depth * 0.9;
    float ghost = exp(-dot(g - ghostAt, g - ghostAt) / pow(u_heart * 0.55, 2.0));
    glass += burn(u_lamp * 1.4, hue + vec3(0.0, 0.18, 0.02)) * ghost * 0.22 * u_room;

    // The optical stack: each element's edge a fine line of light, and on the side that faces the room's light a
    // thin crescent of its coating's colour, brightest at its middle, where a sliver of white shows on the brightest.
    // The deeper an element, the further it shifts as the lens looks about. Thinking, a wave of focus runs through
    // the stack from the front to the back, and a shimmer with it; each catches the voice by its depth.
    for (int index = 0; index < 6; index++) {
      vec4 element = ELEMENTS[index];
      float order = float(index) / 5.0;
      vec2 q = g - u_depth * element.y;
      float qr = length(q);
      float focusing = 1.0 + (u_focus - 1.0) * (1.0 + 0.6 * sin(order * 3.0 + u_shimmerAt * TAU));
      float at = element.x * focusing;
      float off = (qr - at) / pixel;
      if (abs(off) < 7.0) {
        float shimmer = u_shimmer * exp(-pow((order - u_shimmerAt) * 3.2, 2.0));
        float facing = dot(q / max(qr, 1e-4), u_slivers[index]);
        float crescent = smoothstep(0.05, 1.0, facing);
        vec3 coat = COATS[int(element.z)];
        float voice = index < 2 ? u_voice.x : index < 3 ? u_voice.y : index < 5 ? u_voice.z : u_voice.w;
        float catches = element.w * u_catch * u_room;
        // The edge: faint all round, and the lamp's red caught on the side away from the room's light.
        glass += vec3(0.6, 0.72, 0.9) * stroke(off, 1.0) * 0.022 * catches;
        glass += burn(u_lamp * 0.9, hue) * stroke(off, 1.0) * (0.03 + pow(max(-facing, 0.0), 2.0) * 0.16 + voice * 0.5) * u_catch * element.w;
        // The coating's crescent, a hair inside the edge and a little wider than it.
        glass += coat * exp(-pow((off + 1.8) / (2.1 + shimmer * 1.5), 2.0)) * crescent * crescent * (0.3 + 0.3 * shimmer) * catches;
        // And at its middle, a sliver of the room's own light.
        glass += vec3(0.85, 0.93, 1.0) * stroke(off, 1.2) * pow(max(facing, 0.0), 28.0) * (0.35 + 0.5 * shimmer) * catches;
      }
    }

    // The film's catchlights: the room's light caught by the inner elements nearest the lamp, two rows of small
    // curved strokes of light over the disc, crisp-edged and rounded at their ends, the nearer row the brighter. They sit deep with the lamp, and catch more of
    // the room's light while it listens.
    float caughtAt = length(lampAt);
    float caughtAround = atan(lampAt.y, lampAt.x);
    float catches = 0.0;
    for (int index = 0; index < 7; index++) {
      vec4 spot = CATCHES[index];
      float row = spot.y * u_heart * 10.0;
      float off = abs(mod(caughtAround - spot.x + TAU * 0.5, TAU) - TAU * 0.5);
      // A capsule along the arc: its length round it, its width across, its ends rounded.
      vec2 from = vec2(max(off - spot.z * 0.7, 0.0) * row, caughtAt - row);
      float apart = length(from);
      float stroked = max(0.011, pixel * 1.2);
      float middle = 1.0 - 0.3 * pow(min(off / spot.z, 1.0), 2.0);
      catches += spot.w * middle * (clamp((stroked - apart) / (pixel * 1.6) + 0.5, 0.0, 1.0) + 0.2 * exp(-apart * apart / (stroked * stroked * 9.0)));
    }
    glass += vec3(0.66, 0.86, 1.0) * catches * u_room * min(u_catch, 1.6) * 0.95;
    // Where the glass meets the seat, a soft dark seam.
    glass *= 1.0 - 0.5 * exp(-pow((1.0 - gr) / (pixel * 2.5), 2.0));
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
  bloom: 0.26,
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
