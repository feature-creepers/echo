/**
 * A 3D scene of an OpenDocument file (`dr3d:scene`) drawn as LibreOffice shows it, flat in SVG (docs/SPEC.md, section
 * 9.7). Its cubes, spheres, extruded outlines and outlines turned about an axis are made of faces, placed by their
 * transforms and by those of the scenes that hold them, then seen through the scene's camera, in perspective or in
 * parallel: the box of what the scene holds is fitted to the scene's box on the page, as LibreOffice fits it. Each face
 * is lit as LibreOffice lights a face (its emission, the ambient light, then each light by the way it comes and its
 * highlight on the side seen), and the faces are painted from the farthest to the nearest.
 */

import { length, type Properties, share } from './open-styles.ts'
import { childrenNamed, type XmlNode } from './xml.ts'

export type Vector = readonly [number, number, number]

/** A move and turn of 3D points: the images of the three axes, then the move, as `dr3d:transform` writes a matrix. */
export type Transform = readonly [number, number, number, number, number, number, number, number, number, number, number, number]

const IDENTITY: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

/** What the drawing gives a scene: the style of each of its objects, the colour of a shape that names none, and outlines. */
export interface SceneSource {
  style(node: XmlNode): Properties
  fill: string
  /** Path data as polylines, its curves by points along them; a closed one ends where it starts. */
  polygons(data: string): readonly (readonly (readonly [number, number])[])[]
}

/** A face of the scene: its rings of points (a cap with holes keeps several), and how it is painted. */
interface Face {
  rings: Vector[][]
  look: Look
}

interface Look {
  colour: Colour
  opacity: number
  filled: boolean
  line?: { colour: string; width: number } | undefined
  specular: Colour
  emission: Colour
  intensity: number
}

type Colour = readonly [number, number, number]

/** The most faces a scene is made of: past them, its objects are left out. */
export const FACE_LIMIT = 20_000

/** The most scenes within scenes followed. */
const DEPTH_LIMIT = 8

/** Pixels, in which lengths are read, in hundredths of a millimetre, in which a scene keeps its points. */
const HUNDREDTHS = 2540 / 96

const LONE_LIGHT = { colour: [0.8, 0.8, 0.8] as Colour, direction: unit([1, 1, 1]), specular: true }

/** A scene's SVG in its box of `size`, or nothing when it holds nothing drawn. */
export function sceneElement(scene: XmlNode, size: { width: number; height: number }, source: SceneSource): string {
  const faces: Face[] = []
  // A scene shaded smoothly (Gouraud's or Phong's way) has its round objects made of twice the faces, so their facets do not show.
  const shading = scene.attributes['dr3d:shade-mode']
  const fineness = shading === 'flat' || shading === 'draft' ? 1 : 2
  for (const child of scene.children) collect(child, IDENTITY, source, faces, 0, fineness)
  if (faces.length === 0 || size.width <= 0 || size.height <= 0) return ''
  const { attributes } = scene
  // The camera: the outer scene's own transform, then the orientation LibreOffice builds from its view's point and normals.
  const transform = readTransform(attributes['dr3d:transform'])
  const viewPoint = readVector(attributes['dr3d:vrp']) ?? [0, 0, 0]
  const normal = unit(readVector(attributes['dr3d:vpn']) ?? [0, 0, 1])
  const across = unit(cross(unit(readVector(attributes['dr3d:vup']) ?? [0, 1, 0]), normal))
  const up = unit(cross(normal, across))
  // LibreOffice moves by the view's point after turning, not before.
  const toCamera = (point: Vector): Vector => {
    const placed = apply(transform, point)
    return [dot(across, placed) - viewPoint[0], dot(up, placed) - viewPoint[1], dot(normal, placed) - viewPoint[2]]
  }
  const corners = boxCorners(faces).map(toCamera)
  const perspective = attributes['dr3d:projection'] !== 'parallel' && corners.every(([, , z]) => z < -1e-6)
  const project = ([x, y, z]: Vector): [number, number] => (perspective ? [x / -z, y / -z] : [x, y])
  // The box of what the scene holds, seen through the camera, fills the scene's box.
  const seen = corners.map(project)
  const left = Math.min(...seen.map(([x]) => x))
  const right = Math.max(...seen.map(([x]) => x))
  const bottom = Math.min(...seen.map(([, y]) => y))
  const top = Math.max(...seen.map(([, y]) => y))
  const toPage = ([x, y]: [number, number]): [number, number] => [
    right - left > 1e-12 ? ((x - left) / (right - left)) * size.width : size.width / 2,
    top - bottom > 1e-12 ? ((top - y) / (top - bottom)) * size.height : size.height / 2
  ]
  const lighting = lightingOf(scene)
  const drawn = faces.map((face) => {
    const rings = face.rings.map((ring) => ring.map(toCamera))
    const first = rings[0] ?? []
    const middle = centre(first)
    // The side seen is the one lit: its normal is turned to the viewer.
    let facing = newell(first)
    const toViewer: Vector = perspective ? [-middle[0], -middle[1], -middle[2]] : [0, 0, 1]
    if (dot(facing, toViewer) < 0) facing = [-facing[0], -facing[1], -facing[2]]
    return { face, rings, depth: middle[2], colour: shaded(face.look, facing, lighting) }
  })
  drawn.sort((one, other) => one.depth - other.depth)
  return drawn
    .map(({ face, rings, colour }) => {
      const data = rings.map((ring) => `M${ring.map((point) => toPage(project(point)).map(number).join(' ')).join('L')}Z`).join('')
      const { look } = face
      const fill = look.filled ? hex(colour) : 'none'
      const opacity = look.filled && look.opacity < 1 ? ` fill-opacity="${number(look.opacity)}"` : ''
      // A face is drawn a hair over its edges in its own colour, so the seams between faces do not show.
      const stroke = look.line
        ? ` stroke="${look.line.colour}" stroke-width="${number(look.line.width)}" stroke-linejoin="round"`
        : look.filled && look.opacity >= 1
          ? ` stroke="${fill}" stroke-width="0.75" stroke-linejoin="round"`
          : ' stroke="none"'
      return `<path d="${data}" fill="${fill}"${rings.length > 1 ? ' fill-rule="evenodd"' : ''}${opacity}${stroke}/>`
    })
    .join('')
}

