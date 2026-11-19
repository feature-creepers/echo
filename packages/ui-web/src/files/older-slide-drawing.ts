/**
 * A slide of PowerPoint 97 to 2003 drawn as it looks, in SVG (docs/SPEC.md, section 9.7). The presentation's stream
 * keeps each slide as records: its atom says which master it follows and whether it takes the master's shapes,
 * colours and background; its drawing is OfficeArt, shapes with their kind, anchor and properties (geometry, fill,
 * line, picture, text box). A slide's placeholders take what they leave out from the master's shape they name, then
 * from the presentation's defaults. Text is the shape's own or, in older files, the slide's list of texts; each
 * paragraph and run takes its style from the master's style of its kind and level, under its own runs. Colours given
 * by number are the slide's scheme of eight.
 *
 * What cannot be read is left out of the drawing rather than failing it: a shape whose records are damaged, a picture
 * of a format the window does not show.
 */

import { unpack } from './archive.ts'
import { customGeometry, type PathCommand } from './custom-geometry.ts'
import { drawMetafile } from './metafile.ts'
import { ART, type ArtRecord, artRecords, childOf, type StoredPicture } from './office-art.ts'
import { pictureType } from './office-figures.ts'
import type { OfficeChart } from './office-text.ts'
import {
  type Box,
  base64,
  bulletCharacter,
  Canvas,
  chartElements,
  css,
  customElement,
  type DrawnSlide,
  type Fill,
  fillAttribute,
  GROUP_DEPTH_LIMIT,
  listNumber,
  number,
  type Outline,
  type Paint,
  PICTURE_LIMIT,
  pictureElement,
  placed,
  polygon,
  presetPath,
  type RunStyle,
  SHAPE_LIMIT,
  type ShapePath,
  shapeElement,
  slideSvg,
  type TextBullet,
  type TextFrame,
  type TextParagraph,
  type TextPiece,
  textHtml
} from './slide-svg.ts'

/** Master units, 576 to the inch, in pixels at 96 to the inch; English Metric Units in pixels; 16.16 fixed numbers. */
const MASTER_UNITS = 6
const EMU_PER_PIXEL = 9525
const FIXED = 65_536

/** The records of the presentation's stream read here. */
const RECORD = {
  documentAtom: 0x03e9,
  environment: 0x03f2,
  fontCollection: 0x07d5,
  fontEntity: 0x0fb7,
  characterDefaults: 0x0fa4,
  paragraphDefaults: 0x0fa5,
  masterStyle: 0x0fa3,
  list: 0x0ff0,
  persist: 0x03f3,
  mainMaster: 0x03f8,
  slide: 0x03ee,
  slideAtom: 0x03ef,
  scheme: 0x07f0,
  drawing: 0x040c,
  drawingGroup: 0x040b,
  textHeader: 0x0f9f,
  characters: 0x0fa0,
  bytes: 0x0fa8,
  style: 0x0fa1,
  ruler: 0x0fa6,
  outlineReference: 0x0f9e,
  placeholder: 0x0bc3,
  slideNumber: 0x0fd8,
  tags: 0x1388,
  binaryTag: 0x138a,
  tagName: 0x0fba,
  tagData: 0x138b,
  style9: 0x0fac
} as const

/** The record types OfficeArt keeps a shape's parts in, beyond those `office-art.ts` names. */
const GROUP_SPACE = 0xf009
const CHILD_ANCHOR = 0xf00f
const TEXT_BOX = 0xf00d

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

// Properties

/** A shape's properties: their simple values and their complex ones, by number. */
interface Properties {
  values: Map<number, number>
  complex: Map<number, Uint8Array>
}

/** The properties that are sets of flags, each flag with a bit saying it is given (from Office 2000) above it. */
const FLAG_SETS = new Set([0x007f, 0x00bf, 0x013f, 0x017f, 0x01bf, 0x01ff, 0x023f, 0x027f, 0x02bf, 0x02ff, 0x033f, 0x037f, 0x03bf])

/** Two sets of flags as one: the first's given flags, then those only the second gives. */
function mergedFlags(first: number, second: number): number {
  let merged = first >>> 0
  for (let bit = 0; bit < 16; bit++) {
    const given = 2 ** (bit + 16)
    if ((second >>> 0) & given && !((first >>> 0) & given)) merged = ((merged & ~(1 << bit)) | (second & (1 << bit)) | given) >>> 0
  }
  return merged
}

/** The properties that are arrays (`IMsoArray`): a header of six bytes, then their elements. */
const ARRAYS = new Set([0x0145, 0x0146, 0x0151, 0x0152, 0x0155, 0x0156, 0x0157, 0x0197, 0x01cf, 0x0383])

/**
 * How many bytes an array property takes: some files give the size of its elements only, without its header, which
 * is read from where it starts.
 */
function arrayLength(data: DataView, at: number, given: number, end: number): number {
  if (at + 6 > end) return given
  const count = data.getUint16(at, true)
  const kept = data.getUint16(at + 4, true)
  const size = kept === 0xfff0 ? 4 : kept
  return count * size === given && at + given + 6 <= end ? given + 6 : given
}

/** A record of properties (an `OPT`) read into a set: what is already there stays, but for flags it does not give. */
function readProperties(bytes: Uint8Array, record: ArtRecord, into: Properties): void {
  const data = view(bytes)
  const count = Math.min(record.instance, Math.floor(record.size / 6))
  let complex = record.at + count * 6
  const end = record.at + record.size
  for (let index = 0; index < count; index++) {
    const at = record.at + index * 6
    const id = data.getUint16(at, true)
    const value = data.getUint32(at + 2, true)
    const property = id & 0x3fff
    if (id & 0x8000) {
      const length = Math.max(0, Math.min(ARRAYS.has(property) ? arrayLength(data, complex, value, end) : value, end - complex))
      if (!into.complex.has(property)) into.complex.set(property, bytes.subarray(complex, complex + length))
      complex += length
      continue
    }
    const known = into.values.get(property)
    if (known === undefined) into.values.set(property, value)
    else if (FLAG_SETS.has(property)) into.values.set(property, mergedFlags(known, value))
  }
}

/** A flag of a set as it is given; none when it is not. Files older than Office 2000 give every flag. */
function flagOf(value: number | undefined, bit: number): boolean | undefined {
  if (value === undefined) return undefined
  const given = value >>> 16
  if (given === 0) return (value & (1 << bit)) !== 0
  return given & (1 << bit) ? (value & (1 << bit)) !== 0 : undefined
}

/** A shape as its records keep it: its kind, number, flags, properties, anchors and what its app keeps of it. */
interface Shape {
  kind: number
  id: number
  flags: number
  properties: Properties
  anchor?: ArtRecord | undefined
  childAnchor?: ArtRecord | undefined
  groupSpace?: ArtRecord | undefined
  client?: ArtRecord | undefined
  textBox?: ArtRecord | undefined
}

/** The flags of a shape's header. */
const SHAPE_FLAG = { group: 0x1, deleted: 0x8, object: 0x10, flipH: 0x40, flipV: 0x80, background: 0x400 } as const

function readShape(bytes: Uint8Array, container: ArtRecord): Shape {
  const data = view(bytes)
  const shape: Shape = { kind: 0, id: 0, flags: 0, properties: { values: new Map(), complex: new Map() } }
  const tables: ArtRecord[] = []
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (record.type === ART.shapeHeader && record.size >= 8) {
      shape.kind = record.instance
      shape.id = data.getUint32(record.at, true)
      shape.flags = data.getUint32(record.at + 4, true)
    } else if (record.type === ART.properties) tables.unshift(record)
    else if (record.type === ART.secondProperties || record.type === ART.thirdProperties) tables.push(record)
    else if (record.type === ART.clientAnchor) shape.anchor = record
    else if (record.type === CHILD_ANCHOR) shape.childAnchor = record
    else if (record.type === GROUP_SPACE) shape.groupSpace = record
    else if (record.type === ART.clientData) shape.client = record
    else if (record.type === TEXT_BOX) shape.textBox = record
  }
  for (const table of tables) readProperties(bytes, table, shape.properties)
  return shape
}

/** A rectangle as a record keeps it, left, top, right and bottom, in the units of its place. */
interface Rectangle {
  left: number
  top: number
  right: number
  bottom: number
}

