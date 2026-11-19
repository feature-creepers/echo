/**
 * The extrusion of an OpenDocument custom shape (`draw:extrusion="true"`, docs/SPEC.md, section 9.7), drawn as
 * LibreOffice's 3D scene of it looks (svx's `EnhancedCustomShape3d`), without a renderer of 3D: the shape's outline
 * is pushed back by its depth into a solid, turned by its rotation about its centre of rotation, and seen either in
 * the oblique parallel projection LibreOffice uses by default, the depth sheared off by its skew's amount and angle,
 * or in perspective from its viewpoint. Each face is a flat polygon, the faces turned away left out, the sides drawn
 * far to near and the ends after them, since the solid lies behind an end that faces the eye; each lit as LibreOffice
 * lights them: the ambient brightness and the two lights of the scene, a soft light
 * spread over four more as LibreOffice spreads it, and the first light's highlight on a specular surface.
 *
 * Text drawn as Fontwork has no outline to push back here, so it is drawn again at depths along the way, from the
 * back to the front, in the colour of its sides.
 */

import { length } from './open-styles.ts'
import { type Canvas, css, type Fill, fillAttribute, number, type Paint } from './slide-svg.ts'

type Point = [number, number]
type Vector = [number, number, number]

/** A light of the scene: the way to it, in the scene's terms (up is up), as a vector of length one, and how bright it is. */
interface Light {
  direction: Vector
  level: number
  harsh: boolean
}

/** What a shape's geometry says of its extrusion, its lengths in pixels and its angles in radians. */
export interface Extrusion {
  depth: number
  /** The share of the depth in front of the shape's own plane. */
  forward: number
  parallel: boolean
  skew: { amount: number; angle: number }
  rotation: { x: number; y: number }
  /** The centre turned about: across and down as shares of the shape's size from its middle, and back in pixels. */
  centre: Vector
  /** The eye of a perspective, from the origin, in pixels, down being positive. */
  viewpoint: Vector
  /** The point the eye is measured from, as shares of the shape's size from its middle. */
  origin: Point
  lights: [Light, Light]
  ambient: number
  specularity: number
  shininess: number
  metal: boolean
  diffusion: number
  /** Whether its sides take the shape's second fill colour (`draw:extrusion-color`). */
  sideColour: boolean
}

const HUNDREDTHS = 96 / 2540
const RADIANS = Math.PI / 180

/** Numbers written in a list, in brackets or not (`(50000 0 10000)`, `50 -135`). */
const numbers = (value: string | undefined) =>
  (value ?? '')
    .replace(/[()]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)

/** A share as OpenDocument writes it here, `66%`, from 0. */
const percent = (value: string | undefined, fallback: number) => {
  const found = Number.parseFloat(value ?? '')
  return Number.isFinite(found) ? found / 100 : fallback
}

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)

/** A light's way, as the file writes it (down is positive), in the scene's terms, of length one; straight on when it gives none. */
function lightWay(value: string | undefined, fallback: Vector): Vector {
  const [x = Number.NaN, y = Number.NaN, z = Number.NaN] = numbers(value).map(Number)
  const way: Vector = Number.isFinite(x + y + z) ? [x, -y, z] : [fallback[0], -fallback[1], fallback[2]]
  const size = Math.hypot(...way)
  return size > 0 ? [way[0] / size, way[1] / size, way[2] / size] : [0, 0, 1]
}

/**
 * A custom shape's extrusion, from its geometry's attributes, with LibreOffice's defaults for what they leave out: a
 * depth of 1.27 cm behind the shape, a parallel projection skewed half its depth up and to the right, two lights
 * from the right and the left at two thirds, and a third of ambient light. None when the shape is not extruded.
 */
