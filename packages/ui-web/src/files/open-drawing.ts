/**
 * The shapes of an OpenDocument file drawn as they look, in SVG (docs/SPEC.md, section 9.7), whatever kind of file
 * holds them: a presentation's pages (`open-slide-drawing.ts`) and a text's drawings (`open-look.ts`). Each shape is
 * placed by its box and its transform, and drawn as its style says: its fill (a colour, a gradient, a picture), its
 * line with its dashes and the arrows at its ends, and its text. A style takes what it leaves out from the style it
 * comes from, then from its family's default, then from what LibreOffice gives a shape whose styles say nothing: its
 * own blue fill and line, or the colours of the app that wrote the file when that is an older one (`shapeColours`). A placeholder's text takes the style of its master's outline at its level. Lists are bulleted or
 * numbered as their list style says. A Fontwork's text is laid along its path in place of its outline (`fontwork.ts`), an
 * extruded shape is drawn as its solid (`extrusion.ts`), and a 3D scene as LibreOffice shows it (`open-scene.ts`).
 *
 * What cannot be read is left out of the drawing rather than failing it: a shape whose parts are missing, a picture
 * of a format the window does not show.
 */

import { type Archive, partOf, textOf } from './archive.ts'
import { customGeometry, type PathCommand } from './custom-geometry.ts'
import { enhancedGeometry } from './enhanced-geometry.ts'
import { type ExtrudedPart, extrudedElement, readExtrusion, stackedElement } from './extrusion.ts'
import { type FontworkGlyph, type FontworkStyle, fontworkElement, glyphCorners, layFontwork } from './fontwork.ts'
import { drawMetafile } from './metafile.ts'
import { pictureType, readOpenChart } from './office-figures.ts'
import { objectFormula } from './office-math.ts'
import type { OfficeChart } from './office-text.ts'
import { sceneElement } from './open-scene.ts'
import { length, merged, type Properties, type StyleBook, share } from './open-styles.ts'
import {
  base64,
  bulletCharacter,
  Canvas,
  chartElements,
  css,
  customElement,
  escaped,
  type Fill,
  fillAttribute,
  fromHex,
  GROUP_DEPTH_LIMIT,
  isRun,
  listNumber,
  number,
  type Outline,
  type Paint,
  PICTURE_LIMIT,
  pictureElement,
  type RunStyle,
  SHAPE_LIMIT,
  shadedFill,
  shadedPaint,
  slideSvg,
  strokeAttributes,
  type TextBullet,
  type TextFrame,
  type TextParagraph,
  type TextPiece,
  type TextRun,
  textDiv,
  textHtml
} from './slide-svg.ts'
import { childAt, childrenNamed, type XmlNode } from './xml.ts'

/** An angle as OpenDocument writes it, in radians: a bare number is radians, or in degrees, gradians or radians as its unit says. */
function angle(value: string): number {
  const match = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(deg|grad|rad)?\s*$/i.exec(value)
  if (!match) return 0
  const found = Number(match[1])
  const unit = match[2]?.toLowerCase()
  return unit === 'deg' ? (found * Math.PI) / 180 : unit === 'grad' ? (found * Math.PI) / 200 : found
}

// What shapes are drawn from

/** A picture as the SVG holds it: its address of data, and its own size when its header gives one. */
interface Held {
  href: string
  size?: { width: number; height: number } | undefined
}

/**
 * What an OpenDocument's shapes are drawn from, read once for them all: its parts, its styles and fonts, the fills,
 * dashes and arrows its styles name, and the pictures already read.
 */
export interface DrawingSource {
  archive: Archive
  book: StyleBook
  fonts: Map<string, string>
  named: Map<string, XmlNode>
  addresses: Map<string, Promise<Held | undefined>>
  colours: ShapeColours
  /** Whether a shape takes the styles its style comes from: a presentation's do, a text's take only their own, as Writer draws them. */
  styled: boolean
  /** Whether the file asks for Fontwork's older way of laying several lines on one path (`LegacySingleLineFontwork`), as files from before LibreOffice 7.5 do by saying nothing. */
  legacyFontwork: boolean
}

/** The fill and line a shape is drawn with when its styles name neither. */
export interface ShapeColours {
  fill: string
  line: string
}

/**
 * The colours LibreOffice gives a shape whose styles name none, by the app that wrote the file (`meta:generator`), as
 * it reads one (fdo#75872): OpenOffice.org's and early LibreOffice's (before 4.2) light blue and black, Apache
 * OpenOffice 4's paler blue and grey, which it does not write into its files, or LibreOffice's own blue.
 */
export function shapeColours(generator: string | undefined): ShapeColours {
  const libre = /^(?:LibreOffice(?:Dev)?|Collabora[\w ]*)\/(\d+)\.(\d+)/i.exec(generator ?? '')
  if (libre) return Number(libre[1]) < 4 || (Number(libre[1]) === 4 && Number(libre[2]) < 2) ? LEGACY_COLOURS : SHAPE_COLOURS
  if (!/OpenOffice|StarOffice|StarSuite|NeoOffice/i.test(generator ?? '')) return SHAPE_COLOURS
  // Apache OpenOffice 4 builds are numbered from 400; OpenOffice.org 2's were 680.
  const build = Number(/_project\/(\d{3})/.exec(generator ?? '')?.[1])
  return (build >= 400 && build < 600) || /^(?:Apache )?OpenOffice\/4/i.test(generator ?? '') ? { fill: '#cfe7f5', line: '#808080' } : LEGACY_COLOURS
}

/** LibreOffice's own colours for a shape, and those of OpenOffice.org and of LibreOffice before 4.2. */
const SHAPE_COLOURS: ShapeColours = { fill: '#729fcf', line: '#3465a4' }
const LEGACY_COLOURS: ShapeColours = { fill: '#99ccff', line: '#000000' }

/**
 * What a file's shapes are drawn from: its styles, its fonts, the fills, dashes, hatches and arrows its common styles
 * name, and the colours of a shape whose styles name none, by the app that wrote it; with whether its shapes take the
 * styles their styles come from.
 */
export async function drawingSource(
  archive: Archive,
  book: StyleBook,
  fonts: Map<string, string>,
  stylesRoot: XmlNode | undefined,
  styled = true
): Promise<DrawingSource> {
  const named = new Map<string, XmlNode>()
  for (const child of childAt(stylesRoot, 'office:styles')?.children ?? [])
    if (child.attributes['draw:name'] && /^draw:(gradient|fill-image|stroke-dash|hatch|opacity|marker)$/.test(child.name))
      named.set(`${child.name}/${child.attributes['draw:name']}`, child)
  const meta = await textOf(archive, 'meta.xml').catch(() => undefined)
  const generator = meta === undefined ? undefined : /<meta:generator>([^<]{0,300})<\/meta:generator>/.exec(meta)?.[1]
  const settings = await textOf(archive, 'settings.xml').catch(() => undefined)
  const legacyFontwork = !/config:name="LegacySingleLineFontwork"[^>]{0,100}>\s*false\s*</.test(settings ?? '')
  return { archive, book, fonts, named, addresses: new Map(), colours: shapeColours(generator), styled, legacyFontwork }
}

export const plainText = (node: XmlNode): string => (node.name === '#text' ? node.text : node.children.map(plainText).join(''))

/**
 * What shapes are drawn with: where they come from, the number of their page, the footer and date a presentation's
 * page shows, what has been drawn, and which shapes are drawn at all.
 */
export interface DrawingContext {
  source: DrawingSource
  place: number
  footer?: string | undefined
  date?: string | undefined
  canvas: Canvas
  shapes: number
  pictureBytes: number
  shown: (node: XmlNode, inMaster: boolean) => boolean
  /** The pictures of frames in shapes' text, read before their text is laid out, by their frame. */
  textPictures?: Map<XmlNode, string | undefined> | undefined
}

// Pictures

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

/** A part of the file, or a picture written into it, as an address of data the SVG holds. */
async function pictureAddress(source: XmlNode, context: DrawingContext): Promise<string | undefined> {
  return (await pictureHeld(source, context))?.href
}

