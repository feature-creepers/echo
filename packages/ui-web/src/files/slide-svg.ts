/**
 * What every slide drawing writes, whatever format the slide comes from (docs/SPEC.md, section 9.7): colours, fills
 * and outlines, the geometry of the common shapes, text frames, charts, and the SVG that holds them. Each format reads
 * its own records into these (`slide-drawing.ts` for PowerPoint 2007 and later, `older-slide-drawing.ts` for 97 to
 * 2003, `open-slide-drawing.ts` for OpenDocument), so a slide looks the same whichever app saved it.
 *
 * Text is written as XHTML inside the SVG (`foreignObject`), so it wraps as it does in its box. The window shows the
 * SVG as an image, where nothing runs and nothing is fetched: a picture is written into it as data.
 */

import type { OfficeChart } from './office-text.ts'

/** A number as SVG and CSS take it: two decimals at most. */
export const number = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0')

const MARKS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Text written into XML: its marks escaped, and the characters XML does not take left out. */
export const escaped = (text: string) => {
  let written = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0xfffe || code === 0xffff) continue
    written += MARKS[character] ?? character
  }
  return written
}

/** Bytes as base64, a piece at a time. */
export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

// Colours

/** A colour as a slide paints it: its red, green and blue, and how opaque it is. */
export interface Paint {
  red: number
  green: number
  blue: number
  opacity: number
}

export const css = (paint: Paint) =>
  `#${[paint.red, paint.green, paint.blue]
    .map((part) =>
      Math.round(Math.min(255, Math.max(0, part)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/** A colour written as six hexadecimal digits, with or without its `#`. */
export const fromHex = (hex: string | undefined): Paint | undefined => {
  const digits = hex?.replace(/^#/, '')
  if (!digits || !/^[0-9a-f]{6}$/i.test(digits)) return undefined
  const value = Number.parseInt(digits, 16)
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff, opacity: 1 }
}

/** A colour's hue, saturation and lightness, each from 0 to 1, and back. */
export function toLightness({ red, green, blue }: Paint): [number, number, number] {
  const [r, g, b] = [red / 255, green / 255, blue / 255]
  const highest = Math.max(r, g, b)
  const lowest = Math.min(r, g, b)
  const lightness = (highest + lowest) / 2
  if (highest === lowest) return [0, 0, lightness]
  const spread = highest - lowest
  const saturation = lightness > 0.5 ? spread / (2 - highest - lowest) : spread / (highest + lowest)
  const hue = highest === r ? ((g - b) / spread + (g < b ? 6 : 0)) / 6 : highest === g ? ((b - r) / spread + 2) / 6 : ((r - g) / spread + 4) / 6
  return [hue, saturation, lightness]
}

export function fromLightness(hue: number, saturation: number, lightness: number, opacity: number): Paint {
  if (saturation === 0) return { red: lightness * 255, green: lightness * 255, blue: lightness * 255, opacity }
  const upper = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const lower = 2 * lightness - upper
  const channel = (offset: number) => {
    let turn = hue + offset
    if (turn < 0) turn += 1
    if (turn > 1) turn -= 1
    if (turn < 1 / 6) return lower + (upper - lower) * 6 * turn
    if (turn < 1 / 2) return upper
    if (turn < 2 / 3) return lower + (upper - lower) * (2 / 3 - turn) * 6
    return lower
  }
  return { red: channel(1 / 3) * 255, green: channel(0) * 255, blue: channel(-1 / 3) * 255, opacity }
}

// Fills and lines

export type Fill =
  | { kind: 'none' }
  | { kind: 'paint'; paint: Paint }
  | { kind: 'gradient'; stops: { offset: number; paint: Paint }[]; angle: number; radial: boolean; centre?: { x: number; y: number } | undefined }
  | { kind: 'picture'; href: string; crop: Crop | undefined }

/** How much of a picture is cut away on each side, from 0 to 1. */
export interface Crop {
  left: number
  top: number
  right: number
  bottom: number
}

/** An outline: its paint, none for no line, its width in pixels and its dashes. */
export interface Outline {
  paint: Paint | undefined
  width: number
  dashes: string | undefined
}

// Text

