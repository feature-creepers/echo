import { describe, expect, it } from 'vitest'
import { customGeometry, type PathCommand } from './custom-geometry.ts'

const square = { left: 0, top: 0, width: 100, height: 100 }

/** A path of commands in a view box of 100 by 100, drawn at 200 by 100 pixels. */
const drawn = (commands: PathCommand[]) => customGeometry(commands, square, { width: 200, height: 100 })

describe('a shape drawn by its own path', () => {
  it.each<[string, PathCommand[], { fill: string; stroke: string; pieces?: string[] }]>([
    [
      'two paths, each filled on its own, the second over the first and no hole in it',
      [
        { command: 'M', values: [0, 0] },
        { command: 'L', values: [100, 0, 100, 100] },
        { command: 'Z', values: [] },
        { command: 'N', values: [] },
        { command: 'M', values: [50, 0] },
        { command: 'L', values: [100, 0, 100, 50] },
        { command: 'Z', values: [] },
        { command: 'N', values: [] }
      ],
      {
        fill: 'M0 0L200 0L200 100ZM100 0L200 0L200 50Z',
        stroke: 'M0 0L200 0L200 100ZM100 0L200 0L200 50Z',
        pieces: ['M0 0L200 0L200 100Z', 'M100 0L200 0L200 50Z']
      }
    ],
    [
      'lines and curves, scaled from the view box to the box',
      [
        { command: 'M', values: [0, 0] },
        { command: 'L', values: [100, 0, 100, 100] },
        { command: 'C', values: [50, 100, 0, 50, 0, 0] },
        { command: 'Z', values: [] },
        { command: 'N', values: [] }
      ],
      { fill: 'M0 0L200 0L200 100C100 100 0 50 0 0Z', stroke: 'M0 0L200 0L200 100C100 100 0 50 0 0Z' }
    ],
    [
      'an open path, filled as if it were closed',
      [
        { command: 'M', values: [0, 0, 50, 50] },
        { command: 'Q', values: [100, 0, 100, 100] }
      ],
      { fill: 'M0 0L100 50Q200 0 200 100', stroke: 'M0 0L100 50Q200 0 200 100' }
    ],
    [
      'a path left unfilled, and another left unstroked',
      [
        { command: 'M', values: [0, 0] },
        { command: 'L', values: [100, 100] },
        { command: 'F', values: [] },
        { command: 'N', values: [] },
        { command: 'M', values: [0, 100] },
        { command: 'L', values: [100, 0] },
        { command: 'S', values: [] },
        { command: 'N', values: [] }
      ],
      { fill: 'M0 100L200 0', stroke: 'M0 0L200 100' }
    ],
    [
      'quarters of an ellipse, leaving along x then along y',
      [
        { command: 'M', values: [50, 0] },
        { command: 'X', values: [0, 50, 50, 100] }
      ],
      { fill: 'M100 0A100 50 0 0 0 0 50A100 50 0 0 0 100 100', stroke: 'M100 0A100 50 0 0 0 0 50A100 50 0 0 0 100 100' }
    ],
    [
      'a whole ellipse by its centre, radii and angles, as two halves',
      [{ command: 'U', values: [50, 50, 50, 50, 0, 360] }],
      { fill: 'M200 50A100 50 0 0 0 0 50A100 50 0 0 0 200 50', stroke: 'M200 50A100 50 0 0 0 0 50A100 50 0 0 0 200 50' }
    ],
    [
      'an arc of an ellipse by its box, counter-clockwise from one ray to another',
      [{ command: 'B', values: [0, 0, 100, 100, 100, 50, 50, 0] }],
      { fill: 'M200 50A100 50 0 0 0 100 0', stroke: 'M200 50A100 50 0 0 0 100 0' }
    ],
    [
      'the same arc clockwise, the long way round',
      [{ command: 'V', values: [0, 0, 100, 100, 100, 50, 50, 0] }],
      {
        fill: 'M200 50A100 50 0 0 1 0 50A100 50 0 0 1 100 0',
        stroke: 'M200 50A100 50 0 0 1 0 50A100 50 0 0 1 100 0'
      }
    ]
  ])('draws %s', (_, commands, expected) => {
    expect(drawn(commands)).toMatchObject(expected)
  })

  it('draws nothing in an empty view box, and leaves out numbers that make no whole step', () => {
    expect(customGeometry([{ command: 'L', values: [1, 1] }], { left: 0, top: 0, width: 0, height: 0 }, { width: 10, height: 10 })).toMatchObject({
      fill: 'M0 0',
      stroke: 'M0 0'
    })
    expect(drawn([{ command: 'C', values: [1, 2, 3] }])).toMatchObject({ fill: '', stroke: '', outlines: [] })
  })

  it('keeps every subpath in its order, filled, stroked or neither, for the lines a Fontwork follows', () => {
    const commands: PathCommand[] = [
      { command: 'M', values: [0, 0] },
      { command: 'L', values: [100, 0] },
      { command: 'F', values: [] },
      { command: 'S', values: [] },
      { command: 'N', values: [] },
      { command: 'M', values: [0, 100] },
      { command: 'L', values: [100, 100] },
      { command: 'Z', values: [] },
      { command: 'N', values: [] }
    ]
    expect(drawn(commands)).toMatchObject({ fill: 'M0 100L200 100Z', stroke: 'M0 100L200 100Z', outlines: ['M0 0L200 0', 'M0 100L200 100Z'] })
  })
})

describe('a shape’s paths darkened and lightened', () => {
  const square = (shade: string): PathCommand[] => [
    ...(shade ? [{ command: shade, values: [] }] : []),
    { command: 'M', values: [0, 0] },
    { command: 'L', values: [100, 0] },
    { command: 'L', values: [100, 100] },
    { command: 'Z', values: [] },
    { command: 'N', values: [] }
  ]
  it.each([
    { name: 'darkened', shade: 'H', amount: -0.4 },
    { name: 'darkened less', shade: 'I', amount: -0.2 },
    { name: 'lightened', shade: 'J', amount: 0.4 },
    { name: 'lightened less', shade: 'K', amount: 0.2 }
  ])('keeps a path $name, until the path ends', ({ shade, amount }) => {
    expect(drawn([...square(shade), ...square('')]).shading).toEqual({ rule: 'blend', amounts: [amount, 0] })
  })

  it('keeps no shading for paths that are not shaded', () => {
    expect(drawn(square('')).shading).toBeUndefined()
  })
})