// The objects

function collect(node: XmlNode, outer: Transform, source: SceneSource, faces: Face[], depth: number, fineness: number): void {
  if (faces.length >= FACE_LIMIT) return
  const { attributes } = node
  const transform = compose(outer, readTransform(attributes['dr3d:transform']))
  if (node.name === 'dr3d:scene') {
    if (depth < DEPTH_LIMIT) for (const child of node.children) collect(child, transform, source, faces, depth + 1, fineness)
    return
  }
  const style = node.name.startsWith('dr3d:') ? source.style(node) : undefined
  if (!style) return
  const look = lookOf(style, source.fill)
  const add = (rings: Vector[][]) => {
    if (faces.length < FACE_LIMIT && rings.some((ring) => ring.length >= 3))
      faces.push({ rings: rings.map((ring) => ring.map((point) => apply(transform, point))), look })
  }
  const segments = (name: string, fallback: number, least: number) =>
    Math.min(128, Math.max(least, Math.round(Number(style[name] ?? fallback)) || fallback) * fineness)
  switch (node.name) {
    case 'dr3d:cube': {
      const [x0, y0, z0] = readVector(attributes['dr3d:min-edge']) ?? [-2500, -2500, -2500]
      const [x1, y1, z1] = readVector(attributes['dr3d:max-edge']) ?? [2500, 2500, 2500]
      const at = (x: number, y: number, z: number): Vector => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0]
      for (const [a, b, c, d] of [
        [at(0, 0, 0), at(0, 1, 0), at(1, 1, 0), at(1, 0, 0)],
        [at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1)],
        [at(0, 0, 0), at(0, 0, 1), at(0, 1, 1), at(0, 1, 0)],
        [at(1, 0, 0), at(1, 1, 0), at(1, 1, 1), at(1, 0, 1)],
        [at(0, 0, 0), at(1, 0, 0), at(1, 0, 1), at(0, 0, 1)],
        [at(0, 1, 0), at(0, 1, 1), at(1, 1, 1), at(1, 1, 0)]
      ] as Vector[][])
        add([[a as Vector, b as Vector, c as Vector, d as Vector]])
      break
    }
    case 'dr3d:sphere': {
      const [cx, cy, cz] = readVector(attributes['dr3d:center']) ?? [0, 0, 0]
      const [sx, sy, sz] = readVector(attributes['dr3d:size']) ?? [5000, 5000, 5000]
      const around = segments('dr3d:horizontal-segments', 24, 3)
      const down = segments('dr3d:vertical-segments', 24, 2)
      const at = (row: number, column: number): Vector => {
        const latitude = -Math.PI / 2 + (Math.PI * row) / down
        const longitude = (2 * Math.PI * column) / around
        return [
          cx + (Math.cos(latitude) * Math.sin(longitude) * sx) / 2,
          cy + (Math.sin(latitude) * sy) / 2,
          cz + (Math.cos(latitude) * Math.cos(longitude) * sz) / 2
        ]
      }
      for (let row = 0; row < down; row++)
        for (let column = 0; column < around; column++) {
          // A row at a pole meets in a point: its faces are triangles.
          const ring = [at(row, column), at(row, column + 1), at(row + 1, column + 1), at(row + 1, column)]
          add([row === 0 ? ring.slice(1) : row === down - 1 ? [ring[0] as Vector, ring[1] as Vector, ring[2] as Vector] : ring])
        }
      break
    }
    case 'dr3d:extrude': {
      const outlines = outlinesOf(attributes['svg:d'], source)
      if (outlines.length === 0) break
      const depthOf = length(style['dr3d:depth'])
      const deep = depthOf === undefined ? 1000 : depthOf * HUNDREDTHS
      // The front is scaled about the middle of the outline as the back scale says; the back is at depth naught.
      const scale = share(style['dr3d:back-scale']) ?? 1
      const [mx, my] = middleOf(outlines)
      const front = outlines.map((outline) => outline.map(([x, y]): Vector => [mx + (x - mx) * scale, my + (y - my) * scale, deep]))
      const back = outlines.map((outline) => outline.map(([x, y]): Vector => [x, y, 0]))
      outlines.forEach((outline, index) => {
        const near = front[index] as Vector[]
        const far = back[index] as Vector[]
        for (let at = 0; at + 1 < outline.length; at++) add([[far[at] as Vector, far[at + 1] as Vector, near[at + 1] as Vector, near[at] as Vector]])
      })
      const closed = (index: number) => isClosed(outlines[index] ?? [])
      if (style['dr3d:close-front'] !== 'false') add(front.filter((_, index) => closed(index)))
      if (style['dr3d:close-back'] !== 'false') add(back.filter((_, index) => closed(index)))
      break
    }
    case 'dr3d:rotate': {
      const outlines = outlinesOf(attributes['svg:d'], source)
      if (outlines.length === 0) break
      const end = readAngle(style['dr3d:end-angle'], Math.PI / 1800) ?? 2 * Math.PI
      const steps = segments('dr3d:horizontal-segments', 24, 2)
      // An outline turned about the axis going up, as LibreOffice turns it: x toward the back as the angle grows.
      const turned = (outline: readonly (readonly [number, number])[], angle: number) =>
        outline.map(([x, y]): Vector => [x * Math.cos(angle), y, -x * Math.sin(angle)])
      for (const outline of outlines)
        for (let step = 0; step < steps; step++) {
          const one = turned(outline, (end * step) / steps)
          const other = turned(outline, (end * (step + 1)) / steps)
          for (let at = 0; at + 1 < outline.length; at++) add([[one[at] as Vector, one[at + 1] as Vector, other[at + 1] as Vector, other[at] as Vector]])
        }
      // A turn short of a whole one is closed at both ends by its outline, as its caps say.
      if (Math.abs(end) < 2 * Math.PI - 1e-9) {
        const closedOnes = outlines.filter(isClosed)
        if (style['dr3d:close-front'] !== 'false') add(closedOnes.map((outline) => turned(outline, 0)))
        if (style['dr3d:close-back'] !== 'false') add(closedOnes.map((outline) => turned(outline, end)))
      }
      break
    }
  }
}

