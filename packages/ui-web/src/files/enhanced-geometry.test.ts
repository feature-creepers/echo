import { describe, expect, it } from 'vitest'
import { enhancedGeometry, evaluate, pathCommands, shadingOf } from './enhanced-geometry.ts'
import { xmlTree } from './xml.ts'

const context = {
  view: { left: 0, top: 0, width: 21_600, height: 10_800 },
  width: 2540,
  height: 1270,
  modifiers: [5400, 3],
  equation: (name: string) => (name === 'f0' ? 100 : 0),
  stretch: { x: 1, y: 1 }
}

describe('a formula of a custom shape', () => {
  it.each<[string, number]>([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['-4 / 2 - -1', -1],
    ['$0 / 2 + $1', 2703],
    ['?f0 * 2', 200],
    ['right - left + bottom', 32_400],
    ['logwidth / 2 + logheight', 2540],
    ['max(3, min(10, 7)) + abs(-2)', 9],
    ['if(-1, 10, 20) + if(1, 1, 2)', 21],
    ['sqrt(16) + sin(0) + cos(0)', 5],
    ['atan2(1, 0) * 2 / pi', 1],
    ['atan2(0, 1)', 0],
    ['4 / 0', 0],
    ['2 +', 2],
    ['unknown + 1', 1]
  ])('works out %s', (formula, expected) => {
    expect(evaluate(formula, context)).toBeCloseTo(expected, 6)
  })

  it('reads a path’s commands with their numbers worked out, passing over the letters it does not draw', () => {
    expect(pathCommands('M 0 ?f0 L $0 bottom right 0 Z N H R 1 2 F', context)).toEqual([
      { command: 'M', values: [0, 100] },
      { command: 'L', values: [5400, 10_800, 21_600, 0] },
      { command: 'Z', values: [] },
      { command: 'N', values: [] },
      { command: 'H', values: [] },
      { command: 'F', values: [] }
    ])
  })
})

/** An enhanced geometry element from its attributes and equations. */
const geometry = (attributes: string, equations = '') =>
  xmlTree(`<draw:enhanced-geometry ${attributes}>${equations}</draw:enhanced-geometry>`).children[0] as Parameters<typeof enhancedGeometry>[0]

