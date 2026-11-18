import { type Drawing, PRELUDE } from './glsl.ts'

/**
 * The lens look: the eye of 2001: A Space Odyssey, as a real lens in a real room. Nothing in it is painted on: each
 * pixel is a ray from a camera in front of it, traced into the glass.
 *
 * The ray first meets a dome of glass standing out of a thin flat seat of dark polished metal. The dome reflects the
 * room it is in: a nearly dark room with a row of light panels in its ceiling, as on the film's set, which its curve
 * draws out along its upper rim; and, of the screen it lives on, the view it looks at as a faint lit pane. The ray then bends into the glass and goes down the barrel: a tunnel of stops, each a dark
 * ring whose inner edge the lamp lights red, narrower the deeper it is, and in the deeper ones a lens element whose
 * curved face reflects the ceiling's panels again, small: the film's catchlights, which here are what they were on
 * the set. At the bottom is the lamp: a disc of amber yellow in a saturated red that fills the glass round it and
 * sinks to black towards the edge.
 *
 * Because it is traced, it turns as a thing does: the room slides over the dome, the stops part by their depth, and
 * the lamp is seen down the tunnel from the side.
 */

/** The lens's radius, as a share of half the canvas: the rest is room for its shadow. */
export const LENS_SIZE = 0.74

/** How far the glass reaches, as a share of the lens's radius. Round it is the seat that holds it. */
export const SEAT = 0.9

/** How far the dome stands out of the seat at its middle, in the lens's radii, and the radius of the sphere it is a cap of. */
const BULGE = 0.36
const SPHERE = (SEAT * SEAT + BULGE * BULGE) / (2 * BULGE)

/** How much the glass bends light: its index of refraction. */
const INDEX = 1.5

/** How far above the seat's plane the dome is at a radius. */
const domeAt = (radius: number) => Math.sqrt(SPHERE * SPHERE - radius * radius) - (SPHERE - BULGE)

/**
 * How wide something at a depth under the seat must be to be seen at a radius through the dome, which gathers the
 * rays towards its axis as they go down, so what is deep looks larger than it is.
 */
const widthFor = (seen: number, depth: number) => seen * (1 - ((1 - 1 / INDEX) / SPHERE) * (domeAt(seen) + depth))

/**
 * The stops of the barrel, from the front to the back: the radius each is seen at, as a share of the lens's radius;
 * how deep it sits under the seat; and, where a lens element sits in its opening, the radius its face curves at,
 * bulging towards the front, and how much of the room that face reflects. The curve says where the ceiling's panels
 * show in it and how small: the tighter, the nearer the lamp and the smaller.
 */
export const STOPS = [
  { seen: 0.83, depth: 0.05, curve: 0, mirror: 0 },
  { seen: 0.7, depth: 0.17, curve: 0, mirror: 0 },
  { seen: 0.57, depth: 0.31, curve: 1.1, mirror: 0.035 },
  { seen: 0.44, depth: 0.46, curve: 0.62, mirror: 0.09 },
  { seen: 0.31, depth: 0.62, curve: 0.4, mirror: 0.12 }
] as const

/**
 * How soft a stop's edge is, in the lens's radii; and how much more of the lamp's light a stop's inner edge catches
 * than the glass round it, at the front of the barrel and by how much more at the back. Small, so the red is one
 * glow from the lamp outwards, in which the barrel shows as gentle steps.
 */
const EDGE = 0.022
const STEP = [0.13, 0.32] as const

/**
 * The marks of the index ring, which is the first stop's face: how many there are round it, how far from the stop's
 * edge they start, and how long they are, the short ones and the longer one every sixth, in the lens's radii.
 */
const MARKS = 72
const MARK_FROM = 0.022
const MARK_LENGTH = [0.016, 0.03] as const

/**
 * The star of the lamp: the needles of light it throws through the red, as a point of light does through a lens
 * stopped down. How many long ones there are, with a short one between each two; how long a long one is at rest, in
 * the disc's radii, at its shortest and at its longest; and how much longer its voice draws it.
 */