/** How a run of text is written: its size in points, its weight, slant, lines, case, colour, font, and the space after each letter in pixels. */
export interface RunStyle {
  size?: number | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
  underline?: boolean | undefined
  strike?: boolean | undefined
  caps?: boolean | undefined
  paint?: Paint | undefined
  font?: string | undefined
  letterSpacing?: number | undefined
}

/** A run of text in its style, or a line broken within its paragraph. */
export type TextPiece = { text: string; style: RunStyle } | 'break'

/** A bullet or a number before a paragraph: its mark, its colour, its font, its size as a share of the text's, and its width. */
export interface TextBullet {
  mark: string
  paint?: Paint | undefined
  font?: string | undefined
  size?: number | undefined
  width?: number | undefined
}

/**
 * A paragraph as it is drawn: its alignment, its size in points (its first run's), the space between its lines (a
 * multiple of a line, or a height in points), its indents in pixels, the space around it in points, its bullet and its
 * runs.
 */
export interface TextParagraph {
  align: 'left' | 'center' | 'right' | 'justify'
  size: number
  lineSpacing?: number | undefined
  lineHeight?: number | undefined
  marginLeft?: number | undefined
  indent?: number | undefined
  spaceBefore?: number | undefined
  spaceAfter?: number | undefined
  bullet?: TextBullet | undefined
  pieces: TextPiece[]
}

/** The text of a shape in its box: its paragraphs, the space inside its edges in pixels, where it sits, whether it wraps, its font and colour. */
export interface TextFrame {
  paragraphs: TextParagraph[]
  insets: { top: number; right: number; bottom: number; left: number }
  anchor: 'top' | 'middle' | 'bottom'
  wraps: boolean
  font: string
  paint: Paint | undefined
}

/** The characters symbol fonts keep their usual bullets at, as the characters they look like. */
const SYMBOL_BULLETS: Record<string, string> = { '§': '▪', Ø: '➢', ü: '✓', q: '❑', v: '❖', n: '■', l: '●', o: '○', p: '□', u: '◆', Ÿ: '•', '': '•' }

/** A bullet's character as it looks, a symbol font's private characters read as the ones they stand for. */
export const bulletCharacter = (character: string) => {
  const known = SYMBOL_BULLETS[character]
  if (known) return known
  const code = character.codePointAt(0) ?? 0
  const symbol = code >= 0xf020 && code <= 0xf0ff ? String.fromCharCode(code - 0xf000) : character
  return SYMBOL_BULLETS[symbol] ?? symbol
}

/** A number in a list, as its scheme writes it: `arabicPeriod`, `romanUcParenR`, `alphaLcParenBoth`… */
export function listNumber(scheme: string, value: number): string {
  const roman = (count: number) => {
    const numerals: [number, string][] = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i']
    ]
    let left = count
    let written = ''
    for (const [amount, numeral] of numerals)
      while (left >= amount) {
        written += numeral
        left -= amount
      }
    return written
  }
  const letters = (count: number) => {
    let left = count
    let written = ''
    while (left > 0) {
      written = String.fromCharCode(97 + ((left - 1) % 26)) + written
      left = Math.floor((left - 1) / 26)
    }
    return written
  }
  const body = /^roman/.test(scheme) ? roman(value) : /^alpha/.test(scheme) ? letters(value) : String(value)
  const shown = /Uc/.test(scheme) ? body.toUpperCase() : body
  return /ParenBoth$/.test(scheme) ? `(${shown})` : /ParenR$/.test(scheme) ? `${shown})` : /Period$/.test(scheme) ? `${shown}.` : shown
}

/** A font's name, then the kind of font to fall back on. */
export const fontStack = (font: string) => {
  const fallback = /mono|courier|consol/i.test(font)
    ? 'monospace'
    : /times|georgia|garamond|cambria|serif/i.test(font) && !/sans/i.test(font)
      ? 'serif'
      : 'sans-serif'
  return font ? `'${font.replace(/['"\\<>&]/g, '')}', ${fallback}` : fallback
}

const points = (size: number) => number((size * 4) / 3)

