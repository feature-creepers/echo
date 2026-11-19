import { describe, expect, it } from 'vitest'
import { type Extrusion, extrudedElement, readExtrusion, stackedElement } from './extrusion.ts'
import { Canvas } from './slide-svg.ts'

type Point = [number, number]

const square: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100]
]
const white = { red: 255, green: 255, blue: 255, opacity: 1 }
const flat = { horizontal: false, vertical: false, turn: 0 }
const size = { width: 100, height: 100 }

/** The extrusion LibreOffice gives a shape that says only that it is extruded. */
const plain = readExtrusion({ 'draw:extrusion': 'true' }) as Extrusion

/** The faces drawn, in order, each by its path and its colour. */
function faces(svg: string) {
  return [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)"/g)].map(([, path, colour]) => ({ path: path as string, colour: colour as string }))
}

describe('a custom shape’s extrusion read from its geometry', () => {
  it('is none when the shape is not extruded', () => {
    expect(readExtrusion({})).toBeUndefined()
    expect(readExtrusion({ 'draw:extrusion': 'false' })).toBeUndefined()
  })

  it('takes LibreOffice’s defaults for what it leaves out', () => {
    expect(plain.depth).toBeCloseTo(48, 1)
    expect(plain.forward).toBe(0)
    expect(plain.parallel).toBe(true)
    expect(plain.skew.amount).toBe(50)
    expect(plain.skew.angle).toBeCloseTo((-135 * Math.PI) / 180, 6)
    expect(plain.ambient).toBeCloseTo(0.33, 6)
    expect(plain.lights.map((light) => light.level)).toEqual([0.66, 0.66])
    expect(plain.lights[0].direction[0]).toBeGreaterThan(0.9)
    expect(plain.lights[1].direction[0]).toBeLessThan(-0.9)
  })

  it.each([
    {
      name: 'its depth and the share of it in front',
      attributes: { 'draw:extrusion-depth': '2.54cm 0.5' },
      check: (found: Extrusion) => [found.depth, found.forward],
      expected: [96, 0.5]
    },
    { name: 'a perspective', attributes: { 'dr3d:projection': 'perspective' }, check: (found: Extrusion) => [found.parallel ? 1 : 0], expected: [0] },
    {
      name: 'its viewpoint, in lengths',
      attributes: { 'draw:extrusion-viewpoint': '(1in -1in 10in)' },
      check: (found: Extrusion) => found.viewpoint,
      expected: [96, -96, 960]
    },
    {
      name: 'its turn, in degrees, and its centre of turning',
      attributes: { 'draw:extrusion-rotation-angle': '90 -45', 'draw:extrusion-rotation-center': '(0 0.25 2540)' },
      check: (found: Extrusion) => [found.rotation.x, found.rotation.y, ...found.centre],
      expected: [Math.PI / 2, -Math.PI / 4, 0, 0.25, 96]
    },
    {
      name: 'its lights’ levels and its brightness, in percent',
      attributes: { 'draw:extrusion-first-light-level': '100%', 'draw:extrusion-second-light-harsh': 'false', 'draw:extrusion-brightness': '50%' },
      check: (found: Extrusion) => [found.lights[0].level, found.lights[1].harsh ? 1 : 0, found.ambient],
      expected: [1, 0, 0.5]
    },
    {
      name: 'nonsense, as its defaults',
      attributes: { 'draw:extrusion-depth': 'NaN x', 'draw:extrusion-skew': 'a b', 'draw:extrusion-viewpoint': '((' },
      check: (found: Extrusion) => [found.depth, found.skew.amount, found.viewpoint[2]],
      expected: [48, 50, 944.88]
    }
  ])('reads $name', ({ attributes, check, expected }) => {
    const found = readExtrusion({ 'draw:extrusion': 'true', ...attributes }) as Extrusion
    for (const [index, value] of check(found).entries()) expect(value).toBeCloseTo(expected[index] as number, 1)
  })
})

