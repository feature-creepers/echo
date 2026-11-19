/**
 * A slide of an OpenDocument presentation drawn as it looks, in SVG (docs/SPEC.md, section 9.7). A page (`draw:page`)
 * names its master page, whose layout gives the slides' size and whose shapes are drawn under its own; each shape is
 * placed by its box and its transform, and drawn as its style says: its fill (a colour, a gradient, a picture), its
 * stroke and its text. A style takes what it leaves out from the style it comes from, then from its family's default.
 * A placeholder's text takes the style of its master's outline at its level. Lists are bulleted or numbered as their
 * list style says.
 *
 * What cannot be read is left out of the drawing rather than failing it: a shape whose parts are missing, a picture
 * of a format the window does not show.
 */

import { type Archive, partOf, textOf } from './archive.ts'
import { customGeometry, type PathCommand } from './custom-geometry.ts'
import { enhancedGeometry } from './enhanced-geometry.ts'
import { drawMetafile } from './metafile.ts'
import { pictureType, readOpenChart } from './office-figures.ts'
import type { OfficeChart } from './office-text.ts'
import { fontFaces, length, merged, type Properties, StyleBook, share } from './open-styles.ts'
import {
  base64,
  bulletCharacter,
  Canvas,
  chartElements,
  css,
  customElement,
  type DrawnSlide,
  escaped,
  type Fill,
  fillAttribute,
  fromHex,
  GROUP_DEPTH_LIMIT,
  listNumber,
  number,
  type Outline,
  type Paint,
  PICTURE_LIMIT,
  pictureElement,
  type RunStyle,
  SHAPE_LIMIT,
  slideSvg,
  strokeAttributes,
  type TextBullet,
  type TextFrame,
  type TextParagraph,
  type TextPiece,
  textDiv,
  textHtml
} from './slide-svg.ts'
import { childAt, childrenNamed, type XmlNode, xmlTree } from './xml.ts'

/** An angle as OpenDocument writes it, in radians: a bare number is radians, or in degrees, gradians or radians as its unit says. */
function angle(value: string): number {
  const match = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(deg|grad|rad)?\s*$/i.exec(value)
  if (!match) return 0
  const found = Number(match[1])
  const unit = match[2]?.toLowerCase()
  return unit === 'deg' ? (found * Math.PI) / 180 : unit === 'grad' ? (found * Math.PI) / 200 : found
}

// The deck

/** What a presentation's pages are drawn with, read once for them all. */
export interface OpenDeck {
  archive: Archive
  book: StyleBook
  fonts: Map<string, string>
  footers: Map<string, string>
  dates: Map<string, string>
  named: Map<string, XmlNode>
  masters: Map<string, XmlNode>
  layouts: Map<string, XmlNode>
  addresses: Map<string, Promise<Held | undefined>>
}

const ROOT_CONTENT = 'office:document-content'
const ROOT_STYLES = 'office:document-styles'

/** A presentation's styles, fonts, master pages and the declarations of its footers, from its content and `styles.xml`. */
export async function openDeck(archive: Archive, content: XmlNode): Promise<OpenDeck> {
  const stylesXml = await textOf(archive, 'styles.xml')
  const styles = stylesXml === undefined ? undefined : xmlTree(stylesXml)
  const document = childAt(content, ROOT_CONTENT)
  const stylesRoot = childAt(styles, ROOT_STYLES)
  const book = new StyleBook(childAt(document, 'office:automatic-styles'), childAt(stylesRoot, 'office:automatic-styles'), childAt(stylesRoot, 'office:styles'))
  const fonts = fontFaces([stylesRoot, document])
  const named = new Map<string, XmlNode>()
  for (const child of childAt(stylesRoot, 'office:styles')?.children ?? [])
    if (child.attributes['draw:name'] && /^draw:(gradient|fill-image|stroke-dash|hatch|opacity)$/.test(child.name))
      named.set(`${child.name}/${child.attributes['draw:name']}`, child)
  const masters = new Map<string, XmlNode>()
  for (const master of childrenNamed(childAt(stylesRoot, 'office:master-styles'), 'style:master-page'))
    masters.set(master.attributes['style:name'] ?? '', master)
  const layouts = new Map<string, XmlNode>()
  for (const layout of childrenNamed(childAt(stylesRoot, 'office:automatic-styles'), 'style:page-layout'))
    layouts.set(layout.attributes['style:name'] ?? '', layout)
  const footers = new Map<string, string>()
  const dates = new Map<string, string>()
  const presentation = childAt(document, 'office:body', 'office:presentation')
  for (const declaration of presentation?.children ?? []) {
    const name = declaration.attributes['presentation:name'] ?? ''
    if (declaration.name === 'presentation:footer-decl') footers.set(name, plainText(declaration))
    else if (declaration.name === 'presentation:date-time-decl' && declaration.attributes['presentation:source'] !== 'current-date')
      dates.set(name, plainText(declaration))
  }
  return { archive, book, fonts, footers, dates, named, masters, layouts, addresses: new Map() }
}

const plainText = (node: XmlNode): string => (node.name === '#text' ? node.text : node.children.map(plainText).join(''))

// Drawing

/** What a page is drawn with: the deck, its place, its style, its master, what it has drawn. */
interface PageContext {
  deck: OpenDeck
  place: number
  pageStyle: Properties
  footer: string | undefined
  date: string | undefined
  canvas: Canvas
  shapes: number
  pictureBytes: number
}

/**
 * A picture's own size in pixels, as its header gives it: a PNG's at the resolution it names (96 to the inch when it
 * names none), a JPEG's at its density, a GIF's or a BMP's as they are; none for another format.
 */