function runCss(run: RunStyle): string {
  const lines = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  return [
    run.size !== undefined ? `font-size:${points(run.size)}px` : '',
    run.bold ? 'font-weight:bold' : '',
    run.italic ? 'font-style:italic' : '',
    lines ? `text-decoration:${lines}` : '',
    run.caps ? 'text-transform:uppercase' : '',
    run.paint ? `color:${css(run.paint)}${run.paint.opacity < 1 ? `;opacity:${number(run.paint.opacity)}` : ''}` : '',
    run.font ? `font-family:${fontStack(run.font)}` : ''
  ]
    .filter(Boolean)
    .join(';')
}

function paragraphHtml(paragraph: TextParagraph): string {
  const spacing = paragraph.lineHeight !== undefined ? `${points(paragraph.lineHeight)}px` : number(1.2 * (paragraph.lineSpacing ?? 1))
  const style = [
    'margin:0',
    `text-align:${paragraph.align}`,
    `font-size:${points(paragraph.size)}px`,
    `line-height:${spacing}`,
    paragraph.marginLeft ? `padding-left:${number(paragraph.marginLeft)}px` : '',
    paragraph.indent ? `text-indent:${number(paragraph.indent)}px` : '',
    paragraph.spaceBefore ? `margin-top:${points(paragraph.spaceBefore)}px` : '',
    paragraph.spaceAfter ? `margin-bottom:${points(paragraph.spaceAfter)}px` : ''
  ]
    .filter(Boolean)
    .join(';')
  const runs = paragraph.pieces.map((piece) => (piece === 'break' ? '<br/>' : `<span style="${runCss(piece.style)}">${escaped(piece.text)}</span>`))
  let bullet = ''
  if (paragraph.bullet) {
    const { mark, paint, width, font, size } = paragraph.bullet
    bullet = `<span style="display:inline-block;text-indent:0;${width ? `min-width:${number(width)}px;` : 'margin-right:0.4em;'}${font ? `font-family:${fontStack(font)};` : ''}${size !== undefined && size !== 1 ? `font-size:${number(size * 100)}%;` : ''}${paint ? `color:${css(paint)}` : ''}">${escaped(mark)}</span>`
  }
  return `<p style="${style}">${bullet}${runs.length > 0 ? runs.join('') : '&#8203;'}</p>`
}

/** A frame's text as XHTML that fills its container: its paragraphs placed as the frame says. */
export function textDiv(frame: TextFrame): string {
  const { insets } = frame
  const style = [
    'width:100%',
    'height:100%',
    'box-sizing:border-box',
    `padding:${number(insets.top)}px ${number(insets.right)}px ${number(insets.bottom)}px ${number(insets.left)}px`,
    'display:flex',
    'flex-direction:column',
    `justify-content:${frame.anchor === 'middle' ? 'center' : frame.anchor === 'bottom' ? 'flex-end' : 'flex-start'}`,
    `white-space:${frame.wraps ? 'pre-wrap' : 'pre'}`,
    'overflow-wrap:break-word',
    `font-family:${fontStack(frame.font)}`,
    frame.paint ? `color:${css(frame.paint)}` : 'color:#000000'
  ].join(';')
  return `<div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${frame.paragraphs.map(paragraphHtml).join('')}</div>`
}

/** A frame's text in its box, from 0: XHTML inside the SVG, so it wraps as in its app. */
export const textHtml = (frame: TextFrame, box: { width: number; height: number }) =>
  `<foreignObject x="0" y="0" width="${number(box.width)}" height="${number(box.height)}" overflow="visible">${textDiv(frame)}</foreignObject>`

// Geometry

/** A shape's box on the slide, in pixels, turned and turned over as the slide says. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipH: boolean
  flipV: boolean
}

/** The SVG transform that puts a shape's own box, from 0, at its place, turned and turned over. */
export function placed(box: Box): string {
  const centreX = box.width / 2
  const centreY = box.height / 2
  const parts = [`translate(${number(box.x)} ${number(box.y)})`]
  if (box.rotation) parts.push(`rotate(${number(box.rotation)} ${number(centreX)} ${number(centreY)})`)
  if (box.flipH || box.flipV)
    parts.push(`translate(${number(box.flipH ? box.width : 0)} ${number(box.flipV ? box.height : 0)}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`)
  return parts.join(' ')
}

/** A shape's outline as SVG path data in its own box, and whether it is closed, to be filled. */
export interface ShapePath {
  data: string
  closed: boolean
}

