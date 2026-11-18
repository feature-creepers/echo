import { burn, css, lampResponse, light, type Rgb } from './color.ts'
import { ELEMENTS, GLASS, LENS_SIZE } from './lens-shader.ts'
import type { LensPose } from './life.ts'

/**
 * The lens drawn the simpler way, on a 2D canvas, as the shader draws it (`lens-shader.ts`) with less: what does
 * not move (the shadow, the metal, the dark glass and the window it reflects) is drawn once for a size and kept;
 * each frame adds the turning highlights of the metal, the lamp, and the light its elements catch.
 *
 * It draws in the shader's space: the origin in the middle and up as up, so angles turn counter-clockwise.
 */

/** A number from 0 to 1 fixed by another, the same every time. */
const random = (seed: number) => {
  const wave = Math.sin(seed * 12.9898) * 43758.5453
  return wave - Math.floor(wave)
}

/** The lamp's light at a distance from it, in glass radii, as the shader works it out. */
function lampAt(distance: number, lens: LensPose) {
  const focus = lens.focus
  const intensity =
    46 * Math.exp(-(distance * distance) / (focus * focus)) +
    6 / (1 + (distance * distance) / (4 * focus * focus)) ** 1.3 +
    1.8 * Math.exp(-distance / (0.22 * lens.spread)) +
    0.14 * Math.exp(-distance / (0.4 * lens.spread))
  const edge = Math.min(1, Math.max(0, (distance - 0.5) / 0.5))
  return intensity * lens.lamp * (1 - 0.9 * edge * edge * (3 - 2 * edge))
}

/**
 * The turned metal's highlights round the ring, from the light's direction: a strong wedge along the light, a
 * weaker one opposite, and two faint ones across it.
 */
const SHEEN = [
  [0, 0.3],
  [0.07, 0],
  [0.275, 0],
  [0.31, 0.06],
  [0.345, 0],
  [0.44, 0],
  [0.5, 0.14],
  [0.56, 0],
  [0.775, 0],
  [0.81, 0.06],
  [0.845, 0],
  [0.93, 0],
  [1, 0.3]
] as const

/** Where along the glass the lamp's gradient changes, in glass radii: close together where it changes fast. */
const LAMP_STOPS = [0, 0.03, 0.06, 0.09, 0.12, 0.16, 0.2, 0.26, 0.34, 0.44, 0.56, 0.7, 0.85, 1]

function drawBase(side: number) {
  const canvas = new OffscreenCanvas(side, side)
  const context = canvas.getContext('2d')
  if (!context) return canvas.transferToImageBitmap()
  const radius = (side / 2) * LENS_SIZE
  const glass = radius * GLASS
  context.translate(side / 2, side / 2)
  context.scale(1, -1)

  // The shadow on the ground, a little below.
  const shadow = context.createRadialGradient(0, -radius * 0.025, radius * 0.97, 0, -radius * 0.025, radius * 1.1)
  shadow.addColorStop(0, 'rgb(0 0 0 / 0.45)')
  shadow.addColorStop(1, 'rgb(0 0 0 / 0)')
  context.fillStyle = shadow
  context.beginPath()
  context.arc(0, -radius * 0.025, radius * 1.1, 0, Math.PI * 2)
  context.fill()

  // The metal ring: a rolled profile, lit from the upper left, with fine turned grooves.
  const ring = new Path2D()
  ring.arc(0, 0, radius, 0, Math.PI * 2)
  ring.arc(0, 0, glass, 0, Math.PI * 2, true)
  const profile = context.createRadialGradient(0, 0, glass, 0, 0, radius)
  profile.addColorStop(0, '#08090b')
  profile.addColorStop(0.12, '#1b1d21')
  profile.addColorStop(0.6, '#26292e')
  profile.addColorStop(0.86, '#2f3238')
  profile.addColorStop(1, '#121316')
  context.fillStyle = profile
  context.fill(ring)
  const key = context.createLinearGradient(-radius, radius, radius, -radius)
  key.addColorStop(0, 'rgb(255 255 255 / 0.09)')
  key.addColorStop(0.5, 'rgb(255 255 255 / 0)')
  key.addColorStop(1, 'rgb(0 0 0 / 0.35)')
  context.fillStyle = key
  context.fill(ring)
  const width = radius - glass
  if (width > 8) {
    for (let groove = glass + 1.5; groove < radius - 1; groove += 1.5) {
      context.strokeStyle = `rgb(255 255 255 / ${(0.012 + 0.03 * random(groove)).toFixed(3)})`
      context.lineWidth = 0.6
      context.beginPath()
      context.arc(0, 0, groove, 0, Math.PI * 2)
      context.stroke()
    }
  }
  // A dark seam where the ring steps down into the glass.
  context.strokeStyle = 'rgb(0 0 0 / 0.85)'
  context.lineWidth = 1.5
  context.beginPath()
  context.arc(0, 0, glass + 0.75, 0, Math.PI * 2)
  context.stroke()

  // The black glass, a little lighter at its top and at its very edge, where it reflects the room.
  context.save()
  context.beginPath()
  context.arc(0, 0, glass, 0, Math.PI * 2)
  context.clip()
  context.fillStyle = '#030406'
  context.fillRect(-glass, -glass, glass * 2, glass * 2)
  const room = context.createLinearGradient(0, glass, 0, -glass * 0.2)
  room.addColorStop(0, 'rgb(205 216 238 / 0.05)')
  room.addColorStop(1, 'rgb(205 216 238 / 0)')
  context.fillStyle = room
  context.fillRect(-glass, -glass, glass * 2, glass * 2)
  const rim = context.createRadialGradient(0, 0, glass * 0.8, 0, 0, glass)
  rim.addColorStop(0, 'rgb(180 192 214 / 0)')
  rim.addColorStop(1, 'rgb(180 192 214 / 0.07)')
  context.fillStyle = rim
  context.fillRect(-glass, -glass, glass * 2, glass * 2)

  // The window on the upper left, and a fainter light on the lower right, both drawn out along the curve of the glass.
  context.filter = `blur(${Math.max(1, glass * 0.035).toFixed(1)}px)`
  const reflect = (x: number, y: number, long: number, short: number, alpha: number) => {
    context.save()
    context.translate(x * glass, y * glass)
    context.rotate(Math.atan2(y, x) + Math.PI / 2)
    const fade = context.createLinearGradient(0, -short * glass, 0, short * glass)
    fade.addColorStop(0, `rgb(215 225 240 / ${alpha * 0.35})`)
    fade.addColorStop(1, `rgb(215 225 240 / ${alpha})`)
    context.fillStyle = fade
    context.beginPath()
    context.roundRect(-long * glass, -short * glass, long * glass * 2, short * glass * 2, short * glass * 0.6)
    context.fill()
    context.restore()
  }
  reflect(-0.43, 0.45, 0.2, 0.1, 0.16)
  reflect(0.5, -0.52, 0.16, 0.025, 0.08)
  context.restore()
  // A bitmap is what a canvas draws fastest, every frame.
  return canvas.transferToImageBitmap()
}