const NEEDLES = 20
const NEEDLE_REST = [1.5, 4.6] as const
const NEEDLE_VOICE = 5.6

/** How deep the lamp sits under the seat, and how wide its disc is there for each radius it is seen at. */
const LAMP_DEPTH = 0.8
const LAMP_WIDTH = widthFor(0.1, LAMP_DEPTH) / 0.1

/**
 * The one light of the room: a long soft box in its ceiling, one radius above the lens. Where its far edge is across
 * the ceiling, left to right and from over the lens towards the viewer; half its length; how far its light reaches
 * from that edge towards the viewer before it has faded; and how bright it is. It sits a little to the left, as the
 * room's light comes from there. Its far edge is defined and the rest of it fades, towards the viewer and towards
 * its ends: so a polished dome shows it as one soft crescent under its upper rim, clean on the rim's side and melting
 * into the glass on the other, and each element behind the dome as a small arc.
 */
export const SOFTBOX = { at: [-0.22, 0.06], half: 0.95, reach: 0.2, bright: 5.5 } as const

/** How low over the lens's rim the light that goes round it while it thinks is, in radians from the lens's axis. */
const SCAN_LOW = 1.5

/** How far in front of the lens the screen it lives on is taken to be, in its radii, for what of it the glass reflects. */
const SCREEN = 2.2

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
// The corona of fine fibres of light round the disc: how much of it shows, and how far it has turned, in turns.
uniform float u_corona;
uniform float u_swirl;
// The glint of a light that goes round the lens while it thinks: how much of it shows, and where it is, in turns
// counter-clockwise from the right.
uniform float u_scan;
uniform float u_scanAt;
// How far it has woken, from 0 to 1.
uniform float u_wake;
// Of the screen round it: the view it looks at, its middle and half its size in the lens's radii from its middle,
// and how much of it shows.
uniform vec4 u_view;
uniform float u_viewShown;

const float SEAT = ${glsl(SEAT)};
const float BULGE = ${glsl(BULGE)};
const float SPHERE = ${glsl(SPHERE)};
const float INDEX = ${glsl(INDEX)};
// Each stop: how deep it is, how wide its opening, the curve of the element in it, and how much that reflects.
const vec4 STOPS[${STOPS.length}] = vec4[${STOPS.length}](${STOPS.map((stop) => `vec4(${glsl(stop.depth)}, ${glsl(widthFor(stop.seen, stop.depth))}, ${glsl(stop.curve)}, ${glsl(stop.mirror)})`).join(', ')});
// How much smaller than it is seen each stop is: what a pixel of the screen is across it.
const float SCALES[${STOPS.length}] = float[${STOPS.length}](${STOPS.map((stop) => glsl(widthFor(stop.seen, stop.depth) / stop.seen)).join(', ')});
// Which way the room's light comes from, on the whole.
const vec3 KEY = vec3(-0.2425, 0.9285, 0.2814);