/** A slide's anchor, in master units: top, left, right and bottom in two bytes each, or in four. */
function clientRectangle(bytes: Uint8Array, record: ArtRecord): Rectangle | undefined {
  const data = view(bytes)
  if (record.size >= 16) {
    const [top, left, right, bottom] = [0, 4, 8, 12].map((offset) => data.getInt32(record.at + offset, true)) as [number, number, number, number]
    return { left, top, right, bottom }
  }
  if (record.size < 8) return undefined
  const [top, left, right, bottom] = [0, 2, 4, 6].map((offset) => data.getInt16(record.at + offset, true)) as [number, number, number, number]
  return { left, top, right, bottom }
}

/** A group's anchor or space: left, top, right and bottom in four bytes each. */
function groupRectangle(bytes: Uint8Array, record: ArtRecord | undefined): Rectangle | undefined {
  if (!record || record.size < 16) return undefined
  const data = view(bytes)
  const [left, top, right, bottom] = [0, 4, 8, 12].map((offset) => data.getInt32(record.at + offset, true)) as [number, number, number, number]
  return { left, top, right, bottom }
}

// Colours

/** A colour of the text, by its number in the slide's scheme or as itself. */
type Colour = { scheme: number } | { paint: Paint }

/** A colour of text (`ColorIndexStruct`): its red, green and blue, or its number in the scheme. */
function textColour(value: number): Colour | undefined {
  const index = value >>> 24
  if (index === 0xfe) return { paint: { red: value & 0xff, green: (value >>> 8) & 0xff, blue: (value >>> 16) & 0xff, opacity: 1 } }
  return index < 8 ? { scheme: index } : undefined
}

/** The colours of Windows a colour of OfficeArt may name, by their number, as Windows gives them by default. */
const SYSTEM_COLOURS: Record<number, number> = { 5: 0xffffff, 15: 0xf0f0f0, 16: 0xa0a0a0, 20: 0xffffff, 22: 0xe3e3e3, 24: 0xffffe1 }

/** A colour of a shape (`OfficeArtCOLORREF`), as itself, by its number in the scheme, or as another of the shape's changed. */
function artColour(value: number, scheme: readonly Paint[], other: (property: number) => Paint | undefined, depth = 0): Paint | undefined {
  const flags = value >>> 24
  const red = value & 0xff
  const green = (value >>> 8) & 0xff
  const blue = (value >>> 16) & 0xff
  if (flags & 0x08) return scheme[red]
  if (!(flags & 0x10)) return { red, green, blue, opacity: 1 }
  // A colour of the system, or another colour of the shape, darkened, lightened or changed by a parameter.
  const index = value & 0xff
  const others: Record<number, number> = { 240: 0x0181, 241: 0x01c0, 242: 0x01c0, 243: 0x0201, 245: 0x0183, 246: 0x01c2, 247: 0x0181 }
  const property = others[index]
  const system = SYSTEM_COLOURS[index] ?? 0
  const base =
    property !== undefined
      ? depth < 4
        ? other(property)
        : undefined
      : { red: (system >> 16) & 0xff, green: (system >> 8) & 0xff, blue: system & 0xff, opacity: 1 }
  if (!base) return undefined
  const parameter = blue
  const change = (value >>> 8) & 0x0f
  const each = (part: number) => {
    switch (change) {
      case 1:
        return (part * parameter) / 255
      case 2:
        return ((255 - parameter) * 255 + part * parameter) / 255
      case 3:
        return Math.min(255, part + parameter)
      case 4:
        return Math.max(0, part - parameter)
      case 5:
        return Math.max(0, parameter - part)
      case 6:
        return part < parameter ? 0 : 255
      default:
        return part
    }
  }
  const changed = { red: each(base.red), green: each(base.green), blue: each(base.blue), opacity: base.opacity }
  return (value >>> 8) & 0x20 ? { ...changed, red: 255 - changed.red, green: 255 - changed.green, blue: 255 - changed.blue } : changed
}

/** A slide's scheme of eight colours (`ColorSchemeAtom`): background, text, shadow, title, fill, accents. */
function schemeOf(bytes: Uint8Array, container: ArtRecord | undefined): Paint[] | undefined {
  if (!container) return undefined
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (record.type !== RECORD.scheme || record.instance !== 1 || record.size < 32) continue
    return Array.from({ length: 8 }, (_, index) => {
      const at = record.at + index * 4
      return { red: bytes[at] ?? 0, green: bytes[at + 1] ?? 0, blue: bytes[at + 2] ?? 0, opacity: 1 }
    })
  }
  return undefined
}

// Text styles

/** What a paragraph's exception (`TextPFException`) gives: its bullet, alignment, spacing and indents. */
interface ParagraphLook {
  hasBullet?: boolean
  bulletHasFont?: boolean
  bulletHasColour?: boolean
  bulletHasSize?: boolean
  bulletCharacter?: number
  bulletFont?: number
  bulletSize?: number
  bulletColour?: Colour | undefined
  align?: number
  lineSpacing?: number
  spaceBefore?: number
  spaceAfter?: number
  leftMargin?: number
  indent?: number
}

/** What a run's exception (`TextCFException`) gives: its weight, slant, underline, font, size and colour, and which extension it takes. */
interface CharacterLook {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: number
  size?: number
  colour?: Colour | undefined
  extension?: number
}

/** A paragraph's exception, and how many bytes it takes. */
function readParagraph(data: DataView, at: number): [ParagraphLook, number] {
  const masks = data.getUint32(at, true)
  let offset = at + 4
  const look: ParagraphLook = {}
  const take = (size: number) => {
    const here = offset
    offset += size
    return here
  }
  if (masks & 0x0f) {
    const flags = data.getUint16(take(2), true)
    if (masks & 0x01) look.hasBullet = (flags & 0x01) !== 0
    if (masks & 0x02) look.bulletHasFont = (flags & 0x02) !== 0
    if (masks & 0x04) look.bulletHasColour = (flags & 0x04) !== 0
    if (masks & 0x08) look.bulletHasSize = (flags & 0x08) !== 0
  }
  if (masks & 0x80) look.bulletCharacter = data.getUint16(take(2), true)
  if (masks & 0x10) look.bulletFont = data.getUint16(take(2), true)
  if (masks & 0x40) look.bulletSize = data.getInt16(take(2), true)
  if (masks & 0x20) look.bulletColour = textColour(data.getUint32(take(4), true))
  if (masks & 0x800) look.align = data.getUint16(take(2), true)
  if (masks & 0x1000) look.lineSpacing = data.getInt16(take(2), true)
  if (masks & 0x2000) look.spaceBefore = data.getInt16(take(2), true)
  if (masks & 0x4000) look.spaceAfter = data.getInt16(take(2), true)
  if (masks & 0x100) look.leftMargin = data.getInt16(take(2), true)
  if (masks & 0x400) look.indent = data.getInt16(take(2), true)
  if (masks & 0x8000) take(2)
  if (masks & 0x100000) take(2 + data.getUint16(offset, true) * 4)
  if (masks & 0x10000) take(2)
  if (masks & 0xe0000) take(2)
  if (masks & 0x200000) take(2)
  return [look, offset - at]
}

/** A run's exception, and how many bytes it takes. */
function readCharacter(data: DataView, at: number): [CharacterLook, number] {
  const masks = data.getUint32(at, true)
  let offset = at + 4
  const look: CharacterLook = {}
  const take = (size: number) => {
    const here = offset
    offset += size
    return here
  }
  if (masks & 0x3eb7) {
    const style = data.getUint16(take(2), true)
    if (masks & 0x01) look.bold = (style & 0x01) !== 0
    if (masks & 0x02) look.italic = (style & 0x02) !== 0
    if (masks & 0x04) look.underline = (style & 0x04) !== 0
    if (masks & 0x3c00) look.extension = (style >> 10) & 0x0f
  }
  if (masks & 0x10000) look.font = data.getUint16(take(2), true)
  if (masks & 0x200000) take(2)
  if (masks & 0x400000) take(2)
  if (masks & 0x800000) take(2)
  if (masks & 0x20000) look.size = data.getUint16(take(2), true)
  if (masks & 0x40000) look.colour = textColour(data.getUint32(take(4), true))
  if (masks & 0x80000) take(2)
  if (masks & 0x100000) take(4)
  if (masks & 0x1000000) take(2)
  if (masks & 0x2000000) take(2)
  if (masks & 0x4000000) take(4)
  return [look, offset - at]
}

/** One level of a master's style of text: its paragraphs' look and its runs'. */
interface Level {
  paragraph: ParagraphLook
  character: CharacterLook
}

