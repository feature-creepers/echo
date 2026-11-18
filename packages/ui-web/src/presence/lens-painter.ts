import { burn, css, light, type Rgb } from './color.ts'
import { CATCHES, ELEMENTS, GLASS, LENS_SIZE, PANELS } from './lens-shader.ts'
import type { LensPose } from './life.ts'

/**
 * The lens drawn the simpler way, on a 2D canvas, as the shader draws it (`lens-shader.ts`) with less: what does
 * not move (the shadow, the dark dome, the room's panels of light along its top and the line of its rim) is drawn
 * once for a size and kept; each frame adds the lamp's red and its disc of amber, the catchlights over it, and the
 * light the elements catch.
 *
 * It draws in the shader's space: the origin in the middle and up as up, so angles turn counter-clockwise.
 */

/** The lamp's red: the accent, deepened until only its own colour is left, as the shader works it out. */
function hueOf([red, green, blue]: Rgb): [number, number, number] {
  const deep = [red, green, blue].map((channel) => (channel / 255) ** 3.2)
  const strongest = Math.max(...deep, 1e-4)
  return deep.map((channel) => channel / strongest) as [number, number, number]
}

/** The lamp's red at a distance from its middle, in glass radii, as the shader works it out. */
function redAt(distance: number, lens: LensPose) {
  const near = Math.exp(-((Math.max(distance - lens.heart, 0) / (0.14 * lens.iris)) ** 1.15))
  const haze = Math.exp(-distance / (0.5 * lens.iris))
  const edge = Math.min(1, Math.max(0, (distance - 0.55) / 0.43))
  return lens.lamp * (1.75 * near + 0.95 * haze) * (1 - 0.9 * edge * edge * (3 - 2 * edge))
}

/** Where the lamp's gradient changes, in glass radii: close together where it changes fast. */
const LAMP_STOPS = [0, 0.06, 0.09, 0.11, 0.14, 0.18, 0.23, 0.3, 0.38, 0.48, 0.6, 0.74, 0.88, 1]