export interface LensPainting {
  paint(context: CanvasRenderingContext2D, lens: LensPose, accent: Rgb, side: number, scale: number): void
}

export function createLensPainting(): LensPainting {
  let base: ImageBitmap | undefined

  return {
    paint(context, lens, accent, side, scale) {
      if (base?.width !== side) base = drawBase(side)
      const radius = (side / 2) * LENS_SIZE
      const glass = radius * GLASS
      const response = lampResponse(accent)
      context.save()
      context.translate(side / 2, side / 2)
      context.scale(scale, scale)
      context.drawImage(base, -side / 2, -side / 2)
      context.scale(1, -1)
      context.globalCompositeOperation = 'lighter'

      // The turned metal's highlights: two wedges along the light and two fainter ones across it, turning slowly.
      const ring = new Path2D()
      ring.arc(0, 0, radius, 0, Math.PI * 2)
      ring.arc(0, 0, glass, 0, Math.PI * 2, true)
      const sheen = context.createConicGradient(lens.sheen, 0, 0)
      for (const [stop, strength] of SHEEN) sheen.addColorStop(stop, `rgb(222 230 244 / ${(strength * lens.room).toFixed(3)})`)
      context.fillStyle = sheen
      context.fill(ring)
      // The lamp lights the ring's inner lip from inside the glass.
      context.strokeStyle = css(burn(lens.lamp * 0.5, response), 0.16)
      context.lineWidth = Math.max(1, (radius - glass) * 0.18)
      context.beginPath()
      context.arc(0, 0, glass + context.lineWidth / 2 + 1, 0, Math.PI * 2)
      context.stroke()

      // The lamp, deep in the glass: the same light as the shader's, from its heart to the edge of the glass.
      const [x, y] = [lens.depth[0] * glass, lens.depth[1] * glass]
      const lamp = context.createRadialGradient(x, y, 0, x, y, glass)
      for (const stop of LAMP_STOPS) lamp.addColorStop(stop, light(burn(lampAt(stop, lens), response)))
      context.fillStyle = lamp
      context.beginPath()
      context.arc(0, 0, glass, 0, Math.PI * 2)
      context.fill()

      // The lens elements: a faint full edge each, a sliver of the window where it catches it, and the lamp's
      // light on its far side. The shimmer of thinking runs through them from the outside in.
      const caught = burn(lens.lamp * 0.9, response)
      ELEMENTS.forEach((element, index) => {
        const shimmer = lens.shimmer * Math.exp(-(((index / 3 - lens.shimmerAt) * 3.5) ** 2))
        const centre: [number, number] = [lens.depth[0] * element.depth * glass, lens.depth[1] * element.depth * glass]
        const at = element.radius * glass
        const facing = element.catches + lens.turn * element.turn
        context.lineWidth = 1.1 + shimmer * 1.2
        context.strokeStyle = `rgb(217 230 255 / ${0.014 * lens.catch * lens.room})`
        context.beginPath()
        context.arc(centre[0], centre[1], at, 0, Math.PI * 2)
        context.stroke()
        const arcs = (around: number, span: number, steps: number, alpha: (angle: number) => number, color: [number, number, number]) => {
          for (let step = 0; step < steps; step++) {
            const from = around - span + (step / steps) * span * 2
            const to = from + (span * 2) / steps
            context.strokeStyle = css(color, alpha((from + to) / 2 - around))
            context.beginPath()
            context.arc(centre[0], centre[1], at, from, to)
            context.stroke()
          }
        }
        arcs(facing, 0.6, 8, (angle) => Math.max(0, Math.cos(angle)) ** (16 - shimmer * 8) * (0.5 + 0.7 * shimmer) * lens.catch * lens.room, [0.85, 0.9, 1])
        arcs(facing + Math.PI, 1.2, 6, (angle) => (Math.max(0, Math.cos(angle)) ** 2 * 0.6 + 0.02) * 0.25 * lens.catch, caught)
      })
      context.restore()
    }
  }
}