function outlinesOf(data: string | undefined, source: SceneSource): (readonly (readonly [number, number])[])[] {
  if (!data) return []
  return source.polygons(data).filter((outline) => outline.length >= 2)
}

const isClosed = (outline: readonly (readonly [number, number])[]) => {
  const first = outline[0]
  const last = outline[outline.length - 1]
  return outline.length >= 4 && first !== undefined && last !== undefined && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6
}

/** The middle of the box of outlines. */
function middleOf(outlines: readonly (readonly (readonly [number, number])[])[]): [number, number] {
  const points = outlines.flat()
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** How an object is painted: its fill's colour and opacity, its line, and its material's highlight and glow. */
function lookOf(style: Properties, fallback: string): Look {
  const line =
    style['draw:stroke'] && style['draw:stroke'] !== 'none'
      ? { colour: style['svg:stroke-color'] ?? '#3465a4', width: Math.max(0.5, length(style['svg:stroke-width']) ?? 0) }
      : undefined
  return {
    colour: readColour(style['draw:fill-color']) ?? readColour(fallback) ?? [0.447, 0.624, 0.812],
    opacity: share(style['draw:opacity']) ?? 1,
    filled: style['draw:fill'] !== 'none',
    line,
    specular: readColour(style['dr3d:specular-color']) ?? [1, 1, 1],
    emission: readColour(style['dr3d:emissive-color']) ?? [0, 0, 0],
    intensity: (share(style['dr3d:shininess']) ?? 0.15) * 100
  }
}

// The light

interface Lighting {
  ambient: Colour
  lights: { colour: Colour; direction: Vector; specular: boolean }[]
}

/** A scene's ambient light and its lights that are on; one light, as LibreOffice gives a scene, when it names none. */
function lightingOf(scene: XmlNode): Lighting {
  const named = childrenNamed(scene, 'dr3d:light')
  const lights = named
    .filter((light) => light.attributes['dr3d:enabled'] !== 'false')
    .map((light) => ({
      colour: readColour(light.attributes['dr3d:diffuse-color']) ?? [0.8, 0.8, 0.8],
      direction: unit(readVector(light.attributes['dr3d:direction']) ?? [0, 0, 1]),
      specular: light.attributes['dr3d:specular'] === 'true'
    }))
  return { ambient: readColour(scene.attributes['dr3d:ambient-color']) ?? [0.4, 0.4, 0.4], lights: named.length > 0 ? lights : [LONE_LIGHT] }
}

/**
 * A face's colour, as LibreOffice solves it: its glow, the ambient light on its colour, each light on its colour by the
 * cosine of its way and the face's normal, and the highlight of a light that has one, toward the viewer.
 */
function shaded(look: Look, facing: Vector, lighting: Lighting): Colour {
  const normal = unit(facing)
  const colour = look.colour
  let result: [number, number, number] = [
    look.emission[0] + lighting.ambient[0] * colour[0],
    look.emission[1] + lighting.ambient[1] * colour[1],
    look.emission[2] + lighting.ambient[2] * colour[2]
  ]
  for (const light of lighting.lights) {
    const cosine = dot(light.direction, normal)
    if (cosine <= 0) continue
    result = [
      result[0] + light.colour[0] * colour[0] * cosine,
      result[1] + light.colour[1] * colour[1] * cosine,
      result[2] + light.colour[2] * colour[2] * cosine
    ]
    if (!light.specular) continue
    const highlight = dot(unit([light.direction[0], light.direction[1], light.direction[2] + 1]), normal)
    if (highlight <= 0) continue
    const strength = highlight ** look.intensity
    result = [result[0] + look.specular[0] * strength, result[1] + look.specular[1] * strength, result[2] + look.specular[2] * strength]
  }
  return [clamp(result[0]), clamp(result[1]), clamp(result[2])]
}

// Reading

/** A vector as a scene writes it, `(x y z)`, in hundredths of a millimetre. */
export function readVector(value: string | undefined): Vector | undefined {
  const parts = /^\s*\(([^)]*)\)\s*$/
    .exec(value ?? '')?.[1]
    ?.trim()
    .split(/[\s,]+/)
  if (parts?.length !== 3) return undefined
  const numbers = parts.map(measure)
  return numbers.every(Number.isFinite) ? (numbers as unknown as Vector) : undefined
}

