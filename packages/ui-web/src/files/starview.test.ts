import { describe, expect, it } from 'vitest'
import { drawMetafile, metafileKind } from './metafile.ts'
import { drawStarView } from './starview.ts'

/** Little-endian bytes. */
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]
const i32 = (value: number) => u32(value >>> 0)
const point = (x: number, y: number) => [...i32(x), ...i32(y)]
const narrow = (text: string) => [...u16(text.length), ...[...text].map((letter) => letter.charCodeAt(0))]
const wide = (text: string) => [...u16(text.length), ...[...text].flatMap((letter) => u16(letter.charCodeAt(0)))]

/** A version and the length of what follows (`VersionCompat`). */
const compat = (version: number, body: number[]) => [...u16(version), ...u32(body.length), ...body]

/** An action: its type, then its version and length. */
const action = (type: number, version: number, body: number[]) => [...u16(type), ...compat(version, body)]

/** A StarView metafile of hundredths of a millimetre, of a size, with its actions. */
function starView(actions: number[][], size: [number, number] = [2000, 1000]): Uint8Array {
  const mapping = compat(1, [...u16(0), ...point(0, 0), ...i32(1), ...i32(1), ...i32(1), ...i32(1), 1])
  const header = compat(1, [...u32(0), ...mapping, ...point(...size), ...u32(actions.length)])
  return new Uint8Array([...[...'VCLMTF'].map((letter) => letter.charCodeAt(0)), ...header, ...actions.flat()])
}

const colour = (red: number, green: number, blue: number) => u32((red << 16) | (green << 8) | blue)
const lineColour = (rgb: number[]) => action(132, 1, [...rgb, 1])
const fillColour = (rgb: number[]) => action(133, 1, [...rgb, 1])
const rectangle = (left: number, top: number, right: number, bottom: number) => action(103, 1, [...point(left, top), ...point(right, bottom)])

/** A font: its family, its height, its encoding (0xFFFF Unicode), its weight and slant. */
function font(family: string, height: number, options: { charset?: number; weight?: number; italic?: number } = {}) {
  const body = [
    ...narrow(family),
    ...narrow(''),
    ...point(0, height),
    ...u16(options.charset ?? 1),
    ...u16(0),
    ...u16(0),
    ...u16(options.weight ?? 5),
    ...u16(0),
    ...u16(0),
    ...u16(options.italic ?? 0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    0,
    0,
    0,
    0
  ]
  return action(138, 1, compat(1, body))
}

const svgOf = (bytes: Uint8Array) => new TextDecoder().decode(drawStarView(bytes)?.svg)

/** A colour in StarView's older way: a user's own, red, green and blue in 16 bits each. */
const named = (red: number, green: number, blue: number) => [...u16(0x8000), ...u16(red * 257), ...u16(green * 257), ...u16(blue * 257)]

/** Polygons without curves, after their count. */
const polygons = (...shapes: [number, number][][]) => [
  ...u16(shapes.length),
  ...shapes.flatMap((shape) => [...u16(shape.length), ...shape.flatMap(([x, y]) => point(x, y))])
]

/** A hatch over polygons: its style (0 single, 1 double, 2 triple), colour, distance and angle in tenths of a degree. */
const hatch = (shape: [number, number][], style: number, distance: number, angle: number) =>
  action(126, 1, [...polygons(shape), ...compat(1, [...u16(style), ...named(0, 0, 255), ...i32(distance), ...u16(angle)])])

/** A region of bands, each a top and a bottom and the left and right of its rectangles, as vcl writes one. */
const bands = (...rows: [number, number, [number, number][]][]) =>
  compat(2, [
    ...u16(2),
    ...u16(3),
    ...rows.flatMap(([top, bottom, rectangles]) => [
      ...u16(0),
      ...i32(top),
      ...i32(bottom),
      ...rectangles.flatMap(([left, right]) => [...u16(1), ...i32(left), ...i32(right)])
    ]),
    ...u16(2),
    0
  ])

/** A region of polygons, its bands empty. */
const shapes = (...polygonList: [number, number][][]) => compat(2, [...u16(2), ...u16(3), ...u16(2), 1, ...polygons(...polygonList)])

/** A region of its kind alone: 0 without bounds, 1 empty. */
const bare = (kind: number) => compat(2, [...u16(2), ...u16(kind), ...u16(2), 0])

const clipRegion = (region: number[], clipping = 1) => action(128, 1, [...region, clipping])
const push = (flags: number) => action(139, 1, u16(flags))
const pop = action(140, 1, [])

/** The definition of each clipping, in the order written. */
const clipsOf = (svg: string) =>
  [...svg.matchAll(/<clipPath id="(c\d+)"[^>]*?(?: clip-path="url\(#(c\d+)\)")?><path d="([^"]*)" clip-rule="(\w+)"( transform="[^"]*")?/g)].map((found) =>
    found.slice(1)
  )