describe('an extruded shape drawn', () => {
  it('pushes a square back up and to the right by default, showing its top, its right side and its front, the front last', () => {
    const { svg, points } = extrudedElement([{ outlines: [square], side: white, fill: { kind: 'paint', paint: white } }], plain, size, flat, new Canvas())
    const drawn = faces(svg)
    expect(drawn).toHaveLength(3)
    expect(drawn.at(-1)?.path).toBe('M0 0L100 0L100 100L0 100Z')
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    expect(Math.max(...xs)).toBeCloseTo(100 + 48 * 0.3536, 0)
    expect(Math.min(...ys)).toBeCloseTo(-48 * 0.3536, 0)
    // The front faces the eye, lit by two lights from the sides and the ambient light: darker than its white.
    expect(drawn.at(-1)?.colour).toBe('#969696')
    expect(new Set(drawn.map((face) => face.colour)).size).toBe(3)
  })

  it('leaves out the faces turned away, and draws the back when it is turned toward the eye', () => {
    const turned = { ...plain, rotation: { x: 0, y: Math.PI } }
    const drawn = faces(extrudedElement([{ outlines: [square], side: white, fill: { kind: 'paint', paint: white } }], turned, size, flat, new Canvas()).svg)
    expect(drawn.length).toBeLessThanOrEqual(3)
    expect(drawn.at(-1)?.path).not.toBe('M0 0L100 0L100 100L0 100Z')
  })

  it('shrinks the back toward the eye in perspective', () => {
    const seen = { ...plain, parallel: false, viewpoint: [0, 0, 400] as [number, number, number], origin: [0, 0] as Point, depth: 100 }
    const { points } = extrudedElement([{ outlines: [square], side: white, fill: { kind: 'paint', paint: white } }], seen, size, flat, new Canvas())
    // The back is four fifths of the front's size, about the middle, so its sides are hidden behind the front.
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(0, 3)
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(100, 3)
  })

  it('makes walls of a line, showing both its sides, with no ends', () => {
    const line: Point[] = [
      [0, 50],
      [100, 50]
    ]
    const drawn = faces(extrudedElement([{ outlines: [line], side: white, fill: undefined }], plain, size, flat, new Canvas()).svg)
    expect(drawn).toHaveLength(1)
  })

  it('lets a hole show its inner walls', () => {
    const hole: Point[] = [
      [25, 25],
      [25, 75],
      [75, 75],
      [75, 25]
    ]
    const drawn = faces(
      extrudedElement([{ outlines: [square, hole], side: white, fill: { kind: 'paint', paint: white } }], plain, size, flat, new Canvas()).svg
    )
    // The square's top and right, the hole's bottom and left inner walls, and the front with its hole.
    expect(drawn).toHaveLength(5)
    expect(drawn.at(-1)?.path).toContain('Z')
  })

  it('turns the light around for a shape turned over once, as LibreOffice does', () => {
    const lit = (lying: typeof flat) =>
      faces(extrudedElement([{ outlines: [square], side: white, fill: { kind: 'paint', paint: white } }], plain, size, lying, new Canvas()).svg).at(-1)?.colour
    expect(lit({ ...flat, vertical: true })).not.toBe(lit(flat))
    expect(lit({ ...flat, vertical: true, horizontal: true })).toBe(lit(flat))
  })

  it('stops at a limit of faces, so a damaged shape costs little', () => {
    const many: Point[] = Array.from({ length: 50_000 }, (_, index) => [Math.cos(index) * 50 + 50, Math.sin(index) * 50 + 50])
    const drawn = faces(extrudedElement([{ outlines: [many], side: white, fill: undefined }], plain, size, flat, new Canvas()).svg)
    expect(drawn.length).toBeLessThanOrEqual(20_001)
  })
})

describe('a flat drawing extruded by drawing it again along its depth', () => {
  it('draws it at depths from the back to the front in its sides’ colour, then at the front in its own fill', () => {
    const { svg, points } = stackedElement(
      (fill) => `<rect fill="${fill.kind === 'paint' ? 'paint' : 'other'}"/>`,
      square,
      white,
      { kind: 'paint', paint: white },
      plain,
      size,
      flat
    )
    const layers = svg.match(/<g transform="matrix\(/g) ?? []
    expect(layers.length).toBeGreaterThan(10)
    expect(layers.length).toBeLessThanOrEqual(49)
    expect(points).toHaveLength(8)
    expect(svg.endsWith('<rect fill="paint"/></g>')).toBe(true)
  })
})