export const polygon = (corners: readonly [number, number][]) => `M${corners.map(([x, y]) => `${number(x)} ${number(y)}`).join('L')}Z`

/** Points around an ellipse in a box, the first at its top. */
const around = (width: number, height: number, count: number, radius = 1, turn = 0): [number, number][] =>
  Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + turn + (index * 2 * Math.PI) / count
    return [width / 2 + (width / 2) * radius * Math.cos(angle), height / 2 + (height / 2) * radius * Math.sin(angle)]
  })

/** A star of points around its box, its inner points at a share of its radius. */
const star = (width: number, height: number, count: number, inner: number) => {
  const outer = around(width, height, count)
  const within = around(width, height, count, inner, Math.PI / count)
  return polygon(outer.flatMap((point, index) => [point, within[index] as [number, number]]))
}

export const rectanglePath = (width: number, height: number): ShapePath => ({
  data: polygon([
    [0, 0],
    [width, 0],
    [width, height],
    [0, height]
  ]),
  closed: true
})

export const ellipsePath = (width: number, height: number): ShapePath => ({
  data: `M0 ${number(height / 2)}A${number(width / 2)} ${number(height / 2)} 0 1 1 ${number(width)} ${number(height / 2)}A${number(width / 2)} ${number(height / 2)} 0 1 1 0 ${number(height / 2)}Z`,
  closed: true
})

/**
 * A shape of one of the common kinds, by DrawingML's name for it, in its box: `adjust` gives each of its adjustments,
 * from 0 to 1 of its reference, as DrawingML measures them. A kind not known here is its box.
 */