/** The clipping each shape is drawn within, in order, by its identifier. */
const clippedBy = (svg: string) => [...svg.matchAll(/<g clip-path="url\(#(c\d+)\)">/g)].map((found) => found[1])

describe('a StarView metafile', () => {
  it('is known by its first bytes, and drawn at the size its header gives', () => {
    const bytes = starView([rectangle(0, 0, 1000, 500)])
    expect(metafileKind(bytes)).toBe('svm')
    const drawn = drawMetafile(bytes)
    expect([Math.round(drawn?.width ?? 0), Math.round(drawn?.height ?? 0)]).toEqual([76, 38])
    expect(drawStarView(new Uint8Array(40))).toBeUndefined()
  })

  it.each([
    [
      'a rectangle filled and outlined in their colours',
      [lineColour(colour(255, 0, 0)), fillColour(colour(0, 0, 255)), rectangle(0, 0, 1000, 500)],
      'd="M0 0L1000 0L1000 500L0 500Z" fill="#0000ff"'
    ],
    ['no outline when its colour is taken away', [action(132, 1, [...colour(255, 0, 0), 0]), rectangle(0, 0, 10, 10)], 'stroke="none"'],
    [
      'a polygon whose flagged points make a curve',
      [
        action(110, 2, [
          ...u16(4),
          ...point(0, 0),
          ...point(100, 0),
          ...point(200, 100),
          ...point(300, 100),
          1,
          ...compat(1, [...u16(4), ...point(0, 0), ...point(100, 0), ...point(200, 100), ...point(300, 100), 1, 0, 2, 2, 0])
        ])
      ],
      'd="M0 0C100 0 200 100 300 100Z"'
    ],
    [
      'polygons filled through a share of transparency',
      [fillColour(colour(0, 128, 0)), action(142, 1, [...u16(1), ...u16(3), ...point(0, 0), ...point(10, 0), ...point(0, 10), ...u16(25)])],
      'fill="#008000" fill-opacity="0.75"'
    ],
    [
      'the state saved before a change, back once it is restored',
      [fillColour(colour(0, 0, 255)), action(139, 1, u16(0xffff)), fillColour(colour(0, 255, 0)), action(140, 1, []), rectangle(0, 0, 10, 10)],
      'fill="#0000ff"'
    ]
  ])('draws %s', (_, actions, expected) => {
    expect(svgOf(starView(actions))).toContain(expected)
  })

  it('writes text at each character’s place, in its font, from its Unicode copy', () => {
    const svg = svgOf(
      starView([
        font('Arial', 400, { weight: 8, italic: 2 }),
        action(113, 2, [...point(100, 500), ...narrow('Hi?'), ...u16(0), ...u16(2), ...i32(2), ...i32(150), ...i32(300), ...wide('Hé')])
      ])
    )
    expect(svg).toContain('x="0 150"')
    expect(svg).toContain(`font-family="'Arial', sans-serif" font-size="400" font-weight="bold" font-style="italic"`)
    expect(svg).toContain('>Hé</text>')
  })

  it('reads a font of Unicode’s strings in 16 bits, and StarMath’s symbols in StarSymbol as the characters they stand for', () => {
    const symbol = (text: string) => [...u32(text.length), ...[...text].flatMap((letter) => u16(letter.charCodeAt(0)))]
    const svg = svgOf(
      starView([
        font('StarSymbol', 400, { charset: 0xffff }),
        action(114, 2, [...point(0, 400), ...symbol(''), ...u32(300), ...u16(0), ...u16(1), ...wide('')])
      ])
    )
    expect(svg).toContain('>+</text>')
  })

  it('reads a gradient’s colours in StarView’s older way, by their name or in 16 bits each', () => {
    const gradient = compat(1, [...u16(0), ...named(255, 0, 0), ...u16(1), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(100), ...u16(100), ...u16(0)])
    const svg = svgOf(starView([action(125, 1, [...point(0, 0), ...point(100, 100), ...gradient])]))
    expect(svg).toContain('stop-color="#ff0000"')
    expect(svg).toContain('stop-color="#000080"')
  })

  it('draws what came before an action cut short', () => {
    const whole = starView([fillColour(colour(255, 0, 0)), rectangle(0, 0, 10, 10), rectangle(0, 0, 20, 20)])
    const svg = svgOf(whole.subarray(0, whole.length - 10))
    expect(svg).toContain('d="M0 0L10 0L10 10L0 10Z"')
  })
})

