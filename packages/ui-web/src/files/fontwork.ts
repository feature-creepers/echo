/**
 * The text of an OpenDocument Fontwork (docs/SPEC.md, section 9.7): a custom shape whose geometry says its text follows
 * its path (`draw:text-path="true"`) draws no outline of its own, only its text, laid along its path's lines as
 * LibreOffice lays it (svx's `EnhancedCustomShapeFontWork`). Its paths are taken in order: an odd number of them puts
 * each text area on one line, its letters upright along it and centred on it; an even number makes each pair of
 * lines, the upper then the lower, the edges of a text area its letters are stretched between, a letter's every point
 * moved to the same share of the way along both lines and down between them. The lines of its text are shared among
 * the text areas in order, a paragraph's line breaks starting new lines; the text is as large as the longest line
 * fitting its path makes it, or keeps its own size when its scale is the shape's (`draw:text-path-scale="shape"`), and
 * all its letters may be made as tall as each other (`draw:text-path-same-letter-heights`).
 *
 * The window has no outlines of a font's letters to bend, so each letter is written as SVG text placed by a transform
 * of its own: turned along its line, or, between two lines, the transform that best maps its box to the four points
 * its corners go to. Each letter's width and height come from the metrics of the font families LibreOffice's
 * documents name most (those of Liberation Sans and Liberation Serif, Arial's and Times' in their measures), and the
 * letter is stretched to its width (`textLength`), so the text keeps its place whatever font the window draws it in.
 */

import { type Canvas, css, escaped, type Fill, fillAttribute, fontStack, number, type Outline } from './slide-svg.ts'

type Point = [number, number]

/** A transform as the six numbers of SVG's `matrix()`. */
export type GlyphMatrix = [number, number, number, number, number, number]

/** How a Fontwork's text is laid out: its font, size and spacing, and what its shape's geometry and style say. */
export interface FontworkStyle {
  /** The one font its text is drawn in, as LibreOffice takes it from the shape: its family, weight and slant. */
  font: { family: string; bold: boolean; italic: boolean }
  /** Its size in pixels, which the text keeps when its scale is the shape's. */
  size: number
  /** The space added after each letter, in pixels at that size. */
  letterSpacing: number
  /** Whether the text keeps its own size along its path (`draw:text-path-scale="shape"`) rather than being as large as its path makes it. */
  scaleToShape: boolean
  sameLetterHeights: boolean
  /** Whether each line is stretched to the width of its text area (`draw:fit-to-size`). */
  fitToSize: boolean
  align: 'left' | 'center' | 'right' | 'block'
  vertical: 'top' | 'middle' | 'bottom'
  /** Whether the file asks for Fontwork's older way of laying several lines on one path, its line breaks not kept. */
  legacy: boolean
}

/** A letter placed: its character, its width in its own units, and the transform from its own units to the shape. */
export interface FontworkGlyph {
  character: string
  width: number
  matrix: GlyphMatrix
}

// Letters' measures

/** The size letters are written at in their own units, where the transform takes them from. */
const UNIT = 100

/**
 * The advances of the printable ASCII characters (32 to 126), in thousandths of the font's size: Arial's and
 * Liberation Sans', regular and bold, and Times' and Liberation Serif's.
 */
const SANS = parseWidths(
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'
)
const SANS_BOLD = parseWidths(
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'
)
const SERIF = parseWidths(
  '250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278 500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444 921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722 556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500 500 500 333 389 278 500 500 722 500 500 444 480 200 480 541'
)

function parseWidths(widths: string): number[] {
  return widths.split(' ').map((width) => Number(width) / 1000)
}

/** The heights a family's letters reach, as shares of its size: its capitals, small letters, tall small letters and descenders, and its ascent above the baseline. */
interface FamilyHeights {
  capital: number
  small: number
  tall: number
  descender: number
  ascent: number
}

const SANS_HEIGHTS: FamilyHeights = { capital: 0.716, small: 0.519, tall: 0.716, descender: -0.21, ascent: 0.905 }
const SERIF_HEIGHTS: FamilyHeights = { capital: 0.662, small: 0.45, tall: 0.683, descender: -0.217, ascent: 0.891 }