export function presetPath(kind: string, width: number, height: number, adjust: (name: string, fallback: number) => number): ShapePath {
  const shortest = Math.min(width, height)
  const rounded = (radius: number) => {
    const r = Math.min(radius, width / 2, height / 2)
    return {
      data: `M${number(r)} 0H${number(width - r)}A${number(r)} ${number(r)} 0 0 1 ${number(width)} ${number(r)}V${number(height - r)}A${number(r)} ${number(r)} 0 0 1 ${number(width - r)} ${number(height)}H${number(r)}A${number(r)} ${number(r)} 0 0 1 0 ${number(height - r)}V${number(r)}A${number(r)} ${number(r)} 0 0 1 ${number(r)} 0Z`,
      closed: true
    }
  }
  const arrow = (head: number, shaft: number): [number, number][] => {
    const end = width - head
    return [
      [0, height / 2 - shaft],
      [end, height / 2 - shaft],
      [end, 0],
      [width, height / 2],
      [end, height],
      [end, height / 2 + shaft],
      [0, height / 2 + shaft]
    ]
  }
  const closed = (corners: [number, number][]) => ({ data: polygon(corners), closed: true })
  switch (kind) {
    case 'roundRect':
    case 'flowChartAlternateProcess':
    case 'wedgeRoundRectCallout':
      return rounded(shortest * adjust('adj', 16_667 / 100_000))
    case 'flowChartTerminator':
      return rounded(height / 2)
    case 'ellipse':
    case 'flowChartConnector':
    case 'wedgeEllipseCallout':
    case 'cloud':
    case 'cloudCallout':
      return ellipsePath(width, height)
    case 'triangle':
    case 'flowChartExtract':
      return closed([
        [width * adjust('adj', 0.5), 0],
        [width, height],
        [0, height]
      ])
    case 'flowChartMerge':
      return closed([
        [0, 0],
        [width, 0],
        [width / 2, height]
      ])
    case 'rtTriangle':
      return closed([
        [0, 0],
        [width, height],
        [0, height]
      ])
    case 'diamond':
    case 'flowChartDecision':
      return closed([
        [width / 2, 0],
        [width, height / 2],
        [width / 2, height],
        [0, height / 2]
      ])
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const offset = shortest * adjust('adj', 0.25)
      return closed([
        [offset, 0],
        [width, 0],
        [width - offset, height],
        [0, height]
      ])
    }
    case 'trapezoid': {
      const offset = shortest * adjust('adj', 0.25)
      return closed([
        [0, height],
        [offset, 0],
        [width - offset, 0],
        [width, height]
      ])
    }
    case 'pentagon':
      return { data: polygon(around(width, height, 5)), closed: true }
    case 'hexagon': {
      const offset = shortest * adjust('adj', 0.25)
      return closed([
        [offset, 0],
        [width - offset, 0],
        [width, height / 2],
        [width - offset, height],
        [offset, height],
        [0, height / 2]
      ])
    }
    case 'octagon': {
      const offset = shortest * adjust('adj', 0.29289)
      return closed([
        [offset, 0],
        [width - offset, 0],
        [width, offset],
        [width, height - offset],
        [width - offset, height],
        [offset, height],
        [0, height - offset],
        [0, offset]
      ])
    }
    case 'star4':
      return { data: star(width, height, 4, 0.25), closed: true }
    case 'star5':
      return { data: star(width, height, 5, 0.382), closed: true }
    case 'star6':
      return { data: star(width, height, 6, 0.5), closed: true }
    case 'star8':
      return { data: star(width, height, 8, 0.6), closed: true }
    case 'star16':
      return { data: star(width, height, 16, 0.75), closed: true }
    case 'star24':
      return { data: star(width, height, 24, 0.8), closed: true }
    case 'star32':
      return { data: star(width, height, 32, 0.85), closed: true }
    case 'plus':
    case 'flowChartOr': {
      const offset = shortest * adjust('adj', 0.25)
      return closed([
        [offset, 0],
        [width - offset, 0],
        [width - offset, offset],
        [width, offset],
        [width, height - offset],
        [width - offset, height - offset],
        [width - offset, height],
        [offset, height],
        [offset, height - offset],
        [0, height - offset],
        [0, offset],
        [offset, offset]
      ])
    }
    case 'chevron': {
      const offset = shortest * adjust('adj', 0.5)
      return closed([
        [0, 0],
        [width - offset, 0],
        [width, height / 2],
        [width - offset, height],
        [0, height],
        [offset, height / 2]
      ])
    }
    case 'homePlate': {
      const offset = shortest * adjust('adj', 0.5)
      return closed([
        [0, 0],
        [width - offset, 0],
        [width, height / 2],
        [width - offset, height],
        [0, height]
      ])
    }
    case 'rightArrow':
      return closed(arrow(shortest * adjust('adj2', 0.5), (height * adjust('adj1', 0.5)) / 2))
    case 'leftArrow':
      return closed(arrow(shortest * adjust('adj2', 0.5), (height * adjust('adj1', 0.5)) / 2).map(([x, y]) => [width - x, y]))
    case 'donut': {
      const ring = shortest * adjust('adj', 0.25)
      const inner = { width: width - 2 * ring, height: height - 2 * ring }
      return {
        data: `${ellipsePath(width, height).data}M${number(ring)} ${number(height / 2)}A${number(inner.width / 2)} ${number(inner.height / 2)} 0 1 0 ${number(width - ring)} ${number(height / 2)}A${number(inner.width / 2)} ${number(inner.height / 2)} 0 1 0 ${number(ring)} ${number(height / 2)}Z`,
        closed: true
      }
    }
    case 'line':
    case 'straightConnector1':
    case 'bentConnector2':
    case 'bentConnector3':
    case 'curvedConnector3':
      return { data: `M0 0L${number(width)} ${number(height)}`, closed: false }
    default:
      return rectanglePath(width, height)
  }
}

// Drawing

/** The SVG of a slide as it is written: its definitions and its elements, and the identifiers given. */
export class Canvas {
  readonly definitions: string[] = []
  readonly parts: string[] = []
  private ids = 0
  id(prefix: string) {
    this.ids += 1
    return `${prefix}${this.ids}`
  }
}