export function naturalSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const within = (at: number, size: number) => at >= 0 && at + size <= bytes.length
  if (within(0, 24) && data.getUint32(0) === 0x89504e47) {
    let width = data.getUint32(16)
    let height = data.getUint32(20)
    // A chunk of physical size (`pHYs`) in pixels to the metre gives the resolution.
    for (let at = 8; within(at, 8) && at < 4096; at += 12 + data.getUint32(at)) {
      if (data.getUint32(at + 4) !== 0x70485973 || !within(at + 8, 9) || data.getUint8(at + 16) !== 1) continue
      const perInchX = data.getUint32(at + 8) * 0.0254
      const perInchY = data.getUint32(at + 12) * 0.0254
      if (perInchX > 0 && perInchY > 0) {
        width = (width * 96) / perInchX
        height = (height * 96) / perInchY
      }
      break
    }
    return { width, height }
  }
  if (within(0, 10) && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { width: data.getUint16(6, true), height: data.getUint16(8, true) }
  if (within(0, 26) && bytes[0] === 0x42 && bytes[1] === 0x4d) return { width: Math.abs(data.getInt32(18, true)), height: Math.abs(data.getInt32(22, true)) }
  if (within(0, 4) && data.getUint16(0) === 0xffd8) {
    let density: { x: number; y: number } | undefined
    for (let at = 2; within(at, 4); ) {
      const marker = data.getUint16(at)
      const size = data.getUint16(at + 2)
      if (marker === 0xffe0 && within(at + 4, 12) && data.getUint8(at + 11) === 1) density = { x: data.getUint16(at + 12), y: data.getUint16(at + 14) }
      // A frame's header gives its size: the markers of the first frame, but for those of other kinds.
      if (marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc && within(at + 5, 4)) {
        const height = data.getUint16(at + 5)
        const width = data.getUint16(at + 7)
        return density && density.x > 0 && density.y > 0 ? { width: (width * 96) / density.x, height: (height * 96) / density.y } : { width, height }
      }
      if ((marker & 0xff00) !== 0xff00 || size < 2) return undefined
      at += 2 + size
    }
  }
  return undefined
}

/** A picture as the SVG holds it: its address of data, and its own size when its header gives one. */
interface Held {
  href: string
  size?: { width: number; height: number } | undefined
}

/** A part of the presentation, or a picture written into it, as an address of data the SVG holds. */
async function pictureAddress(source: XmlNode, context: PageContext): Promise<string | undefined> {
  return (await pictureHeld(source, context))?.href
}

async function pictureHeld(source: XmlNode, context: PageContext): Promise<Held | undefined> {
  const { deck } = context
  const inline = childAt(source, 'office:binary-data')
  const href = source.attributes['xlink:href']
  const key = inline ? undefined : href?.replace(/^\.\//, '')
  if (!inline && (!key || /^[a-z][a-z\d+.-]*:/i.test(key))) return undefined
  const read = async (): Promise<Held | undefined> => {
    let bytes: Uint8Array | undefined
    if (inline) {
      const binary = atob(plainText(inline).replace(/\s+/g, ''))
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    } else {
      const part = key === undefined ? undefined : partOf(deck.archive, key)
      bytes = part ? await part() : undefined
    }
    if (!bytes) return undefined
    const type = pictureType(bytes)
    if (type) return { href: `data:${type};base64,${base64(bytes)}`, size: naturalSize(bytes) }
    const drawn = drawMetafile(bytes)
    return drawn ? { href: `data:image/svg+xml;base64,${base64(drawn.svg)}`, size: { width: drawn.width, height: drawn.height } } : undefined
  }
  let address = key === undefined ? undefined : deck.addresses.get(key)
  if (!address) {
    address = read().catch(() => undefined)
    if (key !== undefined) deck.addresses.set(key, address)
  }
  const found = await address
  if (!found || context.pictureBytes + found.href.length > PICTURE_LIMIT) return undefined
  context.pictureBytes += found.href.length
  return found
}

/** The crop a frame's style gives its picture (`fo:clip`), lengths cut from its own size on each side, as shares of it. */
function cropOf(clip: string | undefined, size: { width: number; height: number } | undefined) {
  const match = /rect\(([^)]*)\)/.exec(clip ?? '')
  if (!match || !size || size.width <= 0 || size.height <= 0) return undefined
  const [top, right, bottom, left] = (match[1] ?? '').split(/[\s,]+/).map((value) => length(value) ?? 0)
  return { top: (top ?? 0) / size.height, right: (right ?? 0) / size.width, bottom: (bottom ?? 0) / size.height, left: (left ?? 0) / size.width }
}

const paintOf = (colour: string | undefined, opacity = 1): Paint | undefined => {
  const paint = fromHex(colour)
  return paint && { ...paint, opacity: Math.min(1, Math.max(0, opacity)) }
}

/** A gradient (`draw:gradient`) as a fill: along its angle, from its middle out, or from a point, its colours at their intensity. */
function gradientOf(gradient: XmlNode, opacity: number): Fill | undefined {
  const { attributes } = gradient
  const colour = (which: 'start' | 'end') => {
    const paint = paintOf(attributes[`draw:${which}-color`], opacity)
    const intensity = share(attributes[`draw:${which}-intensity`]) ?? 1
    return paint && { ...paint, red: paint.red * intensity, green: paint.green * intensity, blue: paint.blue * intensity }
  }
  const start = colour('start')
  const end = colour('end')
  if (!start || !end) return start ? { kind: 'paint', paint: start } : undefined
  const border = Math.min(0.99, Math.max(0, share(attributes['draw:border']) ?? 0))
  const style = attributes['draw:style'] ?? 'linear'
  if (style === 'linear' || style === 'axial') {
    // The angle turns the axis counter-clockwise from going down, in tenths of a degree when it gives no unit.
    const raw = attributes['draw:angle'] ?? '0'
    const turn = /[a-z]/i.test(raw) ? angle(raw) : ((Number(raw) || 0) / 10) * (Math.PI / 180)
    const direction = (Math.atan2(Math.cos(turn), Math.sin(turn)) * 180) / Math.PI
    const stops =
      style === 'axial'
        ? [
            { offset: 0, paint: end },
            { offset: border / 2, paint: end },
            { offset: 0.5, paint: start },
            { offset: 1 - border / 2, paint: end },
            { offset: 1, paint: end }
          ]
        : [
            { offset: 0, paint: start },
            { offset: border, paint: start },
            { offset: 1, paint: end }
          ]
    return { kind: 'gradient', stops, angle: direction, radial: false }
  }
  // A gradient from a point has its end colour there, its start colour at the edges.
  const centre = { x: share(attributes['draw:cx']) ?? 0.5, y: share(attributes['draw:cy']) ?? 0.5 }
  return {
    kind: 'gradient',
    stops: [
      { offset: 0, paint: end },
      { offset: 1 - border, paint: start },
      { offset: 1, paint: start }
    ],
    angle: 0,
    radial: true,
    centre
  }
}

