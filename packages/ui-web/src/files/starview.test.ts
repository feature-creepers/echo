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

  it('draws what came before an action cut short', () => {
    const whole = starView([fillColour(colour(255, 0, 0)), rectangle(0, 0, 10, 10), rectangle(0, 0, 20, 20)])
    const svg = svgOf(whole.subarray(0, whole.length - 10))
    expect(svg).toContain('d="M0 0L10 0L10 10L0 10Z"')
  })
})