async function pictureHeld(source: XmlNode, context: DrawingContext): Promise<Held | undefined> {
  const { archive, addresses } = context.source
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
      const part = key === undefined ? undefined : partOf(archive, key)
      bytes = part ? await part() : undefined
    }
    if (!bytes) return undefined
    const type = pictureType(bytes)
    if (type) return { href: `data:${type};base64,${base64(bytes)}`, size: naturalSize(bytes) }
    const drawn = drawMetafile(bytes)
    return drawn ? { href: `data:image/svg+xml;base64,${base64(drawn.svg)}`, size: { width: drawn.width, height: drawn.height } } : undefined
  }
  let address = key === undefined ? undefined : addresses.get(key)
  if (!address) {
    address = read().catch(() => undefined)
    if (key !== undefined) addresses.set(key, address)
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

// Fills and lines

export const paintOf = (colour: string | undefined, opacity = 1): Paint | undefined => {
  const paint = fromHex(colour)
  return paint && { ...paint, opacity: Math.min(1, Math.max(0, opacity)) }
}

/** How opaque a fill is, as its properties say. */
const fillOpacity = (properties: Properties) => share(properties['draw:opacity']) ?? 1 - (share(properties['draw:transparency']) ?? 0)

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
export async function fillOf(properties: Properties, context: DrawingContext): Promise<Fill | undefined> {
  const kind = properties['draw:fill']
  const opacity = fillOpacity(properties)
  const named = (element: string, name: string | undefined) => (name ? context.source.named.get(`${element}/${name}`) : undefined)
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'solid': {
      const paint = paintOf(properties['draw:fill-color'] ?? context.source.colours.fill, opacity)
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
function outlineOf(properties: Properties, context: DrawingContext): Outline | undefined {
  const kind = properties['draw:stroke'] ?? 'solid'
  if (kind === 'none') return undefined
  const paint = paintOf(properties['svg:stroke-color'] ?? context.source.colours.line, share(properties['svg:stroke-opacity']) ?? 1)
  const width = Math.max(0.75, length(properties['svg:stroke-width']) ?? 0)
  let dashes: string | undefined
  const dash = kind === 'dash' && properties['draw:stroke-dash'] ? context.source.named.get(`draw:stroke-dash/${properties['draw:stroke-dash']}`) : undefined
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

// Arrows

/** Path data with nothing in it but its commands and numbers. */
const pathData = (value: string | undefined) => (value ?? '').replace(/[^MmLlHhVvCcSsQqTtAaZz\d.,eE\s+-]/g, '')

/** An arrow a line's style puts at one of its ends (`draw:marker`): its outline in its own view box, its width in pixels, and whether its middle sits on the end. */
interface Marker {
  data: string
  view: { left: number; top: number; width: number; height: number }
  width: number
  centred: boolean
}

type Markers = { start?: Marker | undefined; end?: Marker | undefined }

function markerOf(properties: Properties, end: 'start' | 'end', context: DrawingContext): Marker | undefined {
  const name = properties[`draw:marker-${end}`]
  const node = name ? context.source.named.get(`draw:marker/${name}`) : undefined
  if (!node) return undefined
  const data = pathData(node.attributes['svg:d'])
  const view = viewBoxOf(node.attributes['svg:viewBox'], 0, 0)
  if (!data || !(view.width > 0) || !(view.height > 0) || !Number.isFinite(view.left + view.top + view.width + view.height)) return undefined
  // An arrow is as wide as its style says, else three times its line, at least as LibreOffice's are.
  const lineWidth = length(properties['svg:stroke-width']) ?? 0
  const width = length(properties[`draw:marker-${end}-width`]) ?? Math.max(lineWidth * 3, 11.34)
  if (!(width > 0) || width > 10_000) return undefined
  return { data, view, width, centred: properties[`draw:marker-${end}-center`] === 'true' }
}

const markersOf = (properties: Properties, context: DrawingContext): Markers => ({
  start: markerOf(properties, 'start', context),
  end: markerOf(properties, 'end', context)
})

/** How long an arrow is along its line, and how much of the line it covers: all of its length, half when it sits on the end by its middle. */
const markerLength = (marker: Marker) => (marker.width * marker.view.height) / marker.view.width
const covered = (marker: Marker) => markerLength(marker) * (marker.centred ? 0.5 : 1)

/** How far an arrow reaches past the end it sits on, and to each side of its line. */
const markerReach = (marker: Marker) => marker.width / 2 + (marker.centred ? markerLength(marker) / 2 : 0)

/** A scale as SVG takes it, to six figures: a view box of thousands of units scales by numbers too small to round to hundredths. */
const factor = (value: number) => (Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '1')

/** An arrow at an end of a line, its tip on the end and pointing out of the line, in the line's colour. */
function markerElement(marker: Marker, end: PathEnd, paint: Paint): string {
  const turn = (Math.atan2(end.outward[0], -end.outward[1]) * 180) / Math.PI
  const scale = marker.width / marker.view.width
  const middle = marker.view.left + marker.view.width / 2
  const top = marker.view.top + (marker.centred ? marker.view.height / 2 : 0)
  return `<path d="${escaped(marker.data)}" transform="translate(${number(end.at[0])} ${number(end.at[1])}) rotate(${number(turn)}) scale(${factor(scale)}) translate(${number(-middle)} ${number(-top)})" fill="${css(paint)}"${paint.opacity < 1 ? ` fill-opacity="${number(paint.opacity)}"` : ''} stroke="none"/>`
}

/**
 * A line's path with the arrows its style puts at the ends of its open subpaths: each end cut short where its arrow
 * covers it, so a wide line does not show past the arrow's tip, and the arrows drawn in the line's colour. A path with
 * no arrows is kept as it was written.
 */
function withArrows(data: string, outline: Outline | undefined, markers: Markers): { data: string; arrows: string } {
  const { start, end } = markers
  if (!outline?.paint || (!start && !end)) return { data, arrows: '' }
  const paths = subpaths(data)
  let arrows = ''
  const cut = paths.map((path) => {
    if (path.closed) return path
    const ends = subpathEnds(path)
    if (start && ends.start) arrows += markerElement(start, ends.start, outline.paint as Paint)
    if (end && ends.end) arrows += markerElement(end, ends.end, outline.paint as Paint)
    return shortened(path, start && ends.start ? covered(start) : 0, end && ends.end ? covered(end) : 0)
  })
  return arrows ? { data: writePath(cut), arrows } : { data, arrows: '' }
}

// Paths

type Point = [number, number]

/** A piece of a path from where the one before it ends: a line, a curve with its one or two controls, or an arc of an ellipse as SVG writes one. */
type Segment =
  | { kind: 'line'; to: Point }
  | { kind: 'curve'; controls: Point[]; to: Point }
  | { kind: 'arc'; radii: Point; turn: number; large: boolean; sweep: boolean; to: Point }

/** A subpath: where it starts, its pieces, and whether it is closed. */
export interface Subpath {
  from: Point
  segments: Segment[]
  closed: boolean
}

/** An end of a path: where it is, and the way out of the path there, as a vector of length one. */
export interface PathEnd {
  at: Point
  outward: Point
}

const PATH_TOKENS = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/** The most pieces of a path read, so a damaged one costs little. */
const SEGMENT_LIMIT = 20_000

/** SVG path data as its subpaths, every point made absolute; reading stops where a command lacks its numbers. */
export function subpaths(data: string): Subpath[] {
  const tokens = data.match(PATH_TOKENS) ?? []
  const paths: Subpath[] = []
  let current: Subpath | undefined
  let pen: Point = [0, 0]
  let command = ''
  let previous = ''
  let control: Point | undefined
  let at = 0
  let count = 0
  const take = (): number | undefined => {
    const token = tokens[at]
    if (token === undefined || /^[a-z]$/i.test(token)) return undefined
    at += 1
    const value = Number(token)
    return Number.isFinite(value) ? value : undefined
  }
  const takeAll = (count: number): number[] | undefined => {
    const values: number[] = []
    for (let index = 0; index < count; index++) {
      const value = take()
      if (value === undefined) return undefined
      values.push(value)
    }
    return values
  }
  const add = (segment: Segment) => {
    if (!current) {
      current = { from: pen, segments: [], closed: false }
      paths.push(current)
    }
    current.segments.push(segment)
    pen = segment.to
  }
  while (at < tokens.length && count++ < SEGMENT_LIMIT) {
    const token = tokens[at] as string
    if (/^[a-z]$/i.test(token)) {
      command = token
      at += 1
      if (command === 'Z' || command === 'z') {
        if (current) {
          current.closed = true
          pen = current.from
        }
        current = undefined
        previous = 'Z'
        continue
      }
    } else if (command === '' || command === 'Z' || command === 'z') break
    const relative = command === command.toLowerCase()
    const offset = (x: number, y: number): Point => (relative ? [pen[0] + x, pen[1] + y] : [x, y])
    const upper = command.toUpperCase()
    // A path begins with a move, or is drawn as nothing, as SVG has it.
    if (paths.length === 0 && upper !== 'M') break
    const values = takeAll({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[upper] ?? 0)
    if (!values || values.length === 0) break
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0] = values
    switch (upper) {
      case 'M': {
        const to = offset(a, b)
        current = { from: to, segments: [], closed: false }
        paths.push(current)
        pen = to
        // Numbers after a move's first point are lines.
        command = relative ? 'l' : 'L'
        break
      }
      case 'L':
        add({ kind: 'line', to: offset(a, b) })
        break
      case 'H':
        add({ kind: 'line', to: [relative ? pen[0] + a : a, pen[1]] })
        break
      case 'V':
        add({ kind: 'line', to: [pen[0], relative ? pen[1] + a : a] })
        break
      case 'C': {
        const second = offset(c, d)
        add({ kind: 'curve', controls: [offset(a, b), second], to: offset(e, f) })
        control = second
        break
      }
      case 'S': {
        // The first control is the one before turned around the pen, as a smooth curve has it.
        const first: Point = previous === 'C' || previous === 'S' ? [2 * pen[0] - (control?.[0] ?? pen[0]), 2 * pen[1] - (control?.[1] ?? pen[1])] : pen
        const second = offset(a, b)
        add({ kind: 'curve', controls: [first, second], to: offset(c, d) })
        control = second
        break
      }
      case 'Q': {
        const only = offset(a, b)
        add({ kind: 'curve', controls: [only], to: offset(c, d) })
        control = only
        break
      }
      case 'T': {
        const only: Point = previous === 'Q' || previous === 'T' ? [2 * pen[0] - (control?.[0] ?? pen[0]), 2 * pen[1] - (control?.[1] ?? pen[1])] : pen
        add({ kind: 'curve', controls: [only], to: offset(a, b) })
        control = only
        break
      }
      case 'A':
        add({ kind: 'arc', radii: [Math.abs(a), Math.abs(b)], turn: c, large: d !== 0, sweep: e !== 0, to: offset(f, g) })
        break
    }
    previous = upper
  }
  return paths
}

/** Subpaths written back as SVG path data, every point absolute. */
export function writePath(paths: readonly Subpath[]): string {
  const point = ([x, y]: Point) => `${number(x)} ${number(y)}`
  return paths
    .map(
      (path) =>
        `M${point(path.from)}${path.segments
          .map((segment) =>
            segment.kind === 'line'
              ? `L${point(segment.to)}`
              : segment.kind === 'curve'
                ? `${segment.controls.length === 1 ? 'Q' : 'C'}${[...segment.controls, segment.to].map(point).join(' ')}`
                : `A${number(segment.radii[0])} ${number(segment.radii[1])} ${number(segment.turn)} ${segment.large ? 1 : 0} ${segment.sweep ? 1 : 0} ${point(segment.to)}`
          )
          .join('')}${path.closed ? 'Z' : ''}`
    )
    .join('')
}

/** Subpaths moved and scaled, as a shape's view box is drawn in its box: each point, and an arc's radii. */
function mapPath(paths: readonly Subpath[], scaleX: number, scaleY: number, moveX: number, moveY: number): Subpath[] {
  const map = ([x, y]: Point): Point => [x * scaleX + moveX, y * scaleY + moveY]
  return paths.map((path) => ({
    from: map(path.from),
    closed: path.closed,
    segments: path.segments.map((segment): Segment => {
      if (segment.kind === 'line') return { kind: 'line', to: map(segment.to) }
      if (segment.kind === 'curve') return { kind: 'curve', controls: segment.controls.map(map), to: map(segment.to) }
      // A drawing turned over turns its arcs the other way.
      return {
        ...segment,
        radii: [Math.abs(segment.radii[0] * scaleX), Math.abs(segment.radii[1] * scaleY)],
        sweep: scaleX * scaleY < 0 ? !segment.sweep : segment.sweep,
        to: map(segment.to)
      }
    })
  }))
}

const distance = (one: Point, other: Point) => Math.hypot(other[0] - one[0], other[1] - one[1])

/** The vector of length one from a point toward another; none when they are the same point. */
function toward(from: Point, to: Point): Point | undefined {
  const size = distance(from, to)
  return size > 1e-9 ? [(to[0] - from[0]) / size, (to[1] - from[1]) / size] : undefined
}

/**
 * An arc's centre, radii and angles, from its ends as SVG gives them (SVG 1.1, appendix F.6.5): radii too short to
 * reach are made long enough, as SVG draws them.
 */
function arcCentre(from: Point, arc: Extract<Segment, { kind: 'arc' }>) {
  const turn = (arc.turn * Math.PI) / 180
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  const halfX = (from[0] - arc.to[0]) / 2
  const halfY = (from[1] - arc.to[1]) / 2
  const x = cos * halfX + sin * halfY
  const y = -sin * halfX + cos * halfY
  let [radiusX, radiusY] = arc.radii
  const stretch = (x * x) / (radiusX * radiusX) + (y * y) / (radiusY * radiusY)
  if (stretch > 1) {
    radiusX *= Math.sqrt(stretch)
    radiusY *= Math.sqrt(stretch)
  }
  const numerator = radiusX * radiusX * radiusY * radiusY - radiusX * radiusX * y * y - radiusY * radiusY * x * x
  const denominator = radiusX * radiusX * y * y + radiusY * radiusY * x * x
  const factor = (arc.large !== arc.sweep ? 1 : -1) * Math.sqrt(Math.max(0, denominator > 0 ? numerator / denominator : 0))
  const centreX = (factor * radiusX * y) / radiusY
  const centreY = (-factor * radiusY * x) / radiusX
  const centre: Point = [cos * centreX - sin * centreY + (from[0] + arc.to[0]) / 2, sin * centreX + cos * centreY + (from[1] + arc.to[1]) / 2]
  const angleOf = (u: number, v: number) => Math.atan2(v, u)
  const first = angleOf((x - centreX) / radiusX, (y - centreY) / radiusY)
  let sweep = angleOf((-x - centreX) / radiusX, (-y - centreY) / radiusY) - first
  if (!arc.sweep && sweep > 0) sweep -= 2 * Math.PI
  if (arc.sweep && sweep < 0) sweep += 2 * Math.PI
  /** The way an arc goes at one of its angles, as it is drawn. */
  const going = (at: number): Point => {
    const along: Point = [-radiusX * Math.sin(at), radiusY * Math.cos(at)]
    const sign = sweep < 0 ? -1 : 1
    return [sign * (cos * along[0] - sin * along[1]), sign * (sin * along[0] + cos * along[1])]
  }
  const pointAt = (at: number): Point => [
    centre[0] + cos * radiusX * Math.cos(at) - sin * radiusY * Math.sin(at),
    centre[1] + sin * radiusX * Math.cos(at) + cos * radiusY * Math.sin(at)
  ]
  return { first, sweep, going, pointAt, degenerate: !(arc.radii[0] > 1e-9 && arc.radii[1] > 1e-9) }
}

/** The points a segment leaves its start toward, in order, its end last. */
const pointsOf = (segment: Segment): Point[] => (segment.kind === 'curve' ? [...segment.controls, segment.to] : [segment.to])

/** The ends of an open subpath, each with the way out of it there; none at an end whose way cannot be told. */
export function subpathEnds(path: Subpath): { start?: PathEnd | undefined; end?: PathEnd | undefined } {
  let start: PathEnd | undefined
  let from = path.from
  for (const segment of path.segments) {
    if (segment.kind === 'arc' && distance(from, segment.to) > 1e-9) {
      const arc = arcCentre(from, segment)
      const going = arc.degenerate ? toward(from, segment.to) : toward([0, 0], arc.going(arc.first))
      if (going) start = { at: path.from, outward: [-going[0], -going[1]] }
    } else {
      const next = pointsOf(segment).find((point) => distance(from, point) > 1e-9)
      const way = next && toward(next, from)
      if (way) start = { at: path.from, outward: way }
    }
    if (start) break
    from = segment.to
  }
  let end: PathEnd | undefined
  const starts = [path.from, ...path.segments.map((segment) => segment.to)]
  for (let index = path.segments.length - 1; index >= 0 && !end; index--) {
    const segment = path.segments[index] as Segment
    const before = starts[index] as Point
    if (segment.kind === 'arc' && distance(before, segment.to) > 1e-9) {
      const arc = arcCentre(before, segment)
      const going = arc.degenerate ? toward(before, segment.to) : toward([0, 0], arc.going(arc.first + arc.sweep))
      if (going) end = { at: segment.to, outward: going }
    } else {
      const previous = [before, ...(segment.kind === 'curve' ? segment.controls : [])].reverse().find((point) => distance(point, segment.to) > 1e-9)
      const way = previous && toward(previous, segment.to)
      if (way) end = { at: segment.to, outward: way }
    }
  }
  return { start, end }
}

/**
 * A subpath cut short by lengths at its start and at its end, where arrows cover it: a line's end moved along it, a
 * curve's end and its nearest control moved along the way it leaves; an arc is left as it is.
 */
function shortened(path: Subpath, atStart: number, atEnd: number): Subpath {
  const segments = path.segments.map((segment): Segment => (segment.kind === 'curve' ? { ...segment, controls: [...segment.controls] } : { ...segment }))
  const moved = (point: Point, way: Point, by: number): Point => [point[0] + way[0] * by, point[1] + way[1] * by]
  let from = path.from
  const first = segments[0]
  const last = segments.at(-1)
  // A line of one piece with an arrow at each end gives each at most half of itself.
  const share = segments.length === 1 && atStart > 0 && atEnd > 0 ? 0.5 : 1
  if (first && atStart > 0 && first.kind !== 'arc') {
    const next = pointsOf(first).find((point) => distance(path.from, point) > 1e-9)
    const way = next && toward(path.from, next)
    const cut = first.kind === 'line' ? Math.min(atStart, distance(path.from, first.to) * share) : atStart
    if (way) {
      from = moved(path.from, way, cut)
      const control = first.kind === 'curve' ? first.controls[0] : undefined
      if (first.kind === 'curve' && control) first.controls[0] = moved(control, way, cut)
    }
  }
  if (last && atEnd > 0 && last.kind !== 'arc') {
    const before = segments.length > 1 ? (path.segments.at(-2) as Segment).to : path.from
    const previous = [before, ...(last.kind === 'curve' ? last.controls : [])].reverse().find((point) => distance(point, last.to) > 1e-9)
    const way = previous && toward(last.to, previous)
    const cut = last.kind === 'line' ? Math.min(atEnd, distance(before, last.to) * share) : atEnd
    if (way) {
      if (last.kind === 'curve') {
        const index = last.controls.length - 1
        last.controls[index] = moved(last.controls[index] as Point, way, cut)
      }
      last.to = moved(last.to, way, cut)
    }
  }
  return { from, segments, closed: path.closed }
}

/** A point along a curve from its start through its controls to its end, a share of the way along it. */
function curvePoint(points: readonly Point[], share: number): Point {
  let level = [...points]
  while (level.length > 1)
    level = level
      .slice(1)
      .map((point, index) => [
        (level[index] as Point)[0] + (point[0] - (level[index] as Point)[0]) * share,
        (level[index] as Point)[1] + (point[1] - (level[index] as Point)[1]) * share
      ])
  return level[0] ?? [0, 0]
}

/** The points a path passes through, its curves and arcs by points along them, for the box it takes. */
function pathPoints(paths: readonly Subpath[]): Point[] {
  const points: Point[] = []
  for (const path of paths) {
    let from = path.from
    points.push(from)
    for (const segment of path.segments) {
      if (segment.kind === 'arc' && distance(from, segment.to) > 1e-9) {
        const arc = arcCentre(from, segment)
        if (!arc.degenerate) for (let step = 1; step < 8; step++) points.push(arc.pointAt(arc.first + (arc.sweep * step) / 8))
      }
      if (segment.kind === 'curve') for (let step = 1; step < 16; step++) points.push(curvePoint([from, ...segment.controls, segment.to], step / 16))
      points.push(segment.to)
      from = segment.to
    }
  }
  return points
}

/** The most points one subpath is flattened into, so a damaged path costs little. */
const FLAT_LIMIT = 4000

/**
 * Path data as polylines, one for each subpath: its curves by points along them, as many as their length needs, and
 * its arcs by steps of five degrees at most, as LibreOffice divides them; a closed subpath ends where it starts.
 */
export function flattened(data: string): Point[][] {
  return subpaths(data).map((path) => {
    const points: Point[] = [path.from]
    let from = path.from
    for (const segment of path.segments) {
      if (points.length >= FLAT_LIMIT) break
      if (segment.kind === 'arc' && distance(from, segment.to) > 1e-9) {
        const arc = arcCentre(from, segment)
        const steps = arc.degenerate ? 1 : Math.min(256, Math.max(1, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 36))))
        for (let step = 1; step < steps; step++) points.push(arc.pointAt(arc.first + (arc.sweep * step) / steps))
      } else if (segment.kind === 'curve') {
        const along = [from, ...segment.controls, segment.to]
        let reach = 0
        for (let index = 1; index < along.length; index++) reach += distance(along[index - 1] as Point, along[index] as Point)
        const steps = Math.min(64, Math.max(8, Math.ceil(reach / 4)))
        for (let step = 1; step < steps; step++) points.push(curvePoint(along, step / steps))
      }
      points.push(segment.to)
      from = segment.to
    }
    if (path.closed && distance(from, path.from) > 1e-9) points.push(path.from)
    return points
  })
}

// Text

/** A text's properties as a run's style: its size in points, weight, slant, lines, case, colour and font. */
function runStyle(properties: Properties, source: DrawingSource): RunStyle {
  const size = length(properties['fo:font-size'])
  const weight = properties['fo:font-weight']
  const fontName = properties['style:font-name']
  const named = fontName ? source.fonts.get(fontName) : properties['fo:font-family']?.replace(/^['"]|['"]$/g, '')
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
    font: family,
    letterSpacing: length(properties['fo:letter-spacing'])
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

function levelProperties(base: TextBase, level: number, kind: 'paragraph' | 'text', source: DrawingSource): Properties {
  const { book } = source
  if (base.fixed) return merged([book.properties('paragraph', undefined, kind, base.inMaster), base.fixed[kind]])
  const own = book.properties(base.family, base.name, kind, base.inMaster, true, source.styled)
  if (!base.outline || level <= 1) return merged([own, book.properties('paragraph', base.textStyle, kind, base.inMaster, false)])
  // A deeper level of an outline takes its master's outline of that level, then what the shape's own style says.
  const outline = book.properties('presentation', `${base.outline}${level}`, kind, true)
  const automatic = base.name ? book.find('presentation', base.name, base.inMaster) : undefined
  const ownOnly = automatic?.attributes['style:parent-style-name'] ? (childAt(automatic, `style:${kind}-properties`)?.attributes ?? {}) : {}
  return merged([outline, ownOnly, book.properties('paragraph', base.textStyle, kind, base.inMaster, false)])
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
function readParagraphs(holder: XmlNode, base: TextBase, context: DrawingContext): TextParagraph[] {
  const { source } = context
  const { book } = source
  const paragraphs: TextParagraph[] = []
  const counters = new Map<number, number>()
  const outlineList = base.outline ? book.ownList(base.family, base.name, base.inMaster) : undefined
  const walk = (node: XmlNode, place: ListPlace) => {
    for (const child of node.children) {
      if (paragraphs.length >= 2000) return
      if (child.name === 'text:p' || child.name === 'text:h') {
        paragraphs.push(paragraph(child, place))
        place = { ...place, item: false }
      } else if (child.name === 'text:list') {
        const own = child.attributes['text:style-name']
        walk(child, { list: (own ? book.lists.get(own) : undefined) ?? place.list ?? outlineList, level: place.level + 1, item: false })
      } else if (child.name === 'text:list-item') walk(child, { ...place, item: true })
      else if (child.name === 'text:list-header') walk(child, { ...place, item: false })
      else if (child.name === 'text:section' || child.name === 'text:soft-page-break') walk(child, place)
    }
  }
  const paragraph = (node: XmlNode, place: ListPlace): TextParagraph => {
    const level = Math.max(1, place.level)
    const styleName = node.attributes['text:style-name']
    const paragraphProperties = merged([
      levelProperties(base, level, 'paragraph', source),
      book.properties('paragraph', styleName, 'paragraph', base.inMaster, false)
    ])
    const textProperties = merged([levelProperties(base, level, 'text', source), book.properties('paragraph', styleName, 'text', base.inMaster, false)])
    const pieces: TextPiece[] = []
    const inline = (element: XmlNode, properties: Properties) => {
      const style = runStyle(properties, source)
      const add = (text: string) => {
        if (text === '') return
        const last = pieces.at(-1)
        if (last && isRun(last) && last.style === style) last.text += text
        else pieces.push({ text, style })
      }
      for (const part of element.children) {
        if (part.name === '#text') add(part.text.replace(/[\t\n\r ]+/g, ' '))
        else if (part.name === 'text:span' || part.name === 'text:a')
          inline(part, merged([properties, book.properties('text', part.attributes['text:style-name'], 'text', base.inMaster, false)]))
        else if (part.name === 'text:s') add(' '.repeat(Math.min(Math.max(Number(part.attributes['text:c']) || 1, 1), 256)))
        else if (part.name === 'text:tab') add('\t')
        else if (part.name === 'text:line-break') pieces.push('break')
        else if (part.name === 'draw:frame') {
          // A picture in the text, as a caption LibreOffice made a shape of holds one, is in its line at its size.
          const width = length(part.attributes['svg:width']) ?? 0
          const height = length(part.attributes['svg:height']) ?? 0
          if (childAt(part, 'draw:image') && width > 0 && height > 0 && width < 100_000 && height < 100_000)
            pieces.push({ picture: context.textPictures?.get(part), width, height })
        } else if (part.name === 'text:page-number') add(String(context.place))
        else if (part.name === 'presentation:footer') add(context.footer ?? '')
        else if (part.name === 'presentation:date-time') add(context.date ?? '')
        else if (part.name !== 'text:note' && part.name !== 'office:annotation' && part.name !== 'text:bookmark') add(plainText(part))
      }
    }
    inline(node, textProperties)
    const firstStyle = pieces.find(isRun)
    const look = runStyle(textProperties, source)
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
        const font = text['style:font-name'] ? source.fonts.get(text['style:font-name']) : text['fo:font-family']
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

/** The most pictures read in one shape's text, so a damaged file costs little. */
const TEXT_PICTURE_LIMIT = 64

/** The pictures of the frames in a shape's paragraphs, read as any picture is, before its text is laid out. */
async function readTextPictures(holder: XmlNode, context: DrawingContext): Promise<void> {
  const found: XmlNode[] = []
  const walk = (node: XmlNode, depth: number) => {
    for (const child of node.children) {
      if (found.length >= TEXT_PICTURE_LIMIT || depth > 32) return
      if (child.name === 'draw:frame') found.push(child)
      else if (child.name.startsWith('text:')) walk(child, depth + 1)
    }
  }
  walk(holder, 0)
  if (found.length === 0) return
  context.textPictures ??= new Map()
  for (const frame of found) {
    const image = childAt(frame, 'draw:image')
    if (image && !context.textPictures.has(frame)) context.textPictures.set(frame, (await pictureHeld(image, context))?.href)
  }
}

/** A shape's text as a frame: its paragraphs, the padding and placing its graphic properties give, its font and colour. */
function textFrame(holder: XmlNode, base: TextBase, graphic: Properties, context: DrawingContext, anchor: 'top' | 'middle' | 'bottom'): TextFrame | undefined {
  const paragraphs = readParagraphs(holder, base, context)
  if (!paragraphs.some((paragraph) => paragraph.pieces.some((piece) => piece !== 'break' && (!isRun(piece) || piece.text.trim() !== '')))) return undefined
  const padding = (side: string) => length(graphic[`fo:padding-${side}`] ?? graphic['fo:padding']) ?? 4.72
  const vertical = graphic['draw:textarea-vertical-align']
  const look = runStyle(levelProperties(base, 1, 'text', context.source), context.source)
  return {
    paragraphs,
    insets: { top: padding('top'), right: padding('right'), bottom: padding('bottom'), left: padding('left') },
    anchor: vertical === 'middle' ? 'middle' : vertical === 'bottom' ? 'bottom' : vertical === 'top' ? 'top' : anchor,
    wraps: graphic['fo:wrap-option'] !== 'no-wrap',
    font: look.font ?? '',
    paint: look.paint ?? { red: 0, green: 0, blue: 0, opacity: 1 }
  }
}

/**
 * How far a shape's text may reach past its box, guessed from its lines and sizes, since the box takes no more room
 * than its drawing: a line's label, or words wider than a small shape.
 */
function textReach(frame: TextFrame, box: { width: number; height: number }): Sides {
  const reach: Sides = { top: 0, right: 0, bottom: 0, left: 0 }
  const room = box.width - frame.insets.left - frame.insets.right
  let height = frame.insets.top + frame.insets.bottom
  let width = 0
  for (const paragraph of frame.paragraphs) {
    const size = (paragraph.size * 4) / 3
    const lineHeight = paragraph.lineHeight !== undefined ? (paragraph.lineHeight * 4) / 3 : size * 1.2 * (paragraph.lineSpacing ?? 1)
    // Each line broken is as wide as its characters and pictures, as tall as its tallest picture at least, and takes as
    // many lines as its words need in the box when they wrap.
    const lines = [{ wide: 0, tall: 0 }]
    for (const piece of paragraph.pieces) {
      const line = lines.at(-1) as { wide: number; tall: number }
      if (piece === 'break') lines.push({ wide: 0, tall: 0 })
      else if (isRun(piece)) line.wide += piece.text.length * size * 0.6
      else {
        line.wide += piece.width
        line.tall = Math.max(line.tall, piece.height)
      }
    }
    for (const { wide, tall } of lines) {
      width = Math.max(width, wide)
      height += Math.max(tall, lineHeight * (frame.wraps && room > 1 ? Math.max(1, Math.ceil(wide / room)) : 1))
    }
  }
  width += frame.insets.left + frame.insets.right
  if (frame.wraps && box.width > 1) width = Math.min(width, box.width)
  const across = Math.max(0, width - box.width)
  const down = Math.max(0, height - box.height)
  const align = frame.paragraphs[0]?.align
  if (align === 'center' || align === 'justify') reach.left = reach.right = across / 2
  else if (align === 'right') reach.left = across
  else reach.right = across
  if (frame.anchor === 'middle') reach.top = reach.bottom = down / 2
  else if (frame.anchor === 'bottom') reach.top = down
  else reach.bottom = down
  return reach
}

// Shapes

/** A step of a transform as SVG writes it, in degrees and pixels. */
interface TransformStep {
  name: 'rotate' | 'translate' | 'scale' | 'skewX' | 'skewY' | 'matrix'
  values: number[]
}

/** A shape's transform (`draw:transform`) as SVG's steps, its own steps applied in order, then its place when `placed`. */
function transformSteps(node: XmlNode, placed = true): TransformStep[] {
  const steps: TransformStep[] = []
  const written = node.attributes['draw:transform'] ?? ''
  const degrees = (value: string | undefined) => (-angle(value ?? '0') * 180) / Math.PI
  for (const [, name, values] of written.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const args = (values ?? '').trim().split(/[\s,]+/)
    switch (name) {
      case 'rotate':
        // OpenDocument turns counter-clockwise, SVG clockwise.
        steps.unshift({ name: 'rotate', values: [degrees(args[0])] })
        break
      case 'translate':
        steps.unshift({ name: 'translate', values: [length(args[0]) ?? 0, length(args[1]) ?? 0] })
        break
      case 'scale':
        steps.unshift({ name: 'scale', values: [Number(args[0]) || 1, Number(args[1] ?? args[0]) || 1] })
        break
      case 'skewX':
        steps.unshift({ name: 'skewX', values: [degrees(args[0])] })
        break
      case 'skewY':
        steps.unshift({ name: 'skewY', values: [degrees(args[0])] })
        break
      case 'matrix':
        steps.unshift({ name: 'matrix', values: args.slice(0, 6).map((value, index) => (index >= 4 ? (length(value) ?? 0) : Number(value) || 0)) })
        break
    }
  }
  if (!placed) return steps
  const x = length(node.attributes['svg:x']) ?? 0
  const y = length(node.attributes['svg:y']) ?? 0
  if (x || y || steps.length === 0) steps.push({ name: 'translate', values: [x, y] })
  return steps
}

const transformText = (steps: readonly TransformStep[]) => steps.map((step) => `${step.name}(${step.values.map(number).join(' ')})`).join(' ')

/** A shape's transform as SVG's: its own steps, then its place. */
const transformOf = (node: XmlNode) => transformText(transformSteps(node))

/** A transform as the six numbers of its matrix, as SVG's `matrix()` takes them. */
type Matrix = [number, number, number, number, number, number]

function matrixOf(steps: readonly TransformStep[]): Matrix {
  const times = (one: Matrix, other: Matrix): Matrix => [
    one[0] * other[0] + one[2] * other[1],
    one[1] * other[0] + one[3] * other[1],
    one[0] * other[2] + one[2] * other[3],
    one[1] * other[2] + one[3] * other[3],
    one[0] * other[4] + one[2] * other[5] + one[4],
    one[1] * other[4] + one[3] * other[5] + one[5]
  ]
  let result: Matrix = [1, 0, 0, 1, 0, 0]
  for (const { name, values } of steps) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values
    const radians = (a * Math.PI) / 180
    const step: Matrix =
      name === 'rotate'
        ? [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
        : name === 'translate'
          ? [1, 0, 0, 1, a, b]
          : name === 'scale'
            ? [a, 0, 0, b, 0, 0]
            : name === 'skewX'
              ? [1, 0, Math.tan(radians), 1, 0, 0]
              : name === 'skewY'
                ? [1, Math.tan(radians), 0, 1, 0, 0]
                : [a, b, c, d, e, f]
    result = times(result, step)
  }
  return result
}

const applied = (matrix: Matrix, [x, y]: Point): Point => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]

/** The kinds of shape drawn, frames among them. */
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
  'draw:g',
  'dr3d:scene'
])

/** The kinds of shape a text draws as pictures of their own: all but frames, which it lays out as its own. */
export const DRAWINGS: ReadonlySet<string> = new Set([...SHAPES].filter((name) => name !== 'draw:frame'))

export async function drawShapes(holder: XmlNode, context: DrawingContext, inMaster: boolean, depth: number): Promise<void> {
  for (const node of holder.children) {
    if (context.shapes >= SHAPE_LIMIT) return
    if (!SHAPES.has(node.name) || !context.shown(node, inMaster)) continue
    context.shapes++
    try {
      if (node.name === 'draw:g') {
        if (depth >= GROUP_DEPTH_LIMIT) continue
        const transform = node.attributes['draw:transform'] ? transformText(transformSteps(node, false)) : ''
        if (transform) context.canvas.parts.push(`<g transform="${transform}">`)
        await drawShapes(node, context, inMaster, depth + 1)
        if (transform) context.canvas.parts.push('</g>')
      } else await drawShape(node, context, inMaster)
    } catch {
      // A shape that cannot be read is left out of the drawing.
    }
  }
}

/** A shape's graphic properties: its presentation style's under its own graphic style's, and those it comes from when the file's shapes take them. */
function graphicOf(node: XmlNode, source: DrawingSource, inMaster: boolean): Properties {
  const presentationStyle = node.attributes['presentation:style-name']
  const graphicStyle = node.attributes['draw:style-name']
  return merged([
    presentationStyle ? source.book.properties('presentation', presentationStyle, 'graphic', inMaster) : {},
    graphicStyle || !presentationStyle ? source.book.properties('graphic', graphicStyle, 'graphic', inMaster, true, source.styled) : {}
  ])
}

/** The style a shape's text starts from. */
function textBase(node: XmlNode, source: DrawingSource, inMaster: boolean): TextBase {
  const { attributes } = node
  const presentationStyle = attributes['presentation:style-name']
  // A placeholder's outline takes its master's outline styles at each level, named after its first.
  const outlineName =
    attributes['presentation:class'] === 'outline'
      ? source.book.chain('presentation', presentationStyle, inMaster).find((style) => /outline1$/.test(style.attributes['style:name'] ?? ''))?.attributes[
          'style:name'
        ]
      : undefined
  return {
    family: presentationStyle ? 'presentation' : 'graphic',
    name: presentationStyle ?? attributes['draw:style-name'],
    inMaster,
    outline: outlineName?.replace(/1$/, ''),
    textStyle: attributes['draw:text-style-name']
  }
}

/** A line's or a connector's ends, on the page, before its transform. */
const lineEnds = (node: XmlNode) =>
  ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map((name) => length(node.attributes[name]) ?? 0) as [number, number, number, number]

/** Hundredths of a millimetre, in which LibreOffice writes a connector's path, in pixels. */
const HUNDREDTHS = 96 / 2540

/**
 * A connector's path (`svg:d`) in pixels, when it has one that starts where the connector does: LibreOffice writes it
 * in hundredths of a millimetre, from the same corner as its ends.
 */
function connectorPath(node: XmlNode): Subpath[] | undefined {
  const data = pathData(node.attributes['svg:d'])
  if (node.name !== 'draw:connector' || !data) return undefined
  const paths = mapPath(subpaths(data), HUNDREDTHS, HUNDREDTHS, 0, 0)
  const [x1, y1] = lineEnds(node)
  const first = paths[0]?.from
  return first && paths.some((path) => path.segments.length > 0) && distance(first, [x1, y1]) < 2 ? paths : undefined
}

async function drawShape(node: XmlNode, context: DrawingContext, inMaster: boolean): Promise<void> {
  const { source, canvas } = context
  const { attributes } = node
  const graphic = graphicOf(node, source, inMaster)
  const base = textBase(node, source, inMaster)
  const content: string[] = []
  let width = length(attributes['svg:width']) ?? 0
  let height = length(attributes['svg:height']) ?? 0
  let transform = transformOf(node)
  let textBox: { x: number; y: number; width: number; height: number } | undefined
  let textHolder: XmlNode | undefined = node
  let anchor: 'top' | 'middle' | 'bottom' = 'middle'
  // A shape whose styles name no fill is filled as LibreOffice fills one, in the colour it gives the file; a frame is not.
  const fill = async (): Promise<Fill> => {
    const given = await fillOf(graphic, context)
    if (given || node.name === 'draw:frame') return given ?? { kind: 'none' }
    const paint = paintOf(graphic['draw:fill-color'], fillOpacity(graphic)) ?? paintOf(context.source.colours.fill, fillOpacity(graphic))
    return paint ? { kind: 'paint', paint } : { kind: 'none' }
  }
  const outline = outlineOf(graphic, context)
  const markers = markersOf(graphic, context)

  switch (node.name) {
    case 'draw:frame': {
      anchor = 'top'
      textHolder = childAt(node, 'draw:text-box')
      const size = { width, height }
      const object = childAt(node, 'draw:object')
      const table = childAt(node, 'table:table')
      if (table) content.push(tableElement(table, size, context, inMaster))
      else if (object) {
        const chart = await objectChart(object, source)
        if (chart) content.push(chartElements(chart, size, { tones: CHART_TONES, font: source.fonts.values().next().value ?? '' }))
      }
      if (!table && content.length === 0)
        for (const image of childrenNamed(node, 'draw:image')) {
          const held = await pictureHeld(image, context)
          if (!held) continue
          content.push(pictureElement(held.href, cropOf(graphic['fo:clip'], held.size), size))
          break
        }
      // An equation its app kept no picture of is written as its linear text in its frame.
      if (object && content.length === 0) {
        const formula = await objectFormula(source.archive, objectPart(object) ?? '').catch(() => undefined)
        if (formula) content.push(textHtml(formulaFrame(formula, size), size))
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
      const lined = withArrows(geometry.stroke, outline, markers)
      content.push(customElement({ ...geometry, stroke: lined.data }, await fill(), outline, canvas, { width, height }) + lined.arrows)
      break
    }
    case 'draw:line':
    case 'draw:connector': {
      // A line is placed by its ends, on the page, its transform moving them; a connector by the path it takes.
      const [x1, y1, x2, y2] = lineEnds(node)
      transform = attributes['draw:transform'] ? transformText(transformSteps(node, false)) : ''
      const routed = connectorPath(node)
      const lined = withArrows(routed ? writePath(routed) : `M${number(x1)} ${number(y1)}L${number(x2)} ${number(y2)}`, outline, markers)
      content.push(`<path d="${lined.data}" fill="none" ${strokeAttributes(outline)}/>${lined.arrows}`)
      width = Math.abs(x2 - x1)
      height = Math.abs(y2 - y1)
      textBox = { x: Math.min(x1, x2), y: Math.min(y1, y2), width, height }
      break
    }
    case 'draw:polyline':
    case 'draw:polygon': {
      const view = viewBoxOf(attributes['svg:viewBox'], width, height)
      const values = (attributes['draw:points'] ?? attributes['svg:points'] ?? '')
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
      const geometry = customGeometry(commands, view, { width, height })
      const lined = withArrows(geometry.stroke, outline, markers)
      content.push(customElement({ ...geometry, stroke: lined.data }, await fill(), outline, canvas, { width, height }) + lined.arrows)
      break
    }
    case 'draw:path': {
      const view = viewBoxOf(attributes['svg:viewBox'], width, height)
      const data = pathData(attributes['svg:d'])
      if (data) {
        const filled = /z/i.test(data)
        const pathFill = filled ? await fill() : undefined
        const scaleX = view.width ? width / view.width : 1
        const scaleY = view.height ? height / view.height : 1
        const scale = `scale(${factor(scaleX)} ${factor(scaleY)}) translate(${number(-view.left)} ${number(-view.top)})`
        const fillAttributes = filled ? fillAttribute(pathFill, canvas, { width: view.width, height: view.height }) : 'fill="none"'
        // A path with arrows has its line drawn in the shape's own units, where its arrows are placed.
        const lined =
          markers.start || markers.end
            ? withArrows(writePath(mapPath(subpaths(data), scaleX, scaleY, -view.left * scaleX, -view.top * scaleY)), outline, markers)
            : { data, arrows: '' }
        if (lined.arrows)
          content.push(
            `${filled ? `<g transform="${scale}"><path d="${escaped(data)}" ${fillAttributes} stroke="none"/></g>` : ''}<path d="${lined.data}" fill="none" ${strokeAttributes(outline)}/>${lined.arrows}`
          )
        else
          content.push(
            `<g transform="${scale}"><path d="${escaped(data)}" ${fillAttributes} ${strokeAttributes(outline)} vector-effect="non-scaling-stroke"/></g>`
          )
      }
      break
    }
    case 'dr3d:scene': {
      // A 3D scene draws its objects, each in its own style, and holds no text.
      textHolder = undefined
      content.push(
        sceneElement(
          node,
          { width, height },
          { style: (object) => graphicOf(object, source, inMaster), fill: source.colours.fill, polygons: (data) => flattened(pathData(data)) }
        )
      )
      break
    }
    case 'draw:custom-shape': {
      const geometry = childAt(node, 'draw:enhanced-geometry')
      const drawn = geometry
        ? enhancedGeometry(geometry, { width, height })
        : { geometry: { fill: rectangle(width, height), stroke: rectangle(width, height) }, flipH: false, flipV: false, text: undefined }
      let element: string
      const fontwork = fontworkOf(node, base, graphic, context, { width, height })
      const solid = extrudedShape(node, base, graphic, context, { width, height }, await fill(), canvas)
      if (solid) {
        // An extruded shape is drawn as its solid, under its text, which LibreOffice leaves flat.
        canvas.parts.push(`<g transform="${solid.placement}">${solid.svg}</g>`)
        element = ''
        if (fontwork) textHolder = undefined
      } else if (fontwork) {
        // A Fontwork draws its text in its fill and line, in place of its geometry and of its text's frame.
        element = fontworkElement(fontwork.glyphs, fontwork.style, await fill(), outline, canvas)
        textHolder = undefined
      } else {
        const lined = withArrows(drawn.geometry.stroke, outline, markers)
        element = customElement({ ...drawn.geometry, stroke: lined.data }, await fill(), outline, canvas, { width, height }) + lined.arrows
      }
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
    await readTextPictures(textHolder, context)
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

/**
 * A custom shape's extrusion drawn, its fill on its ends and its sides in the fill's colour, or in its second fill
 * colour when its extrusion says so, as LibreOffice paints them: its outline pushed back, or a Fontwork's letters
 * drawn again at depths along the way. The shape is turned over and turned by its own rotation before it is
 * extruded, so its depth goes the way its skew says on the page, and the drawing is placed by the move that puts its
 * middle where its transform does (`placement`); its points are given back in the shape's own box, for the room it
 * takes. None for a shape that is not extruded.
 */
function extrudedShape(
  node: XmlNode,
  base: TextBase,
  graphic: Properties,
  context: DrawingContext,
  size: { width: number; height: number },
  fill: Fill,
  canvas: Canvas
): { svg: string; points: Point[]; placement: string } | undefined {
  const geometry = node.name === 'draw:custom-shape' ? childAt(node, 'draw:enhanced-geometry') : undefined
  const extrusion = geometry ? readExtrusion(geometry.attributes) : undefined
  if (!geometry || !extrusion) return undefined
  const drawn = enhancedGeometry(geometry, size)
  const steps = transformSteps(node)
  const matrix = matrixOf(steps)
  const [a, b, c, d] = matrix
  const turning = Math.abs(a * d - b * c - 1) < 1e-6 && Math.abs(a - d) < 1e-6 && Math.abs(b + c) < 1e-6
  const turn = turning ? (Math.atan2(b, a) * 180) / Math.PI : 0
  const lying = { horizontal: drawn.flipH, vertical: drawn.flipV, turn }
  const { colours } = context.source
  const blue = { red: 114, green: 159, blue: 207, opacity: 1 }
  const fillColour = paintOf(graphic['draw:fill-color'] ?? colours.fill) ?? blue
  const second = paintOf(graphic['draw:secondary-fill-color'] ?? colours.fill) ?? fillColour
  const side = extrusion.sideColour ? second : fill.kind === 'paint' ? fill.paint : fillColour
  // A shape with no fill is filled when it is extruded, as LibreOffice fills its solid.
  const ends: Fill = fill.kind === 'none' ? { kind: 'paint', paint: fillColour } : fill
  let solid: { svg: string; points: Point[] }
  const fontwork = fontworkOf(node, base, graphic, context, size)
  if (fontwork)
    solid = stackedElement(
      (paint) => fontworkElement(fontwork.glyphs, fontwork.style, paint, undefined, canvas),
      glyphCorners(fontwork.glyphs, fontwork.style),
      side,
      ends,
      extrusion,
      size,
      lying
    )
  else {
    const pieces = drawn.geometry.pieces ?? (drawn.geometry.fill ? [drawn.geometry.fill] : [])
    // A shape of lines only is extruded as walls in its line's colour.
    const parts: ExtrudedPart[] =
      pieces.length > 0
        ? pieces.map((piece, index) => {
            // A part darkened or lightened in the flat shape is the colour of its own solid, as LibreOffice gives it.
            const { rule = 'blend', amounts = [] } = drawn.geometry.shading ?? {}
            const amount = amounts[index] ?? 0
            return { outlines: flattened(piece), side: shadedPaint(side, rule, amount), fill: shadedFill(ends, rule, amount) }
          })
        : [{ outlines: flattened(drawn.geometry.stroke), side: outlineOf(graphic, context)?.paint ?? fillColour, fill: undefined }]
    solid = extrudedElement(parts, extrusion, size, lying, canvas)
  }
  const middle: Point = [size.width / 2, size.height / 2]
  const placed = applied(matrix, middle)
  const angle = (-turn * Math.PI) / 180
  const back = ([x, y]: Point): Point => [
    middle[0] + Math.cos(angle) * (x - middle[0]) - Math.sin(angle) * (y - middle[1]),
    middle[1] + Math.sin(angle) * (x - middle[0]) + Math.cos(angle) * (y - middle[1])
  ]
  return {
    svg: solid.svg,
    points: turning ? solid.points.map(back) : solid.points,
    placement: turning ? `translate(${number(placed[0] - middle[0])} ${number(placed[1] - middle[1])})` : transformText(steps)
  }
}

/** Whether a custom shape is a Fontwork: its geometry says its text follows its path. */
const isFontwork = (node: XmlNode) => node.name === 'draw:custom-shape' && childAt(node, 'draw:enhanced-geometry')?.attributes['draw:text-path'] === 'true'

/**
 * A Fontwork's letters placed along the lines of its geometry, and the style they are laid out in: the font of its
 * text's first run, which LibreOffice takes for the whole text, its size, its spacing, and its geometry's and style's
 * choices. None for a shape that is no Fontwork, or one with no text.
 */
function fontworkOf(
  node: XmlNode,
  base: TextBase,
  graphic: Properties,
  context: DrawingContext,
  size: { width: number; height: number }
): { glyphs: FontworkGlyph[]; style: FontworkStyle } | undefined {
  const geometry = childAt(node, 'draw:enhanced-geometry')
  if (!geometry || !isFontwork(node)) return undefined
  const paragraphs = readParagraphs(node, base, context)
  const legacy = context.source.legacyFontwork
  // Each paragraph is a line, or, but in the older way, as many lines as its breaks make.
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    let line = ''
    for (const piece of paragraph.pieces)
      if (isRun(piece)) line += piece.text.replace(/\t/g, ' ')
      else if (piece === 'break' && !legacy) {
        lines.push(line)
        line = ''
      }
    lines.push(line)
  }
  const first = paragraphs.flatMap((paragraph) => paragraph.pieces).find((piece): piece is TextRun => isRun(piece) && piece.text.trim() !== '')
  if (!first) return undefined
  const look = runStyle(levelProperties(base, 1, 'text', context.source), context.source)
  const points = first.style.size ?? look.size ?? 18
  const { attributes } = geometry
  const horizontal = graphic['draw:textarea-horizontal-align']
  const vertical = graphic['draw:textarea-vertical-align']
  const fitting = graphic['draw:fit-to-size']
  const style: FontworkStyle = {
    font: { family: first.style.font ?? look.font ?? 'Liberation Sans', bold: first.style.bold ?? false, italic: first.style.italic ?? false },
    size: (points * 4) / 3,
    letterSpacing: first.style.letterSpacing ?? 0,
    scaleToShape: attributes['draw:text-path-scale'] === 'shape',
    sameLetterHeights: attributes['draw:text-path-same-letter-heights'] === 'true',
    fitToSize: fitting === 'true' || fitting === 'all',
    align: horizontal === 'left' || horizontal === 'center' || horizontal === 'right' ? horizontal : 'block',
    vertical: vertical === 'top' || vertical === 'bottom' ? vertical : 'middle',
    legacy
  }
  const outlines = (enhancedGeometry(geometry, size).geometry.outlines ?? []).flatMap(flattened)
  return { glyphs: layFontwork(outlines, lines, style, size.height), style }
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

/** The folder of the file an object's content is in (`Object 1`); none for an address outside the file. */
function objectPart(object: XmlNode): string | undefined {
  const href = object.attributes['xlink:href']?.replace(/^\.\//, '').replace(/\/$/, '')
  return !href || /^[a-z][a-z\d+.-]*:/i.test(href) ? undefined : href
}

/** The chart an object of the file holds, read from its own content. */
async function objectChart(object: XmlNode, source: DrawingSource): Promise<OfficeChart | undefined> {
  const href = objectPart(object)
  if (!href) return undefined
  const xml = await textOf(source.archive, `${href}/content.xml`)
  return xml === undefined ? undefined : readOpenChart(xml).catch(() => undefined)
}

/**
 * An equation's linear text as the text of its frame: one centred line in the serif LibreOffice writes equations in, as
 * large as the frame holds it, since LibreOffice draws an equation to its frame's size.
 */
function formulaFrame(formula: string, box: { width: number; height: number }): TextFrame {
  const size = Math.max(4, Math.min(box.height * 0.75 * 0.7, ((box.width * 0.75) / Math.max(1, formula.length)) * 1.8))
  return {
    paragraphs: [{ align: 'center', size, pieces: [{ text: formula, style: { size } }] }],
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    anchor: 'middle',
    wraps: true,
    font: 'Liberation Serif',
    paint: { red: 0, green: 0, blue: 0, opacity: 1 }
  }
}

/**
 * A table of a page (`table:table`) as XHTML in its frame: its columns at their widths, its rows at their heights, each
 * cell's fill and text, from its own style over those its table's template gives its row and column.
 */
function tableElement(table: XmlNode, box: { width: number; height: number }, context: DrawingContext, inMaster: boolean): string {
  const { book } = context.source
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

// A text's drawings

/** A box in pixels: its corner and size. */
interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

/** How far something reaches past a box on each side, in pixels. */
interface Sides {
  top: number
  right: number
  bottom: number
  left: number
}

/** The box around points. */
function around(points: readonly Point[]): Rectangle | undefined {
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (finite.length === 0) return undefined
  const xs = finite.map(([x]) => x)
  const ys = finite.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

const corners = ({ x, y, width, height }: Rectangle): Point[] => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height]
]

const grown = (box: Rectangle, reach: Sides): Rectangle => ({
  x: box.x - reach.left,
  y: box.y - reach.top,
  width: box.width + reach.left + reach.right,
  height: box.height + reach.top + reach.bottom
})

/** How far a box reaches past another inside it, on each side. */
const beyond = (outer: Rectangle, inner: Rectangle): Sides => ({
  top: Math.max(0, inner.y - outer.y),
  left: Math.max(0, inner.x - outer.x),
  bottom: Math.max(0, outer.y + outer.height - inner.y - inner.height),
  right: Math.max(0, outer.x + outer.width - inner.x - inner.width)
})

/**
 * The points a shape's own outline passes through and bends toward, in its box before its transform, where they may
 * reach past that box: a custom shape's geometry (a callout's tail), a path's or a polygon's points past its view box.
 */
function outlinePoints(node: XmlNode, width: number, height: number, context: DrawingContext, inMaster: boolean): Point[] {
  const { attributes } = node
  if (node.name === 'draw:custom-shape') {
    const geometry = childAt(node, 'draw:enhanced-geometry')
    if (!geometry) return []
    const drawn = enhancedGeometry(geometry, { width, height })
    // An extruded shape reaches as far as its solid; a Fontwork as far as its letters, which may stand past its path.
    const solid = extrudedShape(
      node,
      textBase(node, context.source, inMaster),
      graphicOf(node, context.source, inMaster),
      context,
      { width, height },
      { kind: 'none' },
      new Canvas()
    )
    if (solid) return solid.points
    const fontwork = fontworkOf(node, textBase(node, context.source, inMaster), graphicOf(node, context.source, inMaster), context, { width, height })
    if (fontwork) return glyphCorners(fontwork.glyphs, fontwork.style).map(([x, y]) => [drawn.flipH ? width - x : x, drawn.flipV ? height - y : y])
    return pathPoints(subpaths(`${drawn.geometry.fill} ${drawn.geometry.stroke}`)).map(([x, y]) => [drawn.flipH ? width - x : x, drawn.flipV ? height - y : y])
  }
  const view = viewBoxOf(attributes['svg:viewBox'], width, height)
  const scaleX = view.width ? width / view.width : 1
  const scaleY = view.height ? height / view.height : 1
  if (node.name === 'draw:path') return pathPoints(mapPath(subpaths(pathData(attributes['svg:d'])), scaleX, scaleY, -view.left * scaleX, -view.top * scaleY))
  if (node.name !== 'draw:polygon' && node.name !== 'draw:polyline') return []
  const values = (attributes['draw:points'] ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const points: Point[] = []
  for (let index = 0; index + 1 < values.length && points.length < SEGMENT_LIMIT; index += 2)
    points.push([((values[index] as number) - view.left) * scaleX, ((values[index + 1] as number) - view.top) * scaleY])
  return points
}

/**
 * The box a shape takes, from the corner its place is measured from, through its transform: a line's or a connector's
 * by the points it passes through, a group's around its shapes. With it, how far its drawing reaches past that box: half
 * its line, its arrows, its outline where it goes past its box, and its text where it overflows.
 */
function shapeBounds(node: XmlNode, context: DrawingContext, inMaster: boolean, depth: number): { box: Rectangle; reach: Sides } | undefined {
  if (node.name === 'draw:g') {
    if (depth >= GROUP_DEPTH_LIMIT) return undefined
    const inner = node.children.flatMap((child) => {
      const found = SHAPES.has(child.name) ? shapeBounds(child, context, inMaster, depth + 1) : undefined
      return found ? [found] : []
    })
    const matrix = matrixOf(node.attributes['draw:transform'] ? transformSteps(node, false) : [])
    const box = around(inner.flatMap((one) => corners(one.box).map((point) => applied(matrix, point))))
    const outer = around(inner.flatMap((one) => corners(grown(one.box, one.reach)).map((point) => applied(matrix, point))))
    return box && outer ? { box, reach: beyond(outer, box) } : undefined
  }
  if (!SHAPES.has(node.name)) return undefined
  const graphic = graphicOf(node, context.source, inMaster)
  const outline = outlineOf(graphic, context)
  const width = length(node.attributes['svg:width']) ?? 0
  const height = length(node.attributes['svg:height']) ?? 0
  let box: Rectangle | undefined
  let drawn: Rectangle | undefined
  if (node.name === 'draw:line' || node.name === 'draw:connector') {
    const [x1, y1, x2, y2] = lineEnds(node)
    const matrix = matrixOf(node.attributes['draw:transform'] ? transformSteps(node, false) : [])
    const routed = connectorPath(node)
    box = around(
      (routed
        ? pathPoints(routed)
        : ([
            [x1, y1],
            [x2, y2]
          ] as Point[])
      ).map((point) => applied(matrix, point))
    )
  } else {
    const matrix = matrixOf(transformSteps(node))
    box = around(corners({ x: 0, y: 0, width, height }).map((point) => applied(matrix, point)))
    drawn = around(outlinePoints(node, width, height, context, inMaster).map((point) => applied(matrix, point)))
  }
  if (!box) return undefined
  const markers = outline?.paint ? markersOf(graphic, context) : {}
  const line = Math.max(outline?.paint ? outline.width / 2 : 0, ...[markers.start, markers.end].map((marker) => (marker ? markerReach(marker) : 0))) + 1
  const past = drawn ? beyond(around([...corners(box), ...corners(drawn)]) ?? box, box) : { top: 0, right: 0, bottom: 0, left: 0 }
  const reach: Sides = { top: past.top + line, right: past.right + line, bottom: past.bottom + line, left: past.left + line }
  const holder = node.name === 'draw:frame' ? childAt(node, 'draw:text-box') : isFontwork(node) ? undefined : node
  const frame = holder && textFrame(holder, textBase(node, context.source, inMaster), graphic, context, node.name === 'draw:frame' ? 'top' : 'middle')
  if (frame) {
    const words = textReach(frame, box)
    for (const side of ['top', 'right', 'bottom', 'left'] as const) reach[side] = Math.max(reach[side], words[side])
  }
  return { box, reach }
}

/** A drawing of a text as a picture of its own: its SVG, the box it takes from its anchor, and how far it reaches past that box on each side, in pixels. */
export interface LoneDrawing {
  svg: Uint8Array
  box: Rectangle
  reach: Sides
}

/** The largest side of a drawing, in pixels, past which it is not drawn. */
const DRAWING_SIDE_LIMIT = 100_000

/**
 * A shape of a text (a line, a rectangle, a group of them) drawn as a picture of its own, as a presentation's are:
 * the box its drawing takes, its line's width, its arrows and its text included, and where that box is from the
 * corner its anchor measures it from. None for a shape that draws nothing.
 */
export async function drawLoneShape(source: DrawingSource, node: XmlNode, inMaster: boolean, place: number): Promise<LoneDrawing | undefined> {
  const context: DrawingContext = { source, place, canvas: new Canvas(), shapes: 0, pictureBytes: 0, shown: () => true }
  const bounds = shapeBounds(node, context, inMaster, 0)
  // A shape of no size, a point, draws nothing to see.
  if (!bounds || !(bounds.box.width > 0 || bounds.box.height > 0)) return undefined
  const shown = grown(bounds.box, bounds.reach)
  if (!(shown.width > 0 && shown.height > 0 && shown.width < DRAWING_SIDE_LIMIT && shown.height < DRAWING_SIDE_LIMIT)) return undefined
  context.canvas.parts.push(`<g transform="translate(${number(-shown.x)} ${number(-shown.y)})">`)
  await drawShapes({ name: '', attributes: {}, children: [node], text: '' }, context, inMaster, 0)
  if (context.canvas.parts.length === 1) return undefined
  context.canvas.parts.push('</g>')
  return { svg: slideSvg(shown.width, shown.height, context.canvas).svg, box: bounds.box, reach: bounds.reach }
}