/** A length in hundredths of a millimetre: as it is without a unit, else converted. */
function measure(value: string): number {
  if (/^\s*-?\d*\.?\d+(?:e-?\d+)?\s*$/i.test(value)) return Number(value)
  const found = length(value)
  return found === undefined ? Number.NaN : found * HUNDREDTHS
}

/** An angle in radians: in degrees, grads or radians as its unit says, else in units of `unitless` radians. */
export function readAngle(value: string | undefined, unitless: number): number | undefined {
  const match = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(deg|grad|rad)?\s*$/i.exec(value ?? '')
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase()
  return amount * (unit === 'deg' ? Math.PI / 180 : unit === 'grad' ? Math.PI / 200 : unit === 'rad' ? 1 : unitless)
}

/** A 3D transform as `dr3d:transform` writes it: matrices, moves, scales and turns about the axes, in order. */
export function readTransform(value: string | undefined): Transform {
  let result = IDENTITY
  for (const [, name, inside] of (value ?? '').matchAll(/(matrix|translate|scale|rotatex|rotatey|rotatez)\s*\(([^)]*)\)/gi)) {
    const values = (inside ?? '').trim().split(/[\s,]+/)
    const kind = (name ?? '').toLowerCase()
    let step: number[] | undefined
    if (kind === 'matrix' && values.length === 12) step = values.map((one, index) => (index >= 9 ? measure(one) : Number(one)))
    else if (kind === 'translate' && values.length === 3) step = [1, 0, 0, 0, 1, 0, 0, 0, 1, ...values.map(measure)]
    else if (kind === 'scale' && values.length === 3) {
      const [x, y, z] = values.map(Number) as [number, number, number]
      step = [x, 0, 0, 0, y, 0, 0, 0, z, 0, 0, 0]
    } else if (kind.startsWith('rotate') && values.length === 1) {
      const angle = readAngle(values[0], 1) ?? Number.NaN
      const [c, s] = [Math.cos(angle), Math.sin(angle)]
      step =
        kind === 'rotatex'
          ? [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]
          : kind === 'rotatey'
            ? [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]
            : [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]
    }
    if (step?.every(Number.isFinite)) result = compose(result, step as unknown as Transform)
  }
  return result
}