/** A fill as SVG paints it, defining a gradient or a picture when it needs one. */
export function fillAttribute(fill: Fill | undefined, canvas: Canvas, box: { width: number; height: number }): string {
  if (!fill || fill.kind === 'none') return 'fill="none"'
  if (fill.kind === 'paint') return `fill="${css(fill.paint)}"${fill.paint.opacity < 1 ? ` fill-opacity="${number(fill.paint.opacity)}"` : ''}`
  if (fill.kind === 'gradient') {
    const id = canvas.id('g')
    const stops = fill.stops
      .map(
        ({ offset, paint }) =>
          `<stop offset="${number(offset)}" stop-color="${css(paint)}"${paint.opacity < 1 ? ` stop-opacity="${number(paint.opacity)}"` : ''}/>`
      )
      .join('')
    if (fill.radial && fill.centre) {
      // A gradient from a point reaches the box's farthest edge, as the rectangles of a shade from a point do.
      const { x, y } = fill.centre
      const reach = Math.max(x, 1 - x, y, 1 - y)
      canvas.definitions.push(
        `<radialGradient id="${id}" cx="${number(x)}" cy="${number(y)}" fx="${number(x)}" fy="${number(y)}" r="${number(reach)}">${stops}</radialGradient>`
      )
    } else if (fill.radial) canvas.definitions.push(`<radialGradient id="${id}">${stops}</radialGradient>`)
    else {
      const angle = (fill.angle * Math.PI) / 180
      const [x, y] = [Math.cos(angle) / 2, Math.sin(angle) / 2]
      canvas.definitions.push(
        `<linearGradient id="${id}" x1="${number(0.5 - x)}" y1="${number(0.5 - y)}" x2="${number(0.5 + x)}" y2="${number(0.5 + y)}">${stops}</linearGradient>`
      )
    }
    return `fill="url(#${id})"`
  }
  const id = canvas.id('p')
  canvas.definitions.push(
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${number(box.width)}" height="${number(box.height)}">${pictureElement(fill.href, fill.crop, box)}</pattern>`
  )
  return `fill="url(#${id})"`
}

/** A picture in a box, the parts its crop cuts away left out. */
export function pictureElement(href: string, crop: Crop | undefined, box: { width: number; height: number }): string {
  const left = crop?.left ?? 0
  const top = crop?.top ?? 0
  const width = Math.max(0.0001, 1 - left - (crop?.right ?? 0))
  const height = Math.max(0.0001, 1 - top - (crop?.bottom ?? 0))
  return (
    `<svg width="${number(box.width)}" height="${number(box.height)}" viewBox="${number(left * 100)} ${number(top * 100)} ${number(width * 100)} ${number(height * 100)}" preserveAspectRatio="none">` +
    `<image width="100" height="100" preserveAspectRatio="none" href="${href}"/></svg>`
  )
}

export function strokeAttributes(outline: Outline | undefined): string {
  if (!outline?.paint) return 'stroke="none"'
  return `stroke="${css(outline.paint)}" stroke-width="${number(outline.width)}"${outline.paint.opacity < 1 ? ` stroke-opacity="${number(outline.paint.opacity)}"` : ''}${outline.dashes ? ` stroke-dasharray="${outline.dashes}"` : ''}`
}

/** A shape's path filled and outlined: nothing when it would show nothing. */
export function shapeElement(
  path: ShapePath,
  fill: Fill | undefined,
  outline: Outline | undefined,
  canvas: Canvas,
  box: { width: number; height: number }
): string {
  const filled = path.closed && fill && fill.kind !== 'none'
  if (!filled && !outline?.paint) return ''
  return `<path d="${path.data}" ${path.closed ? fillAttribute(fill, canvas, box) : 'fill="none"'} ${strokeAttributes(outline)}/>`
}

/** A shape's own path filled and outlined: one element when what is filled is what is stroked, else one for each. */
export function customElement(
  geometry: { fill: string; stroke: string; pieces?: readonly string[] | undefined },
  fill: Fill | undefined,
  outline: Outline | undefined,
  canvas: Canvas,
  box: { width: number; height: number }
): string {
  const fills = geometry.fill !== '' && fill !== undefined && fill.kind !== 'none'
  const strokes = geometry.stroke !== '' && outline?.paint !== undefined
  // Each path is filled on its own, a subpath inside another of the same path a hole, as both apps fill a shape's own path.
  const pieces = geometry.pieces && geometry.pieces.length > 1 ? geometry.pieces : [geometry.fill]
  if (fills && strokes && pieces.length === 1 && geometry.fill === geometry.stroke)
    return `<path d="${geometry.fill}" ${fillAttribute(fill, canvas, box)} fill-rule="evenodd" ${strokeAttributes(outline)}/>`
  const painted = fills ? fillAttribute(fill, canvas, box) : ''
  return (
    (fills ? pieces.map((piece) => `<path d="${piece}" ${painted} fill-rule="evenodd" stroke="none"/>`).join('') : '') +
    (strokes ? `<path d="${geometry.stroke}" fill="none" ${strokeAttributes(outline)}/>` : '')
  )
}

