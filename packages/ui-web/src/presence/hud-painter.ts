import { burn, css, light, type Rgb } from './color.ts'
import { HUD_ARCS, HUD_SIZE, meterBars, HUD_RADII as RADII } from './hud-shader.ts'
import { BANDS, ECHO_STEP, type Pose } from './life.ts'

/**
 * The instrument drawn the simpler way, on a 2D canvas, as the shader draws it (`hud-shader.ts`): the same rings
 * at the same radii, turning at the same paces. Each ring's shape is made once for a size and only turned each
 * frame; the meter, the scan and the core, which follow the voice and the moods, are drawn fresh.
 *
 * It draws in the shader's space: the origin in the middle and up as up, so angles turn counter-clockwise.
 */

const TAU = Math.PI * 2

/** The shader's hash, so both drawings break their rings in the same places. */
function hash(x: number, y: number) {
  const fraction = (value: number) => value - Math.floor(value)
  let a = fraction(x * 0.1031)
  let b = fraction(y * 0.1031)
  let c = fraction(x * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fraction((a + b) * c)
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** An arc from one share of a turn to another. */
function arc(path: Path2D, radius: number, from: number, to: number) {
  path.moveTo(Math.cos(from * TAU) * radius, Math.sin(from * TAU) * radius)
  path.arc(0, 0, radius, from * TAU, to * TAU)
}

/** A line out from the centre, at a share of a turn, between two radii. */
function spoke(path: Path2D, around: number, inner: number, outer: number) {
  const [x, y] = [Math.cos(around * TAU), Math.sin(around * TAU)]
  path.moveTo(x * inner, y * inner)
  path.lineTo(x * outer, y * outer)
}

/** The fine hairline rings between the main ones, as the shader draws them. */
const HAIRLINES = [0.315, 0.405, RADII.rule] as const

/** How far the bezel's ticks hang in: the plain ones, every sixth, and every thirtieth. */
const TICK_LENGTHS = [0.012, 0.02, 0.034] as const

/** Every ring's shape for one size, in device pixels, before it turns. */
function shapes(radius: number) {
  const broken = new Path2D()
  for (let index = 0; index < 3; index++) arc(broken, RADII.broken * radius, index / 3 + 0.018, (index + 1) / 3 - 0.018)

  const band = new Path2D()
  const lit = new Path2D()
  for (let index = 0; index < 16; index++) {
    const before = hash((index + 15) % 16, 3) >= 0.45 ? 0.006 : 0
    const after = hash(index, 3) >= 0.45 ? 0.006 : 0
    arc(hash(index, 9) >= 0.72 ? lit : band, RADII.band * radius, index / 16 + before, (index + 1) / 16 - after)
  }

  const ticks = [new Path2D(), new Path2D(), new Path2D()] as const
  for (let index = 0; index < 120; index++) {
    const kind = index % 30 === 0 ? 2 : index % 6 === 0 ? 1 : 0
    spoke(ticks[kind], index / 120, (RADII.bezel - TICK_LENGTHS[kind]) * radius, RADII.bezel * radius)
  }
  const markers = new Path2D()
  for (let index = 0; index < 4; index++) {
    const around = (index + 0.5) / 4
    const half = (0.017 * radius) / (RADII.bezel * radius)
    const [inner, outer] = [(RADII.bezel - 0.03) * radius, RADII.bezel * radius]
    markers.moveTo(Math.cos((around - half / TAU) * TAU) * outer, Math.sin((around - half / TAU) * TAU) * outer)
    markers.lineTo(Math.cos(around * TAU) * inner, Math.sin(around * TAU) * inner)
    markers.lineTo(Math.cos((around + half / TAU) * TAU) * outer, Math.sin((around + half / TAU) * TAU) * outer)
    markers.closePath()
  }

  const data = new Path2D()
  const blocks = new Path2D()
  for (let index = 0; index < 36; index++) {
    if (hash(index, 17) < 0.3) {
      arc(data, RADII.data * radius, index / 36, (index + 0.15) / 36)
      arc(data, RADII.data * radius, (index + 0.85) / 36, (index + 1) / 36)
    } else arc(data, RADII.data * radius, index / 36, (index + 1) / 36)
    if (hash(index, 23) > 0.84) arc(blocks, RADII.data * radius, (index + 0.3) / 36, (index + 0.7) / 36)
  }

  const arcs = new Path2D()
  const caps = new Path2D()
  for (const [from, to] of HUD_ARCS) {
    arc(arcs, RADII.arcs * radius, from, to)
    spoke(caps, from, (RADII.arcs - 0.02) * radius, (RADII.arcs + 0.02) * radius)
    spoke(caps, to, (RADII.arcs - 0.02) * radius, (RADII.arcs + 0.02) * radius)
  }

  const frame = new Path2D()
  frame.arc(0, 0, RADII.frame * radius, 0, TAU)
  const frameTicks = new Path2D()
  for (let index = 0; index < 8; index++) spoke(frameTicks, index / 8, RADII.frame * radius, (RADII.frame + 0.025) * radius)

  return { broken, band, lit, ticks, markers, data, blocks, arcs, caps, frame, frameTicks }
}

/** The dark field behind the rings, drawn once for a size. */
function field(radius: number) {
  const side = Math.ceil(radius * 2)
  const canvas = new OffscreenCanvas(side, side)
  const context = canvas.getContext('2d')
  if (!context) return canvas.transferToImageBitmap()
  const shade = context.createRadialGradient(radius, radius, radius * 0.3, radius, radius, radius * 0.98)
  shade.addColorStop(0, 'rgb(0 0 0 / 0.55)')
  shade.addColorStop(1, 'rgb(0 0 0 / 0)')
  context.fillStyle = shade
  context.fillRect(0, 0, side, side)
  // A bitmap is what a canvas draws fastest, every frame.
  return canvas.transferToImageBitmap()
}

export interface HudPainting {
  paint(context: CanvasRenderingContext2D, pose: Pose, accent: Rgb, side: number, scale: number): void
}

export function createHudPainting(): HudPainting {
  let made: { side: number; shapes: ReturnType<typeof shapes>; field: ImageBitmap } | undefined

  return {
    paint(context, pose, accent, side, scale) {
      const radius = (side / 2) * HUD_SIZE
      if (made?.side !== side) made = { side, shapes: shapes(radius), field: field(radius) }
      const ring = made.shapes
      const { hud } = pose
      const color = accent.map((channel) => channel / 255) as [number, number, number]
      const whiter = color.map((channel) => channel + (1 - channel) * 0.3) as [number, number, number]
      // Far out, the accent sinks to a deeper, bluer shade of itself, as the shader draws it.
      const deep = [color[0] * 0.7, color[1] * 0.86, color[2]] as [number, number, number]
      const fine = smoothstep(40, 80, radius)
      const lesser = smoothstep(22, 44, radius)
      const rings = hud.rings

      context.save()
      context.translate(side / 2, side / 2)
      context.scale(scale, -scale)

      // A faint dark field behind the rings, so the ground's dots do not show through the finest of them.
      const weight = context.globalAlpha
      context.globalAlpha = weight * Math.max(rings, 0.3)
      context.drawImage(made.field, -radius, -radius)
      context.globalAlpha = weight
      context.globalCompositeOperation = 'lighter'

      // The core: a tight white-hot heart, and round it the reactor, a crisp ring of light and a fainter one outside it.
      const size = hud.size
      const core = context.createRadialGradient(0, 0, 0, 0, 0, radius * 0.5)
      for (const stop of [0, 0.02, 0.04, 0.06, 0.09, 0.13, 0.18, 0.26, 0.36, 0.5, 0.7, 1]) {
        const at = stop * 0.5
        const intensity =
          hud.core *
          (11 * Math.exp(-(at * at) / (0.0006 * size * size)) + 0.8 / (1 + (at * at) / (0.0018 * size * size)) ** 1.6 + 0.06 * Math.exp(-at / (0.1 * size)))
        core.addColorStop(stop, light(burn(intensity, [color[0] + 0.08, color[1] + 0.08, color[2] + 0.08])))
      }
      context.fillStyle = core
      context.fillRect(-radius * 0.5, -radius * 0.5, radius, radius)
      context.lineWidth = 1.6
      context.strokeStyle = css(whiter, Math.min(1, 1.1 * Math.min(hud.core, 1.2)))
      context.beginPath()
      context.arc(0, 0, RADII.coreRim * size * radius, 0, TAU)
      context.stroke()
      context.lineWidth = 1
      context.strokeStyle = css(whiter, 0.35 * Math.min(hud.core, 1.2))
      context.beginPath()
      context.arc(0, 0, (RADII.coreRim + 0.025) * size * radius, 0, TAU)
      context.stroke()

      // Each ring sits a little off the others as the view drifts, by its radius, and listening they all draw in.
      const place = (at: number, turn: number) => {
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.translate(side / 2 + hud.parallax[0] * at * radius * scale, side / 2 - hud.parallax[1] * at * radius * scale)
        context.scale(scale * hud.reach, -scale * hud.reach)
        context.rotate(turn)
      }
      const stroke = (path: Path2D, width: number, tone: readonly number[], alpha: number) => {
        if (alpha < 0.004) return
        context.lineWidth = width
        context.strokeStyle = css(tone as [number, number, number], alpha)
        context.stroke(path)
      }
      const turns = hud.turns

      place(RADII.broken, turns[0] ?? 0)
      stroke(ring.broken, 1, color, 0.62 * rings * lesser)
      place(RADII.band, turns[1] ?? 0)
      const bandWidth = Math.max(0.02 * radius, 2)
      stroke(ring.band, bandWidth, color, 0.62 * rings)
      stroke(ring.lit, bandWidth, whiter, 1 * rings)
      stroke(ring.lit, bandWidth + 4, whiter, 0.06 * rings)

      // The meter: listening, its bars light from the top down both sides with the voice it hears; speaking,
      // each follows its own voice as it was a moment ago, the newest at the top.
      place(RADII.meter, 0)
      const resting = new Path2D()
      const lit = new Path2D()
      const bars = meterBars(radius)
      for (let index = 0; index < bars; index++) {
        const centre = (index + 0.5) / bars
        const fromTop = Math.min(centre, 1 - centre) * 2
        const glowing = Math.min(1, Math.max(0, (hud.gauge * 1.2 - fromTop) * 12))
        const sample = Math.min(31, Math.round((fromTop * 0.9) / ECHO_STEP))
        const note = pose.spectrum[Math.min(BANDS - 1, Math.round(fromTop * (BANDS - 1))) * 2] ?? 0
        const said = ((pose.echo[sample * 2] ?? 0) * 0.4 + note * 0.8) * hud.wave
        const reach = Math.min(RADII.meter + 0.02 + glowing * 0.03 + said * 0.07, RADII.meter + 0.095)
        spoke(glowing > 0.5 ? lit : resting, centre + 0.25, RADII.meter * radius, reach * radius)
      }
      const barWidth = Math.min(1.6, (TAU * RADII.meter * radius) / bars / 2.2)
      stroke(resting, barWidth, color, (0.3 * (0.35 + 0.65 * lesser) + hud.wave * 0.4) * rings)
      stroke(lit, barWidth, whiter, 0.8 * rings)

      place(RADII.bezel, turns[3] ?? 0)
      stroke(ring.ticks[0], 1, color, 0.38 * rings * (0.5 + 0.5 * fine))
      stroke(ring.ticks[1], 1, color, 0.55 * rings)
      stroke(ring.ticks[2], 1, whiter, 0.8 * rings)
      context.lineWidth = 0.034 * radius
      context.strokeStyle = css(color, 0.05 * rings)
      context.beginPath()
      context.arc(0, 0, (RADII.bezel - 0.017) * radius, 0, TAU)
      context.stroke()
      // Asleep, the bezel's circle is the one ring left, breathing.
      context.lineWidth = 1
      context.strokeStyle = css(color, Math.max(0.24 * rings, hud.dormant * 0.5))
      context.beginPath()
      context.arc(0, 0, RADII.bezel * radius - 0.5, 0, TAU)
      context.stroke()
      place(RADII.bezel, turns[2] ?? 0)
      context.fillStyle = css(whiter, 0.6 * rings * lesser)
      context.fill(ring.markers)

      place(RADII.data, turns[4] ?? 0)
      stroke(ring.data, 1, color, 0.45 * rings * lesser)
      stroke(ring.blocks, 3, color, 0.6 * rings * lesser)

      place(RADII.arcs, turns[5] ?? 0)
      stroke(ring.arcs, 1.5, color, 0.55 * rings)
      stroke(ring.arcs, 0.044 * radius, color, 0.06 * rings)
      stroke(ring.caps, 1, whiter, 0.4 * rings)

      // Thinking, the outer circle lights softly behind a scan that goes slowly round: no bright tip, only the light
      // passing.
      if (hud.scan > 0.01) {
        place(RADII.arcs, 0)
        const head = hud.scanAngle / TAU
        for (let step = 0; step < 18; step++) {
          const from = head + step * 0.012
          context.lineWidth = 1.5
          context.strokeStyle = css(whiter, Math.exp(-(step + 0.5) * 0.012 * 5) * 0.4 * hud.scan)
          context.beginPath()
          context.arc(0, 0, RADII.arcs * radius, from * TAU, (from + 0.012) * TAU)
          context.stroke()
        }
      }

      // Fine hairline rings between the main ones, as the scales of an instrument, and deeper in colour outwards.
      if (fine > 0.01) {
        place(0, 0)
        for (const at of HAIRLINES) {
          context.lineWidth = 1
          context.strokeStyle = css(at > 0.5 ? deep : color, 0.09 * rings * fine)
          context.beginPath()
          context.arc(0, 0, at * radius, 0, TAU)
          context.stroke()
        }
      }

      place(RADII.frame, 0)
      stroke(ring.frame, 1, deep, 0.14 * rings)
      stroke(ring.frameTicks, 1, color, 0.32 * rings * lesser)
      context.restore()
    }
  }
}