describe('a custom shape’s geometry', () => {
  it('draws its path from its equations and adjustments, in its box, with the box of its text', () => {
    const drawn = enhancedGeometry(
      geometry(
        'svg:viewBox="0 0 100 100" draw:modifiers="25" draw:enhanced-path="M ?f0 0 L 100 0 100 100 0 100 Z N" draw:text-areas="?f0 0 right bottom"',
        '<draw:equation draw:name="f0" draw:formula="$0 * 2"/>'
      ),
      { width: 200, height: 100 }
    )
    expect(drawn.geometry).toMatchObject({
      fill: 'M100 0L200 0L200 100L0 100Z',
      stroke: 'M100 0L200 0L200 100L0 100Z',
      outlines: ['M100 0L200 0L200 100L0 100Z']
    })
    expect(drawn.text).toEqual({ x: 100, y: 0, width: 100, height: 100 })
  })

  it('takes an equation that names itself as zero, and turns over as it says', () => {
    const drawn = enhancedGeometry(
      geometry(
        'svg:viewBox="0 0 10 10" draw:mirror-horizontal="true" draw:enhanced-path="M ?f0 ?f1 L 10 10"',
        '<draw:equation draw:name="f0" draw:formula="?f1 + 1"/><draw:equation draw:name="f1" draw:formula="?f0 + 1"/>'
      ),
      { width: 10, height: 10 }
    )
    expect(drawn.geometry.stroke).toBe('M2 1L10 10')
    expect(drawn.flipH).toBe(true)
  })

  it('keeps the corners of a shape with a stretch point round, its far edge stretched to its longer side', () => {
    const rounded = (size: { width: number; height: number }) =>
      enhancedGeometry(
        geometry(
          'svg:viewBox="0 0 100 100" draw:path-stretchpoint-x="50" draw:path-stretchpoint-y="50" draw:modifiers="10" draw:enhanced-path="M ?f0 0 L ?f1 0 X 100 10 L 100 100 0 100 Z N" draw:text-areas="0 0 right bottom"',
          '<draw:equation draw:name="f0" draw:formula="left+$0"/><draw:equation draw:name="f1" draw:formula="right-$0"/>'
        ),
        size
      )
    const wide = rounded({ width: 300, height: 100 })
    expect(wide.geometry.stroke).toBe('M10 0L290 0A10 10 0 0 1 300 10L300 100L0 100Z')
    expect(wide.text).toEqual({ x: 0, y: 0, width: 300, height: 100 })
    expect(rounded({ width: 100, height: 200 }).geometry.stroke).toBe('M10 0L90 0A10 10 0 0 1 100 10L100 200L0 200Z')
  })

  it('draws the path with arcs LibreOffice writes for itself rather than the one without them', () => {
    const drawn = enhancedGeometry(geometry('svg:viewBox="0 0 10 10" draw:enhanced-path="M 0 10 L 10 10 N" drawooo:enhanced-path="M 0 10 G 5 5 180 180 N"'), {
      width: 10,
      height: 10
    })
    expect(drawn.geometry.stroke).toMatch(/^M0 10A5 5 /)
  })

  it('reads a view box of no size as the shape’s own size in hundredths of a millimetre', () => {
    const drawn = enhancedGeometry(geometry('svg:viewBox="0 0 0 0" draw:enhanced-path="M 0 0 L logwidth 0 logwidth logheight Z N"'), { width: 96, height: 48 })
    expect(drawn.geometry.stroke).toBe('M0 0L96 0L96 48Z')
  })

  it('draws a kind it names when it gives no path', () => {
    expect(enhancedGeometry(geometry('draw:type="ellipse"'), { width: 20, height: 10 }).geometry.fill).toBe('M0 5A10 5 0 1 1 20 5A10 5 0 1 1 0 5Z')
    expect(enhancedGeometry(geometry('draw:type="mso-spt100"'), { width: 2, height: 1 }).geometry.fill).toBe('M0 0L2 0L2 1L0 1Z')
  })
})

describe('the shading of a custom shape’s parts', () => {
  const geometry = (pieces: number) => ({
    fill: 'M0 0Z',
    stroke: 'M0 0Z',
    pieces: pieces > 1 ? Array.from({ length: pieces }, () => 'M0 0Z') : undefined,
    shading: { rule: 'blend' as const, amounts: [-0.4] }
  })
  it.each([
    { type: 'non-primitive', pieces: 1, expected: { rule: 'blend', amounts: [-0.4] } },
    { type: 'ooxml-cube', pieces: 1, expected: { rule: 'blend', amounts: [-0.4] } },
    { type: 'cube', pieces: 3, expected: { rule: 'value', amounts: [0, 0.2, -0.2] } },
    { type: 'can', pieces: 2, expected: { rule: 'value', amounts: [0, 0.4] } },
    { type: 'paper', pieces: 3, expected: { rule: 'value', amounts: [0, -0.2, -0.2] } },
    { type: 'col-60da8460', pieces: 7, expected: { rule: 'value', amounts: [0, -0.2, -0.4, -0.4, 0.2, 0.4, 0.4] } },
    { type: 'col-20400000', pieces: 2, expected: { rule: 'value', amounts: [0, 0.4] } },
    { type: 'cube', pieces: 1, expected: undefined },
    { type: 'rectangle', pieces: 1, expected: undefined },
    { type: '', pieces: 1, expected: undefined }
  ])('shades the parts of a $type of $pieces parts', ({ type, pieces, expected }) => {
    expect(shadingOf(type, geometry(pieces))).toEqual(expected)
  })
})
