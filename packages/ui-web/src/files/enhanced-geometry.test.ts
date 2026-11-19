import { describe, expect, it } from 'vitest'
import { enhancedGeometry, evaluate, pathCommands } from './enhanced-geometry.ts'
import { xmlTree } from './xml.ts'

const context = {
  view: { left: 0, top: 0, width: 21_600, height: 10_800 },
  width: 2540,
  height: 1270,
  modifiers: [5400, 3],
  equation: (name: string) => (name === 'f0' ? 100 : 0)
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
    ['atan2(0, 1) * 2 / pi', 1],
    ['4 / 0', 0],
    ['2 +', 2],
    ['unknown + 1', 1]
  ])('works out %s', (formula, expected) => {
    expect(evaluate(formula, context)).toBeCloseTo(expected, 6)
  })

  it('reads a path’s commands with their numbers worked out, passing over the letters it does not draw', () => {
    expect(pathCommands('M 0 ?f0 L $0 bottom right 0 Z N I 1 2 F', context)).toEqual([
      { command: 'M', values: [0, 100] },
      { command: 'L', values: [5400, 10_800, 21_600, 0] },
      { command: 'Z', values: [] },
      { command: 'N', values: [] },
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
    expect(drawn.geometry).toEqual({ fill: 'M100 0L200 0L200 100L0 100Z', stroke: 'M100 0L200 0L200 100L0 100Z' })
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

  it('draws a kind it names when it gives no path', () => {
    expect(enhancedGeometry(geometry('draw:type="ellipse"'), { width: 20, height: 10 }).geometry.fill).toBe('M0 5A10 5 0 1 1 20 5A10 5 0 1 1 0 5Z')
    expect(enhancedGeometry(geometry('draw:type="mso-spt100"'), { width: 2, height: 1 }).geometry.fill).toBe('M0 0L2 0L2 1L0 1Z')
  })
})