/** A shape's or a page's fill, as its properties say; none given when they give none. */
async function fillOf(properties: Properties, context: PageContext): Promise<Fill | undefined> {
  const kind = properties['draw:fill']
  const opacity = share(properties['draw:opacity']) ?? 1 - (share(properties['draw:transparency']) ?? 0)
  const named = (element: string, name: string | undefined) => (name ? context.deck.named.get(`${element}/${name}`) : undefined)
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'solid': {
      const paint = paintOf(properties['draw:fill-color'] ?? '#ffffff', opacity)
      return paint ? { kind: 'paint', paint } : undefined
    }
    case 'gradient': {
      const gradient = named('draw:gradient', properties['draw:fill-gradient-name'])
      return gradient ? gradientOf(gradient, opacity) : undefined
    }
    case 'bitmap': {
      const image = named('draw:fill-image', properties['draw:fill-image-name'])
      const href = image ? await pictureAddress(image, context) : undefined
      return href ? { kind: 'picture', href, crop: undefined } : undefined
    }
    case 'hatch': {
      // A hatch is drawn as the colour behind it, when it has one, else as its lines' colour, faintly.
      if (properties['draw:fill-hatch-solid'] === 'true') {
        const paint = paintOf(properties['draw:fill-color'], opacity)
        return paint ? { kind: 'paint', paint } : undefined
      }
      const hatch = named('draw:hatch', properties['draw:fill-hatch-name'])
      const paint = paintOf(hatch?.attributes['draw:color'], opacity * 0.4)
      return paint ? { kind: 'paint', paint } : { kind: 'none' }
    }
    default:
      return undefined
  }
}

/** A shape's line, as its properties say: its colour, width, opacity and dashes; none when it has none. */
function outlineOf(properties: Properties, context: PageContext): Outline | undefined {
  const kind = properties['draw:stroke'] ?? 'solid'
  if (kind === 'none') return undefined
  const paint = paintOf(properties['svg:stroke-color'] ?? '#000000', share(properties['svg:stroke-opacity']) ?? 1)
  const width = Math.max(0.75, length(properties['svg:stroke-width']) ?? 0)
  let dashes: string | undefined
  const dash = kind === 'dash' && properties['draw:stroke-dash'] ? context.deck.named.get(`draw:stroke-dash/${properties['draw:stroke-dash']}`) : undefined
  if (dash) {
    const { attributes } = dash
    const measure = (value: string | undefined) => (share(value) !== undefined ? (share(value) as number) * width : (length(value) ?? width))
    const pieces: number[] = []
    const distance = measure(attributes['draw:distance'])
    for (const which of ['1', '2']) {
      const count = Math.min(Number(attributes[`draw:dots${which}`]) || 0, 16)
      const piece = measure(attributes[`draw:dots${which}-length`])
      for (let index = 0; index < count; index++) pieces.push(Math.max(piece, 0.5), Math.max(distance, 0.5))
    }
    if (pieces.length > 0) dashes = pieces.map(number).join(' ')
  }
  return { paint, width, dashes }
}

// Text