/** A master's style of text of a kind (`TxMasterStyleAtom`), by level; kinds from 5 on name each level they give. */
function readMasterStyle(bytes: Uint8Array, record: ArtRecord): Level[] {
  const data = view(bytes)
  const levels: Level[] = []
  let at = record.at
  const end = record.at + record.size
  const count = Math.min(data.getUint16(at, true), 9)
  at += 2
  for (let index = 0; index < count && at < end; index++) {
    let level = index
    if (record.instance >= 5) {
      level = data.getUint16(at, true)
      at += 2
    }
    const [paragraph, paragraphSize] = readParagraph(data, at)
    at += paragraphSize
    const [character, characterSize] = readCharacter(data, at)
    at += characterSize
    if (level < 9) levels[level] = { paragraph, character }
  }
  return levels
}

/** The masters' styles of text by kind of text. */
function masterStyles(bytes: Uint8Array, container: ArtRecord | undefined): Map<number, Level[]> {
  const styles = new Map<number, Level[]>()
  if (!container) return styles
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (record.type !== RECORD.masterStyle) continue
    try {
      styles.set(record.instance, readMasterStyle(bytes, record))
    } catch {
      // A style that cannot be read is left to the defaults.
    }
  }
  return styles
}

const defined = <Value extends object>(value: Value): Partial<Value> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<Value>

const mergedLevel = (under: Level, over: Level | undefined): Level =>
  over ? { paragraph: { ...under.paragraph, ...defined(over.paragraph) }, character: { ...under.character, ...defined(over.character) } } : under

// The deck

/** What a presentation's slides are drawn with, read once for them all. */
export interface OlderDeck {
  bytes: Uint8Array
  places: Map<number, number>
  width: number
  height: number
  fonts: string[]
  defaults: Level
  otherStyle: Level[]
  shapeDefaults: Properties
  masters: Map<number, ArtRecord>
  texts: Map<number, ArtRecord[][]>
  pictures: (place: number) => StoredPicture | undefined
  chart: (client: ArtRecord | undefined) => Promise<OfficeChart | undefined>
  addresses: Map<number, Promise<string | undefined>>
}

const recordAt = (bytes: Uint8Array, at: number | undefined): ArtRecord | undefined => {
  if (at === undefined || at < 0 || at + 8 > bytes.length) return undefined
  const [found] = artRecords(bytes, at)
  return found
}

/**
 * What a presentation's slides are drawn with: its slides' size, fonts and default styles, its shapes' defaults, its
 * masters by number, the texts its list of slides keeps for each, its pictures, and the chart an object of another
 * app holds, by the client data of the shape that shows it.
 */
export function olderDeck(
  bytes: Uint8Array,
  places: Map<number, number>,
  document: ArtRecord,
  pictures: (place: number) => StoredPicture | undefined,
  chart: (client: ArtRecord | undefined) => Promise<OfficeChart | undefined> = async () => undefined
): OlderDeck {
  const data = view(bytes)
  // A size that is not one is the 10 by 7.5 inches of PowerPoint's slides.
  const atom = childOf(bytes, document, RECORD.documentAtom)
  const size = (at: number, fallback: number) => {
    const found = atom && atom.size >= 8 ? data.getInt32(atom.at + at, true) / MASTER_UNITS : 0
    return found > 0 && found < 100_000 ? found : fallback
  }
  const width = size(0, 960)
  const height = size(4, 720)

  // The fonts by their number, and the presentation's own style of text.
  const fonts: string[] = []
  let defaults: Level = { paragraph: {}, character: {} }
  let otherStyle: Level[] = []
  const environment = childOf(bytes, document, RECORD.environment)
  if (environment) {
    const collection = childOf(bytes, environment, RECORD.fontCollection)
    for (const font of collection ? artRecords(bytes, collection.at, collection.at + collection.size) : []) {
      if (font.type !== RECORD.fontEntity || font.size < 64) continue
      fonts[font.instance] = new TextDecoder('utf-16le').decode(bytes.subarray(font.at, font.at + 64)).replace(/\0.*$/s, '')
    }
    const characters = childOf(bytes, environment, RECORD.characterDefaults)
    const paragraphs = childOf(bytes, environment, RECORD.paragraphDefaults)
    try {
      defaults = {
        character: characters ? readCharacter(data, characters.at)[0] : {},
        paragraph: paragraphs && paragraphs.size >= 6 ? readParagraph(data, paragraphs.at + 2)[0] : {}
      }
    } catch {
      // Defaults that cannot be read are left out.
    }
    otherStyle = masterStyles(bytes, environment).get(4) ?? []
  }

  // The properties every shape takes when it does not give them.
  const shapeDefaults: Properties = { values: new Map(), complex: new Map() }
  const group = childOf(bytes, document, RECORD.drawingGroup)
  const drawingGroup = group && childOf(bytes, group, ART.drawingGroup)
  for (const record of drawingGroup ? artRecords(bytes, drawingGroup.at, drawingGroup.at + drawingGroup.size) : [])
    if (record.type === ART.properties || record.type === ART.thirdProperties) readProperties(bytes, record, shapeDefaults)

  // The masters by their number, and the texts the list of slides keeps for each slide.
  const masters = new Map<number, ArtRecord>()
  const texts = new Map<number, ArtRecord[][]>()
  for (const list of artRecords(bytes, document.at, document.at + document.size)) {
    if (list.type !== RECORD.list) continue
    let current: ArtRecord[][] | undefined
    for (const record of artRecords(bytes, list.at, list.at + list.size)) {
      if (record.type === RECORD.persist && record.size >= 16) {
        const persisted = data.getUint32(record.at, true)
        if (list.instance === 1) {
          const master = recordAt(bytes, places.get(persisted))
          if (master) masters.set(data.getUint32(record.at + 12, true), master)
        }
        current = []
        texts.set(persisted, current)
      } else if (current && record.type === RECORD.textHeader) current.push([record])
      else current?.at(-1)?.push(record)
    }
  }
  return { bytes, places, width, height, fonts, defaults, otherStyle, shapeDefaults, masters, texts, pictures, chart, addresses: new Map() }
}

// Text

/** A text as a shape or the list of slides keeps it: its kind, its characters, and the records of its styles. */
interface TextBlock {
  kind: number
  text: string
  style?: ArtRecord | undefined
  ruler?: ArtRecord | undefined
  fields: { at: number; kind: 'number' | 'other' }[]
}

function textBlock(bytes: Uint8Array, records: readonly ArtRecord[]): TextBlock | undefined {
  const data = view(bytes)
  let block: TextBlock | undefined
  for (const record of records) {
    if (record.type === RECORD.textHeader && record.size >= 4) block = { kind: data.getUint32(record.at, true), text: '', fields: [] }
    else if (record.type === RECORD.characters) {
      block ??= { kind: 4, text: '', fields: [] }
      block.text = new TextDecoder('utf-16le').decode(bytes.subarray(record.at, record.at + record.size - (record.size % 2)))
    } else if (record.type === RECORD.bytes) {
      block ??= { kind: 4, text: '', fields: [] }
      let text = ''
      for (const byte of bytes.subarray(record.at, record.at + record.size)) text += String.fromCharCode(byte)
      block.text = text
    } else if (block && record.type === RECORD.style) block.style = record
    else if (block && record.type === RECORD.ruler) block.ruler = record
    else if (block && record.size >= 4 && (record.type === RECORD.slideNumber || record.type === 0x0ff7 || record.type === 0x0ff8 || record.type === 0x1015))
      block.fields.push({ at: data.getInt32(record.at, true), kind: record.type === RECORD.slideNumber ? 'number' : 'other' })
  }
  return block
}

/** The runs of a text's style (`StyleTextPropAtom`): its paragraphs' with their levels, then its characters'. */
function readStyleRuns(bytes: Uint8Array, record: ArtRecord | undefined, length: number) {
  const paragraphs: { count: number; level: number; look: ParagraphLook }[] = []
  const characters: { count: number; look: CharacterLook }[] = []
  if (!record) return { paragraphs, characters }
  const data = view(bytes)
  const end = record.at + record.size
  let at = record.at
  try {
    for (let covered = 0; covered < length + 1 && at + 6 <= end; ) {
      const count = data.getUint32(at, true)
      const level = data.getUint16(at + 4, true)
      const [look, size] = readParagraph(data, at + 6)
      paragraphs.push({ count, level: Math.min(level, 8), look })
      at += 6 + size
      covered += count
      if (count === 0) break
    }
    for (let covered = 0; covered < length + 1 && at + 4 <= end; ) {
      const count = data.getUint32(at, true)
      const [look, size] = readCharacter(data, at + 4)
      characters.push({ count, look })
      at += 4 + size
      covered += count
      if (count === 0) break
    }
  } catch {
    // Runs past a damaged one take the master's style.
  }
  return { paragraphs, characters }
}