export function readExtrusion(attributes: Readonly<Record<string, string>>): Extrusion | undefined {
  if (attributes['draw:extrusion'] !== 'true') return undefined
  const [depthText, fractionText] = numbers(attributes['draw:extrusion-depth'])
  const depth = Math.min(100_000, Math.max(0, length(depthText) ?? 1270 * HUNDREDTHS))
  const [amount = 50, angle = -135] = numbers(attributes['draw:extrusion-skew']).map(Number)
  const [rotateX = 0, rotateY = 0] = numbers(attributes['draw:extrusion-rotation-angle']).map((value) => Number.parseFloat(value))
  const [centreX = 0, centreY = 0, centreZ = 0] = numbers(attributes['draw:extrusion-rotation-center']).map(Number)
  const view = numbers(attributes['draw:extrusion-viewpoint']).map((value) => length(value))
  const [originX = 0.5, originY = -0.5] = numbers(attributes['draw:extrusion-origin']).map(Number)
  const projection = attributes['dr3d:projection'] ?? attributes['draw:projection']
  const light = (which: 'first' | 'second', fallback: Vector): Light => ({
    direction: lightWay(attributes[`draw:extrusion-${which}-light-direction`], fallback),
    level: percent(attributes[`draw:extrusion-${which}-light-level`], 0.66),
    harsh: attributes[`draw:extrusion-${which}-light-harsh`] !== 'false'
  })
  return {
    depth,
    forward: Math.min(1, Math.max(0, finite(Number(fractionText ?? 0), 0))),
    parallel: projection !== 'perspective',
    skew: { amount: finite(amount, 50), angle: finite(angle, -135) * RADIANS },
    rotation: { x: finite(rotateX, 0) * RADIANS, y: finite(rotateY, 0) * RADIANS },
    centre: [finite(centreX, 0), finite(centreY, 0), finite(centreZ, 0) * HUNDREDTHS],
    viewpoint: [
      finite(view[0] ?? Number.NaN, 3472 * HUNDREDTHS),
      finite(view[1] ?? Number.NaN, -3472 * HUNDREDTHS),
      finite(view[2] ?? Number.NaN, 25000 * HUNDREDTHS)
    ],
    origin: [finite(originX, 0.5), finite(originY, -0.5)],
    lights: [light('first', [50000, 0, 10000]), light('second', [-50000, 0, 10000])],
    ambient: percent(attributes['draw:extrusion-brightness'], 0.33),
    specularity: percent(attributes['draw:extrusion-specularity'], 0),
    shininess: percent(attributes['draw:extrusion-shininess'], 0.5) * 100,
    metal: attributes['draw:extrusion-metal'] === 'true',
    diffusion: percent(attributes['draw:extrusion-diffusion'], 0),
    sideColour: attributes['draw:extrusion-color'] === 'true'
  }
}

// The scene

const dot = (one: Vector, other: Vector) => one[0] * other[0] + one[1] * other[1] + one[2] * other[2]
const unit = (vector: Vector): Vector => {
  const size = Math.hypot(...vector)
  return size > 0 ? [vector[0] / size, vector[1] / size, vector[2] / size] : [0, 0, 0]
}
/** Turns about the x, y and z axes, as LibreOffice's 3D matrices turn. */
const turnX = ([x, y, z]: Vector, angle: number): Vector => [x, Math.cos(angle) * y - Math.sin(angle) * z, Math.sin(angle) * y + Math.cos(angle) * z]
const turnY = ([x, y, z]: Vector, angle: number): Vector => [Math.cos(angle) * x + Math.sin(angle) * z, y, -Math.sin(angle) * x + Math.cos(angle) * z]
const turnZ = ([x, y, z]: Vector, angle: number): Vector => [Math.cos(angle) * x - Math.sin(angle) * y, Math.sin(angle) * x + Math.cos(angle) * y, z]

/** The four lights a soft light is spread over, sixty degrees around it, as LibreOffice places them: up, down, right and left of it. */
function softLights(light: Vector): Vector[] {
  const spread = 60 * RADIANS
  const around: Vector[] = [
    [0, Math.sin(spread), Math.cos(spread)],
    [0, -Math.sin(spread), Math.cos(spread)],
    [Math.sin(spread), 0, Math.cos(spread)],
    [-Math.sin(spread), 0, Math.cos(spread)]
  ]
  const [x, y, z] = light
  return around.map((vector) => {
    const turned = turnZ(vector, Math.PI / 4)
    if (x === 0 && z === 0) return turnX(turned, y >= 0 ? -Math.PI / 2 : Math.PI / 2)
    return turnY(turnX(turned, -Math.atan2(y, Math.hypot(x, z))), Math.atan2(x, z))
  })
}

/** How a face of a normal is lit: what multiplies its colour, and the highlight added to it. */
type Lighting = (normal: Vector) => { factor: number; highlight: number }