/** A text's properties as a run's style: its size in points, weight, slant, lines, case, colour and font. */
function runStyle(properties: Properties, deck: OpenDeck): RunStyle {
  const size = length(properties['fo:font-size'])
  const weight = properties['fo:font-weight']
  const fontName = properties['style:font-name']
  const named = fontName ? deck.fonts.get(fontName) : properties['fo:font-family']?.replace(/^['"]|['"]$/g, '')
  // A font named after a theme's (`+mn-lt`), as PowerPoint writes one, is no font of its own.
  const family = named?.startsWith('+') ? undefined : named
  const lined = (name: string) => {
    const value = properties[name]
    return value !== undefined && value !== 'none'
  }
  return {
    size: size === undefined ? undefined : (size * 3) / 4,
    bold: weight === 'bold' || Number(weight) >= 600,
    italic: properties['fo:font-style'] === 'italic' || properties['fo:font-style'] === 'oblique',
    underline: lined('style:text-underline-style'),
    strike: lined('style:text-line-through-style'),
    caps: properties['fo:text-transform'] === 'uppercase',
    paint: properties['style:use-window-font-color'] === 'true' ? undefined : paintOf(properties['fo:color']),
    font: family
  }
}

/** The style a shape's text starts from at a level: its own style's, or for a placeholder's outline, its master's outline of that level. */
interface TextBase {
  family: string
  name: string | undefined
  inMaster: boolean
  outline: string | undefined
  textStyle: string | undefined
  fixed?: { text: Properties; paragraph: Properties } | undefined
}

function levelProperties(base: TextBase, level: number, kind: 'paragraph' | 'text', deck: OpenDeck): Properties {
  if (base.fixed) return merged([deck.book.properties('paragraph', undefined, kind, base.inMaster), base.fixed[kind]])
  const own = deck.book.properties(base.family, base.name, kind, base.inMaster)
  if (!base.outline || level <= 1) return merged([own, deck.book.properties('paragraph', base.textStyle, kind, base.inMaster, false)])
  // A deeper level of an outline takes its master's outline of that level, then what the shape's own style says.
  const outline = deck.book.properties('presentation', `${base.outline}${level}`, kind, true)
  const automatic = base.name ? deck.book.find('presentation', base.name, base.inMaster) : undefined
  const ownOnly = automatic?.attributes['style:parent-style-name'] ? (childAt(automatic, `style:${kind}-properties`)?.attributes ?? {}) : {}
  return merged([outline, ownOnly, deck.book.properties('paragraph', base.textStyle, kind, base.inMaster, false)])
}

/** A list's level as a bullet or a number, and the indents it gives. */
function listLevel(list: XmlNode | undefined, level: number) {
  const found = list?.children.find((child) => child.name.startsWith('text:list-level-style-') && Number(child.attributes['text:level']) === level)
  if (!found) return undefined
  const properties = childAt(found, 'style:list-level-properties')
  const alignment = childAt(properties, 'style:list-level-label-alignment')?.attributes
  const placed =
    properties?.attributes['text:list-level-position-and-space-mode'] === 'label-alignment' && alignment
      ? { marginLeft: length(alignment['fo:margin-left']) ?? 0, indent: length(alignment['fo:text-indent']) ?? 0 }
      : (() => {
          const before = length(properties?.attributes['text:space-before']) ?? 0
          const label = length(properties?.attributes['text:min-label-width']) ?? 0
          return { marginLeft: before + label, indent: -label }
        })()
  return { node: found, ...placed, text: childAt(found, 'style:text-properties')?.attributes ?? {} }
}

/** The kinds of numbering of OpenDocument's lists, as `listNumber` names them. */
const NUMBERINGS: Record<string, string> = { '1': 'arabic', a: 'alphaLc', A: 'alphaUc', i: 'romanLc', I: 'romanUc' }

/** What a paragraph is read in: its list, its level, whether it begins an item, and the counts of each level. */
interface ListPlace {
  list: XmlNode | undefined
  level: number
  item: boolean
}

/** The paragraphs of a shape's text, walked in order through its lists, with what each needs to be drawn. */
function readParagraphs(holder: XmlNode, base: TextBase, context: PageContext): TextParagraph[] {
  const { deck } = context
  const paragraphs: TextParagraph[] = []
  const counters = new Map<number, number>()
  const outlineList = base.outline ? deck.book.ownList(base.family, base.name, base.inMaster) : undefined
  const walk = (node: XmlNode, place: ListPlace) => {
    for (const child of node.children) {
      if (paragraphs.length >= 2000) return
      if (child.name === 'text:p' || child.name === 'text:h') {
        paragraphs.push(paragraph(child, place))
        place = { ...place, item: false }
      } else if (child.name === 'text:list') {
        const own = child.attributes['text:style-name']
        walk(child, { list: (own ? deck.book.lists.get(own) : undefined) ?? place.list ?? outlineList, level: place.level + 1, item: false })
      } else if (child.name === 'text:list-item') walk(child, { ...place, item: true })
      else if (child.name === 'text:list-header') walk(child, { ...place, item: false })
      else if (child.name === 'text:section' || child.name === 'text:soft-page-break') walk(child, place)
    }
  }
  const paragraph = (node: XmlNode, place: ListPlace): TextParagraph => {
    const level = Math.max(1, place.level)
    const styleName = node.attributes['text:style-name']
    const paragraphProperties = merged([
      levelProperties(base, level, 'paragraph', deck),
      deck.book.properties('paragraph', styleName, 'paragraph', base.inMaster, false)
    ])
    const textProperties = merged([levelProperties(base, level, 'text', deck), deck.book.properties('paragraph', styleName, 'text', base.inMaster, false)])
    const pieces: TextPiece[] = []
    const inline = (element: XmlNode, properties: Properties) => {
      const style = runStyle(properties, deck)
      const add = (text: string) => {
        if (text === '') return
        const last = pieces.at(-1)
        if (last && last !== 'break' && last.style === style) last.text += text
        else pieces.push({ text, style })
      }
      for (const part of element.children) {
        if (part.name === '#text') add(part.text.replace(/[\t\n\r ]+/g, ' '))
        else if (part.name === 'text:span' || part.name === 'text:a')
          inline(part, merged([properties, deck.book.properties('text', part.attributes['text:style-name'], 'text', base.inMaster, false)]))
        else if (part.name === 'text:s') add(' '.repeat(Math.min(Math.max(Number(part.attributes['text:c']) || 1, 1), 256)))
        else if (part.name === 'text:tab') add('\t')
        else if (part.name === 'text:line-break') pieces.push('break')
        else if (part.name === 'text:page-number') add(String(context.place))
        else if (part.name === 'presentation:footer') add(context.footer ?? '')
        else if (part.name === 'presentation:date-time') add(context.date ?? '')
        else if (part.name !== 'text:note' && part.name !== 'office:annotation' && part.name !== 'text:bookmark') add(plainText(part))
      }
    }
    inline(node, textProperties)
    const firstStyle = pieces.find((piece): piece is { text: string; style: RunStyle } => piece !== 'break')
    const look = runStyle(textProperties, deck)
    const size = firstStyle?.style.size ?? look.size ?? 18
    // A list's level gives a bullet or a number, and the indents its paragraph style does not.
    const listed = place.list && place.level > 0 ? listLevel(place.list, level) : undefined
    let bullet: TextBullet | undefined
    const ownMargin = length(paragraphProperties['fo:margin-left'])
    const ownIndent = length(paragraphProperties['fo:text-indent'])
    const marginLeft = ownMargin ?? listed?.marginLeft ?? 0
    const indent = ownIndent ?? listed?.indent ?? 0
    if (listed && place.item && pieces.length > 0) {
      const text = listed.text
      const paint = text['style:use-window-font-color'] === 'true' ? undefined : paintOf(text['fo:color'])
      const relative = share(text['fo:font-size']) ?? share(listed.node.attributes['text:bullet-relative-size'])
      const width = indent < 0 ? -indent : undefined
      const firstPaint = firstStyle?.style.paint
      if (listed.node.name === 'text:list-level-style-number') {
        const format = listed.node.attributes['style:num-format'] ?? '1'
        const count = (counters.get(level) ?? (Number(listed.node.attributes['text:start-value']) || 1) - 1) + 1
        counters.set(level, count)
        const scheme = NUMBERINGS[format]
        if (scheme)
          bullet = {
            mark: `${listed.node.attributes['style:num-prefix'] ?? ''}${listNumber(scheme, count)}${listed.node.attributes['style:num-suffix'] ?? ''}`,
            paint: paint ?? firstPaint,
            width,
            size: relative
          }
      } else {
        // A bullet of a font of symbols the window may not have is the character it stands for, or a plain one.
        const character = listed.node.attributes['text:bullet-char'] ?? '•'
        const font = text['style:font-name'] ? deck.fonts.get(text['style:font-name']) : text['fo:font-family']
        const known = bulletCharacter(character)
        const symbols = font !== undefined && /wingdings|webdings|symbol|sorts|dingbats/i.test(font) && !/opensymbol|starsymbol/i.test(font)
        bullet = { mark: known !== character ? known : symbols ? '•' : character, paint: paint ?? firstPaint, width, size: relative }
      }
      for (const deeper of [...counters.keys()]) if (deeper > level) counters.delete(deeper)
    }
    const align = paragraphProperties['fo:text-align']
    const height = paragraphProperties['fo:line-height']
    const atLeast = length(paragraphProperties['style:line-height-at-least'])
    const points = (value: string | undefined) => {
      const found = length(value)
      return found === undefined ? undefined : (found * 3) / 4
    }
    return {
      align: align === 'center' ? 'center' : align === 'end' || align === 'right' ? 'right' : align === 'justify' ? 'justify' : 'left',
      size,
      lineSpacing: share(height) ?? (height === undefined || height === 'normal' ? 1 : undefined),
      lineHeight: points(height) ?? (atLeast !== undefined ? (atLeast * 3) / 4 : undefined),
      marginLeft,
      indent,
      spaceBefore: points(paragraphProperties['fo:margin-top']),
      spaceAfter: points(paragraphProperties['fo:margin-bottom']),
      bullet,
      pieces
    }
  }
  walk(holder, { list: undefined, level: 0, item: false })
  return paragraphs
}

/** A shape's text as a frame: its paragraphs, the padding and placing its graphic properties give, its font and colour. */
function textFrame(holder: XmlNode, base: TextBase, graphic: Properties, context: PageContext, anchor: 'top' | 'middle' | 'bottom'): TextFrame | undefined {
  const paragraphs = readParagraphs(holder, base, context)
  if (!paragraphs.some((paragraph) => paragraph.pieces.some((piece) => piece !== 'break' && piece.text.trim() !== ''))) return undefined
  const padding = (side: string) => length(graphic[`fo:padding-${side}`] ?? graphic['fo:padding']) ?? 4.72
  const vertical = graphic['draw:textarea-vertical-align']
  const look = runStyle(levelProperties(base, 1, 'text', context.deck), context.deck)
  return {
    paragraphs,
    insets: { top: padding('top'), right: padding('right'), bottom: padding('bottom'), left: padding('left') },
    anchor: vertical === 'middle' ? 'middle' : vertical === 'bottom' ? 'bottom' : vertical === 'top' ? 'top' : anchor,
    wraps: graphic['fo:wrap-option'] !== 'no-wrap',
    font: look.font ?? '',
    paint: look.paint ?? { red: 0, green: 0, blue: 0, opacity: 1 }
  }
}

// Shapes

/** A shape's transform (`draw:transform`) as SVG's, its own steps applied in order, then its place. */
function transformOf(node: XmlNode): string {
  const parts: string[] = []
  const written = node.attributes['draw:transform'] ?? ''
  for (const [, name, values] of written.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const args = (values ?? '').trim().split(/[\s,]+/)
    switch (name) {
      case 'rotate':
        // OpenDocument turns counter-clockwise, SVG clockwise.
        parts.unshift(`rotate(${number((-angle(args[0] ?? '0') * 180) / Math.PI)})`)
        break
      case 'translate':
        parts.unshift(`translate(${number(length(args[0]) ?? 0)} ${number(length(args[1]) ?? 0)})`)
        break
      case 'scale':
        parts.unshift(`scale(${number(Number(args[0]) || 1)} ${number(Number(args[1] ?? args[0]) || 1)})`)
        break
      case 'skewX':
        parts.unshift(`skewX(${number((-angle(args[0] ?? '0') * 180) / Math.PI)})`)
        break
      case 'skewY':
        parts.unshift(`skewY(${number((-angle(args[0] ?? '0') * 180) / Math.PI)})`)
        break
      case 'matrix':
        parts.unshift(
          `matrix(${args
            .slice(0, 6)
            .map((value, index) => number(index >= 4 ? (length(value) ?? 0) : Number(value) || 0))
            .join(' ')})`
        )
        break
    }
  }
  const x = length(node.attributes['svg:x']) ?? 0
  const y = length(node.attributes['svg:y']) ?? 0
  if (x || y || parts.length === 0) parts.push(`translate(${number(x)} ${number(y)})`)
  return parts.join(' ')
}

/** The classes of placeholders a master's slides fill, and those of their footers, shown as each slide says. */
const FOOTERS: Record<string, string> = {
  footer: 'presentation:display-footer',
  'page-number': 'presentation:display-page-number',
  'date-time': 'presentation:display-date-time'
}

const SHAPES = new Set([
  'draw:frame',
  'draw:rect',
  'draw:ellipse',
  'draw:circle',
  'draw:line',
  'draw:polyline',
  'draw:polygon',
  'draw:path',
  'draw:custom-shape',
  'draw:connector',
  'draw:caption',
  'draw:g'
])

async function drawShapes(holder: XmlNode, context: PageContext, inMaster: boolean, depth: number): Promise<void> {
  for (const node of holder.children) {
    if (context.shapes >= SHAPE_LIMIT) return
    if (!SHAPES.has(node.name)) continue
    const kind = node.attributes['presentation:class']
    if (kind !== undefined) {
      // A master's placeholders are its slides' to fill, but for its footers, which a slide shows when it says so.
      if (inMaster && (FOOTERS[kind] === undefined || context.pageStyle[FOOTERS[kind]] !== 'true')) continue
      if (!inMaster && node.attributes['presentation:placeholder'] === 'true') continue
    }
    context.shapes++
    try {
      if (node.name === 'draw:g') {
        if (depth >= GROUP_DEPTH_LIMIT) continue
        const transform = node.attributes['draw:transform'] ? transformOf({ ...node, attributes: { 'draw:transform': node.attributes['draw:transform'] } }) : ''
        if (transform) context.canvas.parts.push(`<g transform="${transform}">`)
        await drawShapes(node, context, inMaster, depth + 1)
        if (transform) context.canvas.parts.push('</g>')
      } else await drawShape(node, context, inMaster)
    } catch {
      // A shape that cannot be read is left out of the drawing.
    }
  }
}

async function drawShape(node: XmlNode, context: PageContext, inMaster: boolean): Promise<void> {
  const { deck, canvas } = context
  const { attributes } = node
  const presentationStyle = attributes['presentation:style-name']
  const graphicStyle = attributes['draw:style-name']
  const graphic = merged([
    presentationStyle ? deck.book.properties('presentation', presentationStyle, 'graphic', inMaster) : {},
    graphicStyle || !presentationStyle ? deck.book.properties('graphic', graphicStyle, 'graphic', inMaster) : {}
  ])
  const placeholder = attributes['presentation:class']
  // A placeholder's outline takes its master's outline styles at each level, named after its first.
  const outlineName =
    placeholder === 'outline'
      ? deck.book.chain('presentation', presentationStyle, inMaster).find((style) => /outline1$/.test(style.attributes['style:name'] ?? ''))?.attributes[
          'style:name'
        ]
      : undefined
  const base: TextBase = {
    family: presentationStyle ? 'presentation' : 'graphic',
    name: presentationStyle ?? graphicStyle,
    inMaster,
    outline: outlineName?.replace(/1$/, ''),
    textStyle: attributes['draw:text-style-name']
  }
  const content: string[] = []
  let width = length(attributes['svg:width']) ?? 0
  let height = length(attributes['svg:height']) ?? 0
  let transform = transformOf(node)
  let textBox: { x: number; y: number; width: number; height: number } | undefined
  let textHolder: XmlNode | undefined = node
  let anchor: 'top' | 'middle' | 'bottom' = 'middle'
  const fill = async () => (await fillOf(graphic, context)) ?? { kind: 'none' as const }
  const outline = outlineOf(graphic, context)

  switch (node.name) {
    case 'draw:frame': {
      anchor = 'top'
      textHolder = childAt(node, 'draw:text-box')
      const size = { width, height }
      const object = childAt(node, 'draw:object')
      const table = childAt(node, 'table:table')
      if (table) content.push(tableElement(table, size, context, inMaster))
      else if (object) {
        const chart = await objectChart(object, deck)
        if (chart) content.push(chartElements(chart, size, { tones: CHART_TONES, font: deck.fonts.values().next().value ?? '' }))
      }
      if (!table && content.length === 0)
        for (const image of childrenNamed(node, 'draw:image')) {
          const held = await pictureHeld(image, context)
          if (!held) continue
          content.push(pictureElement(held.href, cropOf(graphic['fo:clip'], held.size), size))
          break
        }
      // A frame of text is filled and outlined as its style says; one of a picture, a chart or a table only outlined.
      const frameFill = textHolder ? await fill() : undefined
      content.unshift(customElement({ fill: rectangle(width, height), stroke: rectangle(width, height) }, frameFill, outline, canvas, size))
      break
    }
    case 'draw:rect':
    case 'draw:caption': {
      const radius = Math.min(length(attributes['draw:corner-radius']) ?? 0, width / 2, height / 2)
      const data = radius > 0 ? rounded(width, height, radius) : rectangle(width, height)
      content.push(customElement({ fill: data, stroke: data }, await fill(), outline, canvas, { width, height }))
      break
    }
    case 'draw:ellipse':
    case 'draw:circle': {
      const shape = attributes['draw:kind'] ?? 'full'
      const start = Number(attributes['draw:start-angle'] ?? 0) || 0
      const end = Number(attributes['draw:end-angle'] ?? 360) || 0
      const centre = [width / 2, height / 2, width / 2, height / 2]
      const commands: PathCommand[] =
        shape === 'section'
          ? [
              { command: 'M', values: [width / 2, height / 2] },
              { command: 'T', values: [...centre, start, end] },
              { command: 'Z', values: [] }
            ]
          : shape === 'cut'
            ? [
                { command: 'U', values: [...centre, start, end] },
                { command: 'Z', values: [] }
              ]
            : shape === 'arc'
              ? [
                  { command: 'U', values: [...centre, start, end] },
                  { command: 'F', values: [] }
                ]
              : [{ command: 'U', values: [...centre, 0, 360] }]
      const geometry = customGeometry(commands, { left: 0, top: 0, width, height }, { width, height })
      content.push(customElement(geometry, await fill(), outline, canvas, { width, height }))
      break
    }
    case 'draw:line':
    case 'draw:connector': {
      // A line is placed by its ends, on the page, its transform moving them.
      const [x1, y1, x2, y2] = ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map((name) => length(attributes[name]) ?? 0) as [number, number, number, number]
      transform = attributes['draw:transform'] ? transformOf({ ...node, attributes: { 'draw:transform': attributes['draw:transform'] } }) : ''
      content.push(`<path d="M${number(x1)} ${number(y1)}L${number(x2)} ${number(y2)}" fill="none" ${strokeAttributes(outline)}/>`)
      width = Math.abs(x2 - x1)
      height = Math.abs(y2 - y1)
      textBox = { x: Math.min(x1, x2), y: Math.min(y1, y2), width, height }
      break
    }
    case 'draw:polyline':
    case 'draw:polygon': {
      const view = viewBoxOf(attributes['svg:viewBox'], width, height)
      const values = (attributes['svg:points'] ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite)
      const closed = node.name === 'draw:polygon'
      const commands: PathCommand[] = [
        { command: 'M', values: values.slice(0, 2) },
        { command: 'L', values: values.slice(2) },
        ...(closed ? [{ command: 'Z', values: [] }] : [{ command: 'F', values: [] }])
      ]
      content.push(customElement(customGeometry(commands, view, { width, height }), await fill(), outline, canvas, { width, height }))
      break
    }
    case 'draw:path': {
      const view = viewBoxOf(attributes['svg:viewBox'], width, height)
      const data = (attributes['svg:d'] ?? '').replace(/[^MmLlHhVvCcSsQqTtAaZz\d.,eE\s+-]/g, '')
      if (data) {
        const filled = /z/i.test(data)
        const pathFill = filled ? await fill() : undefined
        const scale = `scale(${number(view.width ? width / view.width : 1)} ${number(view.height ? height / view.height : 1)}) translate(${number(-view.left)} ${number(-view.top)})`
        content.push(
          `<g transform="${scale}"><path d="${escaped(data)}" ${filled ? fillAttribute(pathFill, canvas, { width: view.width, height: view.height }) : 'fill="none"'} ${strokeAttributes(outline)} vector-effect="non-scaling-stroke"/></g>`
        )
      }
      break
    }
    case 'draw:custom-shape': {
      const geometry = childAt(node, 'draw:enhanced-geometry')
      const drawn = geometry
        ? enhancedGeometry(geometry, { width, height })
        : { geometry: { fill: rectangle(width, height), stroke: rectangle(width, height) }, flipH: false, flipV: false, text: undefined }
      const element = customElement(drawn.geometry, await fill(), outline, canvas, { width, height })
      const flips =
        drawn.flipH || drawn.flipV
          ? `translate(${number(drawn.flipH ? width : 0)} ${number(drawn.flipV ? height : 0)}) scale(${drawn.flipH ? -1 : 1} ${drawn.flipV ? -1 : 1})`
          : ''
      content.push(flips && element ? `<g transform="${flips}">${element}</g>` : element)
      textBox = drawn.text
      break
    }
  }

  if (textHolder) {
    const frame = textFrame(textHolder, base, graphic, context, anchor)
    if (frame) {
      const box = textBox ?? { x: 0, y: 0, width, height }
      const html = textHtml(frame, box)
      content.push(box.x || box.y ? `<g transform="translate(${number(box.x)} ${number(box.y)})">${html}</g>` : html)
    }
  }
  const drawn = content.filter(Boolean)
  if (drawn.length > 0) canvas.parts.push(transform ? `<g transform="${transform}">${drawn.join('')}</g>` : drawn.join(''))
}

const rectangle = (width: number, height: number) => `M0 0L${number(width)} 0L${number(width)} ${number(height)}L0 ${number(height)}Z`

const rounded = (width: number, height: number, r: number) =>
  `M${number(r)} 0H${number(width - r)}A${number(r)} ${number(r)} 0 0 1 ${number(width)} ${number(r)}V${number(height - r)}A${number(r)} ${number(r)} 0 0 1 ${number(width - r)} ${number(height)}H${number(r)}A${number(r)} ${number(r)} 0 0 1 0 ${number(height - r)}V${number(r)}A${number(r)} ${number(r)} 0 0 1 ${number(r)} 0Z`

/** A shape's view box (`svg:viewBox`), or its own size when it gives none. */
function viewBoxOf(value: string | undefined, width: number, height: number) {
  const [left = 0, top = 0, boxWidth = width, boxHeight = height] = (value ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  return { left, top, width: boxWidth, height: boxHeight }
}

/** The colours LibreOffice draws a chart's series in. */
const CHART_TONES = ['#004586', '#ff420e', '#ffd320', '#579d1c', '#7e0021', '#83caff']

/** The chart an object of the presentation holds, read from its own content. */
async function objectChart(object: XmlNode, deck: OpenDeck): Promise<OfficeChart | undefined> {
  const href = object.attributes['xlink:href']?.replace(/^\.\//, '').replace(/\/$/, '')
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return undefined
  const xml = await textOf(deck.archive, `${href}/content.xml`)
  return xml === undefined ? undefined : readOpenChart(xml).catch(() => undefined)
}

/**
 * A table of a page (`table:table`) as XHTML in its frame: its columns at their widths, its rows at their heights, each
 * cell's fill and text, from its own style over those its table's template gives its row and column.
 */
function tableElement(table: XmlNode, box: { width: number; height: number }, context: PageContext, inMaster: boolean): string {
  const { book } = context.deck
  const columns: number[] = []
  for (const column of childrenNamed(table, 'table:table-column')) {
    const width = length(book.properties('table-column', column.attributes['table:style-name'], 'table-column', inMaster)['style:column-width'])
    const count = Math.min(Number(column.attributes['table:number-columns-repeated']) || 1, 64)
    for (let index = 0; index < count; index++) columns.push(width ?? 0)
  }
  const template = book.templates.get(table.attributes['table:template-name'] ?? '')
  const uses = (part: string) => table.attributes[`table:use-${part}-styles`] === 'true'
  const templateStyle = (part: string) => childAt(template, `table:${part}`)?.attributes['table:style-name']
  const rowNodes = table.children.flatMap((child) => (child.name === 'table:table-row' ? [child] : childrenNamed(child, 'table:table-row'))).slice(0, 200)
  const rows: string[] = []
  rowNodes.forEach((row, rowIndex) => {
    const rowProperties = book.properties('table-row', row.attributes['table:style-name'], 'table-row', inMaster)
    const cells: string[] = []
    let columnIndex = 0
    for (const cell of childrenNamed(row, 'table:table-cell').slice(0, 64)) {
      const spanned = Math.max(1, Number(cell.attributes['table:number-columns-spanned']) || 1)
      // The template's styles: its body's, its bands', its first and last columns' and rows', as the table uses them.
      const names: (string | undefined)[] = []
      if (template) {
        names.push(templateStyle('body'))
        if (uses('banding-columns')) names.push(templateStyle(columnIndex % 2 === 0 ? 'odd-columns' : 'even-columns'))
        const banded = rowIndex - (uses('first-row') ? 1 : 0)
        if (uses('banding-rows') && banded >= 0) names.push(templateStyle(banded % 2 === 0 ? 'odd-rows' : 'even-rows'))
        if (uses('first-column') && columnIndex === 0) names.push(templateStyle('first-column'))
        if (uses('last-column') && columnIndex + spanned >= columns.length) names.push(templateStyle('last-column'))
        if (uses('first-row') && rowIndex === 0) names.push(templateStyle('first-row'))
        if (uses('last-row') && rowIndex === rowNodes.length - 1) names.push(templateStyle('last-row'))
      }
      names.push(cell.attributes['table:style-name'])
      const layered = (kind: string) => merged(names.map((name) => book.properties('table-cell', name, kind, inMaster, false)))
      const cellProperties = merged([layered('graphic'), layered('table-cell')])
      const background = cellProperties['fo:background-color']
      const ground =
        cellProperties['draw:fill'] === 'none'
          ? undefined
          : paintOf(cellProperties['draw:fill-color'] ?? (background === 'transparent' ? undefined : background))
      const base: TextBase = {
        family: 'table-cell',
        name: undefined,
        inMaster,
        outline: undefined,
        textStyle: undefined,
        fixed: { text: layered('text'), paragraph: layered('paragraph') }
      }
      const vertical = cellProperties['style:vertical-align']
      const frame = textFrame(cell, base, cellProperties, context, vertical === 'middle' ? 'middle' : vertical === 'bottom' ? 'bottom' : 'top')
      const span = spanned > 1 ? ` colspan="${spanned}"` : ''
      const rowSpan = Number(cell.attributes['table:number-rows-spanned']) > 1 ? ` rowspan="${Number(cell.attributes['table:number-rows-spanned'])}"` : ''
      cells.push(
        `<td${span}${rowSpan} style="padding:0;border:1px solid #ffffff;vertical-align:top;${ground ? `background:${css(ground)};` : ''}">${frame ? textDiv(frame) : ''}</td>`
      )
      columnIndex += spanned
    }
    const height = length(rowProperties['style:row-height'] ?? rowProperties['style:min-row-height'])
    rows.push(`<tr${height ? ` style="height:${number(height)}px"` : ''}>${cells.join('')}</tr>`)
  })
  const widths = columns.map((width) => `<col${width ? ` style="width:${number(width)}px"` : ''}/>`).join('')
  return `<foreignObject x="0" y="0" width="${number(box.width)}" height="${number(box.height)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml"><table style="border-collapse:collapse;table-layout:fixed;width:${number(box.width)}px"><colgroup>${widths}</colgroup>${rows.join('')}</table></div></foreignObject>`
}

/** A page's background: its own fill, else its master's, as its style lets it; white when none is given. */
async function backgroundOf(master: XmlNode | undefined, masterName: string, context: PageContext): Promise<Fill> {
  const { book } = context.deck
  const own = await fillOf(context.pageStyle, context)
  if (own && own.kind !== 'none') return own
  if (context.pageStyle['presentation:background-visible'] !== 'false') {
    const masterStyle = book.properties('drawing-page', master?.attributes['draw:style-name'], 'drawing-page', true, false)
    const masters = await fillOf(masterStyle, context)
    if (masters && masters.kind !== 'none') return masters
    // Older files keep a master's background in a presentation style of its own.
    const older = await fillOf(book.properties('presentation', `${masterName}-background`, 'graphic', true, false), context)
    if (older && older.kind !== 'none') return older
  }
  return { kind: 'paint', paint: { red: 255, green: 255, blue: 255, opacity: 1 } }
}

/** A page of an OpenDocument presentation drawn as SVG, at the size its master's layout gives; `place` its number in the show. */
export async function drawOpenPage(deck: OpenDeck, page: XmlNode, place: number): Promise<DrawnSlide | undefined> {
  if (page.name !== 'draw:page') return undefined
  const masterName = page.attributes['draw:master-page-name'] ?? ''
  const master = deck.masters.get(masterName)
  const layout = deck.layouts.get(master?.attributes['style:page-layout-name'] ?? '')
  const layoutProperties = childAt(layout, 'style:page-layout-properties')?.attributes ?? {}
  const width = length(layoutProperties['fo:page-width']) ?? 1058
  const height = length(layoutProperties['fo:page-height']) ?? 794
  if (!(width > 0 && height > 0 && width < 100_000 && height < 100_000)) return undefined
  const pageStyle = deck.book.properties('drawing-page', page.attributes['draw:style-name'], 'drawing-page', false, false)
  const context: PageContext = {
    deck,
    place,
    pageStyle,
    footer: deck.footers.get(page.attributes['presentation:use-footer-name'] ?? ''),
    date: deck.dates.get(page.attributes['presentation:use-date-time-name'] ?? ''),
    canvas: new Canvas(),
    shapes: 0,
    pictureBytes: 0
  }
  const size = { width, height }
  const ground = await backgroundOf(master, masterName, context)
  context.canvas.parts.push(`<rect width="${number(width)}" height="${number(height)}" ${fillAttribute(ground, context.canvas, size)}/>`)
  if (master && pageStyle['presentation:background-objects-visible'] !== 'false') await drawShapes(master, context, true, 0)
  await drawShapes(page, context, false, 0)
  return slideSvg(width, height, context.canvas)
}
