import { describe, expect, it } from 'vitest'
import { flattened } from './open-drawing.ts'
import { apply, compose, FACE_LIMIT, readAngle, readTransform, readVector, type SceneSource, sceneElement, type Transform, type Vector } from './open-scene.ts'
import type { Properties } from './open-styles.ts'
import { type XmlNode, xmlTree } from './xml.ts'

const STYLES: Record<string, Properties> = {
  red: { 'draw:fill-color': '#ff0000', 'dr3d:depth': '1cm' },
  hollow: { 'draw:fill-color': '#00ff00', 'dr3d:end-angle': '1800', 'dr3d:horizontal-segments': '4' },
  fine: { 'dr3d:horizontal-segments': '200', 'dr3d:vertical-segments': '200' },
  lined: { 'draw:fill': 'none', 'draw:stroke': 'solid', 'svg:stroke-color': '#0000ff', 'svg:stroke-width': '2px' }
}

const SOURCE: SceneSource = {
  style: (node) => STYLES[node.attributes['draw:style-name'] ?? ''] ?? {},
  fill: '#729fcf',
  polygons: (data) => flattened(data)
}

const LIGHT = '<dr3d:light dr3d:diffuse-color="#cccccc" dr3d:direction="(0 0 1)" dr3d:enabled="true" dr3d:specular="false"/>'

/** The scene an element of XML is. */
const sceneOf = (xml: string) => xmlTree(xml).children[0] as XmlNode

/** A scene of the objects given, seen from the front in parallel unless it says otherwise, lit from the front. */
const scene = (objects: string, attributes = 'dr3d:projection="parallel"', light = LIGHT) =>
  sceneOf(`<dr3d:scene dr3d:vrp="(0 0 10000)" dr3d:vpn="(0 0 1)" dr3d:ambient-color="#000000" ${attributes}>${light}${objects}</dr3d:scene>`)

const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)"/g)].map(([, data, fill]) => ({ data: data as string, fill: fill as string }))

const pointsOf = (data: string) => [...data.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)] as const)

describe('the reading of a 3D scene', () => {
  it.each<[string, Vector | undefined]>([
    ['(1 2 3)', [1, 2, 3]],
    ['( -1.5  0 2e3 )', [-1.5, 0, 2000]],
    ['(1cm 0 0)', [1000, 0, 0]],
    ['(1 2)', undefined],
    ['1 2 3', undefined]
  ])('reads the vector %s', (value, expected) => {
    expect(readVector(value)?.map((part) => Math.round(part * 1000) / 1000)).toEqual(expected)
  })

  it.each<[string, number, number | undefined]>([
    ['151.2deg', Math.PI / 1800, (151.2 * Math.PI) / 180],
    ['168grad', Math.PI / 1800, (168 * Math.PI) / 200],
    ['2.6389rad', Math.PI / 1800, 2.6389],
    ['1512', Math.PI / 1800, (151.2 * Math.PI) / 180],
    ['0.5', 1, 0.5],
    ['wide', 1, undefined]
  ])('reads the angle %s', (value, unitless, expected) => {
    const found = readAngle(value, unitless)
    expect(found === undefined ? undefined : Math.round(found * 1e6)).toEqual(expected === undefined ? undefined : Math.round(expected * 1e6))
  })

  it.each<[string, Vector, Vector]>([
    ['matrix (1 0 0 0 1 0 0 0 1 4cm 0cm 0cm)', [1, 2, 3], [4001, 2, 3]],
    // The images of the axes come first: y goes where z was, z where minus y was.
    ['matrix (1 0 0 0 0 1 0 -1 0 0cm 0cm 0cm)', [0, 1000, 0], [0, 0, 1000]],
    ['translate (1 2 3) scale (2 2 2)', [1, 1, 1], [3, 4, 5]],
    ['rotatez (90deg)', [1, 0, 0], [0, 1, 0]],
    ['', [1, 2, 3], [1, 2, 3]]
  ])('applies the transform %s', (value, point, expected) => {
    expect(apply(readTransform(value), point).map((part) => Math.round(part * 1000) / 1000)).toEqual(expected)
  })

  it('composes transforms, the inner first', () => {
    const move: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0]
    const double: Transform = [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]
    expect(apply(compose(double, move), [1, 0, 0])).toEqual([22, 0, 0])
    expect(apply(compose(move, double), [1, 0, 0])).toEqual([12, 0, 0])
  })
})