const readColour = (value: string | undefined): Colour | undefined => {
  const match = /^#([0-9a-f]{6})$/i.exec(value?.trim() ?? '')
  if (!match) return undefined
  const code = Number.parseInt(match[1] as string, 16)
  return [((code >> 16) & 0xff) / 255, ((code >> 8) & 0xff) / 255, (code & 0xff) / 255]
}

// Arithmetic

export const apply = (t: Transform, [x, y, z]: Vector): Vector => [
  t[0] * x + t[3] * y + t[6] * z + t[9],
  t[1] * x + t[4] * y + t[7] * z + t[10],
  t[2] * x + t[5] * y + t[8] * z + t[11]
]

/** The transform that applies `inner`, then `outer`. */
export function compose(outer: Transform, inner: Transform): Transform {
  const turn = (x: number, y: number, z: number): Vector => [
    outer[0] * x + outer[3] * y + outer[6] * z,
    outer[1] * x + outer[4] * y + outer[7] * z,
    outer[2] * x + outer[5] * y + outer[8] * z
  ]
  return [
    ...turn(inner[0], inner[1], inner[2]),
    ...turn(inner[3], inner[4], inner[5]),
    ...turn(inner[6], inner[7], inner[8]),
    ...apply(outer, [inner[9], inner[10], inner[11]])
  ]
}

const dot = (one: Vector, other: Vector) => one[0] * other[0] + one[1] * other[1] + one[2] * other[2]
const cross = (one: Vector, other: Vector): Vector => [
  one[1] * other[2] - one[2] * other[1],
  one[2] * other[0] - one[0] * other[2],
  one[0] * other[1] - one[1] * other[0]
]

function unit(vector: Vector): Vector {
  const size = Math.hypot(vector[0], vector[1], vector[2])
  return size > 1e-12 ? [vector[0] / size, vector[1] / size, vector[2] / size] : [0, 0, 1]
}

/** A polygon's normal by Newell's sum, which holds for a polygon not quite flat. */
function newell(ring: readonly Vector[]): Vector {
  let [x, y, z] = [0, 0, 0]
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % ring.length] as Vector
    x += (point[1] - next[1]) * (point[2] + next[2])
    y += (point[2] - next[2]) * (point[0] + next[0])
    z += (point[0] - next[0]) * (point[1] + next[1])
  })
  return [x, y, z]
}

function centre(ring: readonly Vector[]): Vector {
  const count = ring.length || 1
  return [ring.reduce((sum, [x]) => sum + x, 0) / count, ring.reduce((sum, [, y]) => sum + y, 0) / count, ring.reduce((sum, [, , z]) => sum + z, 0) / count]
}

/** The corners of the box of every face's points. */
function boxCorners(faces: readonly Face[]): Vector[] {
  const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const face of faces)
    for (const ring of face.rings)
      for (const point of ring)
        for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis] as number, point[axis] as number)
          high[axis] = Math.max(high[axis] as number, point[axis] as number)
        }
  const corners: Vector[] = []
  for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) corners.push([x as number, y as number, z as number])
  return corners
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const hex = (colour: Colour) =>
  `#${colour
    .map((part) =>
      Math.round(part * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
const number = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0')