describe('a StarView metafile’s clipping', () => {
  const triangle: [number, number][] = [
    [0, 0],
    [100, 0],
    [50, 80]
  ]

  it.each([
    [
      'a region of bands, a rectangle for each left and right across each band',
      [
        clipRegion(
          bands(
            [
              0,
              10,
              [
                [0, 20],
                [30, 40]
              ]
            ],
            [11, 30, [[5, 15]]]
          )
        )
      ],
      [['c1', undefined, 'M0 0L20 0L20 10L0 10ZM30 0L40 0L40 10L30 10ZM5 11L15 11L15 30L5 30Z', 'nonzero', undefined]]
    ],
    [
      'a region of polygons, by the even-odd rule, before its bands',
      [clipRegion(shapes(triangle))],
      [['c1', undefined, 'M0 0L100 0L50 80Z', 'evenodd', undefined]]
    ],
    ['an empty region, which clips everything away', [clipRegion(bare(1))], [['c1', undefined, 'M0 0Z', 'nonzero', undefined]]],
    [
      'a region cut by another, within it',
      [clipRegion(shapes(triangle)), action(130, 1, bands([0, 50, [[0, 60]]]))],
      [
        ['c1', undefined, 'M0 0L100 0L50 80Z', 'evenodd', undefined],
        ['c2', 'c1', 'M0 0L60 0L60 50L0 50Z', 'nonzero', undefined]
      ]
    ],
    [
      'a clipping moved, with the clipping it is cut by',
      [clipRegion(shapes(triangle)), action(129, 1, [...point(0, 0), ...point(60, 50)]), action(131, 1, [...i32(5), ...i32(-7)])],
      [
        ['c1', undefined, 'M0 0L100 0L50 80Z', 'evenodd', undefined],
        ['c2', 'c1', 'M0 0L60 0L60 50L0 50Z', 'nonzero', undefined],
        ['c3', undefined, 'M0 0L100 0L50 80Z', 'evenodd', ' transform="translate(5 -7)"'],
        ['c4', 'c3', 'M0 0L60 0L60 50L0 50Z', 'nonzero', ' transform="translate(5 -7)"']
      ]
    ],
    ['bands that end early as no region', [clipRegion(compat(2, [...u16(2), ...u16(3), ...u16(0), ...i32(0)]))], []]
  ])('follows %s', (_, clipping, expected) => {
    const svg = svgOf(starView([...clipping, rectangle(0, 0, 200, 200)]))
    expect(clipsOf(svg)).toEqual(expected)
    expect(clippedBy(svg)).toEqual(expected.length > 0 ? [expected.at(-1)?.[0]] : [])
  })

  it.each([
    ['taken away by a region without bounds', [clipRegion(shapes(triangle)), clipRegion(bare(0))], []],
    ['taken away when its flag says there is none', [clipRegion(shapes(triangle)), clipRegion(shapes(triangle), 0)], []],
    ['left as it is by a region without bounds that cuts it', [clipRegion(shapes(triangle)), action(130, 1, bare(0))], ['c1']],
    ['brought back by a save that names it', [push(0x20), clipRegion(shapes(triangle)), pop], []],
    ['kept by a save that names only colours', [push(0x03), clipRegion(shapes(triangle)), pop], ['c1']]
  ])('is %s', (_, clipping, expected) => {
    expect(clippedBy(svgOf(starView([...clipping, rectangle(0, 0, 200, 200)])))).toEqual(expected)
  })

  it('brings back only what a save names', () => {
    const svg = svgOf(
      starView([
        fillColour(colour(0, 0, 255)),
        lineColour(colour(0, 255, 0)),
        push(0x02),
        fillColour(colour(255, 0, 0)),
        lineColour(colour(255, 0, 0)),
        pop,
        rectangle(0, 0, 10, 10)
      ])
    )
    expect(svg).toContain('fill="#0000ff"')
    expect(svg).toContain('stroke="#ff0000"')
  })
})