/** A text's ruler (`TextRulerAtom`): the left margin and indent of each level it gives, in master units. */
function readRuler(bytes: Uint8Array, record: ArtRecord | undefined): { leftMargin?: number; indent?: number }[] {
  const levels: { leftMargin?: number; indent?: number }[] = []
  if (!record || record.size < 4) return levels
  const data = view(bytes)
  try {
    const masks = data.getUint32(record.at, true)
    let at = record.at + 4
    if (masks & 0x02) at += 2
    if (masks & 0x01) at += 2
    if (masks & 0x04) at += 2 + data.getUint16(at, true) * 4
    for (let level = 0; level < 5; level++) {
      const entry: { leftMargin?: number; indent?: number } = {}
      if (masks & (1 << (3 + level))) {
        entry.leftMargin = data.getInt16(at, true)
        at += 2
      }
      if (masks & (1 << (8 + level))) {
        entry.indent = data.getInt16(at, true)
        at += 2
      }
      levels[level] = entry
    }
  } catch {
    // A ruler past its record gives what it gave.
  }
  return levels
}

/** The numbering schemes of PowerPoint's lists, by their number, as `listNumber` names them. */
const NUMBER_SCHEMES = [
  'alphaLcPeriod',
  'alphaUcPeriod',
  'arabicParenR',
  'arabicPeriod',
  'romanLcParenBoth',
  'romanLcParenR',
  'romanLcPeriod',
  'romanUcPeriod',
  'alphaLcParenBoth',
  'alphaLcParenR',
  'alphaUcParenBoth',
  'alphaUcParenR',
  'arabicParenBoth',
  'arabicPlain',
  'romanUcParenBoth',
  'romanUcParenR'
]

/**
 * The numbered lists of a shape's text, from what PowerPoint 2000 and later keep beside it (its `___PPT9` tag): by
 * the number a run's style names, the scheme and first number of its paragraphs, when they are numbered.
 */
function numberedLists(bytes: Uint8Array, client: ArtRecord | undefined): { scheme: string; start: number }[] {
  const lists: { scheme: string; start: number }[] = []
  const tags = client && childOf(bytes, client, RECORD.tags)
  if (!tags) return lists
  const data = view(bytes)
  for (const tag of artRecords(bytes, tags.at, tags.at + tags.size)) {
    if (tag.type !== RECORD.binaryTag) continue
    const name = childOf(bytes, tag, RECORD.tagName)
    if (!name || new TextDecoder('utf-16le').decode(bytes.subarray(name.at, name.at + name.size)) !== '___PPT9') continue
    const kept = childOf(bytes, tag, RECORD.tagData)
    const styles = kept && [...artRecords(bytes, kept.at, kept.at + kept.size)].find((record) => record.type === RECORD.style9)
    if (!styles) continue
    try {
      const end = styles.at + styles.size
      for (let at = styles.at; at + 12 <= end; ) {
        const masks = data.getUint32(at, true)
        at += 4
        let numbered = false
        let scheme = 3
        let start = 1
        if (masks & 0x800000) at += 2
        if (masks & 0x2000000) {
          numbered = data.getUint16(at, true) !== 0
          at += 2
        }
        if (masks & 0x1000000) {
          scheme = data.getUint16(at, true)
          start = data.getInt16(at + 2, true) || 1
          at += 4
        }
        // Its runs' and its words' extensions follow, neither of which a drawing needs.
        const characterMasks = data.getUint32(at, true)
        at += 4 + (characterMasks & 0x100000 ? 4 : 0)
        const wordMasks = data.getUint32(at, true)
        at += 4
        for (const [bit, size] of [
          [0x01, 2],
          [0x02, 2],
          [0x04, 2],
          [0x40, 2],
          [0x20, 4]
        ] as const)
          if (wordMasks & bit) at += size
        if (wordMasks & 0x200) at += 4 + data.getUint32(at, true) * 4
        lists.push(numbered ? { scheme: NUMBER_SCHEMES[scheme] ?? 'arabicPeriod', start } : { scheme: '', start })
      }
    } catch {
      // Extensions past a damaged one are left out.
    }
  }
  return lists
}

/** What a slide's text is drawn with: the deck, the slide's scheme, its master's styles, and its number. */
interface TextContext {
  deck: OlderDeck
  scheme: readonly Paint[]
  styles: Map<number, Level[]>
  number: number
}

/** The kind of text whose master's style a kind takes first: centred and split bodies a body's, a centred title a title's. */
const baseKind = (kind: number) => (kind === 6 ? 0 : kind === 5 || kind === 7 || kind === 8 ? 1 : kind === 3 ? 4 : kind)

/** A level's style for a kind of text: the presentation's defaults, then the master's levels down to it. */
function levelStyle(context: TextContext, kind: number, level: number): Level {
  let style = context.deck.defaults
  const base = baseKind(kind)
  const levels = context.styles.get(base) ?? (base === 4 ? context.deck.otherStyle : [])
  for (let index = 0; index <= level; index++) style = mergedLevel(style, levels[index])
  if (base !== kind) {
    const own = context.styles.get(kind) ?? []
    for (let index = 0; index <= level; index++) style = mergedLevel(style, own[index])
  }
  return style
}

const paintOf = (colour: Colour | undefined, scheme: readonly Paint[]) => (colour ? ('paint' in colour ? colour.paint : scheme[colour.scheme]) : undefined)

/** A space before or after a paragraph, or between its lines: a share of a line when positive, master units when not, in points. */
const spacing = (value: number | undefined, size: number) => (value === undefined ? undefined : value >= 0 ? (value / 100) * size * 1.2 : -value / 8)

