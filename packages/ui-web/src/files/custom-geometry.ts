/**
 * A shape drawn by its own path, as PowerPoint 97 to 2003 and OpenDocument keep one (docs/SPEC.md, section 9.7). Both
 * describe it with the same commands, OfficeArt's segments and OpenDocument's `draw:enhanced-path` letters: moves,
 * lines, curves, arcs of an ellipse given by its box or by its angles, quarters of an ellipse, closing and ending a
 * path, and paths left unfilled or unstroked. The numbers are in the shape's own view box, drawn to its box in pixels.
 *
 * Every subpath is filled, an open one as if it were closed, and stroked as it is drawn, unless its path says not to
 * be, as both apps draw them.
 */

import { number } from './slide-svg.ts'

/** A command of a shape's own path, by its letter (`M`, `L`, `C`, `Z`, `N`, `F`, `S`, `T`, `U`, `A`, `B`, `V`, `W`, `X`, `Y`, `Q`, `G`), with its numbers. */
export interface PathCommand {
  command: string
  values: number[]
}

/** A shape's own path as SVG path data: what is filled, and what is stroked. */
export interface CustomGeometry {
  fill: string
  stroke: string
}

/** The view box a path's numbers are in. */
export interface ViewBox {
  left: number
  top: number
  width: number
  height: number
}

/** How many numbers each command takes at a time, when it takes any. */
const TAKES: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, T: 6, U: 6, A: 8, B: 8, V: 8, W: 8, X: 2, Y: 2, G: 4 }

/** The most commands of one shape drawn, so a damaged shape costs little. */
const COMMAND_LIMIT = 20_000

const RADIANS = Math.PI / 180

/**
 * The commands of a shape's path in its view box, drawn in a box of `size` pixels. A shape whose view box is empty
 * draws nothing.
 */