function lighting(extrusion: Extrusion, flipped: boolean): Lighting {
  const turn = (vector: Vector): Vector => (flipped ? [-vector[0], -vector[1], -vector[2]] : vector)
  const [first, second] = extrusion.lights
  let levels = [first.level, second.level]
  const directions = [turn(first.direction), turn(second.direction)]
  const soft: { direction: Vector; level: number }[] = []
  if (!second.harsh && second.level > 0 && (first.harsh || first.level === 0)) {
    for (const direction of softLights(directions[1] as Vector)) soft.push({ direction, level: Math.min(1, second.level * 0.4) })
    levels = [first.level, second.level * 0.2]
  } else if (!first.harsh && first.level > 0 && (second.harsh || second.level === 0)) {
    for (const direction of softLights(directions[0] as Vector)) soft.push({ direction, level: Math.min(1, first.level * 0.4) })
    levels = [first.level * 0.2, second.level]
  } else if (!first.harsh && first.level > 0 && !second.harsh && second.level > 0) {
    const [, , right, left] = softLights(directions[0] as Vector)
    const [up, down] = softLights(directions[1] as Vector)
    for (const direction of [right, left]) if (direction) soft.push({ direction, level: Math.min(1, first.level * 0.8) })
    for (const direction of [up, down]) if (direction) soft.push({ direction, level: Math.min(1, second.level * 0.8) })
    levels = [first.level * 0.4, second.level * 0.4]
  }
  const ambient = Math.min(1, extrusion.ambient + (levels[0] !== undefined && levels[0] > 1 ? (levels[0] - 1) / 2 : 0))
  const lights = [
    { direction: directions[0] as Vector, level: Math.min(1, levels[0] ?? 0) },
    { direction: directions[1] as Vector, level: Math.min(1, levels[1] ?? 0) },
    ...soft
  ]
  // The first light alone shines on a surface that is not matte, as LibreOffice's scene lets only its first light.
  const specular = Math.min(1, first.level * extrusion.specularity * (extrusion.metal ? 200 / 255 : 1))
  const power = Math.min(100, Math.round(Math.min(100, 2 ** (extrusion.shininess / 10))) + (extrusion.metal ? 15 : 0))
  const halfway = unit([(directions[0] as Vector)[0], (directions[0] as Vector)[1], (directions[0] as Vector)[2] + 1])
  return (normal) => {
    let factor = ambient
    for (const { direction, level } of lights) factor += level * Math.max(0, dot(normal, direction))
    const facing = dot(normal, directions[0] as Vector)
    const highlight = specular > 0 && facing > 0 ? specular * Math.max(0, dot(halfway, normal)) ** power : 0
    return { factor, highlight }
  }
}

/** A colour lit: multiplied by its light, its highlight added, each part held within its range. */
const lit = (paint: Paint, { factor, highlight }: { factor: number; highlight: number }): Paint => ({
  red: Math.min(255, paint.red * factor + highlight * 255),
  green: Math.min(255, paint.green * factor + highlight * 255),
  blue: Math.min(255, paint.blue * factor + highlight * 255),
  opacity: paint.opacity
})

/** A colour made as bright as its diffusion says, as LibreOffice stands it in for the diffuse colour it does not draw. */
function diffused(paint: Paint, diffusion: number): Paint {
  if (!(diffusion > 0) || Math.abs(diffusion - 1) < 1e-9) return paint
  const highest = Math.max(paint.red, paint.green, paint.blue, 1)
  const factor = Math.min(diffusion, 255 / highest)
  return { ...paint, red: paint.red * factor, green: paint.green * factor, blue: paint.blue * factor }
}

/**
 * A fill lit as a face of a normal: a colour; a gradient or a picture as it is, since LibreOffice lays them on its
 * solid as a texture that takes the place of the lit colour.
 */
function litFill(fill: Fill, light: { factor: number; highlight: number }): Fill {
  return fill.kind === 'paint' ? { kind: 'paint', paint: lit(fill.paint, light) } : fill
}

/** The way a point of the shape is seen: where it falls in the drawing, how near the eye it is, and how a face's normal turns. */
interface View {
  project: (point: Vector) => Point
  nearness: (point: Vector) => number
  normal: (normal: Vector) => Vector
  /** Whether a face of a normal, through a point, faces the eye. */
  faces: (normal: Vector, through: Vector) => boolean
}

/**
 * The view of a shape of `size` pixels: its points, across and up from its middle and toward the eye from its plane,
 * turned about the centre of rotation, then sheared by the skew or seen from the viewpoint.
 */