/** A text in its shape: its paragraphs, each in its level's style under its own runs, numbered or bulleted. */
function textFrame(block: TextBlock, context: TextContext, shape: Shape, numbering: { scheme: string; start: number }[]): TextFrame {
  const { deck, scheme } = context
  const text = block.text
  // Fields are written as the slide shows them: its number, and nothing for a date.
  const fields = new Map(block.fields.map((field) => [field.at, field.kind]))
  const shown = (from: number, to: number) => {
    let written = ''
    for (let index = from; index < to; index++) {
      const field = fields.get(index)
      written += field === undefined ? (text[index] ?? '') : field === 'number' ? String(context.number) : ''
    }
    return written
  }
  const runs = readStyleRuns(deck.bytes, block.style, text.length)
  const ruler = readRuler(deck.bytes, block.ruler)
  const runAt = <Run extends { count: number }>(list: readonly Run[], position: number): Run | undefined => {
    let covered = 0
    for (const run of list) {
      covered += run.count
      if (position < covered) return run
    }
    return list.at(-1)
  }
  // Where each run of characters ends.
  const breaks: number[] = []
  let covered = 0
  for (const run of runs.characters) {
    covered += run.count
    breaks.push(covered)
  }
  const counters = new Map<number, number>()
  const paragraphs: TextParagraph[] = []
  let start = 0
  for (const line of text.split('\r')) {
    const paragraphRun = runAt(runs.paragraphs, start)
    const level = paragraphRun?.level ?? 0
    const style = levelStyle(context, block.kind, level)
    const paragraph: ParagraphLook = { ...style.paragraph, ...defined(paragraphRun?.look ?? {}) }
    const margins = ruler[level]
    const leftMargin = paragraphRun?.look.leftMargin ?? margins?.leftMargin ?? paragraph.leftMargin ?? 0
    const indent = paragraphRun?.look.indent ?? margins?.indent ?? paragraph.indent ?? 0
    // The paragraph's runs, cut where its characters' style changes and where a line breaks.
    const pieces: TextPiece[] = []
    let firstRun: CharacterLook | undefined
    let firstSize: number | undefined
    const end = start + line.length
    for (let position = start; position < end; ) {
      const run = runAt(runs.characters, position)
      const look: CharacterLook = { ...style.character, ...defined(run?.look ?? {}) }
      const until = Math.min(end, breaks.find((one) => one > position) ?? end)
      firstRun ??= look
      for (const [index, part] of shown(position, until).split('\v').entries()) {
        if (index > 0) pieces.push('break')
        if (part === '') continue
        const size = look.size ?? 18
        firstSize ??= size
        const runStyle: RunStyle = {
          size,
          bold: look.bold,
          italic: look.italic,
          underline: look.underline,
          paint: paintOf(look.colour, scheme),
          font: look.font === undefined ? undefined : deck.fonts[look.font]
        }
        pieces.push({ text: part, style: runStyle })
      }
      position = until
    }
    const size = firstSize ?? style.character.size ?? 18
    let bullet: TextBullet | undefined
    if (paragraph.hasBullet && pieces.some((piece) => piece !== 'break')) {
      const numbered = numbering[firstRun?.extension ?? 0]
      const paint = (paragraph.bulletHasColour ? paintOf(paragraph.bulletColour, scheme) : undefined) ?? paintOf(firstRun?.colour, scheme)
      const width = leftMargin > indent ? (leftMargin - indent) / MASTER_UNITS : undefined
      const share =
        paragraph.bulletHasSize && paragraph.bulletSize ? (paragraph.bulletSize > 0 ? paragraph.bulletSize / 100 : -paragraph.bulletSize / size) : undefined
      if (numbered?.scheme) {
        const count = (counters.get(level) ?? numbered.start - 1) + 1
        counters.set(level, count)
        bullet = { mark: listNumber(numbered.scheme, count), paint, width }
      } else {
        const raw = String.fromCharCode(paragraph.bulletCharacter || 0x2022)
        const named = paragraph.bulletHasFont && paragraph.bulletFont !== undefined ? deck.fonts[paragraph.bulletFont] : undefined
        const known = bulletCharacter(raw)
        // A character of a font of symbols the window may not have is the bullet it stands for, or a plain one.
        const symbols = named !== undefined && /wingdings|webdings|symbol|sorts|dingbats/i.test(named)
        const mark = known !== raw ? known : symbols ? '•' : raw
        bullet = { mark, paint, width, font: mark === raw ? named : undefined, size: share }
      }
      for (const deeper of [...counters.keys()]) if (deeper > level) counters.delete(deeper)
    } else counters.delete(level)
    const align = paragraph.align ?? 0
    const lineSpacing = paragraph.lineSpacing ?? 100
    paragraphs.push({
      align: align === 1 ? 'center' : align === 2 ? 'right' : align >= 3 ? 'justify' : 'left',
      size,
      lineSpacing: lineSpacing >= 0 ? Math.max(0.5, lineSpacing / 100) : undefined,
      lineHeight: lineSpacing < 0 ? -lineSpacing / 8 : undefined,
      marginLeft: leftMargin / MASTER_UNITS,
      indent: (indent - leftMargin) / MASTER_UNITS,
      spaceBefore: spacing(paragraph.spaceBefore, size),
      spaceAfter: spacing(paragraph.spaceAfter, size),
      bullet,
      pieces
    })
    start = end + 1
  }
  const { values } = shape.properties
  const inset = (property: number, fallback: number) => (values.get(property) ?? fallback) / EMU_PER_PIXEL
  const anchor = values.get(0x0087) ?? 0
  const base = levelStyle(context, block.kind, 0)
  return {
    paragraphs,
    insets: { left: inset(0x0081, 91_440), top: inset(0x0082, 45_720), right: inset(0x0083, 91_440), bottom: inset(0x0084, 45_720) },
    anchor: anchor === 1 || anchor === 4 ? 'middle' : anchor === 2 || anchor === 5 || anchor === 7 || anchor === 9 ? 'bottom' : 'top',
    wraps: values.get(0x0085) !== 2,
    font: deck.fonts[base.character.font ?? 0] ?? '',
    paint: paintOf(base.character.colour, scheme) ?? scheme[1]
  }
}

// Shapes

/** The common kinds of shape by their number in OfficeArt, as DrawingML names them. */
const KINDS: Record<number, string> = {
  1: 'rect',
  2: 'roundRect',
  3: 'ellipse',
  4: 'diamond',
  5: 'triangle',
  6: 'rtTriangle',
  7: 'parallelogram',
  9: 'hexagon',
  10: 'octagon',
  11: 'plus',
  12: 'star5',
  13: 'rightArrow',
  14: 'rightArrow',
  15: 'homePlate',
  17: 'roundRect',
  20: 'line',
  23: 'donut',
  32: 'line',
  33: 'line',
  34: 'line',
  35: 'line',
  36: 'line',
  37: 'line',
  38: 'line',
  39: 'line',
  40: 'line',
  55: 'chevron',
  56: 'pentagon',
  58: 'star8',
  59: 'star16',
  60: 'star32',
  62: 'roundRect',
  63: 'ellipse',
  66: 'leftArrow',
  92: 'star24',
  110: 'diamond',
  111: 'parallelogram',
  116: 'flowChartTerminator',
  120: 'ellipse',
  124: 'ellipse',
  127: 'triangle',
  128: 'flowChartMerge',
  176: 'roundRect',
  187: 'star4'
}

/** A shape of one of the common kinds in its box, its adjustments (in 21,600ths of its box) turned into DrawingML's. */
function kindPath(kind: number, width: number, height: number, adjust: (index: number, fallback: number) => number): ShapePath {
  const shortest = Math.min(width, height) || 1
  const share = (index: number, fallback: number) => adjust(index, fallback) / 21_600
  const name = KINDS[kind] ?? 'rect'
  if (kind === 8) {
    // PowerPoint's trapezoid is wide at its top.
    const offset = width * share(0, 5400)
    return {
      data: polygon([
        [0, 0],
        [width, 0],
        [width - offset, height],
        [offset, height]
      ]),
      closed: true
    }
  }
  const adjustment = (adjustName: string, fallback: number): number => {
    switch (kind) {
      case 2:
      case 17:
      case 62:
      case 176:
        return share(0, 3600)
      case 5:
      case 127:
        return share(0, 10_800)
      case 7:
      case 111:
      case 9:
        return (width * share(0, 5400)) / shortest
      case 10:
        return share(0, 6326)
      case 11:
      case 23:
        return share(0, 5400)
      case 13:
      case 14:
        return adjustName === 'adj2' ? (width * (1 - share(0, 16_200))) / shortest : 2 * (0.5 - share(1, 5400))
      case 66:
        return adjustName === 'adj2' ? (width * share(0, 5400)) / shortest : 2 * (0.5 - share(1, 5400))
      case 15:
      case 55:
        return (width * (1 - share(0, 16_200))) / shortest
      default:
        return fallback
    }
  }
  return presetPath(name, width, height, adjustment)
}

/** A shape's own path, from its vertices, its segments and the guides they name, in its view box. */
function vertexGeometry(shape: Shape, values: (property: number) => number | undefined, size: { width: number; height: number }) {
  const vertices = shape.properties.complex.get(0x0145)
  if (!vertices || vertices.length < 6) return undefined
  const data = view(vertices)
  const left = (values(0x0140) ?? 0) | 0
  const top = (values(0x0141) ?? 0) | 0
  const right = (values(0x0142) ?? 21_600) | 0
  const bottom = (values(0x0143) ?? 21_600) | 0
  const guides = guideValues(shape.properties.complex.get(0x0156), values, { left, top, right, bottom })
  const count = data.getUint16(0, true)
  const kept = data.getUint16(4, true)
  const size8 = kept === 8
  const elementSize = kept === 0xfff0 ? 4 : kept
  const points: [number, number][] = []
  const coordinate = (raw: number) => (raw >>> 16 === 0x8000 ? (guides[raw & 0xffff] ?? 0) : raw)
  for (let index = 0; index < count && 6 + (index + 1) * elementSize <= vertices.length; index++) {
    const at = 6 + index * elementSize
    if (size8) points.push([coordinate(data.getInt32(at, true)), coordinate(data.getInt32(at + 4, true))])
    else if (elementSize === 4) points.push([data.getInt16(at, true), data.getInt16(at + 2, true)])
    else return undefined
  }
  const commands = pathCommands(shape.properties.complex.get(0x0146), points, values(0x0144))
  return customGeometry(commands, { left, top, width: right - left, height: bottom - top }, size)
}

