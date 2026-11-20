import { burn, css, light, type Rgb } from './color.ts'
import { SEAT as GLASS, LENS_SIZE } from './lens-shader.ts'
import type { LensPose } from './life.ts'

/**
 * The lens drawn the simpler way, on a 2D canvas, flat where the shader traces it in space (`lens-shader.ts`): what
 * does not move (the shadow, the seat, the smoky dome, its softboxes and glint and the line of its rim) is drawn once
 * for a size and kept; each frame adds the lamp's red and its disc of amber, the catchlights over it, and the light
 * the elements catch.
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

/**
 * The lens elements inside the glass, as this flat drawing shows them, from the front to the back: each edge's radius
 * as a share of the glass, how deep it sits (the deeper, the further it shifts as the lens looks about), which light
 * its edge catches, where it catches it, in radians, how fast that turns, and how much of it.
 */
const ELEMENTS = [
  { radius: 0.9, depth: 0.08, coat: 0, catches: 2.3, turn: 0.6, strength: 0.55 },
  { radius: 0.76, depth: 0.22, coat: 1, catches: 5.45, turn: -0.9, strength: 0.7 },
  { radius: 0.63, depth: 0.38, coat: 2, catches: 2.0, turn: 1.1, strength: 0.6 },
  { radius: 0.5, depth: 0.55, coat: 1, catches: 5.75, turn: -1.3, strength: 0.55 },
  { radius: 0.38, depth: 0.72, coat: 3, catches: 2.65, turn: 0.8, strength: 0.5 },
  { radius: 0.27, depth: 0.88, coat: 3, catches: 5.1, turn: -1.1, strength: 0.45 }
] as const

/** The light an element's edge catches from the room: a cool white on the front ones, the lamp's warmth on the deep. */
const COATS = [
  [0.74, 0.86, 1],
  [0.74, 0.86, 1],
  [0.86, 0.9, 1],
  [1, 0.66, 0.56]
] as const

/**
 * The lights of the room's ceiling as the dome reflects them here, drawn as bands that follow its curve: where round
 * the glass, in radians, their half-width, how far in they fade from and how far out their edge is, and how bright.
 */
const SOFTBOXES = [
  [2.28, 0.62, 0.56, 0.915, 0.26],
  [0.72, 0.32, 0.7, 0.895, 0.11]
] as const

/** One small glint of the room's light on the dome, as a point on it, and how bright it is. */
const GLINT = [-0.46, 0.5, 0.55] as const

/**
 * The catchlights over the lamp: where round the lamp, in radians, how far out, as a share of ten of the disc's
 * radii, their half-width round it, and how bright. Two rows, the nearer three brighter.
 */
const CATCHES = [
  [1.08, 0.2, 0.2, 0.7],
  [1.57, 0.205, 0.26, 0.85],
  [2.06, 0.2, 0.2, 0.7],
  [0.72, 0.262, 0.16, 0.42],
  [1.25, 0.272, 0.2, 0.6],
  [1.89, 0.272, 0.2, 0.6],
  [2.42, 0.262, 0.16, 0.42]
] as const