function viewOf(extrusion: Extrusion, size: { width: number; height: number }): View {
  const { width, height } = size
  const centre: Vector = [extrusion.centre[0] * width, -extrusion.centre[1] * height, extrusion.centre[2]]
  const turned = ([x, y, z]: Vector): Vector => {
    const moved: Vector = [x - centre[0], y - centre[1], z - centre[2]]
    const [tx, ty, tz] = turnX(turnY(moved, -extrusion.rotation.y), -extrusion.rotation.x)
    return [tx + centre[0], ty + centre[1], tz + centre[2]]
  }
  const turnedNormal = (normal: Vector) => turnX(turnY(normal, -extrusion.rotation.y), -extrusion.rotation.x)
  const toDrawing = ([x, y]: Point): Point => [x + width / 2, height / 2 - y]
  if (extrusion.parallel) {
    const shearX = (extrusion.skew.amount / 100) * Math.cos(extrusion.skew.angle)
    const shearY = (extrusion.skew.amount / 100) * Math.sin(extrusion.skew.angle)
    // The line of sight before the shear, toward the eye.
    const sight: Vector = [-shearX, -shearY, 1]
    return {
      project: (point) => {
        const [x, y, z] = turned(point)
        return toDrawing([x + shearX * z, y + shearY * z])
      },
      nearness: (point) => dot(turned(point), sight),
      normal: (normal) => {
        const [x, y, z] = turnedNormal(normal)
        return unit([x, y, z - shearX * x - shearY * y])
      },
      faces: (normal) => dot(turnedNormal(normal), sight) > 1e-9
    }
  }
  const eye: Vector = [
    extrusion.viewpoint[0] + extrusion.origin[0] * width,
    -extrusion.viewpoint[1] - extrusion.origin[1] * height,
    Math.max(1, extrusion.viewpoint[2])
  ]
  return {
    project: (point) => {
      const [x, y, z] = turned(point)
      // A point at or behind the eye is held just before it.
      const scale = eye[2] / Math.max(1e-3, eye[2] - z)
      return toDrawing([eye[0] + (x - eye[0]) * scale, eye[1] + (y - eye[1]) * scale])
    },
    nearness: (point) => {
      const [x, y, z] = turned(point)
      return -Math.hypot(x - eye[0], y - eye[1], z - eye[2])
    },
    normal: (normal) => unit(turnedNormal(normal)),
    faces: (normal, through) => {
      const [x, y, z] = turned(through)
      return dot(turnedNormal(normal), [eye[0] - x, eye[1] - y, eye[2] - z]) > 1e-9
    }
  }
}

// Drawing

/**
 * How a shape lies before it is extruded: turned over across and down, then turned by its own rotation, in degrees
 * clockwise as SVG turns, as LibreOffice turns and turns over a shape before its 3D rotation and its skew.
 */
export interface Lying {
  horizontal: boolean
  vertical: boolean
  turn: number
}

