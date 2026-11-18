import { type Drawing, PRELUDE } from './glsl.ts'

/**
 * The lens look: a camera's eye. From the outside in, a thin ring of turned metal; a dome of black glass with the
 * lens elements inside it, each edge catching a sliver of light, and a window reflected on its upper left; and deep
 * inside, a lamp seen through it all, the accent where its light is faint, amber where it is strong, near white at
 * its very heart. Only the lamp is coloured: the metal and the glass reflect a neutral room.
 */

/** The lens's radius, as a share of half the canvas: the rest is room for its shadow. */
export const LENS_SIZE = 0.74

/** Where the glass meets the metal ring, as a share of the lens's radius. */
export const GLASS = 0.86

/**
 * The lens elements inside the glass, from the outside in: their edge's radius as a share of the glass, how deep
 * they sit (the deeper, the further they shift as the view drifts), where their edge catches the window's light,
 * in radians, and how fast that turns against the elements' clock, the neighbours turning opposite ways.
 */
export const ELEMENTS = [
  { radius: 0.8, depth: 0.2, catches: 2.3, turn: 1 },
  { radius: 0.635, depth: 0.45, catches: 2.95, turn: -1.4 },
  { radius: 0.48, depth: 0.7, catches: 1.65, turn: 0.8 },
  { radius: 0.335, depth: 0.9, catches: 3.7, turn: -1.1 }
] as const

const glsl = (value: number) => value.toFixed(4)