describe('a StarView metafile’s hatch', () => {
  const square: [number, number][] = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000]
  ]
  /** The lines drawn and the shape they are clipped to. */
  const linesOf = (svg: string) => {
    const lines =
      /<path d="([^"]*)" fill="none" stroke="(#[0-9a-f]{6})" stroke-width="1" vector-effect="non-scaling-stroke" clip-path="url\(#(c\d+)\)"\/>/.exec(svg)
    const clip = lines ? new RegExp(`<clipPath id="${lines[3]}"[^>]*><path d="([^"]*)" clip-rule="evenodd"`).exec(svg) : null
    return {
      lines: [...(lines?.[1] ?? '').matchAll(/M([^\sML]+) ([^\sML]+)L([^\sML]+) ([^\sML]+)/g)].map((line) => line.slice(1).map(Number)),
      colour: lines?.[2],
      shape: clip?.[1]
    }
  }
  /** The angle of a line on the picture, counterclockwise from the right, in whole degrees from 0 to 179. */
  const angleOf = ([x1, y1, x2, y2]: number[]) => (Math.round((Math.atan2(-((y2 ?? 0) - (y1 ?? 0)), (x2 ?? 0) - (x1 ?? 0)) * 180) / Math.PI) + 360) % 180

  it.each([
    ['single, at its angle', 0, 450, [45]],
    ['double, a second set across it', 1, 0, [0, 90]],
    ['triple, a third set between them', 2, 300, [30, 75, 120]]
  ])('draws a hatch %s, in its colour, clipped to its polygons', (_, style, angle, angles) => {
    const { lines, colour: drawn, shape } = linesOf(svgOf(starView([hatch(square, style, 100, angle)])))
    expect(drawn).toBe('#0000ff')
    expect(shape).toBe('M0 0L1000 0L1000 1000L0 1000Z')
    expect([...new Set(lines.map(angleOf))].sort((one, other) => one - other)).toEqual(angles)
  })

  it('places its lines its distance apart, one through the top left corner of its box a pixel out of it', () => {
    const { lines } = linesOf(svgOf(starView([hatch(square, 0, 100, 0)])))
    const heights = lines.map(([, y]) => y ?? 0)
    const pixel = 2540 / 96
    expect(heights).toContain(Math.round(-pixel * 100) / 100)
    expect(Math.round((heights[1] ?? 0) - (heights[0] ?? 0))).toBe(100)
  })

  it('keeps its lines three pixels apart at least, and draws a dense one with fewer', () => {
    const near = linesOf(svgOf(starView([hatch(square, 0, 1, 0)]))).lines
    expect(Math.round(((near[1]?.[1] ?? 0) - (near[0]?.[1] ?? 0)) * 100) / 100).toBe(79.38)
    const huge: [number, number][] = [
      [0, 0],
      [2_000_000_000, 0],
      [2_000_000_000, 2_000_000_000]
    ]
    expect(linesOf(svgOf(starView([rectangle(0, 0, 10, 10), hatch(huge, 2, 1, 0)]))).lines.length).toBeLessThanOrEqual(3 * 1026)
  })
})