/** A shape's segments (`MSOPATHINFO`) as commands taking its vertices in order; lines through them all when it has none. */
function pathCommands(segments: Uint8Array | undefined, points: readonly [number, number][], kind: number | undefined): PathCommand[] {
  const commands: PathCommand[] = []
  let next = 0
  const take = (count: number) => {
    const values = points.slice(next, next + count).flat()
    next += count
    return values
  }
  if (!segments || segments.length < 6) {
    if (points.length === 0) return commands
    const curves = kind === 2 || kind === 3
    commands.push({ command: 'M', values: take(1) })
    commands.push({ command: curves ? 'C' : 'L', values: take(points.length - 1) })
    if (kind !== 0 && kind !== 2) commands.push({ command: 'Z', values: [] })
    return commands
  }
  const data = view(segments)
  const count = data.getUint16(0, true)
  const size = data.getUint16(4, true) === 4 ? 4 : 2
  const ESCAPES: Record<number, [string, number]> = {
    0: ['L', 1],
    1: ['T', 1],
    2: ['U', 1],
    3: ['A', 1],
    4: ['B', 1],
    5: ['W', 1],
    6: ['V', 1],
    7: ['X', 1],
    8: ['Y', 1],
    9: ['Q', 1],
    10: ['F', 0],
    11: ['S', 0]
  }
  for (let index = 0; index < count && 6 + (index + 1) * size <= segments.length; index++) {
    const segment = data.getUint16(6 + index * size, true)
    const many = segment & 0x1fff
    switch (segment >> 13) {
      case 0:
        commands.push({ command: 'L', values: take(many || 1) })
        break
      case 1:
        commands.push({ command: 'C', values: take(3 * (many || 1)) })
        break
      case 2:
        commands.push({ command: 'M', values: take(many || 1) })
        break
      case 3:
        commands.push({ command: 'Z', values: [] })
        break
      case 4:
        commands.push({ command: 'N', values: [] })
        break
      default: {
        const escaped = ESCAPES[(segment >> 8) & 0x1f]
        if (!escaped) break
        const [command, takes] = escaped
        const values = takes ? take(segment & 0xff || (command === 'L' ? 1 : 0)) : []
        // Angles of an ellipse are in degrees, or in 16.16 when they are larger than a turn could be.
        if (command === 'T' || command === 'U')
          for (let at = 4; at < values.length; at += 6)
            for (const offset of [0, 1]) if (Math.abs(values[at + offset] as number) > 720) values[at + offset] = (values[at + offset] as number) / FIXED
        commands.push({ command, values })
      }
    }
  }
  return commands
}

/** A shape's guides (`MSOSG`): each a formula of up to three numbers, other guides, adjustments or its view box. */
function guideValues(guides: Uint8Array | undefined, values: (property: number) => number | undefined, box: Rectangle): number[] {
  const results: number[] = []
  if (!guides || guides.length < 6) return results
  const data = view(guides)
  const count = Math.min(data.getUint16(0, true), 128)
  const reference = (parameter: number): number => {
    if (parameter >= 0x0400 && parameter < 0x0480) return results[parameter - 0x0400] ?? 0
    if (parameter >= 0x0147 && parameter <= 0x0150) return values(parameter) ?? 0
    switch (parameter) {
      case 0x0140:
        return box.left
      case 0x0141:
        return box.top
      case 0x0142:
        return box.right
      case 0x0143:
        return box.bottom
      case 0x04f8:
        return (box.left + box.right) / 2
      case 0x04f9:
        return (box.top + box.bottom) / 2
      case 0x04fa:
      case 0x0504:
        return box.right - box.left
      case 0x04fb:
      case 0x0505:
        return box.bottom - box.top
      default:
        return 0
    }
  }
  const angle = (fixed: number) => ((fixed / FIXED) * Math.PI) / 180
  for (let index = 0; index < count && 6 + (index + 1) * 8 <= guides.length; index++) {
    const at = 6 + index * 8
    const flags = data.getUint16(at, true)
    const [a, b, c] = [0, 1, 2].map((place) => {
      const raw = data.getInt16(at + 2 + place * 2, true)
      return flags & (0x2000 << place) ? reference(raw & 0xffff) : raw
    }) as [number, number, number]
    let value = 0
    switch (flags & 0x1fff) {
      case 0:
        value = a + b - c
        break
      case 1:
        value = c === 0 ? 0 : (a * b) / c
        break
      case 2:
        value = (a + b) / 2
        break
      case 3:
        value = Math.abs(a)
        break
      case 4:
        value = Math.min(a, b)
        break
      case 5:
        value = Math.max(a, b)
        break
      case 6:
        value = a > 0 ? b : c
        break
      case 7:
        value = Math.hypot(a, b, c)
        break
      case 8:
        value = ((Math.atan2(b, a) * 180) / Math.PI) * FIXED
        break
      case 9:
        value = a * Math.sin(angle(b))
        break
      case 10:
        value = a * Math.cos(angle(b))
        break
      case 11:
        value = a * Math.cos(Math.atan2(c, b))
        break
      case 12:
        value = a * Math.sin(Math.atan2(c, b))
        break
      case 13:
        value = Math.sqrt(Math.max(0, a))
        break
      case 14:
        value = a + b * FIXED - c * FIXED
        break
      case 15:
        value = b === 0 ? 0 : c * Math.sqrt(Math.max(0, 1 - (a / b) ** 2))
        break
      case 16:
        value = a * Math.tan(angle(b))
        break
    }
    results.push(Number.isFinite(value) ? value : 0)
  }
  return results
}

// Drawing

/** What a slide is drawn with, beyond its deck: its scheme, its master's styles and shapes, and what it has drawn. */
interface SlideContext extends TextContext {
  masterShapes: Map<number, Shape>
  slidePersist: number
  canvas: Canvas
  shapes: number
  pictureBytes: number
}

/** How a group's units map to pixels: where its box is, and how many pixels a unit is. */
interface Mapping {
  x: (value: number) => number
  y: (value: number) => number
  scaleX: number
  scaleY: number
}

const SLIDE_MAPPING: Mapping = { x: (value) => value / MASTER_UNITS, y: (value) => value / MASTER_UNITS, scaleX: 1 / MASTER_UNITS, scaleY: 1 / MASTER_UNITS }

/** A shape's box in pixels: its anchor through its group's mapping, turned and turned over as its properties say. */
function boxOf(shape: Shape, bytes: Uint8Array, mapping: Mapping): Box | undefined {
  const rectangle = shape.childAnchor ? groupRectangle(bytes, shape.childAnchor) : shape.anchor ? clientRectangle(bytes, shape.anchor) : undefined
  if (!rectangle) return undefined
  let x = mapping.x(Math.min(rectangle.left, rectangle.right))
  let y = mapping.y(Math.min(rectangle.top, rectangle.bottom))
  let width = Math.abs(rectangle.right - rectangle.left) * mapping.scaleX
  let height = Math.abs(rectangle.bottom - rectangle.top) * mapping.scaleY
  const rotation = (((shape.properties.values.get(0x0004) ?? 0) | 0) / FIXED) % 360
  const turned = (rotation + 360) % 360
  // A shape turned nearer upright than flat keeps its anchor turned with it: its box is that one turned back.
  if ((turned > 45 && turned <= 135) || (turned > 225 && turned <= 315)) {
    const centreX = x + width / 2
    const centreY = y + height / 2
    ;[width, height] = [height, width]
    x = centreX - width / 2
    y = centreY - height / 2
  }
  return { x, y, width, height, rotation, flipH: (shape.flags & SHAPE_FLAG.flipH) !== 0, flipV: (shape.flags & SHAPE_FLAG.flipV) !== 0 }
}

/** A property of a shape: its own, its master shape's, then the presentation's default. */
function propertyOf(shape: Shape, context: SlideContext, property: number, withDefaults = true): number | undefined {
  const master = context.masterShapes.get(shape.properties.values.get(0x0301) ?? -1)
  return (
    shape.properties.values.get(property) ??
    master?.properties.values.get(property) ??
    (withDefaults ? context.deck.shapeDefaults.values.get(property) : undefined)
  )
}

/** A flag of a shape: its own, its master shape's, the presentation's default, then the fallback. */
function flag(shape: Shape, context: SlideContext, property: number, bit: number, fallback: boolean, withDefaults = true): boolean {
  const master = context.masterShapes.get(shape.properties.values.get(0x0301) ?? -1)
  return (
    flagOf(shape.properties.values.get(property), bit) ??
    flagOf(master?.properties.values.get(property), bit) ??
    (withDefaults ? flagOf(context.deck.shapeDefaults.values.get(property), bit) : undefined) ??
    fallback
  )
}