export function customGeometry(commands: readonly PathCommand[], view: ViewBox, size: { width: number; height: number }): CustomGeometry {
  const scaleX = view.width ? size.width / view.width : 0
  const scaleY = view.height ? size.height / view.height : 0
  const x = (value: number) => (value - view.left) * scaleX
  const y = (value: number) => (value - view.top) * scaleY
  const fills: string[] = []
  const strokes: string[] = []
  // The path under way: its subpaths, and whether it is filled and stroked.
  let subpaths: string[] = []
  let filled = true
  let stroked = true
  // The subpath under way, where it started, and where the pen is.
  let data = ''
  let start: [number, number] = [0, 0]
  let pen: [number, number] = [0, 0]
  const point = (to: [number, number]) => `${number(to[0])} ${number(to[1])}`
  const endSubpath = (closed: boolean) => {
    if (data) subpaths.push(closed ? `${data}Z` : data)
    data = ''
  }
  const endPath = () => {
    endSubpath(false)
    if (filled) fills.push(...subpaths)
    if (stroked) strokes.push(...subpaths)
    subpaths = []
    filled = true
    stroked = true
  }
  const moveTo = (to: [number, number]) => {
    endSubpath(false)
    data = `M${point(to)}`
    start = to
    pen = to
  }
  const lineTo = (to: [number, number]) => {
    if (!data) return moveTo(to)
    data += `L${point(to)}`
    pen = to
  }
  /** An elliptical arc from the pen to a point, turning clockwise on the screen or not. */
  const arcTo = (to: [number, number], radiusX: number, radiusY: number, large: boolean, clockwise: boolean) => {
    if (Math.abs(radiusX) < 1e-9 || Math.abs(radiusY) < 1e-9) return lineTo(to)
    data += `A${number(Math.abs(radiusX))} ${number(Math.abs(radiusY))} 0 ${large ? 1 : 0} ${clockwise ? 1 : 0} ${point(to)}`
    pen = to
  }
  /** An arc of an ellipse by its centre and radii, between two angles in radians, counter-clockwise when they increase. */
  const ellipseArc = (centre: [number, number], radiusX: number, radiusY: number, from: number, sweep: number, join: 'move' | 'line') => {
    const at = (angle: number): [number, number] => [centre[0] + radiusX * Math.cos(angle), centre[1] - radiusY * Math.sin(angle)]
    if (join === 'move') moveTo(at(from))
    else lineTo(at(from))
    // A whole turn is drawn as two halves, since one SVG arc cannot end where it starts.
    let left = Math.min(Math.abs(sweep), 2 * Math.PI)
    let angle = from
    const direction = sweep < 0 ? -1 : 1
    while (left > 1e-9) {
      const step = Math.min(left, Math.PI)
      angle += direction * step
      arcTo(at(angle), radiusX, radiusY, false, direction < 0)
      left -= step
    }
  }

  let count = 0
  for (const { command, values } of commands) {
    if (++count > COMMAND_LIMIT) break
    const takes = TAKES[command]
    if (takes === undefined) {
      if (command === 'Z') {
        endSubpath(true)
        pen = start
      } else if (command === 'N') endPath()
      else if (command === 'F') filled = false
      else if (command === 'S') stroked = false
      continue
    }
    let quadrantX = command === 'X'
    for (let at = 0; at + takes <= values.length; at += takes) {
      const value = (index: number) => values[at + index] as number
      const pointAt = (index: number): [number, number] => [x(value(index)), y(value(index + 1))]
      switch (command) {
        case 'M':
          if (at === 0) moveTo(pointAt(0))
          else lineTo(pointAt(0))
          break
        case 'L':
          lineTo(pointAt(0))
          break
        case 'C': {
          if (!data) moveTo(pen)
          const end = pointAt(4)
          data += `C${point(pointAt(0))} ${point(pointAt(2))} ${point(end)}`
          pen = end
          break
        }
        case 'Q': {
          if (!data) moveTo(pen)
          const end = pointAt(2)
          data += `Q${point(pointAt(0))} ${point(end)}`
          pen = end
          break
        }
        case 'T':
        case 'U': {
          // An ellipse by its centre and radii, from one angle to another in degrees, counter-clockwise.
          const centre = pointAt(0)
          const from = value(4) * RADIANS
          let sweep = (value(5) - value(4)) * RADIANS
          if (sweep <= 0) sweep += 2 * Math.PI
          ellipseArc(centre, value(2) * scaleX, value(3) * scaleY, from, sweep, command === 'U' ? 'move' : 'line')
          break
        }
        case 'A':
        case 'B':
        case 'V':
        case 'W': {
          // An ellipse by its box, from where one point's ray meets it to where another's does.
          const corner = pointAt(0)
          const other = pointAt(2)
          let first = pointAt(4)
          let last = pointAt(6)
          // A box given from its far corner on one axis turns the arc around, as both apps draw it.
          if (corner[0] > other[0] !== corner[1] > other[1]) [first, last] = [last, first]
          const centre: [number, number] = [(corner[0] + other[0]) / 2, (corner[1] + other[1]) / 2]
          const radiusX = Math.abs(other[0] - corner[0]) / 2
          const radiusY = Math.abs(other[1] - corner[1]) / 2
          if (radiusX < 1e-9 || radiusY < 1e-9) {
            if (command === 'B' || command === 'V') moveTo(first)
            lineTo(last)
            break
          }
          const angleOf = (to: [number, number]) => Math.atan2(-(to[1] - centre[1]) / radiusY, (to[0] - centre[0]) / radiusX)
          const from = angleOf(first)
          const end = angleOf(last)
          const clockwise = command === 'V' || command === 'W'
          let sweep = clockwise ? from - end : end - from
          if (sweep <= 1e-9) sweep += 2 * Math.PI
          ellipseArc(centre, radiusX, radiusY, from, clockwise ? -sweep : sweep, command === 'B' || command === 'V' ? 'move' : 'line')
          break
        }
        case 'X':
        case 'Y': {
          // A quarter of an ellipse from the pen, leaving it along x first, or along y, the two taking turns.
          if (!data) moveTo(pen)
          const end = pointAt(0)
          const centre: [number, number] = quadrantX ? [pen[0], end[1]] : [end[0], pen[1]]
          const from = [pen[0] - centre[0], pen[1] - centre[1]]
          const to = [end[0] - centre[0], end[1] - centre[1]]
          const turn = (from[0] as number) * (to[1] as number) - (from[1] as number) * (to[0] as number)
          arcTo(end, Math.abs(end[0] - pen[0]), Math.abs(end[1] - pen[1]), false, turn > 0)
          quadrantX = !quadrantX
          break
        }
        case 'G': {
          // An arc as DrawingML gives one: its radii, where it starts on them and how far it turns, clockwise on the screen.
          if (!data) moveTo(pen)
          const radiusX = value(0) * scaleX
          const radiusY = value(1) * scaleY
          const from = value(2) * RADIANS
          const sweep = value(3) * RADIANS
          const centre: [number, number] = [pen[0] - radiusX * Math.cos(from), pen[1] - radiusY * Math.sin(from)]
          const end: [number, number] = [centre[0] + radiusX * Math.cos(from + sweep), centre[1] + radiusY * Math.sin(from + sweep)]
          arcTo(end, radiusX, radiusY, Math.abs(sweep) > Math.PI, sweep > 0)
          break
        }
      }
    }
  }
  endPath()
  return { fill: fills.join(''), stroke: strokes.join('') }
}