function drawBase(side: number) {
  const canvas = new OffscreenCanvas(side, side)
  const context = canvas.getContext('2d')
  if (!context) return canvas.transferToImageBitmap()
  const glass = (side / 2) * LENS_SIZE * GLASS
  context.translate(side / 2, side / 2)
  context.scale(1, -1)

  // The shadow on the ground, a little below.
  const shadow = context.createRadialGradient(0, -glass * 0.03, glass * 0.96, 0, -glass * 0.03, glass * 1.1)
  shadow.addColorStop(0, 'rgb(0 0 0 / 0.5)')
  shadow.addColorStop(1, 'rgb(0 0 0 / 0)')
  context.fillStyle = shadow
  context.beginPath()
  context.arc(0, -glass * 0.03, glass * 1.1, 0, Math.PI * 2)
  context.fill()

  // The dark dome, a little lighter towards its top, where it reflects the room.
  context.save()
  context.beginPath()
  context.arc(0, 0, glass, 0, Math.PI * 2)
  context.clip()
  context.fillStyle = '#030406'
  context.fillRect(-glass, -glass, glass * 2, glass * 2)
  const room = context.createLinearGradient(0, glass, 0, -glass * 0.2)
  room.addColorStop(0, 'rgb(128 184 250 / 0.035)')
  room.addColorStop(1, 'rgb(128 184 250 / 0)')
  context.fillStyle = room
  context.fillRect(-glass, -glass, glass * 2, glass * 2)

  // The room's panels of cool light along the top of the dome, each a soft arc, whiter at its heart.
  context.filter = `blur(${Math.max(1, glass * 0.025).toFixed(1)}px)`
  context.lineCap = 'round'
  for (const [at, out, wide, bright] of PANELS) {
    context.lineWidth = glass * 0.1
    context.strokeStyle = `rgb(150 200 255 / ${(bright * 0.34).toFixed(3)})`
    context.beginPath()
    context.arc(0, 0, out * glass, at - wide * 0.8, at + wide * 0.8)
    context.stroke()
    context.lineWidth = glass * 0.045
    context.strokeStyle = `rgb(220 238 255 / ${(bright * 0.4).toFixed(3)})`
    context.beginPath()
    context.arc(0, 0, out * glass, at - wide * 0.55, at + wide * 0.55)
    context.stroke()
  }
  context.filter = 'none'
  context.restore()

  // The rim: a fine line of cool light along the top of the dome, fading down its sides.
  const rim = context.createLinearGradient(0, glass, 0, -glass * 0.15)
  rim.addColorStop(0, 'rgb(158 204 255 / 0.22)')
  rim.addColorStop(1, 'rgb(158 204 255 / 0)')
  context.strokeStyle = rim
  context.lineWidth = 1
  context.beginPath()
  context.arc(0, 0, glass - 1.2, 0, Math.PI * 2)
  context.stroke()
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
      const glass = (side / 2) * LENS_SIZE * GLASS
      const hue = hueOf(accent)
      const red: [number, number, number] = [hue[0], hue[1] + 0.02, hue[2] + 0.012]
      const amber: [number, number, number] = [hue[0], hue[1] + 0.3, hue[2] + 0.03]
      context.save()
      context.translate(side / 2, side / 2)
      context.scale(scale, scale)
      context.drawImage(base, -side / 2, -side / 2)
      context.scale(1, -1)
      context.globalCompositeOperation = 'lighter'

      // The lamp, deep in the glass: the same red as the shader's, from the disc to the edge of the glass.
      const [x, y] = [lens.depth[0] * glass, lens.depth[1] * glass]
      const lamp = context.createRadialGradient(x, y, 0, x, y, glass)
      for (const stop of LAMP_STOPS) lamp.addColorStop(stop, light(burn(redAt(stop, lens), red)))
      context.fillStyle = lamp
      context.beginPath()
      context.arc(0, 0, glass, 0, Math.PI * 2)
      context.fill()

      // The disc of amber over it, its edge soft over a pixel or two.
      context.globalCompositeOperation = 'source-over'
      const heart = lens.heart * glass
      const disc = context.createRadialGradient(x, y, 0, x, y, heart + 1)
      for (const stop of [0, 0.3, 0.6, 0.85, 1]) {
        const middle = Math.exp(-((stop * stop) / 0.35))
        disc.addColorStop(stop, css(burn(lens.lamp * (2.6 + 2.4 * middle), amber), stop === 1 ? 0 : 1))
      }
      context.fillStyle = disc
      context.beginPath()
      context.arc(x, y, heart + 1, 0, Math.PI * 2)
      context.fill()
      context.globalCompositeOperation = 'lighter'

      // The catchlights over the lamp: rounded strokes of cool light, two rows.
      context.lineCap = 'round'
      context.lineWidth = Math.max(1.2, glass * 0.026)
      for (const [at, out, wide, bright] of CATCHES) {
        context.strokeStyle = `rgb(168 220 255 / ${(bright * lens.room * Math.min(lens.catch, 1.6) * 0.7).toFixed(3)})`
        context.beginPath()
        context.arc(x, y, out * lens.heart * 10 * glass, at - wide * 0.7, at + wide * 0.7)
        context.stroke()
      }
      context.lineCap = 'butt'

      // The lens elements: a faint full edge each, and the lamp's red on its far side. The shimmer of thinking runs
      // through them from the outside in.
      const caught = burn(lens.lamp * 0.9, hue)
      ELEMENTS.forEach((element, index) => {
        const shimmer = lens.shimmer * Math.exp(-(((index / 3 - lens.shimmerAt) * 3.5) ** 2))
        const centre: [number, number] = [lens.depth[0] * element.depth * glass, lens.depth[1] * element.depth * glass]
        const at = element.radius * lens.focus * glass
        const facing = element.catches + lens.turn * element.turn
        context.lineWidth = 1.1 + shimmer * 1.2
        context.strokeStyle = css(caught, (0.04 + (lens.voice[index] ?? 0) * 0.5) * lens.catch)
        context.beginPath()
        context.arc(centre[0], centre[1], at, 0, Math.PI * 2)
        context.stroke()
        context.strokeStyle = css(caught, 0.14 * lens.catch)
        context.beginPath()
        context.arc(centre[0], centre[1], at, facing + Math.PI - 0.9, facing + Math.PI + 0.9)
        context.stroke()
      })
      context.restore()
    }
  }
}