describe('a 3D scene drawn', () => {
  it('draws a cube seen from the front as its front face filling the scene’s box, lit by the light toward it', () => {
    const svg = sceneElement(
      scene('<dr3d:cube draw:style-name="red" dr3d:min-edge="(0 0 0)" dr3d:max-edge="(1000 1000 1000)"/>'),
      { width: 100, height: 50 },
      SOURCE
    )
    const drawn = paths(svg)
    expect(drawn).toHaveLength(6)
    // Its front face is painted last, nearest, in the colour the light toward it gives its red.
    const front = drawn[drawn.length - 1]
    expect(front?.fill).toBe('#cc0000')
    const points = pointsOf(front?.data ?? '')
    expect(Math.min(...points.map(([x]) => x))).toBe(0)
    expect(Math.max(...points.map(([x]) => x))).toBe(100)
    expect(Math.max(...points.map(([, y]) => y))).toBe(50)
  })

  it('sees a scene in perspective, its nearer side larger, and fits the box of what it holds to the scene’s box', () => {
    // A cube turned a quarter about the vertical axis is seen from its side; in perspective its far edge is smaller.
    const turned = '<dr3d:cube dr3d:min-edge="(-1000 -1000 -1000)" dr3d:max-edge="(1000 1000 1000)" dr3d:transform="rotatey (0.3)"/>'
    const near = paths(sceneElement(scene(turned, 'dr3d:projection="perspective"'), { width: 100, height: 100 }, SOURCE))
    const all = near.flatMap(({ data }) => pointsOf(data))
    // The box of the turned cube is wider than the cube seen: it lies within the scene's box.
    expect(Math.min(...all.map(([x]) => x))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...all.map(([x]) => x))).toBeLessThanOrEqual(100)
    const heights = near.map(({ data }) => {
      const ys = pointsOf(data).map(([, y]) => y)
      return Math.max(...ys) - Math.min(...ys)
    })
    expect(new Set(heights.map(Math.round)).size).toBeGreaterThan(1)
    // A camera behind what the scene holds sees it in parallel instead.
    const behind = sceneElement(
      sceneOf(`<dr3d:scene dr3d:vrp="(0 0 -10000)" dr3d:projection="perspective">${turned}</dr3d:scene>`),
      { width: 100, height: 100 },
      SOURCE
    )
    expect(paths(behind).length).toBeGreaterThan(0)
  })

  it('makes a sphere of its segments, twice as fine when the scene is shaded smoothly', () => {
    const sphere = '<dr3d:sphere dr3d:center="(0 0 0)" dr3d:size="(2000 2000 2000)"/>'
    expect(paths(sceneElement(scene(sphere, 'dr3d:projection="parallel" dr3d:shade-mode="flat"'), { width: 50, height: 50 }, SOURCE))).toHaveLength(24 * 24)
    expect(paths(sceneElement(scene(sphere, 'dr3d:projection="parallel" dr3d:shade-mode="gouraud"'), { width: 50, height: 50 }, SOURCE))).toHaveLength(48 * 48)
    // As many faces as the limit at most.
    const many = Array.from({ length: 4 }, () => '<dr3d:sphere draw:style-name="fine"/>').join('')
    expect(paths(sceneElement(scene(many, 'dr3d:shade-mode="flat"'), { width: 50, height: 50 }, SOURCE)).length).toBeLessThanOrEqual(FACE_LIMIT)
  })

  it('extrudes an outline by its depth, closed at both ends, and turns an outline about the axis by its end angle', () => {
    const square = 'svg:viewBox="0 0 1000 1000" svg:d="M0 0L1000 0 1000 1000 0 1000Z"'
    const extruded = paths(sceneElement(scene(`<dr3d:extrude draw:style-name="red" ${square}/>`), { width: 50, height: 50 }, SOURCE))
    expect(extruded).toHaveLength(4 + 2)
    // An open outline is a band, with no ends.
    const band = paths(
      sceneElement(scene('<dr3d:extrude svg:viewBox="0 0 1000 0" svg:d="M0 0h1000"/>', 'dr3d:projection="perspective"'), { width: 50, height: 50 }, SOURCE)
    )
    expect(band).toHaveLength(1)
    // Half a turn in four steps: four faces for each side of the square, and its two ends.
    const turned = paths(
      sceneElement(
        scene(`<dr3d:rotate draw:style-name="hollow" ${square.replace('M0 0', 'M500 0')}/>`, 'dr3d:shade-mode="flat"'),
        { width: 50, height: 50 },
        SOURCE
      )
    )
    expect(turned).toHaveLength(4 * 4 + 2)
  })

  it('draws an object of no fill by its lines, and a scene holding nothing as nothing', () => {
    const svg = sceneElement(scene('<dr3d:cube draw:style-name="lined"/>'), { width: 50, height: 50 }, SOURCE)
    expect(svg).toContain('fill="none"')
    expect(svg).toContain('stroke="#0000ff" stroke-width="2"')
    expect(sceneElement(scene(''), { width: 50, height: 50 }, SOURCE)).toBe('')
    expect(sceneElement(scene('<dr3d:extrude svg:d="M0 0"/>'), { width: 50, height: 50 }, SOURCE)).toBe('')
  })

  it('places what a scene within the scene holds by that scene’s transform', () => {
    const inner = '<dr3d:scene dr3d:transform="translate (3000 0 0)"><dr3d:cube dr3d:min-edge="(0 0 0)" dr3d:max-edge="(1000 1000 1000)"/></dr3d:scene>'
    const svg = sceneElement(scene(`<dr3d:cube dr3d:min-edge="(0 0 0)" dr3d:max-edge="(1000 1000 1000)"/>${inner}`), { width: 400, height: 100 }, SOURCE)
    const xs = paths(svg).flatMap(({ data }) => pointsOf(data).map(([x]) => x))
    // The two cubes span four thousandths of the box: the first a quarter of it, the second from three quarters.
    expect(xs.filter((x) => x > 100 && x < 300)).toHaveLength(0)
    expect(Math.max(...xs)).toBe(400)
  })
})