/** A chart drawn simply in its frame: bars for amounts, lines for a course, its categories under it, in the tones and font given. */
export function chartElements(chart: OfficeChart, box: { width: number; height: number }, look: { tones: readonly string[]; font: string }): string {
  const series = chart.series.slice(0, 6)
  const categories = series[0]?.points.map((point) => point.x) ?? []
  const values = series.flatMap((one) => one.points.map((point) => point.y)).filter(Number.isFinite)
  if (categories.length === 0 || values.length === 0 || look.tones.length === 0) return ''
  const highest = Math.max(0, ...values)
  const lowest = Math.min(0, ...values)
  const range = highest - lowest || 1
  const title = chart.title ? 28 : 8
  const left = 8
  const bottom = 22
  const plot = { x: left, y: title, width: Math.max(1, box.width - left - 8), height: Math.max(1, box.height - title - bottom) }
  const at = (value: number) => plot.y + plot.height - ((value - lowest) / range) * plot.height
  const slot = plot.width / categories.length
  const parts: string[] = []
  if (chart.title)
    parts.push(
      `<text x="${number(box.width / 2)}" y="20" text-anchor="middle" font-family="${fontStack(look.font)}" font-size="14" fill="#404040">${escaped(chart.title)}</text>`
    )
  parts.push(`<path d="M${number(plot.x)} ${number(at(0))}H${number(plot.x + plot.width)}" stroke="#bfbfbf" stroke-width="1"/>`)
  series.forEach((one, index) => {
    const tone = look.tones[index % look.tones.length] as string
    if (chart.chart === 'bar') {
      const width = (slot * 0.7) / series.length
      one.points.forEach((point, place) => {
        const x = plot.x + place * slot + slot * 0.15 + index * width
        const top = Math.min(at(point.y), at(0))
        parts.push(`<rect x="${number(x)}" y="${number(top)}" width="${number(width)}" height="${number(Math.abs(at(point.y) - at(0)))}" fill="${tone}"/>`)
      })
    } else {
      const line = one.points.map((point, place) => `${number(plot.x + place * slot + slot / 2)} ${number(at(point.y))}`).join('L')
      if (chart.chart === 'area')
        parts.push(
          `<path d="M${number(plot.x + slot / 2)} ${number(at(0))}L${line}L${number(plot.x + (one.points.length - 0.5) * slot)} ${number(at(0))}Z" fill="${tone}" fill-opacity="0.6"/>`
        )
      else parts.push(`<path d="M${line}" fill="none" stroke="${tone}" stroke-width="2.25"/>`)
    }
  })
  const every = Math.max(1, Math.ceil(categories.length / Math.max(1, Math.floor(plot.width / 60))))
  categories.forEach((category, place) => {
    if (place % every === 0)
      parts.push(
        `<text x="${number(plot.x + place * slot + slot / 2)}" y="${number(box.height - 6)}" text-anchor="middle" font-family="${fontStack(look.font)}" font-size="11" fill="#595959">${escaped(category)}</text>`
      )
  })
  return parts.join('')
}

/** A slide drawn: its SVG and its size in pixels. */
export interface DrawnSlide {
  svg: Uint8Array
  width: number
  height: number
}

/** A slide's SVG, of its size in pixels, from what its canvas holds. */
export function slideSvg(width: number, height: number, canvas: Canvas): DrawnSlide {
  const { definitions, parts } = canvas
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}" overflow="hidden">` +
    `${definitions.length > 0 ? `<defs>${definitions.join('')}</defs>` : ''}${parts.join('')}</svg>`
  return { svg: new TextEncoder().encode(svg), width, height }
}

/** The most bytes of slides drawn in one presentation: past them, a slide shows its text, pictures and charts. */
export const DRAWINGS_LIMIT = 96 * 1024 * 1024

/** The most bytes of pictures written into one slide's drawing. */
export const PICTURE_LIMIT = 32 * 1024 * 1024

/** The most shapes a slide draws, groups and their insides counted, and how deep groups go. */
export const SHAPE_LIMIT = 2000
export const GROUP_DEPTH_LIMIT = 16