// The room the lens is in, as its glass reflects it, in a direction: nearly dark, with a faint glow from above and
// a little to the left; the strip of light in its ceiling; and of the screen in front of it, the view it looks at.
// Everything in it is soft: nothing a dark glass reflects has a hard edge.
vec3 room(vec3 dir, float soft) {
  vec3 light = vec3(0.004, 0.0055, 0.008) * (1.0 + dir.y);
  light += vec3(0.5, 0.68, 1.0) * (0.8 * pow(max(dot(dir, KEY), 0.0), 5.0));
  if (dir.y > 0.04) {
    vec2 at = dir.xz / dir.y - vec2(${glsl(SOFTBOX.at[0])}, ${glsl(SOFTBOX.at[1])});
    // Along it, the light is fullest at the middle and gone at the ends, where the box is also narrower.
    float along = clamp(1.0 - pow(at.x / ${glsl(SOFTBOX.half)}, 2.0), 0.0, 1.0);
    float reach = ${glsl(SOFTBOX.reach)} * (0.35 + 0.65 * along);
    float lit = smoothstep(-soft, soft, at.y) * exp(-pow(max(at.y, 0.0) / reach, 1.6));
    light += vec3(0.62, 0.82, 1.0) * (${glsl(SOFTBOX.bright)} * lit * along * sqrt(along));
  }
  // Thinking, a small faint light goes slowly round the lens, low over its rim: the dome and each element behind
  // it show it as a soft glint going round.
  if (u_scan > 0.001) {
    float round = u_scanAt * TAU;
    vec3 toScan = vec3(cos(round) * ${glsl(Math.sin(SCAN_LOW))}, sin(round) * ${glsl(Math.sin(SCAN_LOW))}, ${glsl(Math.cos(SCAN_LOW))});
    light += vec3(0.7, 0.86, 1.0) * (3.5 * u_scan * exp(-(1.0 - dot(dir, toScan)) / (0.006 + soft * 0.3)));
  }
  if (dir.z > 0.05 && u_viewShown > 0.001) {
    vec2 at = dir.xy * (${glsl(SCREEN)} / dir.z);
    vec2 q = abs(at - u_view.xy) - u_view.zw;
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    light += vec3(0.52, 0.7, 1.0) * (3.2 * u_viewShown * (1.0 - smoothstep(-soft * 4.0, soft * 4.0, edge)));
  }
  return light;
}