/** A colour property of a shape, with its opacity. */
function colourOf(shape: Shape, context: SlideContext, property: number, fallback: number, opacityProperty?: number): Paint | undefined {
  const resolve = (which: number, depth: number): Paint | undefined =>
    artColour(propertyOf(shape, context, which) ?? (which === property ? fallback : 0xffffff), context.scheme, (other) => resolve(other, depth + 1), depth)
  const paint = resolve(property, 0)
  if (!paint) return undefined
  const opacity = opacityProperty === undefined ? undefined : propertyOf(shape, context, opacityProperty)
  return opacity === undefined ? paint : { ...paint, opacity: Math.min(1, Math.max(0, opacity / FIXED)) }
}

/** A picture of the presentation's store as an address of data the SVG holds, drawn when it is a metafile. */
async function pictureAddress(place: number, context: SlideContext): Promise<string | undefined> {
  const { deck } = context
  let address = deck.addresses.get(place)
  if (!address) {
    address = (async () => {
      const picture = deck.pictures(place)
      if (picture?.bytes) {
        const type = pictureType(picture.bytes)
        return type ? `data:${type};base64,${base64(picture.bytes)}` : undefined
      }
      const metafile = picture?.metafile
      if (!metafile || metafile.size > PICTURE_LIMIT) return undefined
      const bytes = metafile.packed ? await unpack(metafile.bytes, 'deflate', metafile.size) : metafile.bytes
      const drawn = drawMetafile(bytes, metafile.hint)
      return drawn ? `data:image/svg+xml;base64,${base64(drawn.svg)}` : undefined
    })().catch(() => undefined)
    deck.addresses.set(place, address)
  }
  const found = await address
  if (!found || context.pictureBytes + found.length > PICTURE_LIMIT) return undefined
  context.pictureBytes += found.length
  return found
}

/** A shape's fill: a colour, a gradient between its two colours, or a picture; none when it is not filled. */
async function fillOf(shape: Shape, context: SlideContext, placeholder: boolean, background: Fill | undefined): Promise<Fill | undefined> {
  const kind = shape.kind
  const unfilledByDefault = placeholder || kind === 20 || (kind >= 32 && kind <= 40) || kind === 75 || kind === 202
  // The presentation's defaults are for shapes filled by default: a line, a picture or a placeholder is filled only when it says so.
  if (!flag(shape, context, 0x01bf, 4, !unfilledByDefault, !unfilledByDefault)) return { kind: 'none' }
  const type = propertyOf(shape, context, 0x0180) ?? 0
  const first = colourOf(shape, context, 0x0181, 0xffffff, 0x0182)
  const second = colourOf(shape, context, 0x0183, 0xffffff, 0x0184)
  if (type === 9) return background
  if (type === 2 || type === 3) {
    const place = propertyOf(shape, context, 0x0186)
    const href = place ? await pictureAddress(place, context) : undefined
    if (href) return { kind: 'picture', href, crop: undefined }
  }
  if (!first) return undefined
  if (type === 1 && second)
    // A pattern is drawn as the colour its two make together.
    return {
      kind: 'paint',
      paint: { red: (first.red + second.red) / 2, green: (first.green + second.green) / 2, blue: (first.blue + second.blue) / 2, opacity: first.opacity }
    }
  if (type >= 4 && type <= 8 && second) {
    const focus = ((propertyOf(shape, context, 0x018c) ?? 0) | 0) % 101
    const [one, other] = focus < 0 ? [second, first] : [first, second]
    const reach = Math.abs(focus)
    if (type === 5 || type === 6) {
      const to = (property: number) => ((propertyOf(shape, context, property) ?? 0) | 0) / FIXED
      const centre = type === 6 ? { x: 0.5, y: 0.5 } : { x: (to(0x018d) + to(0x018f)) / 2, y: (to(0x018e) + to(0x0190)) / 2 }
      const stops =
        reach >= 100
          ? [
              { offset: 0, paint: one },
              { offset: 1, paint: other }
            ]
          : [
              { offset: 0, paint: other },
              { offset: 1, paint: one }
            ]
      return { kind: 'gradient', stops, angle: 0, radial: true, centre }
    }
    // A shade goes along its angle, the first colour where the focus puts it and the second at the ends.
    const turn = ((((propertyOf(shape, context, 0x018b) ?? 0) | 0) / FIXED) * Math.PI) / 180
    const angle = (Math.atan2(-Math.cos(turn), -Math.sin(turn)) * 180) / Math.PI
    const stops =
      reach >= 100
        ? [
            { offset: 0, paint: other },
            { offset: 1, paint: one }
          ]
        : reach <= 0
          ? [
              { offset: 0, paint: one },
              { offset: 1, paint: other }
            ]
          : [
              { offset: 0, paint: other },
              { offset: reach / 100, paint: one },
              { offset: 1, paint: other }
            ]
    return { kind: 'gradient', stops, angle, radial: false }
  }
  return { kind: 'paint', paint: first }
}

/** The dashes of OfficeArt's lines by their number, in widths of the line. */
const DASHES: Record<number, number[]> = {
  1: [3, 1],
  2: [1, 1],
  3: [3, 1, 1, 1],
  4: [3, 1, 1, 1, 1, 1],
  5: [1, 3],
  6: [4, 3],
  7: [8, 3],
  8: [4, 3, 1, 3],
  9: [8, 3, 1, 3],
  10: [8, 3, 1, 3, 1, 3]
}

function outlineOf(shape: Shape, context: SlideContext, placeholder: boolean): Outline | undefined {
  const unlinedByDefault = placeholder || shape.kind === 75 || shape.kind === 202
  if (!flag(shape, context, 0x01ff, 3, !unlinedByDefault, !unlinedByDefault)) return undefined
  const paint = colourOf(shape, context, 0x01c0, 0x000000, 0x01c1)
  const width = Math.max(0.5, (propertyOf(shape, context, 0x01cb) ?? 9525) / EMU_PER_PIXEL)
  const dash = DASHES[propertyOf(shape, context, 0x01ce) ?? 0]
  return { paint, width, dashes: dash?.map((part) => number(part * width)).join(' ') }
}

/** Whether a shape is hidden, or is no shape a slide shows. */
const hidden = (shape: Shape) => (shape.flags & (SHAPE_FLAG.deleted | SHAPE_FLAG.background)) !== 0 || flagOf(shape.properties.values.get(0x03bf), 1) === true

/** The placeholder a shape is, by its client data (`OEPlaceholderAtom`): its place's kind; none when it is no placeholder. */
function placeholderOf(bytes: Uint8Array, shape: Shape): number | undefined {
  const atom = shape.client && childOf(bytes, shape.client, RECORD.placeholder)
  return atom && atom.size >= 5 ? (bytes[atom.at + 4] ?? 0) : undefined
}

/** A group's shapes (an `SpgrContainer`), its first record being the group itself; the slide's own group maps to the slide. */
async function drawGroup(container: ArtRecord, context: SlideContext, mapping: Mapping, isMaster: boolean, depth: number): Promise<void> {
  const { bytes } = context.deck
  let first = true
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (context.shapes >= SHAPE_LIMIT) return
    if (first && record.type === ART.shape) {
      first = false
      continue
    }
    first = false
    try {
      if (record.type === ART.shape) await drawShape(readShape(bytes, record), context, mapping, isMaster)
      else if (record.type === ART.group && depth < GROUP_DEPTH_LIMIT) await drawNestedGroup(record, context, mapping, isMaster, depth + 1)
    } catch {
      // A shape that cannot be read is left out of the drawing.
    }
  }
}

/** A group within the slide's: its shapes mapped from its own units to its box, turned and turned over with it. */
async function drawNestedGroup(container: ArtRecord, context: SlideContext, mapping: Mapping, isMaster: boolean, depth: number): Promise<void> {
  const { bytes } = context.deck
  const [head] = artRecords(bytes, container.at, container.at + container.size)
  if (head?.type !== ART.shape) return
  const group = readShape(bytes, head)
  if (hidden(group)) return
  context.shapes++
  const box = boxOf(group, bytes, mapping)
  const space = groupRectangle(bytes, group.groupSpace)
  if (!box || !space) return drawGroup(container, context, mapping, isMaster, depth)
  const spaceWidth = space.right - space.left || 1
  const spaceHeight = space.bottom - space.top || 1
  const inner: Mapping = {
    x: (value) => box.x + ((value - space.left) * box.width) / spaceWidth,
    y: (value) => box.y + ((value - space.top) * box.height) / spaceHeight,
    scaleX: box.width / spaceWidth,
    scaleY: box.height / spaceHeight
  }
  const centreX = box.x + box.width / 2
  const centreY = box.y + box.height / 2
  const turns = [
    box.rotation ? `rotate(${number(box.rotation)} ${number(centreX)} ${number(centreY)})` : '',
    box.flipH || box.flipV
      ? `translate(${number(centreX)} ${number(centreY)}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1}) translate(${number(-centreX)} ${number(-centreY)})`
      : ''
  ]
    .filter(Boolean)
    .join(' ')
  if (turns) context.canvas.parts.push(`<g transform="${turns}">`)
  await drawGroup(container, context, inner, isMaster, depth)
  if (turns) context.canvas.parts.push('</g>')
}

