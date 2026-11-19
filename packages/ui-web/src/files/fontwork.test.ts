import { describe, expect, it } from 'vitest'
import { advanceOf, type FontworkGlyph, type FontworkStyle, fontworkElement, glyphCorners, inkOf, layFontwork } from './fontwork.ts'
import { Canvas } from './slide-svg.ts'

type Point = [number, number]

const STYLE: FontworkStyle = {
  font: { family: 'Liberation Sans', bold: false, italic: false },
  size: 24,
  letterSpacing: 0,
  scaleToShape: false,
  sameLetterHeights: false,
  fitToSize: false,
  align: 'center',
  vertical: 'middle',
  legacy: false
}

const line = (y: number, from = 0, to = 300): Point[] => [
  [from, y],
  [to, y]
]

/** Where a point of a letter's own units goes in the shape. */
const at = ({ matrix: [a, b, c, d, e, f] }: FontworkGlyph, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f]

/** The box around every letter's corners. */
function bounds(glyphs: FontworkGlyph[], style = STYLE) {
  const corners = glyphCorners(glyphs, style)
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

describe('a Fontwork’s letters laid along its paths', () => {
  it.each([
    { name: 'no path', outlines: [], lines: ['Text'] },
    { name: 'no text', outlines: [line(50)], lines: [] },
    { name: 'only spaces', outlines: [line(50)], lines: ['   '] },
    { name: 'a path of one point', outlines: [[[0, 0]] as Point[]], lines: ['Text'] }
  ])('places nothing for $name', ({ outlines, lines }) => {
    expect(layFontwork(outlines, lines, STYLE, 100)).toEqual([])
  })

  it('lays one line along one path, upright and centred on it, as long as the path', () => {
    const glyphs = layFontwork([line(50)], ['HHHH'], STYLE, 100)
    expect(glyphs.map((glyph) => glyph.character).join('')).toBe('HHHH')
    const box = bounds(glyphs)
    expect(box.left).toBeCloseTo(0, 0)
    expect(box.right).toBeCloseTo(300, 0)
    expect((box.top + box.bottom) / 2).toBeCloseTo(50, 0)
    for (const glyph of glyphs) {
      expect(glyph.matrix[1]).toBeCloseTo(0, 6)
      expect(glyph.matrix[0]).toBeGreaterThan(0)
    }
  })

  it('turns each letter along a slanting path', () => {
    const glyphs = layFontwork(
      [
        [
          [0, 0],
          [300, 300]
        ]
      ],
      ['HHH'],
      STYLE,
      100
    )
    for (const glyph of glyphs) expect(Math.atan2(glyph.matrix[1], glyph.matrix[0])).toBeCloseTo(Math.PI / 4, 3)
  })

  it('stretches the letters between two paths, the upper and the lower, their ink touching both', () => {
    const glyphs = layFontwork([line(20), line(80)], ['Hello'], STYLE, 100)
    const box = bounds(glyphs)
    expect(box.top).toBeCloseTo(20, 0)
    expect(box.bottom).toBeCloseTo(80, 0)
    expect(box.left).toBeCloseTo(0, 0)
    expect(box.right).toBeCloseTo(300, 0)
    // A small letter reaches the lower path but not the upper one.
    const small = glyphs.find((glyph) => glyph.character === 'e') as FontworkGlyph
    const smallTop = at(small, [small.width / 2, -(inkOf('e', { capital: 0.716, small: 0.519, tall: 0.716, descender: -0.21, ascent: 0.905 })?.top ?? 0) * 100])
    expect(smallTop[1]).toBeGreaterThan(30)
  })

  it('follows paths that rise and fall, each letter as tall as the paths are apart where it stands', () => {
    const upper: Point[] = [
      [0, 0],
      [150, 40],
      [300, 0]
    ]
    const lower: Point[] = [
      [0, 100],
      [150, 60],
      [300, 100]
    ]
    const glyphs = layFontwork([upper, lower], ['HHHHHH'], STYLE, 100)
    const height = (glyph: FontworkGlyph) => {
      const top = at(glyph, [glyph.width / 2, -71.6])
      const bottom = at(glyph, [glyph.width / 2, 0])
      return bottom[1] - top[1]
    }
    const [first, middle] = [glyphs[0] as FontworkGlyph, glyphs[2] as FontworkGlyph]
    expect(height(first)).toBeGreaterThan(height(middle))
  })

  it('shares the lines among the text areas, as many to each as are left over the areas left', () => {
    const glyphs = layFontwork([line(10), line(40), line(60), line(90)], ['A', 'B', 'C'], STYLE, 100)
    const centre = (character: string) => {
      const glyph = glyphs.find((one) => one.character === character) as FontworkGlyph
      return at(glyph, [glyph.width / 2, -35])[1]
    }
    expect(centre('A')).toBeLessThan(40)
    expect(centre('B')).toBeLessThan(40)
    expect(centre('C')).toBeGreaterThan(60)
  })

  it('keeps the text’s own size along the path when its scale is the shape’s, and makes it smaller to fit', () => {
    const own = layFontwork([line(50)], ['HH'], { ...STYLE, scaleToShape: true, size: 24 }, 100)
    expect(bounds(own).bottom - bounds(own).top).toBeCloseTo(24 * 0.716, 1)
    const long = layFontwork([line(50, 0, 60)], ['HHHHHHHHHH'], { ...STYLE, scaleToShape: true, size: 24 }, 100)
    expect(bounds(long).right - bounds(long).left).toBeLessThanOrEqual(61)
  })

  it('makes every letter as tall as the tallest when its letters are to be of the same height', () => {
    const glyphs = layFontwork([line(50)], ['Ho'], { ...STYLE, sameLetterHeights: true }, 100)
    const [capital, small] = glyphs.map((glyph) => Math.hypot(glyph.matrix[2], glyph.matrix[3]))
    expect(small).toBeGreaterThan((capital ?? 0) * 1.3)
  })

  it('lays several lines on one path beside it, the first above, and in the older way along the path itself', () => {
    for (const legacy of [false, true]) {
      const glyphs = layFontwork([line(50)], ['AAA', 'BBB'], { ...STYLE, legacy }, 100)
      const middle = (character: string) => {
        const glyph = glyphs.find((one) => one.character === character) as FontworkGlyph
        return at(glyph, [glyph.width / 2, -35])[1]
      }
      expect(middle('A')).toBeLessThan(50)
      expect(middle('B')).toBeGreaterThan(50)
    }
  })

  it('stops at a few thousand letters, so a damaged file costs little', () => {
    expect(layFontwork([line(50)], ['x'.repeat(100_000)], STYLE, 100).length).toBeLessThanOrEqual(4000)
  })
})

describe('the measures of a letter', () => {
  it.each([
    { character: 'H', font: STYLE.font, advance: 0.722 },
    { character: 'i', font: STYLE.font, advance: 0.222 },
    { character: 'b', font: { ...STYLE.font, bold: true }, advance: 0.611 },
    { character: 'a', font: { ...STYLE.font, family: 'Liberation Serif' }, advance: 0.444 },
    { character: 'é', font: STYLE.font, advance: 0.556 },
    { character: '漢', font: STYLE.font, advance: 1 }
  ])('gives $character its advance', ({ character, font, advance }) => {
    expect(advanceOf(character, font)).toBeCloseTo(advance, 3)
  })

  const SANS = { capital: 0.716, small: 0.519, tall: 0.716, descender: -0.21, ascent: 0.905 }
  it.each([
    { character: 'H', ink: { bottom: 0, top: 0.716 } },
    { character: 'x', ink: { bottom: 0, top: 0.519 } },
    { character: 'y', ink: { bottom: -0.21, top: 0.519 } },
    { character: 'd', ink: { bottom: 0, top: 0.716 } },
    { character: '-', ink: { bottom: 0.23, top: 0.31 } },
    { character: 'É', ink: { bottom: 0, top: 0.896 } },
    { character: ' ', ink: undefined }
  ])('gives $character its ink', ({ character, ink }) => {
    const found = inkOf(character, SANS)
    if (!ink) expect(found).toBeUndefined()
    else {
      expect(found?.bottom).toBeCloseTo(ink.bottom, 3)
      expect(found?.top).toBeCloseTo(ink.top, 3)
    }
  })
})

describe('a Fontwork’s letters drawn', () => {
  const glyphs = layFontwork([line(50)], ['A<B'], STYLE, 100)
  const blue = { red: 0, green: 0, blue: 255, opacity: 1 }

  it.each([
    {
      name: 'filled with a colour',
      fill: { kind: 'paint' as const, paint: blue },
      outline: undefined,
      shows: ['fill="#0000ff"', '&lt;', 'lengthAdjust="spacingAndGlyphs"'],
      hides: ['clip-path']
    },
    {
      name: 'filled with a gradient across the whole text, seen through its letters',
      fill: {
        kind: 'gradient' as const,
        stops: [
          { offset: 0, paint: blue },
          { offset: 1, paint: { ...blue, red: 255 } }
        ],
        angle: 0,
        radial: false
      },
      outline: undefined,
      shows: ['<clipPath', 'clip-path="url(#', 'linearGradient'],
      hides: []
    },
    {
      name: 'outlined only, its line at its own width',
      fill: { kind: 'none' as const },
      outline: { paint: blue, width: 2, dashes: undefined },
      shows: ['fill="none" stroke="#0000ff" stroke-width="2"', 'vector-effect="non-scaling-stroke"'],
      hides: ['clip-path']
    }
  ])('draws them $name', ({ fill, outline, shows, hides }) => {
    const canvas = new Canvas()
    const drawn = fontworkElement(glyphs, STYLE, fill, outline, canvas) + canvas.definitions.join('')
    for (const piece of shows) expect(drawn).toContain(piece)
    for (const piece of hides) expect(drawn).not.toContain(piece)
    expect(drawn).not.toMatch(/<script|href="(?!data:)/)
  })

  it('draws nothing for no letters', () => {
    expect(fontworkElement([], STYLE, { kind: 'paint', paint: blue }, undefined, new Canvas())).toBe('')
  })
})