/** Whether a family is drawn with serifs, by its name: its letters are measured as Times' then. */
const serifed = (family: string) => /serif|times|roman|georgia|garamond|cambria|book|palatino|century/i.test(family) && !/sans/i.test(family)

/** The characters whose ink reaches below the baseline, and those whose ink is as tall as a capital though they are small letters. */
const DESCENDING = new Set([...'gjpqy,;()[]{}|@$Q'])
const TALL = new Set([...'bdfhklt'])
const SMALL = new Set([...'acegmnopqrsuvwxyz'])

/**
 * Where a character's ink reaches, below and above its baseline, as shares of its font's size; none for one with no
 * ink, a space.
 */
export function inkOf(character: string, heights: FamilyHeights): { bottom: number; top: number } | undefined {
  if (/^\s$/u.test(character) || character === '') return undefined
  const base = character.normalize('NFD')
  const letter = base[0] ?? character
  const marked = base.length > 1
  const below = DESCENDING.has(letter) || /[̧̨]/.test(base) ? heights.descender : 0
  let top: number
  if (letter === '.' || letter === ',') top = 0.1
  else if (letter === '-' || letter === '–' || letter === '—') return { bottom: 0.23, top: 0.31 }
  else if (letter === '_') return { bottom: -0.17, top: -0.12 }
  else if (letter === '+' || letter === '<' || letter === '>' || letter === '=' || letter === '~') return { bottom: 0.12, top: 0.58 }
  else if (letter === '*' || letter === '"' || letter === "'" || letter === '`' || letter === '^') return { bottom: 0.43, top: heights.capital }
  else if (SMALL.has(letter) || letter === ':' || letter === ';') top = heights.small
  else if (TALL.has(letter) || letter === 'i' || letter === 'j') top = heights.tall
  else top = heights.capital
  // An accent above a letter reaches past a capital, or to a tall letter's height above a small one.
  if (marked && /[̀-͂̕̚]/.test(base)) top = SMALL.has(letter) || letter === 'i' ? Math.max(top, heights.tall) : top + 0.18
  return { bottom: below, top }
}

/** A character's advance, as a share of its font's size, in the font's family and weight. */
export function advanceOf(character: string, font: FontworkStyle['font']): number {
  const table = serifed(font.family) ? SERIF : font.bold ? SANS_BOLD : SANS
  const code = character.codePointAt(0) ?? 0
  const found = code >= 32 && code <= 126 ? table[code - 32] : undefined
  if (found !== undefined) return found * (serifed(font.family) && font.bold ? 1.04 : 1)
  if (character === '\t') return table[0] ?? 0.278
  // A letter with an accent is as wide as its letter; a character of a script of square characters takes the whole square.
  const letter = character.normalize('NFD')[0] ?? ''
  const plain = letter.codePointAt(0) ?? 0
  if (plain >= 32 && plain <= 126) return table[plain - 32] ?? 0.556
  return code >= 0x2e80 ? 1 : 0.556
}

// Paths

/** A polyline's points, with the share of its length at each, from 0 to 1. */
interface Measured {
  points: readonly Point[]
  shares: number[]
  length: number
}

function measured(points: readonly Point[]): Measured {
  const shares = [0]
  let length = 0
  for (let index = 1; index < points.length; index++) {
    const [x, y] = points[index] as Point
    const [beforeX, beforeY] = points[index - 1] as Point
    length += Math.hypot(x - beforeX, y - beforeY)
    shares.push(length)
  }
  return { points, length, shares: length > 0 ? shares.map((share) => share / length) : shares }
}

/** The point a share of the way along a polyline, as LibreOffice finds it: at its ends past them. */
function pointAlong(line: Measured, share: number): Point {
  const { points, shares } = line
  const index = shares.findIndex((value) => value >= share)
  if (index < 0) return points.at(-1) ?? [0, 0]
  const at = points[index] as Point
  if (index === 0 || Math.abs((shares[index] as number) - share) < 1e-12) return at
  const before = points[index - 1] as Point
  const from = shares[index - 1] as number
  const step = (shares[index] as number) - from
  const along = step > 0 ? (share - from) / step : 0
  return [before[0] + (at[0] - before[0]) * along, before[1] + (at[1] - before[1]) * along]
}

// Layout