const FRAGMENT = `${PRELUDE}
uniform float u_lamp;
uniform float u_focus;
uniform float u_spread;
uniform float u_catch;
uniform float u_room;
uniform float u_shimmer;
uniform float u_shimmerAt;
// Which way the room's light falls across the ring, and where each element's edge catches it.
uniform vec2 u_sheen;
uniform vec2 u_slivers[4];
uniform vec2 u_depth;

const float GLASS = ${glsl(GLASS)};
const vec2 ELEMENTS[4] = vec2[4](${ELEMENTS.map((element) => `vec2(${glsl(element.radius)}, ${glsl(element.depth)})`).join(', ')});

void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
  float r = length(p);
  vec2 toward = p / max(r, 1e-4);
  // A warm filament behind a filter of the accent: where the lamp burns, the colours the filter leaks show as it
  // whitens. For a red accent, that is amber, then white.
  vec3 response = (pow(u_accent, vec3(2.2)) + 0.04) * vec3(1.0, 0.66, 0.35);
  float cover = clamp((1.0 - r) * u_radius + 0.5, 0.0, 1.0);
  vec3 light = vec3(0.0);

  // Beyond the ring, only a soft shadow on the ground, falling a little below it.
  float shadow = 0.45 * (1.0 - smoothstep(0.97, 1.1, length(p + vec2(0.0, 0.025))));

  // The ring of turned metal.
  float ring = cover * clamp((r - GLASS) * u_radius + 0.5, 0.0, 1.0);
  if (ring > 0.0) {
    float across = clamp((r - GLASS) / (1.0 - GLASS), 0.0, 1.0);
    float bend = across * 2.0 - 1.0;
    // Its profile: a flat face, rolling over at its outer edge and stepping down into the glass at its inner one.
    vec3 normal = normalize(vec3(toward * bend * bend * bend * 1.3, 1.0));
    float diffuse = max(dot(normal, normalize(vec3(u_sheen * 0.62, 0.78))), 0.0);
    // Its fine circular grooves catch the light in two wedges, along the light and opposite it, and a second,
    // fainter light from the side in two more.
    float facing = dot(toward, u_sheen);
    float side = dot(toward, vec2(-u_sheen.y, u_sheen.x) * 0.8 + u_sheen * 0.6);
    float wedges = pow(abs(facing), 14.0) * (facing > 0.0 ? 1.0 : 0.45) + pow(abs(side), 30.0) * 0.3;
    // The grooves as streaks round the ring; on a ring too narrow to show them, they fade to their average.
    float around = atan(p.y, p.x) / TAU + 0.5;
    float grooves = mix(0.5, noise(vec2(around * 48.0, r * u_radius * 0.9), 48.0), smoothstep(4.0, 14.0, (1.0 - GLASS) * u_radius));
    float metal = (0.03 + 0.24 * diffuse * diffuse) * (0.8 + 0.4 * grooves) + wedges * (0.2 + 0.55 * grooves) * smoothstep(0.2, 0.7, diffuse);
    // The rolled outer edge catches a thin line of light on the side the light comes from.
    metal += stroke((1.0 - r) * u_radius - 1.2, 1.0) * 0.3 * max(facing, 0.0);
    vec3 tint = vec3(0.86, 0.9, 0.96) * metal * u_room;
    // The lamp lights the ring's inner lip from inside the glass, and a dark seam parts them.
    tint += burn(u_lamp * 0.5, response) * exp(-across / 0.08) * 0.18;
    tint *= 1.0 - 0.85 * stroke((r - GLASS) * u_radius - 0.5, 1.5);
    light += tint * ring;
  }

  float inside = clamp((GLASS - r) * u_radius + 0.5, 0.0, 1.0);
  if (inside > 0.0) {
    vec2 g = p / GLASS;
    float gr = r / GLASS;
    float pixel = 1.0 / (u_radius * GLASS);
    vec3 glass = vec3(0.003, 0.004, 0.006);

    // The dome is a cap of a sphere: its surface turns away towards the ring. What it reflects, as a direction
    // across the screen: a dim room, a little brighter above, and a window on the upper left.
    float facing = sqrt(1.0 - gr * gr * 0.64);
    vec2 seen = 1.6 * facing * g;
    float reflects = 0.3 + 0.7 * (1.0 - facing) * (1.0 - facing) * 4.0;
    vec2 pane = mat2(0.94, 0.34, -0.34, 0.94) * (seen - vec2(-0.6, 0.6) + u_depth * 0.5);
    vec2 corner = abs(pane) - vec2(0.2, 0.15);
    float frame = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 0.08;
    float soft = 0.05 + pixel * 1.6;
    float window = (1.0 - smoothstep(-soft, soft, frame)) * (0.3 + 0.7 * smoothstep(-0.2, 0.22, pane.y));
    // A second, fainter light from the lower right, drawn out along the curve of the glass.
    vec2 low = mat2(0.71, -0.71, 0.71, 0.71) * (seen - vec2(0.6, -0.62));
    window += exp(-(low.x * low.x * 12.0 + low.y * low.y * 140.0)) * 0.22;
    float room = 0.008 + 0.04 * smoothstep(-0.3, 0.95, seen.y);
    glass += vec3(0.8, 0.85, 0.93) * (room + window * 0.34) * reflects * u_room;
    // Where the dome meets the ring it reflects the most, a thin light that is brighter at the top.
    glass += vec3(0.7, 0.75, 0.82) * pow(gr, 10.0) * (0.03 + 0.05 * smoothstep(-0.6, 0.9, g.y)) * u_room;

    // The lamp deep inside, seen through it all: a white-hot heart that falls off as a real light does, quickly
    // then slowly, and a glow that stays inside the glass. Its own voice travels out through it.
    vec2 lampAt = g - u_depth;
    float d = length(lampAt);
    float a = u_focus;
    float intensity = 46.0 * exp(-d * d / (a * a)) + 6.0 / pow(1.0 + d * d / (4.0 * a * a), 1.3) + 1.8 * exp(-d / (0.22 * u_spread))
      + 0.14 * exp(-d / (0.4 * u_spread));
    intensity *= u_lamp * (1.0 - 0.9 * smoothstep(0.5, 1.0, gr)) * (1.0 + echo(d * 0.8).x * 0.6 * (1.0 - smoothstep(0.15, 0.7, d)));
    glass += burn(intensity, response);

    // The lens elements: each edge a faint full circle, catching the window as a sliver whose colours part a
    // little, and the lamp's light on its far side. Thinking, a shimmer runs through them from the outside in.
    for (int index = 0; index < 4; index++) {
      vec2 element = ELEMENTS[index];
      vec2 q = g - u_depth * element.y;
      float qr = length(q);
      if (abs(qr - element.x) < 0.035 + pixel * 4.0) {
        float off = (qr - element.x) / pixel;
        float turned = dot(q / qr, u_slivers[index]);
        float shimmer = u_shimmer * exp(-pow((float(index) / 3.0 - u_shimmerAt) * 3.5, 2.0));
        float width = 1.1 + shimmer * 1.2;
        float split = element.x * 0.012 / pixel;
        vec3 edge = vec3(stroke(off - split, width), stroke(off, width), stroke(off + split, width));
        float sliver = pow(max(turned, 0.0), 16.0 - shimmer * 8.0);
        glass += edge * vec3(0.85, 0.9, 1.0) * (0.014 + sliver * (0.5 + 0.7 * shimmer)) * u_catch * u_room;
        float caught = pow(max(-turned, 0.0), 2.0) * 0.6 + 0.02 + 0.5 * echo(element.x * 0.4).x;
        glass += burn(u_lamp * 0.9, response) * stroke(off, width + 1.0) * caught * 0.25 * u_catch;
      }
    }
    light += glass * inside;
  }

  finish(light, max(cover, shadow));
}`

const UNIFORMS = ['lamp', 'focus', 'spread', 'catch', 'room', 'shimmer', 'shimmerAt', 'sheen', 'slivers', 'depth'] as const

const slivers = new Float32Array(ELEMENTS.length * 2)

export const LENS: Drawing<(typeof UNIFORMS)[number]> = {
  fragment: FRAGMENT,
  size: LENS_SIZE,
  reach: 1.12,
  uniforms: UNIFORMS,
  set(gl, at, { lens }) {
    gl.uniform1f(at.lamp, lens.lamp)
    gl.uniform1f(at.focus, lens.focus)
    gl.uniform1f(at.spread, lens.spread)
    gl.uniform1f(at.catch, lens.catch)
    gl.uniform1f(at.room, lens.room)
    gl.uniform1f(at.shimmer, lens.shimmer)
    gl.uniform1f(at.shimmerAt, lens.shimmerAt)
    gl.uniform2f(at.sheen, Math.cos(lens.sheen), Math.sin(lens.sheen))
    ELEMENTS.forEach((element, index) => {
      slivers[index * 2] = Math.cos(element.catches + lens.turn * element.turn)
      slivers[index * 2 + 1] = Math.sin(element.catches + lens.turn * element.turn)
    })
    gl.uniform2fv(at.slivers, slivers)
    gl.uniform2f(at.depth, lens.depth[0], lens.depth[1])
  }
}