async function drawShape(shape: Shape, context: SlideContext, mapping: Mapping, isMaster: boolean): Promise<void> {
  const { bytes } = context.deck
  if (hidden(shape)) return
  const placeholder = placeholderOf(bytes, shape)
  // A master's placeholders are its slides' to fill.
  if (isMaster && placeholder !== undefined) return
  context.shapes++
  const box = boxOf(shape, bytes, mapping)
  if (!box) return
  const size = { width: box.width, height: box.height }
  const content: string[] = []
  const isPlaceholder = placeholder !== undefined

  const fill = await fillOf(shape, context, isPlaceholder, undefined)
  const outline = outlineOf(shape, context, isPlaceholder)
  const values = (property: number) => propertyOf(shape, context, property)
  const custom = vertexGeometry(shape, values, size)
  if (custom) content.push(customElement(custom, fill, outline, context.canvas, size))
  else {
    const path = kindPath(shape.kind, size.width, size.height, (index, fallback) => (values(0x0147 + index) ?? fallback) | 0)
    content.push(shapeElement(path, fill, outline, context.canvas, size))
  }

  // A picture, cropped as the shape crops it, over its fill; an object of another app whose picture cannot be shown
  // draws the chart it holds, when it holds one.
  const place = shape.properties.values.get(0x0104)
  const href = place ? await pictureAddress(place, context) : undefined
  const crop = (property: number) => ((values(property) ?? 0) | 0) / FIXED
  if (href) content.push(pictureElement(href, { top: crop(0x0100), bottom: crop(0x0101), left: crop(0x0102), right: crop(0x0103) }, size))
  else if (shape.flags & SHAPE_FLAG.object) {
    const chart = await context.deck.chart(shape.client).catch(() => undefined)
    const tones = [4, 5, 6, 7, 3, 2].flatMap((index) => (context.scheme[index] ? [css(context.scheme[index])] : []))
    if (chart) content.push(chartElements(chart, size, { tones, font: context.deck.fonts[0] ?? '' }))
  }

  // Its text: its own, or the one the list of slides keeps for it.
  const records = shape.textBox ? [...artRecords(bytes, shape.textBox.at, shape.textBox.at + shape.textBox.size)] : []
  const reference = records.find((record) => record.type === RECORD.outlineReference)
  const kept = reference && reference.size >= 4 ? context.deck.texts.get(context.slidePersist)?.[view(bytes).getInt32(reference.at, true)] : undefined
  const block = textBlock(bytes, kept ?? records)
  if (block && block.text.replace(/[\r\v\s]/g, '') !== '') {
    const frame = textFrame(block, context, shape, numberedLists(bytes, shape.client))
    content.push(textHtml(frame, size))
  }
  const drawn = content.filter(Boolean)
  if (drawn.length > 0) context.canvas.parts.push(`<g transform="${placed(box)}">${drawn.join('')}</g>`)
}

/** The drawing of a slide or master (`PPDrawing`): its shapes' group, and its background shape. */
function drawingOf(bytes: Uint8Array, container: ArtRecord): { group?: ArtRecord | undefined; background?: Shape | undefined } {
  const drawing = childOf(bytes, container, RECORD.drawing)
  const art = drawing && childOf(bytes, drawing, ART.drawing)
  if (!art) return {}
  let group: ArtRecord | undefined
  let background: Shape | undefined
  for (const record of artRecords(bytes, art.at, art.at + art.size)) {
    if (record.type === ART.group) group ??= record
    else if (record.type === ART.shape) {
      const shape = readShape(bytes, record)
      if (shape.flags & SHAPE_FLAG.background) background = shape
    }
  }
  return { group, background }
}

/** Every shape of a drawing by its number, groups' shapes included, for the placeholders of slides that name them. */
function shapesById(bytes: Uint8Array, group: ArtRecord | undefined, into = new Map<number, Shape>(), depth = 0): Map<number, Shape> {
  if (!group) return into
  for (const record of artRecords(bytes, group.at, group.at + group.size)) {
    if (record.type === ART.shape) {
      const shape = readShape(bytes, record)
      into.set(shape.id, shape)
    } else if (record.type === ART.group && depth < GROUP_DEPTH_LIMIT) shapesById(bytes, record, into, depth + 1)
  }
  return into
}

/** A slide's atom (`SlideAtom`): the master it follows, and whether it takes its shapes, scheme and background. */
function slideAtom(bytes: Uint8Array, container: ArtRecord): { master: number; objects: boolean; scheme: boolean; background: boolean } {
  const atom = childOf(bytes, container, RECORD.slideAtom)
  if (!atom || atom.size < 22) return { master: 0, objects: true, scheme: true, background: true }
  const data = view(bytes)
  const flags = data.getUint16(atom.at + 20, true)
  return { master: data.getUint32(atom.at + 12, true), objects: (flags & 1) !== 0, scheme: (flags & 2) !== 0, background: (flags & 4) !== 0 }
}

/** The default scheme, as PowerPoint 97 gives a new presentation. */
const DEFAULT_SCHEME: Paint[] = [0xffffff, 0x000000, 0x808080, 0x000000, 0x00cc99, 0x3333cc, 0xccccff, 0xb2b2b2].map((value) => ({
  red: (value >> 16) & 0xff,
  green: (value >> 8) & 0xff,
  blue: value & 0xff,
  opacity: 1
}))

/**
 * A slide of a PowerPoint 97 to 2003 presentation drawn as SVG, at the size of the presentation's slides: `slide`
 * its container, `persisted` its number in the directory of objects, `place` its number in the show.
 */
export async function drawOlderSlide(deck: OlderDeck, slide: ArtRecord, persisted: number, place: number): Promise<DrawnSlide | undefined> {
  const { bytes } = deck
  if (slide.type !== RECORD.slide) return undefined
  const atom = slideAtom(bytes, slide)
  const master = deck.masters.get(atom.master)
  // A title master follows a main master of its own, whose styles of text it takes.
  const mainMaster = master?.type === RECORD.slide ? deck.masters.get(slideAtom(bytes, master).master) : master
  const scheme = (atom.scheme ? undefined : schemeOf(bytes, slide)) ?? schemeOf(bytes, master) ?? schemeOf(bytes, mainMaster) ?? DEFAULT_SCHEME
  const masterDrawing = master ? drawingOf(bytes, master) : {}
  const context: SlideContext = {
    deck,
    scheme,
    styles: masterStyles(bytes, mainMaster),
    number: place,
    masterShapes: shapesById(bytes, masterDrawing.group),
    slidePersist: persisted,
    canvas: new Canvas(),
    shapes: 0,
    pictureBytes: 0
  }
  const own = drawingOf(bytes, slide)
  const size = { width: deck.width, height: deck.height }

  // The background: the slide's own, or its master's, filled as any shape is, the scheme's background colour by default.
  const backgroundShape = atom.background ? (masterDrawing.background ?? (mainMaster ? drawingOf(bytes, mainMaster).background : undefined)) : own.background
  let ground: Fill | undefined
  if (backgroundShape) {
    if (!backgroundShape.properties.values.has(0x0181)) backgroundShape.properties.values.set(0x0181, 0x08000000)
    ground = await fillOf(backgroundShape, context, false, undefined).catch(() => undefined)
  }
  if (!ground || ground.kind === 'none') ground = { kind: 'paint', paint: scheme[0] ?? { red: 255, green: 255, blue: 255, opacity: 1 } }
  context.canvas.parts.push(`<rect width="${number(size.width)}" height="${number(size.height)}" ${fillAttribute(ground, context.canvas, size)}/>`)

  if (atom.objects && masterDrawing.group) await drawGroup(masterDrawing.group, context, SLIDE_MAPPING, true, 0)
  if (own.group) await drawGroup(own.group, context, SLIDE_MAPPING, false, 0)
  return slideSvg(size.width, size.height, context.canvas)
}