/** A letter on its line before it is fitted to the path: its character, its width, and where its own units go, scaled and moved. */
interface Laid {
  character: string
  advance: number
  /** Its own units to the line's: `x' = x0 + sx·x`, `y' = y0 + sy·y`. */
  x0: number
  y0: number
  sx: number
  sy: number
  /** Its ink's top and bottom in its own units (negative above the baseline). */
  inkTop: number
  inkBottom: number
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const emptyBox = (): Box => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
const isEmpty = (box: Box) => !(box.right >= box.left && box.bottom >= box.top)
const join = (box: Box, other: Box) => {
  box.left = Math.min(box.left, other.left)
  box.top = Math.min(box.top, other.top)
  box.right = Math.max(box.right, other.right)
  box.bottom = Math.max(box.bottom, other.bottom)
}

/** A letter's ink in the line's units. */
const inkBox = (glyph: Laid): Box => ({
  left: glyph.x0,
  right: glyph.x0 + glyph.sx * glyph.advance,
  top: glyph.y0 + glyph.sy * glyph.inkTop,
  bottom: glyph.y0 + glyph.sy * glyph.inkBottom
})

interface Paragraph {
  glyphs: Laid[]
  box: Box
}

interface TextArea {
  paragraphs: Paragraph[]
  box: Box
  /** How far its lines were moved up or down by its vertical alignment, as LibreOffice records it to undo it on the path. */
  alignMove: number
}

/** The most letters laid out in one Fontwork, so a damaged file costs little. */
const GLYPH_LIMIT = 4000

/**
 * A Fontwork's letters placed in its shape: its lines of text laid along the outlines of its geometry (in the shape's
 * pixels, in their order), `height` the shape's own height. None when it has no outline or no text.
 */
export function layFontwork(outlines: readonly (readonly Point[])[], lines: readonly string[], style: FontworkStyle, height: number): FontworkGlyph[] {
  const count = outlines.length
  if (count === 0 || lines.length === 0 || !(height > 0)) return []
  const single = count % 2 === 1
  const areaCount = single ? count : count / 2
  const heights = serifed(style.font.family) ? SERIF_HEIGHTS : SANS_HEIGHTS
  let budget = GLYPH_LIMIT
  const characters = lines.slice(0, GLYPH_LIMIT).map((line) => {
    const taken = [...line].slice(0, Math.max(0, budget))
    budget -= taken.length
    return taken
  })
  const spacing = style.size > 0 ? style.letterSpacing / style.size : 0
  const emWidth = (line: string[]) => line.reduce((sum, character) => sum + advanceOf(character, style.font) + spacing, 0)

  // The lines shared among the text areas, as many to each as there are left over the areas left.
  const shares: string[][][] = []
  let left = characters.length
  let next = 0
  const perArea = Math.floor((characters.length - 1) / areaCount) + 1
  for (let area = 0; area < areaCount && left > 0; area++) {
    const taken = Math.floor((left - 1) / (areaCount - area)) + 1
    shares.push(characters.slice(next, next + taken))
    next += taken
    left -= taken
  }
  const paths = outlines.map(measured)
  const areaLength = (area: number) => (single ? (paths[area]?.length ?? 0) : ((paths[2 * area]?.length ?? 0) + (paths[2 * area + 1]?.length ?? 0)) / 2)

  // The text's size: as large as the longest line fitting its path makes it, or its own, made smaller until each line fits.
  let fit = Infinity
  shares.forEach((area, index) => {
    for (const line of area) {
      const wide = emWidth(line)
      if (wide > 0) fit = Math.min(fit, areaLength(index) / wide)
    }
  })
  if (!Number.isFinite(fit) || !(fit > 0)) fit = height / perArea
  let size: number
  let horizontalScale: number
  if (style.scaleToShape) {
    size = Math.max(1, Math.min(style.size > 0 ? style.size : fit, fit))
    horizontalScale = fit / size
  } else {
    size = fit
    horizontalScale = fit / (height / perArea)
  }

  const areas: TextArea[] = shares.map((area) => {
    const textArea: TextArea = { paragraphs: [], box: emptyBox(), alignMove: 0 }
    let offset = perArea > area.length ? size / 2 : 0
    for (const line of area) {
      const paragraph: Paragraph = { glyphs: [], box: emptyBox() }
      const baseline = offset + heights.ascent * size
      let pen = 0
      for (const character of line) {
        const advance = advanceOf(character, style.font)
        const ink = inkOf(character, heights)
        if (ink) {
          const glyph: Laid = {
            character,
            advance: advance * UNIT,
            x0: pen,
            y0: baseline,
            sx: size / UNIT,
            sy: size / UNIT,
            inkTop: -ink.top * UNIT,
            inkBottom: -ink.bottom * UNIT
          }
          paragraph.glyphs.push(glyph)
          join(paragraph.box, inkBox(glyph))
        }
        pen += (advance + spacing) * size
      }
      if (isEmpty(paragraph.box)) {
        if (isEmpty(textArea.box)) textArea.box = { left: 0, top: 0, right: 1, bottom: size }
        else textArea.box.bottom += size
      } else {
        join(textArea.box, paragraph.box)
        if (style.sameLetterHeights)
          for (const glyph of paragraph.glyphs) {
            const own = inkBox(glyph)
            const tall = own.bottom - own.top
            if (tall > 0) {
              glyph.sy *= (paragraph.box.bottom - paragraph.box.top) / tall
              glyph.y0 += paragraph.box.top - (glyph.y0 + glyph.sy * glyph.inkTop)
            }
          }
      }
      textArea.paragraphs.push(paragraph)
      offset += size
    }
    return textArea
  })

  // Each line placed across its text area: stretched to it, or moved to its side or its middle.
  for (const area of areas) {
    const areaWidth = area.box.right - area.box.left
    const move = (paragraph: Paragraph, across: number, down: number) => {
      for (const glyph of paragraph.glyphs) {
        glyph.x0 += across
        glyph.y0 += down
      }
    }
    for (const paragraph of area.paragraphs) {
      const width = paragraph.box.right - paragraph.box.left
      if (isEmpty(paragraph.box) || !(width > 0)) continue
      if (style.fitToSize) {
        const stretch = areaWidth / width
        for (const glyph of paragraph.glyphs) {
          glyph.x0 *= stretch
          glyph.sx *= stretch
        }
      } else if (style.scaleToShape) {
        const factor = style.vertical === 'bottom' ? -0.5 : style.vertical === 'top' ? 0.5 : 0
        const down = size * factor * (area.paragraphs.length - 1)
        area.alignMove = down
        const room = horizontalScale * areaWidth - width
        move(paragraph, style.align === 'center' ? room / 2 : style.align === 'right' ? room : 0, down)
      } else if (style.align === 'center' || style.align === 'right') move(paragraph, style.align === 'center' ? (areaWidth - width) / 2 : areaWidth - width, 0)
    }
  }

  const placed: FontworkGlyph[] = []
  let outline = 0
  for (const area of areas) {
    const { left, top } = area.box
    let width = area.box.right - area.box.left
    const tall = area.box.bottom - area.box.top
    if (style.scaleToShape) width *= horizontalScale
    if (single) {
      const path = paths[outline++]
      if (!path || path.points.length < 2 || !(tall > 0) || !(width > 0)) continue
      placed.push(...alongOneLine(area, path, style, horizontalScale, left, width))
    } else {
      const upper = paths[outline++]
      const lower = paths[outline++]
      if (!upper || !lower || upper.points.length < 2 || lower.points.length < 2 || !(tall > 0) || !(width > 0)) continue
      for (const paragraph of area.paragraphs)
        for (const glyph of paragraph.glyphs) {
          const warp = ([x, y]: Point): Point => {
            const across = (glyph.x0 + glyph.sx * x - left) / width
            const down = (glyph.y0 + glyph.sy * y - top) / tall
            const [x1, y1] = pointAlong(upper, across)
            const [x2, y2] = pointAlong(lower, across)
            return [x1 + (x2 - x1) * down, y1 + (y2 - y1) * down]
          }
          placed.push({ character: glyph.character, width: glyph.advance, matrix: fitted(glyph, warp) })
        }
    }
  }
  // A letter a damaged path sends nowhere is left out.
  return placed.filter((glyph) => glyph.matrix.every(Number.isFinite))
}

/**
 * The transform that best maps a letter's box in its own units to where its four corners go, by least squares: its
 * middle to the middle of the four, its across and down to the mean of its two edges each way.
 */
function fitted(glyph: Laid, warp: (point: Point) => Point): GlyphMatrix {
  const right = glyph.advance
  const [topLeft, topRight, bottomRight, bottomLeft] = [
    warp([0, glyph.inkTop]),
    warp([right, glyph.inkTop]),
    warp([right, glyph.inkBottom]),
    warp([0, glyph.inkBottom])
  ]
  const tall = glyph.inkBottom - glyph.inkTop
  const a = (topRight[0] - topLeft[0] + bottomRight[0] - bottomLeft[0]) / 2 / right
  const b = (topRight[1] - topLeft[1] + bottomRight[1] - bottomLeft[1]) / 2 / right
  const c = (bottomLeft[0] - topLeft[0] + bottomRight[0] - topRight[0]) / 2 / tall
  const d = (bottomLeft[1] - topLeft[1] + bottomRight[1] - topRight[1]) / 2 / tall
  const middle: Point = [(topLeft[0] + topRight[0] + bottomRight[0] + bottomLeft[0]) / 4, (topLeft[1] + topRight[1] + bottomRight[1] + bottomLeft[1]) / 4]
  const own: Point = [right / 2, (glyph.inkTop + glyph.inkBottom) / 2]
  return [a, b, c, d, middle[0] - a * own[0] - c * own[1], middle[1] - b * own[0] - d * own[1]]
}

/**
 * The letters of a text area on one line, each upright along the chord of the path under it and the middle of its
 * line on the path: a text of several lines is laid on lines beside the path, each as far from it as it is from the
 * middle of the text, as LibreOffice 7.5 does, or, in Fontwork's older way, every line along the path itself, moved
 * off it along each letter's own chord.
 */
function alongOneLine(area: TextArea, path: Measured, style: FontworkStyle, horizontalScale: number, left: number, width: number): FontworkGlyph[] {
  const placed: FontworkGlyph[] = []
  const shift = style.align === 'right' ? 2 : style.align === 'center' ? 1 : style.align === 'left' ? 0 : -1
  const areaMiddle = (area.box.top + area.box.bottom) / 2
  const areaWidth = area.box.right - area.box.left
  const place = (glyph: Laid, middleY: number, line: Measured, share: (x: number) => number, off: number) => {
    const ink = inkBox(glyph)
    const [x1, y1] = pointAlong(line, Math.max(0, share(ink.left)))
    const [x2, y2] = pointAlong(line, Math.max(0, share(ink.right)))
    const chord = Math.hypot(x2 - x1, y2 - y1)
    if (!(chord > 0)) return
    const cos = (x2 - x1) / chord
    const sin = (y2 - y1) / chord
    // The way off the line, to its left as it goes, by which a line of the text is moved off the path.
    const target: Point = [(x1 + x2) / 2 + sin * off, (y1 + y2) / 2 - cos * off]
    const centre: Point = [(ink.left + ink.right) / 2, middleY]
    // Its own units to the line's, then turned about its middle onto the chord.
    const a = cos * glyph.sx
    const b = sin * glyph.sx
    const c = -sin * glyph.sy
    const d = cos * glyph.sy
    const fromX = glyph.x0 - centre[0]
    const fromY = glyph.y0 - centre[1]
    placed.push({
      character: glyph.character,
      width: glyph.advance,
      matrix: [a, b, c, d, cos * fromX - sin * fromY + target[0], sin * fromX + cos * fromY + target[1]]
    })
  }
  if (!style.legacy && area.paragraphs.length > 1 && shift >= 0) {
    for (const paragraph of area.paragraphs) {
      if (isEmpty(paragraph.box)) continue
      const paragraphWidth = paragraph.box.right - paragraph.box.left
      const paragraphMiddle = (paragraph.box.top + paragraph.box.bottom) / 2
      const distance = areaMiddle - paragraphMiddle - area.alignMove
      const line = measured(beside(path.points, distance))
      const room = line.length > paragraphWidth ? (shift * (line.length - paragraphWidth)) / 2 : -1
      const undo = ((horizontalScale * areaWidth - paragraphWidth) * shift) / 2
      const share = (x: number) => {
        const along = (x - left - undo) / paragraphWidth
        return room >= 0 ? (along * paragraphWidth + room) / line.length : along
      }
      for (const glyph of paragraph.glyphs) place(glyph, paragraphMiddle, line, share, area.alignMove)
    }
    return placed
  }
  for (const paragraph of area.paragraphs) {
    const paragraphMiddle = (paragraph.box.top + paragraph.box.bottom) / 2
    for (const glyph of paragraph.glyphs) place(glyph, paragraphMiddle, path, (x) => (x - left) / width, areaMiddle - paragraphMiddle)
  }
  return placed
}

/** A polyline moved a distance to its left as it goes, each point along the way between its neighbours. */
function beside(points: readonly Point[], distance: number): Point[] {
  return points.map(([x, y], index) => {
    const [x1, y1] = points[Math.max(0, index - 1)] as Point
    const [x2, y2] = points[Math.min(points.length - 1, index + 1)] as Point
    const length = Math.hypot(x2 - x1, y2 - y1)
    return length > 0 ? [x + ((y2 - y1) / length) * distance, y - ((x2 - x1) / length) * distance] : [x, y]
  })
}

// Drawing

/** The corners of each letter's box, in the shape, for the room its text takes. */
export function glyphCorners(glyphs: readonly FontworkGlyph[], style: FontworkStyle): Point[] {
  const heights = serifed(style.font.family) ? SERIF_HEIGHTS : SANS_HEIGHTS
  return glyphs.flatMap(({ character, width, matrix: [a, b, c, d, e, f] }) => {
    const ink = inkOf(character, heights) ?? { bottom: 0, top: heights.capital }
    return (
      [
        [0, -ink.top * UNIT],
        [width, -ink.top * UNIT],
        [width, -ink.bottom * UNIT],
        [0, -ink.bottom * UNIT]
      ] as Point[]
    ).map(([x, y]): Point => [a * x + c * y + e, b * x + d * y + f])
  })
}

/**
 * A Fontwork's letters as SVG, filled and outlined as its shape is: a colour on the letters themselves; a gradient
 * or a picture across the box of the whole text, seen through the letters, as LibreOffice fills its text as one
 * shape; its line around each letter at its own width.
 */
export function fontworkElement(
  glyphs: readonly FontworkGlyph[],
  style: FontworkStyle,
  fill: Fill | undefined,
  outline: Outline | undefined,
  canvas: Canvas
): string {
  if (glyphs.length === 0) return ''
  const { font } = style
  const letters = (extra: string) =>
    glyphs
      .map(
        ({ character, width, matrix }) =>
          `<text transform="matrix(${matrix.map((value) => String(Number(value.toPrecision(6)))).join(' ')})" font-size="${UNIT}" textLength="${number(width)}" lengthAdjust="spacingAndGlyphs"${extra}>${escaped(character)}</text>`
      )
      .join('')
  const face = `font-family="${escaped(fontStack(font.family))}"${font.bold ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''}`
  let drawn = ''
  if (fill && fill.kind === 'paint')
    drawn += `<g ${face} fill="${css(fill.paint)}"${fill.paint.opacity < 1 ? ` fill-opacity="${number(fill.paint.opacity)}"` : ''} stroke="none">${letters('')}</g>`
  else if (fill && fill.kind !== 'none') {
    const corners = glyphCorners(glyphs, style)
    const xs = corners.map(([x]) => x)
    const ys = corners.map(([, y]) => y)
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    if (box.width > 0 && box.height > 0) {
      const id = canvas.id('t')
      // A clip holds shapes and text but no group, so the letters take their font from the clip itself.
      canvas.definitions.push(`<clipPath id="${id}" ${face}>${letters('')}</clipPath>`)
      drawn += `<g clip-path="url(#${id})"><rect transform="translate(${number(box.x)} ${number(box.y)})" width="${number(box.width)}" height="${number(box.height)}" ${fillAttribute(fill, canvas, box)}/></g>`
    }
  }
  if (outline?.paint)
    drawn += `<g ${face} fill="none" stroke="${css(outline.paint)}" stroke-width="${number(outline.width)}"${outline.paint.opacity < 1 ? ` stroke-opacity="${number(outline.paint.opacity)}"` : ''}${outline.dashes ? ` stroke-dasharray="${outline.dashes}"` : ''} stroke-linejoin="round">${letters(' vector-effect="non-scaling-stroke"')}</g>`
  return drawn
}