/** A point of the shape's box, across and up from its middle, turned over and turned as it lies. */
function sceneOf(size: { width: number; height: number }, lying: Lying) {
  const angle = (-lying.turn * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  return ([x, y]: Point): Point => {
    const across = (lying.horizontal ? -1 : 1) * (x - size.width / 2)
    const up = (lying.vertical ? -1 : 1) * (size.height / 2 - y)
    return [cos * across - sin * up, sin * across + cos * up]
  }
}

/** A part of a shape pushed back: its outlines in the shape's pixels, the colour of its sides, and its fill, for a part whose ends are closed. */
export interface ExtrudedPart {
  outlines: Point[][]
  side: Paint
  fill?: Fill | undefined
}

/** A face of the solid: its corners in the drawing, how near it is, and how it is painted. */
interface Face {
  corners: Point[][]
  nearness: number
  paint: string
}

/** The most faces drawn for one shape, so a damaged one costs little. */
const FACE_LIMIT = 20_000

const signedArea = (points: readonly Point[]) => {
  let area = 0
  for (let index = 0; index < points.length; index++) {
    const [x1, y1] = points[index] as Point
    const [x2, y2] = points[(index + 1) % points.length] as Point
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

function inside([x, y]: Point, polygon: readonly Point[]): boolean {
  let within = false
  for (let index = 0, before = polygon.length - 1; index < polygon.length; before = index++) {
    const [x1, y1] = polygon[index] as Point
    const [x2, y2] = polygon[before] as Point
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) within = !within
  }
  return within
}

const pathOf = (polygons: readonly Point[][]) => polygons.map((polygon) => `M${polygon.map(([x, y]) => `${number(x)} ${number(y)}`).join('L')}Z`).join('')

/**
 * A shape's parts extruded and seen as its extrusion says, in its box of `size` pixels, turned over as it is: each
 * face far to near, the ends of a part painted with its fill and its sides with their colour, each lit. With the
 * points the drawing passes through, for the room it takes.
 */
export function extrudedElement(
  parts: readonly ExtrudedPart[],
  extrusion: Extrusion,
  size: { width: number; height: number },
  lying: Lying,
  canvas: Canvas
): { svg: string; points: Point[] } {
  if (!Number.isFinite(size.width + size.height + lying.turn)) return { svg: '', points: [] }
  const view = viewOf(extrusion, size)
  const light = lighting(extrusion, lying.horizontal !== lying.vertical)
  const front = extrusion.depth * extrusion.forward
  const back = front - extrusion.depth
  const toScene = sceneOf(size, lying)
  const sides: Face[] = []
  const ends: Face[] = []
  const points: Point[] = []
  let count = 0
  for (const part of parts) {
    const polygons = part.outlines
      .map((outline) =>
        outline
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          .map(toScene)
          .filter((point, index, all) => index === 0 || Math.hypot(point[0] - (all[index - 1] as Point)[0], point[1] - (all[index - 1] as Point)[1]) > 1e-6)
      )
      .map((outline) => {
        // A closed outline that ends where it starts has its last point once.
        const [first, last] = [outline[0], outline.at(-1)]
        return first && last && outline.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6 ? outline.slice(0, -1) : outline
      })
      .filter((outline) => outline.length >= 2)
    const material = diffused(part.side, extrusion.diffusion)
    const lightNormal = (normal: Vector) => light(view.normal(normal))
    polygons.forEach((polygon, index) => {
      // The solid is inside an outline, or outside one that is a hole in another.
      const depth = polygons.filter((other, place) => place !== index && other.length > 2 && inside(polygon[0] as Point, other)).length
      const outward = Math.sign(signedArea(polygon)) * (depth % 2 === 0 ? 1 : -1) || 1
      const closed = part.fill !== undefined && polygon.length > 2
      const edges = closed ? polygon.length : polygon.length - 1
      for (let edge = 0; edge < edges && count < FACE_LIMIT; edge++, count++) {
        const [px, py] = polygon[edge] as Point
        const [qx, qy] = polygon[(edge + 1) % polygon.length] as Point
        const along = Math.hypot(qx - px, qy - py)
        if (!(along > 0)) continue
        // A side's normal, out of the solid; an open outline, a line, shows both its sides.
        let normal: Vector = [(outward * (qy - py)) / along, (-outward * (qx - px)) / along, 0]
        const corners: Vector[] = [
          [px, py, front],
          [qx, qy, front],
          [qx, qy, back],
          [px, py, back]
        ]
        const middle: Vector = [(px + qx) / 2, (py + qy) / 2, (front + back) / 2]
        if (!view.faces(normal, middle)) {
          if (closed) continue
          normal = [-normal[0], -normal[1], 0]
        }
        const projected = corners.map(view.project)
        points.push(...projected)
        sides.push({ corners: [projected], nearness: view.nearness(middle), paint: `fill="${css(lit(material, lightNormal(normal)))}"` })
      }
    })
    if (part.fill === undefined) continue
    // Its two ends, the one facing the eye drawn, each with every outline of the part, its holes left out.
    for (const [z, normal] of [
      [back, [0, 0, -1]],
      [front, [0, 0, 1]]
    ] as [number, Vector][]) {
      const all = polygons.filter((polygon) => polygon.length > 2)
      const sum = all.flat().reduce((total, [x, y]) => [total[0] + x, total[1] + y], [0, 0])
      const middle: Vector = [sum[0] / Math.max(1, all.flat().length), sum[1] / Math.max(1, all.flat().length), z]
      if (all.length === 0 || !view.faces(normal, middle)) continue
      const corners = all.map((polygon) => polygon.map(([x, y]) => view.project([x, y, z])))
      points.push(...corners.flat())
      const fill = part.fill.kind === 'none' ? ({ kind: 'paint', paint: material } as Fill) : part.fill
      const tone = lightNormal(normal)
      ends.push({ corners, nearness: view.nearness(middle), paint: `${fillAttribute(litFill(fill, tone), canvas, size)} fill-rule="evenodd"` })
    }
  }
  sides.sort((one, other) => one.nearness - other.nearness)
  // Each face edged in its own colour, a hair wide, so no seam shows between the faces beside it.
  // A face a damaged shape sends nowhere is left out.
  const svg = [...sides, ...ends]
    .filter((face) => face.corners.every((corners) => corners.every(([x, y]) => Math.abs(x) < 1e9 && Math.abs(y) < 1e9)))
    .map((face) => {
      const colour = /^fill="(#[0-9a-f]{6})"/.exec(face.paint)?.[1]
      return `<path d="${pathOf(face.corners)}" ${face.paint}${colour ? ` stroke="${colour}" stroke-width="0.5" stroke-linejoin="round"` : ' stroke="none"'}/>`
    })
    .join('')
  return { svg, points }
}

/**
 * A drawing of a flat shape, such as a Fontwork's letters, extruded by drawing it again at depths along the way, from
 * the back to the front, in the lit colour of its sides, then at the front in its own fill, lit as a face toward the
 * eye. `draw` draws it in a fill, `reach` the points it passes through; with those points carried to each end.
 */
export function stackedElement(
  draw: (fill: Fill) => string,
  reach: readonly Point[],
  side: Paint,
  fill: Fill,
  extrusion: Extrusion,
  size: { width: number; height: number },
  lying: Lying
): { svg: string; points: Point[] } {
  if (!Number.isFinite(size.width + size.height + lying.turn)) return { svg: '', points: [] }
  const view = viewOf(extrusion, size)
  const light = lighting(extrusion, lying.horizontal !== lying.vertical)
  const front = extrusion.depth * extrusion.forward
  const back = front - extrusion.depth
  const toScene = sceneOf(size, lying)
  /** The transform taking the flat drawing to a depth, from where three of its points fall there. */
  const at = (z: number) => {
    const [origin, across, down] = (
      [
        [0, 0],
        [size.width, 0],
        [0, size.height]
      ] as Point[]
    ).map((point) => view.project([...toScene(point), z]))
    const a = ((across as Point)[0] - (origin as Point)[0]) / (size.width || 1)
    const b = ((across as Point)[1] - (origin as Point)[1]) / (size.width || 1)
    const c = ((down as Point)[0] - (origin as Point)[0]) / (size.height || 1)
    const d = ((down as Point)[1] - (origin as Point)[1]) / (size.height || 1)
    return [a, b, c, d, (origin as Point)[0], (origin as Point)[1]]
  }
  const [frontMatrix, backMatrix] = [at(front), at(back)]
  if (![...frontMatrix, ...backMatrix].every((value) => Math.abs(value) < 1e9)) return { svg: '', points: [] }
  const apart = Math.hypot((frontMatrix[4] ?? 0) - (backMatrix[4] ?? 0), (frontMatrix[5] ?? 0) - (backMatrix[5] ?? 0))
  const steps = Math.min(48, Math.max(2, Math.ceil(apart)))
  // The sides seen face the way the back lies from the front in the drawing, as a side of the solid would.
  const way: Point = [(backMatrix[4] ?? 0) - (frontMatrix[4] ?? 0), (frontMatrix[5] ?? 0) - (backMatrix[5] ?? 0)]
  const sideTone = lit(diffused(side, extrusion.diffusion), light(view.normal(unit([way[0], way[1], 0]))))
  const matrix = (values: number[]) => `matrix(${values.map((value) => String(Number(value.toPrecision(6)))).join(' ')})`
  const layers: string[] = []
  for (let step = 0; step < steps; step++) {
    const values = at(back + ((front - back) * step) / steps)
    if (values.every((value) => Math.abs(value) < 1e9)) layers.push(`<g transform="${matrix(values)}">${draw({ kind: 'paint', paint: sideTone })}</g>`)
  }
  layers.push(`<g transform="${matrix(frontMatrix)}">${draw(litFill(fill, light(view.normal([0, 0, 1]))))}</g>`)
  const points = [front, back]
    .flatMap((z) => reach.map((point) => view.project([...toScene(point), z])))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  return { svg: layers.join(''), points }
}