void main() {
  vec2 s = (gl_FragCoord.xy - u_center) / u_radius;
  float px = 1.0 / u_radius;
  // The lens, turned to where it looks: the camera and this pixel's ray, as seen from it.
  mat3 turn = turned(u_tilt);
  vec3 o = vec3(0.0, 0.0, CAMERA) * turn;
  vec3 d = normalize(vec3(s, -CAMERA)) * turn;
  // The lamp's red: the accent, deepened until only its own colour is left.
  vec3 hue = pow(u_accent, vec3(3.2));
  hue /= max(hue.r, max(hue.g, hue.b));
  // Which way the room's light falls across the lens's face.
  vec2 key = normalize((KEY * turn).xy);

  // Where the ray meets the plane of the seat.
  vec2 h = o.xy - d.xy * (o.z / d.z);
  float r = length(h);
  vec2 toward = h / max(r, 1e-4);
  // Every edge of the lens is a pixel and a half soft: crisp, never hard.
  float cover = clamp((1.0 - r) / (px * 1.6) + 0.5, 0.0, 1.0);
  // Beyond the lens, only a soft shadow on the ground, falling a little below it.
  float shadow = 0.42 * (1.0 - smoothstep(0.97, 1.12, length(h + vec2(0.0, 0.03))));
  vec3 light = vec3(0.0);

  // The seat: a flat ring of dark anodised metal that holds the glass, as round the film's eye, with a narrow chamfer
  // at each edge. Its finish is polished and finely brushed round the ring, so the room's light catches it as two soft
  // wedges along the way the light comes, over a very fine grain; each chamfer catches a thin line of light, the
  // outer one on the lit side, the inner one on the far side. It stays dark, and has no step and no groove: a light
  // grey ring round a glow would make the eye a lamp in its fitting, and steps a camera's aperture.
  float seated = smoothstep(SEAT - px * 1.5, SEAT + px * 1.5, r);
  float lip = cover * seated;
  if (lip > 0.0) {
    float facing = dot(toward, key);
    float across = clamp((r - SEAT) / (1.0 - SEAT), 0.0, 1.0);
    float width = (1.0 - SEAT) * u_radius;
    float bevel = max(1.5 / max(width, 1.0), 0.16);
    float inner = 1.0 - smoothstep(0.0, bevel, across);
    float outer = smoothstep(1.0 - bevel, 1.0, across);
    float plain = 1.0 - max(inner, outer);
    float around = atan(h.y, h.x) / TAU + 0.5;
    float grain = mix(0.5, noise(vec2(around * 36.0, r * u_radius * 1.3), 36.0), smoothstep(5.0, 14.0, width));
    // Turned on a lathe: fine grooves run round its face, three pixels apart, and each catches the light on one side.
    float grooves = floor(width / 3.0);
    float groove = mix(0.5, 0.5 + 0.5 * cos(across * TAU * grooves), smoothstep(8.0, 13.0, width));
    float side = dot(toward, vec2(-key.y, key.x));
    float wedges = pow(abs(facing), 5.0) * (facing > 0.0 ? 1.0 : 0.55) + pow(abs(side), 14.0) * 0.22;
    float shade = 0.05 * (0.7 + 0.3 * smoothstep(-0.8, 0.8, facing)) + wedges * 0.4 * (0.6 + 0.4 * grain + 0.5 * groove);
    shade *= plain * (0.86 + 0.12 * grain + 0.16 * groove) + (1.0 - plain) * 0.6;
    shade += outer * (0.035 + pow(max(facing, 0.0), 2.0) * 0.42) + inner * (0.02 + pow(max(-facing, 0.0), 2.0) * 0.2);
    vec3 metal = mix(vec3(0.33, 0.42, 0.55), vec3(0.66, 0.77, 0.9), clamp(wedges, 0.0, 1.0)) * shade * u_room;
    // Thinking, the light that goes round the lens glints on the metal as it passes.
    float passing = max(dot(toward, vec2(cos(u_scanAt * TAU), sin(u_scanAt * TAU))), 0.0);
    metal += vec3(0.66, 0.8, 1.0) * (u_scan * u_room * (pow(passing, 40.0) * 0.3 * (0.6 + 0.6 * grain) + pow(passing, 8.0) * 0.04) * (plain + outer * 0.8));
    // The lamp's red reaches its inner chamfer from inside the glass, faintly.
    metal += hue * u_lamp * inner * 0.05;
    light = metal * lip;
  }

  // The glass: a cap of a sphere standing out of the seat.
  vec3 centre = vec3(0.0, 0.0, BULGE - SPHERE);
  vec3 from = o - centre;
  float along = dot(from, d);
  // Never under nothing: at the lens's very middle the two are equal, and their difference is only rounding.
  float apart = max(dot(from, from) - along * along, 0.0);
  float glassy = 0.0;
  if (apart < SPHERE * SPHERE) {
    vec3 P = o + d * (-along - sqrt(SPHERE * SPHERE - apart));
    glassy = clamp((SPHERE - sqrt(apart)) / (px * 1.6) + 0.5, 0.0, 1.0) * clamp(P.z / (px * 1.6) + 0.5, 0.0, 1.0);
    if (glassy > 0.0) {
      vec3 N = (P - centre) / SPHERE;
      float gr = min(length(P.xy) / SEAT, 1.0);
      float pixel = px / SEAT;
      // What the dome reflects of the room, more as it turns away from the camera.
      float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(N, -d), 0.0, 1.0), 5.0);
      vec3 mirrored = room(turn * reflect(d, N), 0.03) * fresnel;

      // Into the glass, and down the barrel. Thinking, the stack breathes along its axis, as a lens finding focus.
      vec3 T = refract(d, N, 1.0 / INDEX);
      float stack = 1.0 + (u_focus - 1.0) * 4.0;
      // Waking, the light rises out of the dark: the disc ignites first, then the red spreads up the barrel.
      float ignite = smoothstep(0.0, 0.16, u_wake);
      float rise = smoothstep(0.06, 0.92, u_wake);
      float iris = u_iris * mix(0.3, 1.0, smoothstep(0.1, 0.95, u_wake));
      vec3 inner = vec3(0.0);
      vec3 caught = vec3(0.0);
      // How much more of the lamp's light the stops' inner edges catch than the glass between them; and how much
      // of what lies deeper still shows, past the stops so far.
      float edges = 0.0;
      float through = 1.0;
      for (int index = 0; index < ${STOPS.length}; index++) {
        vec4 stop = STOPS[index];
        float order = float(index) / ${glsl(STOPS.length - 1)};
        vec2 q = P.xy + T.xy * ((-stop.x * stack - P.z) / T.z);
        float rq = length(q);
        // A stop's edge is soft, and what it catches of the lamp fades slowly out across its face: the barrel
        // shows as depth in one glow of red, never as circles drawn on it.
        float open = smoothstep(-1.0, 1.0, (stop.y - rq) / (${glsl(EDGE)} + px * 1.6));
        // The edges catch the voice as it travels: its own, out from the lamp to the front; the one it hears, in
        // from the front to the lamp. Thinking, a shimmer runs down them; working, a beat runs up.
        float heard = echo((1.0 - order) * 0.26).x + echo(order * 0.26).y;
        float shimmer = u_shimmer * exp(-pow((order - u_shimmerAt) * 3.2, 2.0));
        float beat = u_beat * exp(-pow((1.0 - order - u_beatAt) / 0.2, 2.0)) * (1.0 - smoothstep(0.4, 1.2, u_beatAt));
        float lit = smoothstep(0.15, 0.35, u_wake - 0.55 * (1.0 - order));
        float rim = exp(-max(rq - stop.y, 0.0) / (0.07 + 0.05 * order));
        float shown = through * (1.0 - open);
        // The stop's edge is polished: a fine line of the room's light runs along it on the side the light comes
        // from, and thinking, the light that goes round the lens glints on each edge in turn. Fine and cool, as
        // the edges of the rings deep in a lens are, they part by their depth as the lens turns.
        vec2 outward = q / max(rq, 1e-4);
        float fine = px * SCALES[index];
        float edge = stroke((rq - stop.y) / fine - 1.0, 1.2) * through;
        float facing = max(dot(outward, key), 0.0);
        float passing = max(dot(outward, vec2(cos(u_scanAt * TAU), sin(u_scanAt * TAU))), 0.0);
        inner += vec3(0.6, 0.78, 1.0) * (edge * u_room * (pow(facing, 3.0) * (0.34 - 0.2 * order) + pow(passing, 24.0) * u_scan * 0.4) * lit);
        // The first stop is the lens's index ring, under the glass: fine marks engraved round it and filled with
        // a pale paint, a longer one every sixth. It turns slowly, as a ring that sets the focus, and faster while
        // the lens thinks. A small lens has none: they would only blur.
        if (index == 0) {
          float about = atan(q.y, rq > 1e-5 ? q.x : 1.0) / TAU + u_swirl * 0.5;
          float nearest = floor(about * ${glsl(MARKS)} + 0.5);
          float longer = 1.0 - step(0.5, mod(nearest, 6.0));
          float beside = (about * ${glsl(MARKS)} - nearest) / ${glsl(MARKS)} * TAU * rq / fine;
          float from = stop.y + ${glsl(MARK_FROM)};
          float mark = stroke(beside, 1.2) * clamp((rq - from) / fine + 0.5, 0.0, 1.0) * clamp((from + mix(${glsl(MARK_LENGTH[0])}, ${glsl(MARK_LENGTH[1])}, longer) - rq) / fine + 0.5, 0.0, 1.0);
          mark *= smoothstep(40.0, 90.0, u_radius) * shown;
          inner += (vec3(0.55, 0.7, 0.9) * (0.1 + 0.2 * facing) * u_room + hue * u_lamp * 0.05) * (mark * mix(0.6, 1.0, longer));
        }
        edges += (${glsl(STEP[0])} + ${glsl(STEP[1])} * order) * u_catch * (1.0 + heard * 2.2 + shimmer * 1.5 + beat * 1.5) * lit * rim * shown;
        // The stops nearest the front catch a little of the room too, most on the side its light comes from.
        inner += vec3(0.42, 0.56, 0.75) * ((1.0 - order) * (0.012 + 0.03 * facing + 0.06 * rim * facing) * u_room * shown);
        // The element in its opening: its curved face reflects the room back up through the dome.
        if (stop.w > 0.0) {
          vec3 back = refract(reflect(T, normalize(vec3(q / stop.z, 1.0))), -N, INDEX);
          if (dot(back, back) > 0.5) caught += room(turn * back, 0.04) * (through * open * stop.w);
        }
        through *= open;
      }

      // The lamp, at the bottom: a disc of amber, yellow at its middle; round it, a saturated red that falls
      // quickly; and through the glass itself, a red haze, by how near the ray passes the lamp. Its voice travels
      // out through the red.
      vec3 lamp = vec3(0.0, 0.0, -${glsl(LAMP_DEPTH)} * stack);
      vec2 ql = P.xy + T.xy * ((lamp.z - P.z) / T.z);
      float dl = length(ql);
      float e = u_heart * ${glsl(LAMP_WIDTH)};
      float disc = clamp((e - dl) / (px * 1.8) + 0.5, 0.0, 1.0) * ignite * through;
      vec3 toLamp = lamp - P;
      float off = length(toLamp - T * dot(toLamp, T));
      float voiced = echo(off * 1.1).x * (1.0 - smoothstep(0.08, 0.6, off));
      float near = exp(-pow(max(dl - e, 0.0) / (0.1 * iris), 1.15));
      float haze = exp(-off / (0.37 * iris)) * rise;
      float glow = u_lamp * (1.55 * near * mix(ignite, 1.0, rise) + 0.95 * haze) * (1.0 + voiced * 0.35) * mix(0.35, 1.0, rise);
      // Working, each beat is a ring of light that leaves the lamp and crosses the glass to its edge, where the
      // ground takes it on.
      float pulse = u_beat * exp(-pow((gr - u_beatAt) / 0.075, 2.0)) * (1.0 - smoothstep(0.5, 1.15, u_beatAt)) * rise;
      glow *= (1.0 + edges + 0.85 * pulse) * (1.0 - 0.9 * smoothstep(0.55, 0.98, gr));
      // The star: needles of hotter light the lamp throws through the red, as a point of light does through a lens
      // stopped down. Each is a pixel or two wide and tapers to nothing, each has its own length, which breathes
      // slowly, and a shorter one stands between each two. The star turns slowly. Each needle has a note of its
      // voice, the low ones at the top and the high ones down the sides, and is drawn out by it as it speaks. A
      // small lens has none: they would only blur.
      float beyond = max(dl - e, 0.0) / e;
      float about = fract(atan(ql.x, dl > 1e-5 ? ql.y : 1.0) / TAU + 0.5 + u_swirl * 0.12) * ${glsl(NEEDLES * 2)};
      float nearest = floor(about + 0.5);
      float which = mod(nearest, ${glsl(NEEDLES * 2)});
      float lesser = mod(which, 2.0);
      float note = abs(which / ${glsl(NEEDLES)} - 1.0);
      float said = echo(0.02 + note * 0.1).x * 0.35 + spectrum(note).x * 1.1;
      float rest = mix(${glsl(NEEDLE_REST[0])}, ${glsl(NEEDLE_REST[1])}, noise(vec2(which * 0.5, u_time * 0.35 + which * 7.3), ${glsl(NEEDLES)}));
      float reach = (rest * u_corona + said * ${glsl(NEEDLE_VOICE)}) * mix(1.0, 0.42, lesser);
      float way = beyond / max(reach, 1e-3);
      float beside = (about - nearest) / ${glsl(NEEDLES * 2)} * TAU * dl / ${glsl(LAMP_WIDTH)} * u_radius;
      float thick = max(1.3, u_radius * 0.009) * mix(1.0, 0.7, lesser);
      float needle = stroke(beside, mix(thick, 0.0, way)) * pow(max(1.0 - way, 0.0), 1.3);
      float heat = needle * mix(1.0, 0.6, lesser) * min(0.46 * u_corona + said * 1.4, 1.3) * smoothstep(26.0, 60.0, u_radius) * rise;
      // The light is hottest at the lamp and cools as it leaves it: amber, then orange, then the deep red.
      float warm = 0.21 * exp(-beyond / 0.8) * rise;
      glow *= 1.0 + 0.5 * heat;
      vec3 red = burn(glow, hue + vec3(0.0, 0.02 + warm + 0.5 * heat + 0.07 * pulse, 0.012 + 0.02 * warm + 0.05 * heat));
      red += hue * (0.09 * pulse * u_lamp * (1.0 - smoothstep(0.8, 1.0, gr)));
      red += vec3(1.0, 0.45, 0.07) * (0.3 * heat * u_lamp * (1.0 - 0.9 * smoothstep(0.55, 0.98, gr)));
      float middle = exp(-dl * dl / (e * e * 0.35));
      vec3 amber = burn(u_lamp * (2.6 + 2.4 * middle) * (1.0 + voiced * 0.25), hue + vec3(0.0, 0.3, 0.03));
      // At the disc's very middle, the filament behind it: a small soft point, nearly white.
      amber += vec3(1.0, 0.9, 0.78) * (0.3 * u_lamp * exp(-dl * dl / (e * e * 0.06)));
      inner += mix(red, amber, disc);

      // Smoky black glass, a little lighter towards its edge; what is in it; and what it reflects.
      vec3 glass = vec3(0.004, 0.0055, 0.008) + vec3(0.012, 0.017, 0.025) * gr * gr * gr;
      glass += inner * (1.0 - fresnel);
      glass += 1.0 - exp(-(mirrored + caught * (1.0 - fresnel)) * u_room);
      // A line of cool light along the top of the dome's edge, fading down its sides; and where the glass meets
      // the seat, a soft dark seam.
      float top = smoothstep(-0.15, 0.85, P.y / max(length(P.xy), 1e-3));
      glass += vec3(0.62, 0.8, 1.0) * ((stroke((1.0 - gr) / pixel - 1.2, 1.3) * 0.1 + pow(gr, 18.0) * 0.04) * top * u_room);
      glass *= 1.0 - 0.5 * exp(-pow((1.0 - gr) / (pixel * 2.5), 2.0));
      light = mix(light, glass, glassy);
    }
  }

  finish(light, max(max(cover, glassy), shadow));
}`

const UNIFORMS = [
  'lamp',
  'heart',
  'iris',
  'catch',
  'room',
  'shimmer',
  'shimmerAt',
  'focus',
  'beat',
  'beatAt',
  'corona',
  'swirl',
  'scan',
  'scanAt',
  'wake',
  'view',
  'viewShown'
] as const

/** How far the lens turns towards what it looks at, in radians, at the edge of its gaze: a glance, not a lean. */
const TURN = 0.14

export const LENS: Drawing<(typeof UNIFORMS)[number]> = {
  fragment: FRAGMENT,
  size: LENS_SIZE,
  reach: 1.14,
  // A lens: its light halates a little in the glass, as on film.
  bloom: 0.26,
  uniforms: UNIFORMS,
  // Towards what it looks at, and a little with the drift of the view.
  turn: ({ gaze, lens }) => [gaze[0] * TURN + lens.sway[0], gaze[1] * TURN + lens.sway[1]],
  set(gl, at, { lens, wake, view }) {
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
    gl.uniform1f(at.corona, lens.corona)
    gl.uniform1f(at.swirl, lens.turn / (Math.PI * 2))
    gl.uniform1f(at.scan, lens.scan)
    gl.uniform1f(at.scanAt, lens.scanAngle / (Math.PI * 2))
    gl.uniform1f(at.wake, wake.lens)
    // What is round it is told in the core's radii; the lens is a little smaller than the core.
    gl.uniform4f(at.view, (view[0] ?? 0) / LENS_SIZE, (view[1] ?? 0) / LENS_SIZE, (view[2] ?? 0) / LENS_SIZE, (view[3] ?? 0) / LENS_SIZE)
    gl.uniform1f(at.viewShown, view[4] ?? 0)
  }
}