/** The seat's polish round it, from the way the room's light comes: a wedge along it, and a fainter one opposite. */
const POLISH = [
  [0, 0.16],
  [0.06, 0.07],
  [0.13, 0],
  [0.37, 0],
  [0.44, 0.035],
  [0.5, 0.08],
  [0.56, 0.035],
  [0.63, 0],
  [0.87, 0],
  [0.94, 0.07],
  [1, 0.16]
] as const

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
  const outer = (side / 2) * LENS_SIZE
  const shadow = context.createRadialGradient(0, -outer * 0.03, outer * 0.97, 0, -outer * 0.03, outer * 1.12)
  shadow.addColorStop(0, 'rgb(0 0 0 / 0.42)')
  shadow.addColorStop(1, 'rgb(0 0 0 / 0)')
  context.fillStyle = shadow
  context.beginPath()
  context.arc(0, -outer * 0.03, outer * 1.12, 0, Math.PI * 2)
  context.fill()

  // The seat: a flat ring of dark anodised metal round the glass; its polish is drawn each frame, as it turns with
  // the room's light.
  const seat = new Path2D()
  seat.arc(0, 0, outer, 0, Math.PI * 2)
  seat.arc(0, 0, glass, 0, Math.PI * 2, true)
  context.fillStyle = '#0d1118'
  context.fill(seat)
  context.strokeStyle = 'rgb(0 0 0 / 0.5)'
  context.lineWidth = 1
  context.beginPath()
  context.arc(0, 0, glass + 0.5, 0, Math.PI * 2)
  context.stroke()

  // The smoky dome, a little lighter towards its edge and its top, where it reflects the room.
  context.save()
  context.beginPath()
  context.arc(0, 0, glass, 0, Math.PI * 2)
  context.clip()
  const smoke = context.createRadialGradient(0, 0, 0, 0, 0, glass)
  smoke.addColorStop(0, '#040608')
  smoke.addColorStop(0.7, '#06080c')
  smoke.addColorStop(1, '#0c1118')
  context.fillStyle = smoke
  context.fillRect(-glass, -glass, glass * 2, glass * 2)
  const room = context.createLinearGradient(0, glass, 0, -glass * 0.2)
  room.addColorStop(0, 'rgb(128 184 250 / 0.035)')
  room.addColorStop(1, 'rgb(128 184 250 / 0)')
  context.fillStyle = room
  context.fillRect(-glass, -glass, glass * 2, glass * 2)

  // The softboxes along the dome's curve, crisp at their outer edge and fading inwards, and the one small glint.
  for (const [at, wide, from, edge, bright] of SOFTBOXES) {
    const band = context.createRadialGradient(0, 0, from * glass, 0, 0, edge * glass)
    band.addColorStop(0, 'rgb(110 170 255 / 0)')
    band.addColorStop(0.7, `rgb(150 196 255 / ${(bright * 0.45).toFixed(3)})`)
    band.addColorStop(1, `rgb(225 240 255 / ${bright.toFixed(3)})`)
    context.fillStyle = band
    context.beginPath()
    context.arc(0, 0, edge * glass, at - wide * 0.8, at + wide * 0.8)
    context.arc(0, 0, from * glass, at + wide * 0.8, at - wide * 0.8, true)
    context.closePath()
    context.fill()
  }
  const [glintX, glintY, glintBright] = GLINT
  const glint = context.createRadialGradient(glintX * glass, glintY * glass, 0, glintX * glass, glintY * glass, glass * 0.05)
  glint.addColorStop(0, `rgb(235 245 255 / ${glintBright.toFixed(3)})`)
  glint.addColorStop(1, 'rgb(235 245 255 / 0)')
  context.fillStyle = glint
  context.fillRect(-glass, -glass, glass * 2, glass * 2)
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

interface LensPainting {
  paint(context: CanvasRenderingContext2D, lens: LensPose, accent: Rgb, side: number, scale: number): void
}

export function createLensPainting(): LensPainting {
  let base: ImageBitmap | undefined

  return {
    paint(context, lens, accent, side, scale) {
      if (base?.width !== side) {
        base?.close()
        base = drawBase(side)
      }
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

      // The seat's polish: two soft wedges of the room's light along the way it comes, the far one fainter.
      const outer = (side / 2) * LENS_SIZE
      const seat = new Path2D()
      seat.arc(0, 0, outer, 0, Math.PI * 2)
      seat.arc(0, 0, glass, 0, Math.PI * 2, true)
      const polish = context.createConicGradient(lens.sheen, 0, 0)
      for (const [stop, strength] of POLISH) polish.addColorStop(stop, `rgb(150 178 214 / ${(strength * lens.room).toFixed(3)})`)
      context.fillStyle = polish
      context.fill(seat)

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

      // The optical stack: a faint full edge each, the lamp's red on its far side, and the thin crescent of its
      // coating's colour on the side that faces the room's light. The shimmer of thinking runs through them.
      const caught = burn(lens.lamp * 0.9, hue)
      ELEMENTS.forEach((element, index) => {
        const order = index / (ELEMENTS.length - 1)
        const shimmer = lens.shimmer * Math.exp(-(((order - lens.shimmerAt) * 3.2) ** 2))
        const centre: [number, number] = [lens.depth[0] * element.depth * glass, lens.depth[1] * element.depth * glass]
        const at = element.radius * lens.focus * glass
        const facing = element.catches + lens.turn * element.turn
        context.lineWidth = 1.1 + shimmer * 1.2
        const voice = lens.voice[Math.min(3, Math.floor((index * 4) / ELEMENTS.length))] ?? 0
        context.strokeStyle = css(caught, (0.04 + voice * 0.5) * lens.catch * element.strength)
        context.beginPath()
        context.arc(centre[0], centre[1], at, 0, Math.PI * 2)
        context.stroke()
        context.strokeStyle = css(caught, 0.14 * lens.catch * element.strength)
        context.beginPath()
        context.arc(centre[0], centre[1], at, facing + Math.PI - 0.9, facing + Math.PI + 0.9)
        context.stroke()
        const coat = COATS[element.coat] ?? COATS[0]
        context.lineWidth = 2.5 + shimmer * 1.5
        context.strokeStyle = css(coat, (0.22 + 0.25 * shimmer) * lens.catch * lens.room * element.strength)
        context.beginPath()
        context.arc(centre[0], centre[1], Math.max(1, at - 1.8), facing - 0.75, facing + 0.75)
        context.stroke()
      })
      context.restore()
    }
  }
}
