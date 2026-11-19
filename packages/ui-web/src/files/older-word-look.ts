/**
 * A Word document of 97 to 2003, of Word 6 and 95, or of Word 2, as it looks (docs/SPEC.md, section 9.7), read into
 * `document-look.ts` from the binary records `binary-office.ts` finds: each paragraph and run in its style over the
 * ones it comes from, then its own properties (`sprm`s, an older version's written as Word 97's by
 * `older-word-properties.ts`) and those of the piece of text it is in; lists numbered and bulleted as their list and
 * its overrides say at each level, or as Word 6's automatic numbers say; tables with their columns, merged cells, row
 * heights, borders, padding and shading; pictures and charts in their line or floating; boxes of text where their
 * shapes are, alone or in a group, their paragraphs read from the boxes' own story; frames, paragraphs placed by their
 * own properties, as boxes the paragraph after them holds; sections with their pages' size, margins and columns,
 * their headers and footers (first, odd and even pages) with the page's number and the count of pages; footnotes at
 * their page's foot and endnotes at the end. Pages break where the Word of 97 to 2003 that saved the document last
 * broke them, when it left its cache of them; else where the text and its sections break them.
 */

import { codePageDecoder, leadsTwoBytes, type Reader, reader, type WordProperty, wordProperties } from './binary-records.ts'
import type {
  BorderLook,
  DocumentBlock,
  DocumentLook,
  DocumentPage,
  DocumentParagraph,
  DocumentSpan,
  DocumentTable,
  PageBand,
  ParagraphLook,
  PlacedFigure,
  Sides,
  TableCell,
  TabStop,
  TextBox,
  TextLook
} from './document-look.ts'
import { BLOCK_LIMIT } from './office-text.ts'
import {
  characterRun,
  type FormattedRun,
  formattedRuns,
  type Properties,
  paragraphRun,
  runAt,
  twoCharacters,
  type WordVersion,
  wordProperties97
} from './older-word-properties.ts'
import { isSymbolFont, listMark, symbolCharacter } from './word-look.ts'

/** Where a part of the file is, and how long it is. */
export interface WordPlace {
  at: number
  size: number
}

/**
 * A piece of the text: its characters' places in the text, where the file keeps them, in 8 bits or 16, and the
 * properties every character of it takes, in the table stream, or the one property of Word 6 a piece names itself
 * (its code, then its operand's one byte).
 */
export interface TextPiece {
  start: number
  end: number
  at: number
  narrow: boolean
  properties?: WordPlace | undefined
  property?: number | undefined
}

/** Where a shape floating over the text is, in points, what its place is measured from, and how text wraps around it. */
export interface FloatingAnchor {
  left: number
  top: number
  width: number
  height: number
  across: 'margin' | 'page' | 'column'
  down: 'margin' | 'page' | 'paragraph'
  /** Word's wrapping: 1 above and below it, 3 none (over or behind the text), the rest around it. */
  wrap: number
  /** The shape's identifier in the document's drawing. */
  shape?: number | undefined
}

/**
 * A box of text a floating shape is or holds: the shape it is, its place and size in points from the anchor's corner,
 * its fill, its line and the space inside its edges.
 */
export interface FloatingBox {
  shape: number
  left: number
  top: number
  width: number
  height: number
  fill: string | undefined
  line: { color: string; width: number } | undefined
  insets: { top: number; right: number; bottom: number; left: number }
}

/** The figures of the document, as `binary-office.ts` reads them: in the text by the place of their character, floating by their anchor. */
export interface WordFigures {
  inline(place: number, field: { object?: number | undefined; chart: boolean }): number | undefined
  object(place: number): number | undefined
  floating(character: number): number | undefined
  anchor(character: number): FloatingAnchor | undefined
  /** The boxes of text a shape anchored at a character is or holds. */
  boxes(character: number): FloatingBox[]
  /** The rule across the text a special character is, once its figure was asked for: its share of the width in thousandths, its height in points, its colour. */
  rule(place: number): { share: number; height: number; color: string | undefined } | undefined
  /** A figure's size in the text, in points. */
  size(figure: number): { width?: number | undefined; height?: number | undefined } | undefined
  /** The equation of Equation Editor or MathType an object holds, by the number of its storage, as linear text. */
  equation?(object: number | undefined): string | undefined
}

/**
 * The parts of a document its look reads, each where its header says: its styles, the references and texts of its
 * footnotes and endnotes, its sections, headers and footers, fonts, settings (`DOP`), and Word 97's lists, the
 * stories of its boxes of text, the main text's and the headers' (`PlcftxbxTxt`), and the cache of where the Word that
 * saved it last broke its pages.
 */
export type WordPart =
  | 'styles'
  | 'footnoteReferences'
  | 'footnoteTexts'
  | 'sections'
  | 'headers'
  | 'fonts'
  | 'settings'
  | 'endnoteReferences'
  | 'endnoteTexts'
  | 'lists'
  | 'listOverrides'
  | 'textBoxes'
  | 'headerTextBoxes'
  | 'pageBreaks'

/** A document's streams and the parts its header names, as `binary-office.ts` found them. */
export interface OlderWordFile {
  /** The version of Word whose records the document is written in: Word 97 to 2003, Word 6 and 95, or Word 2. */
  version: Exclude<WordVersion, 1>
  word: Reader
  /** The stream of its parts: the table stream of Word 97, the main stream itself before it. */
  table: Reader
  data: Reader | undefined
  part(name: WordPart): WordPlace
  /** The pages of runs (`FKP`) of characters and of paragraphs, by their numbers in the main stream. */
  runPages: { characters: readonly number[]; paragraphs: readonly number[] }
  /** The code page of the 8-bit text: Western European in Word 97, the document's language's before it. */
  codePage: number
  /** The length of each story, in characters: the text, its footnotes, headers, macros, comments, endnotes and boxes. */
  lengths: readonly number[]
  pieces: readonly TextPiece[]
  figures: WordFigures
  /** Past this many characters of the text, the rest is left out. */
  limit: number
}

const each = (source: Properties | undefined): Iterable<WordProperty> => (source ? wordProperties(source.bytes, source.at, source.end) : [])

// Colours

/** The sixteen colours Word 6 and 97 name by number; 0 is automatic. */
const ICO = [
  '000000',
  '0000ff',
  '00ffff',
  '00ff00',
  'ff00ff',
  'ff0000',
  'ffff00',
  'ffffff',
  '000080',
  '008080',
  '008000',
  '800080',
  '800000',
  '808000',
  '808080',
  'c0c0c0'
]
const icoColor = (ico: number): string | undefined => (ico >= 1 && ico <= 16 ? `#${ICO[ico - 1]}` : undefined)

/** A colour as Windows keeps it: red, green and blue, then 0xFF when it is automatic. */
function colorRef(bytes: Reader, at: number): string | undefined {
  if (bytes.u8(at + 3) === 0xff) return undefined
  return `#${[0, 1, 2]
    .map((index) =>
      bytes
        .u8(at + index)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** One colour over another by a share of it, as a pattern of dots looks from afar. */
function mixed(over: string, under: string, share: number): string {
  const part = (color: string, index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round(part(over, index) * share + part(under, index) * (1 - share))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The share of the foreground each of Word's patterns of shading shows, past clear (0) and solid (1). */
const PATTERN_SHARES: Record<number, number> = { 2: 0.05, 3: 0.1, 4: 0.2, 5: 0.25, 6: 0.3, 7: 0.4, 8: 0.5, 9: 0.6, 10: 0.7, 11: 0.75, 12: 0.8, 13: 0.9 }

/** A shading's colour: its background, its foreground, or the two mixed by its pattern. */
function shadingColor(fore: string | undefined, back: string | undefined, pattern: number): string | undefined {
  if (pattern === 0) return back
  if (pattern === 1) return fore ?? '#000000'
  const share = PATTERN_SHARES[pattern]
  return share === undefined ? back : mixed(fore ?? '#000000', back ?? '#ffffff', share)
}

/** A shading of Word 97 (`SHD80`): its colours by number and its pattern, in two bytes. */
function shading80(value: number): string | undefined {
  return shadingColor(icoColor(value & 0x1f), icoColor((value >> 5) & 0x1f), value >> 10)
}

/** A shading of Word 2000 and later (`SHD`): its colours in full and its pattern. */
function shading(bytes: Reader, at: number): string | undefined {
  return shadingColor(colorRef(bytes, at), colorRef(bytes, at + 4), bytes.u16(at + 8))
}

// Borders

/** A border as the file writes it: its kind, its width in eighths of a point, its colour. */
interface Border {
  type: number
  eighths: number
  color: string | undefined
}

/** A border of Word 97 (`BRC80`), in four bytes; all of them set is none at all. */
function border80(bytes: Reader, at: number): Border | undefined {
  if (bytes.u32(at) === 0xffffffff) return undefined
  return { eighths: bytes.u8(at), type: bytes.u8(at + 1), color: icoColor(bytes.u8(at + 2)) }
}

/** A border of Word 2000 and later (`BRC`), in eight bytes, its colour in full. */
function border(bytes: Reader, at: number): Border | undefined {
  if (bytes.u32(at + 4) === 0xffffffff) return undefined
  return { color: colorRef(bytes, at), eighths: bytes.u8(at + 4), type: bytes.u8(at + 5) }
}

/** A border's look: its kinds of line as one of the look's, a double line as wide as its two lines and the space between them. */
function borderLook(found: Border | undefined): BorderLook | undefined {
  if (!found || found.type === 0 || found.type === 0xff) return undefined
  const width = found.type === 5 ? 0.25 : Math.min(Math.max(found.eighths / 8, 0.25), 6)
  const style =
    found.type === 3 || found.type === 10 || (found.type >= 11 && found.type <= 21)
      ? 'double'
      : found.type === 6
        ? 'dotted'
        : [7, 8, 9, 22, 23].includes(found.type)
          ? 'dashed'
          : 'solid'
  return { width: style === 'double' ? Math.max(width * 3, 2.25) : found.type === 2 ? width * 2 : width, style, color: found.color ?? '#000000' }
}

// Characters

interface CharacterProperties {
  font: number
  /** In half points. */
  size: number
  bold: boolean
  italic: boolean
  struck: boolean
  caps: boolean
  smallCaps: boolean
  hidden: boolean
  deleted: boolean
  underline: number
  color: string | undefined
  highlight: string | undefined
  /** 1 above the line, 2 below it. */
  position: number
  /** In twentieths of a point. */
  spacing: number
  shading: string | undefined
  special: boolean
  symbol: { font: number; code: number } | undefined
}

const plainCharacter = (font: number): CharacterProperties => ({
  font,
  size: 20,
  bold: false,
  italic: false,
  struck: false,
  caps: false,
  smallCaps: false,
  hidden: false,
  deleted: false,
  underline: 0,
  color: undefined,
  highlight: undefined,
  position: 0,
  spacing: 0,
  shading: undefined,
  special: false,
  symbol: undefined
})

/** A property that turns something on or off: 0 off, 1 on, 0x80 as the style has it, 0x81 the other way. */
const toggled = (value: number, styled: boolean) => (value === 0x80 ? styled : value === 0x81 ? !styled : value !== 0)

/** A character property set on characters, over `styled`, the properties of their style, which toggles are measured from. */
function applyCharacter(found: CharacterProperties, bytes: Reader, { code, at }: WordProperty, styled: CharacterProperties): void {
  switch (code) {
    case 0x0835:
      found.bold = toggled(bytes.u8(at), styled.bold)
      break
    case 0x0836:
      found.italic = toggled(bytes.u8(at), styled.italic)
      break
    case 0x0837:
    case 0x2a53:
      found.struck = toggled(bytes.u8(at), styled.struck)
      break
    case 0x083a:
      found.smallCaps = toggled(bytes.u8(at), styled.smallCaps)
      break
    case 0x083b:
      found.caps = toggled(bytes.u8(at), styled.caps)
      break
    case 0x083c:
      found.hidden = toggled(bytes.u8(at), styled.hidden)
      break
    case 0x0800:
      found.deleted = bytes.u8(at) !== 0
      break
    case 0x2a3e:
      found.underline = bytes.u8(at)
      break
    case 0x2a42:
      found.color = icoColor(bytes.u8(at))
      break
    case 0x6870:
      found.color = colorRef(bytes, at)
      break
    case 0x4a43:
      found.size = bytes.u16(at)
      break
    case 0x2a48:
      found.position = bytes.u8(at)
      break
    case 0x8840:
      found.spacing = bytes.i16(at)
      break
    case 0x4a4f:
      found.font = bytes.u16(at)
      break
    case 0x2a0c:
      found.highlight = icoColor(bytes.u8(at))
      break
    case 0x4866:
      found.shading = shading80(bytes.u16(at))
      break
    case 0xca71:
      found.shading = shading(bytes, at + 1)
      break
    case 0x0855:
      found.special = bytes.u8(at) !== 0
      break
    case 0x6a09:
      found.symbol = { font: bytes.u16(at), code: bytes.u16(at + 2) }
      break
  }
}

/** Word's kinds of underline as the look's: single, by words and thick as a line, double, dotted, dashed, wavy. */
function underlineOf(kind: number): TextLook['underline'] {
  if (kind === 0) return undefined
  if (kind === 3) return 'double'
  if (kind === 4 || kind === 20) return 'dotted'
  if ([7, 9, 10, 23, 25, 26, 39, 55].includes(kind)) return 'dashed'
  if (kind === 11 || kind === 27 || kind === 43) return 'wavy'
  return 'solid'
}

// Paragraphs

/** A tab stop as the file writes it: its place in twentieths of a point, its alignment and its leader. */
interface WordTab {
  position: number
  align: number
  leader: number
}

/** A table row's properties, which the paragraph that ends it carries (`TAP`). */
interface TableProperties {
  align: number
  gapHalf: number
  height: number
  header: boolean
  edges: number[]
  cells: CellProperties[]
  /** The table's borders: top, left, bottom, right, between rows, between columns. */
  borders: (Border | undefined)[]
  padding: Sides<number>
  /** The colours of each side of each cell's borders in full, top, left, bottom and right, over those their borders name by number. */
  colors: (string | undefined)[][]
}

interface CellProperties {
  /** Merged with the next (1) or the one before (2) across; down, merged with the one above (`0x20`), starting a merge (`0x40`). */
  flags: number
  vertical: number
  borders: (Border | undefined)[]
  shading?: string | undefined
  padding: Sides<number>
}

interface ParagraphProperties {
  style: number
  align: number
  left: number
  right: number
  first: number
  before: number
  after: number
  beforeAuto: boolean
  afterAuto: boolean
  line: { value: number; multiple: boolean }
  pageBreakBefore: boolean
  list: number
  level: number
  inTable: boolean
  rowEnd: boolean
  depth: number
  innerCell: boolean
  innerRowEnd: boolean
  outline: number
  shading: string | undefined
  /** Top, left, bottom, right. */
  borders: (Border | undefined)[]
  tabs: WordTab[]
  contextual: boolean
  table: TableProperties | undefined
  /** Word 6's automatic number: its level (`nLvlAnm`, 0 for none), and its look (`ANLD`) as Word 97 keeps it. */
  numbering: number
  anld: { bytes: Reader; at: number } | undefined
  frame: FrameProperties
}

/**
 * Where a paragraph in a frame is placed: from what (`pc`: its high two bits across, the column, the margin or the page;
 * the two below them down, the margin, the page or the paragraph; three for neither), across and down, each kept one
 * more than its distance in twentieths of a point, or a place by name (`XAS_plusOne`, `YAS_plusOne`), its width and
 * height (the high bit saying it is at least that), how text wraps around it, and its drop cap's lines.
 */
interface FrameProperties {
  position: number | undefined
  x: number
  y: number
  width: number
  height: number
  wrap: number
}

/** Whether a paragraph is in a frame: placed from something, at a place, or of a width of its own. */
const framed = (frame: FrameProperties) =>
  (frame.position !== undefined && (frame.position & 0xf0) !== 0xf0) || frame.x !== 0 || frame.y !== 0 || frame.width !== 0

const plainParagraph = (style: number): ParagraphProperties => ({
  style,
  align: 0,
  left: 0,
  right: 0,
  first: 0,
  before: 0,
  after: 0,
  beforeAuto: false,
  afterAuto: false,
  line: { value: 240, multiple: true },
  pageBreakBefore: false,
  list: 0,
  level: 0,
  inTable: false,
  rowEnd: false,
  depth: 0,
  innerCell: false,
  innerRowEnd: false,
  outline: 9,
  shading: undefined,
  borders: [],
  tabs: [],
  contextual: false,
  table: undefined,
  numbering: 0,
  anld: undefined,
  frame: { position: undefined, x: 0, y: 0, width: 0, height: 0, wrap: 0 }
})

const copyParagraph = (found: ParagraphProperties): ParagraphProperties => ({
  ...found,
  borders: [...found.borders],
  tabs: [...found.tabs],
  table: found.table && copyTable(found.table),
  frame: { ...found.frame }
})

const plainCell = (): CellProperties => ({ flags: 0, vertical: 0, borders: [], padding: {} })

const copyTable = (found: TableProperties): TableProperties => ({
  ...found,
  edges: [...found.edges],
  cells: found.cells.map((cell) => ({ ...cell, borders: [...cell.borders], padding: { ...cell.padding } })),
  borders: [...found.borders],
  padding: { ...found.padding },
  colors: found.colors.map((side) => [...side])
})

/** Tab stops changed: some taken away, by their place or near it, others added with their alignment and leader. */
function changeTabs(tabs: WordTab[], bytes: Reader, at: number, close: boolean): WordTab[] {
  let place = at
  const removed = bytes.u8(place++)
  const taken = Array.from({ length: removed }, (_, index) => bytes.i16(place + index * 2))
  place += removed * 2
  const near = close ? Array.from({ length: removed }, (_, index) => Math.abs(bytes.i16(place + index * 2))) : []
  if (close) place += removed * 2
  const added = bytes.u8(place++)
  const kept = tabs.filter((tab) => !taken.some((position, index) => Math.abs(tab.position - position) <= (near[index] ?? 0)))
  for (let index = 0; index < added; index++) {
    const position = bytes.i16(place + index * 2)
    const descriptor = bytes.u8(place + added * 2 + index)
    const same = kept.findIndex((tab) => tab.position === position)
    if (same >= 0) kept.splice(same, 1)
    kept.push({ position, align: descriptor & 7, leader: (descriptor >> 3) & 7 })
  }
  return kept.sort((one, other) => one.position - other.position)
}

/** A table's property, set on the paragraph that ends a row. */
function applyTable(table: TableProperties, bytes: Reader, { code, at, size }: WordProperty): void {
  const cell = (index: number) => {
    while (table.cells.length <= index && table.cells.length < 64) table.cells.push(plainCell())
    return table.cells[index]
  }
  const range = (first: number, limit: number) => Array.from({ length: Math.max(0, Math.min(limit, 64) - first) }, (_, index) => first + index)
  switch (code) {
    case 0xd608: {
      // The table's definition: how many cells, the places of their edges, then each cell's merges, alignment and borders.
      const start = at + 2
      const count = Math.min(bytes.u8(start), 64)
      table.edges = Array.from({ length: count + 1 }, (_, index) => bytes.i16(start + 1 + index * 2))
      const cells = start + 1 + (count + 1) * 2
      const stored = Math.max(0, Math.floor((at + size - cells) / 20))
      table.cells = Array.from({ length: count }, (_, index) => {
        if (index >= stored) return plainCell()
        const place = cells + index * 20
        const flags = bytes.u16(place)
        return {
          flags: flags & 0x63,
          vertical: (flags >> 7) & 3,
          borders: [border80(bytes, place + 4), border80(bytes, place + 8), border80(bytes, place + 12), border80(bytes, place + 16)],
          padding: {}
        }
      })
      break
    }
    case 0x5400:
    case 0x548a:
      table.align = bytes.u16(at) & 3
      break
    case 0x9602:
      table.gapHalf = bytes.i16(at)
      break
    case 0x9407:
      table.height = bytes.i16(at)
      break
    case 0x3404:
      table.header = bytes.u8(at) !== 0
      break
    case 0xd605:
      table.borders = Array.from({ length: 6 }, (_, index) => border80(bytes, at + 1 + index * 4))
      break
    case 0xd613:
      table.borders = Array.from({ length: 6 }, (_, index) => border(bytes, at + 1 + index * 8))
      break
    case 0xd620:
    case 0xd62f: {
      const wide = code === 0xd62f
      const found = wide ? border(bytes, at + 4) : border80(bytes, at + 4)
      const sides = bytes.u8(at + 3)
      for (const index of range(bytes.u8(at + 1), bytes.u8(at + 2))) {
        const target = cell(index)
        if (!target) continue
        // Top, left, bottom, right, as the bits of `sides` name them.
        for (let side = 0; side < 4; side++) if (sides & (1 << side)) target.borders[side] = found
      }
      break
    }
    case 0xd609: {
      const count = Math.floor(bytes.u8(at) / 2)
      for (let index = 0; index < count; index++) {
        const target = cell(index)
        if (target) target.shading = shading80(bytes.u16(at + 1 + index * 2))
      }
      break
    }
    case 0xd612:
    case 0xd616:
    case 0xd60c: {
      // The shading of the first 22 cells, of the next 22, then of the 20 after them.
      const offset = code === 0xd612 ? 0 : code === 0xd616 ? 22 : 44
      const count = Math.floor(bytes.u8(at) / 10)
      for (let index = 0; index < count; index++) {
        const target = cell(offset + index)
        if (target) target.shading = shading(bytes, at + 1 + index * 10)
      }
      break
    }
    case 0xd61a:
    case 0xd61b:
    case 0xd61c:
    case 0xd61d: {
      // The colours of the cells' top, left, bottom or right borders, in full.
      const count = Math.min(Math.floor(bytes.u8(at) / 4), 64)
      table.colors[code - 0xd61a] = Array.from({ length: count }, (_, index) => colorRef(bytes, at + 1 + index * 4))
      break
    }
    case 0xd62b: {
      // A cell merged down: 1 with the one above, 3 starting a merge.
      const target = cell(bytes.u8(at + 1))
      const merge = bytes.u8(at + 2)
      if (target) target.flags = (target.flags & ~0x60) | (merge === 3 ? 0x60 : merge === 1 ? 0x20 : 0)
      break
    }
    case 0x5624:
    case 0x5625:
      // Cells merged across, the first of them starting the merge, or split again.
      for (const index of range(bytes.u8(at), bytes.u8(at + 1))) {
        const target = cell(index)
        if (target) target.flags = (target.flags & ~3) | (code === 0x5625 ? 0 : index === bytes.u8(at) ? 1 : 2)
      }
      break
    case 0x7627:
      for (const index of range(bytes.u8(at), bytes.u8(at + 1))) {
        const target = cell(index)
        if (target) target.shading = shading80(bytes.u16(at + 2))
      }
      break
    case 0xd62c:
      for (const index of range(bytes.u8(at + 1), bytes.u8(at + 2))) {
        const target = cell(index)
        if (target) target.vertical = bytes.u8(at + 3)
      }
      break
    case 0xd632:
    case 0xd634: {
      // Padding in twentieths of a point (its unit 3), on the sides its bits name, of some cells or of every cell.
      if (bytes.u8(at + 4) !== 3) break
      const sides = bytes.u8(at + 3)
      const value = bytes.u16(at + 5) / 20
      const set = (padding: Sides<number>) => {
        if (sides & 1) padding.top = value
        if (sides & 2) padding.left = value
        if (sides & 4) padding.bottom = value
        if (sides & 8) padding.right = value
      }
      if (code === 0xd634) set(table.padding)
      else
        for (const index of range(bytes.u8(at + 1), bytes.u8(at + 2))) {
          const target = cell(index)
          if (target) set(target.padding)
        }
      break
    }
  }
}

const plainTable = (): TableProperties => ({ align: 0, gapHalf: 0, height: 0, header: false, edges: [], cells: [], borders: [], padding: {}, colors: [] })

/** A paragraph property set on a paragraph or its style; a huge list of them is in the data stream, `data`. */
function applyParagraph(found: ParagraphProperties, bytes: Reader, property: WordProperty, data: Reader | undefined, depth = 0): void {
  const { code, at } = property
  switch (code) {
    case 0x4600:
      found.style = bytes.u16(at)
      break
    case 0x2403:
    case 0x2461:
      found.align = bytes.u8(at)
      break
    case 0x2407:
      found.pageBreakBefore = bytes.u8(at) !== 0
      break
    case 0x260a:
      found.level = Math.min(bytes.u8(at), 8)
      break
    case 0x460b:
      found.list = bytes.i16(at)
      break
    case 0xc60d:
      found.tabs = changeTabs(found.tabs, bytes, at + 1, false)
      break
    case 0xc615:
      found.tabs = changeTabs(found.tabs, bytes, at + 1, true)
      break
    case 0x840e:
    case 0x845d:
      found.right = bytes.i16(at)
      break
    case 0x840f:
    case 0x845e:
      found.left = bytes.i16(at)
      break
    case 0x8411:
    case 0x8460:
      found.first = bytes.i16(at)
      break
    case 0x6412:
      found.line = { value: bytes.i16(at), multiple: bytes.i16(at + 2) !== 0 }
      break
    case 0xa413:
      found.before = bytes.u16(at)
      break
    case 0xa414:
      found.after = bytes.u16(at)
      break
    case 0x245b:
      found.beforeAuto = bytes.u8(at) !== 0
      break
    case 0x245c:
      found.afterAuto = bytes.u8(at) !== 0
      break
    case 0x2416:
      found.inTable = bytes.u8(at) !== 0
      if (found.inTable && found.depth === 0) found.depth = 1
      break
    case 0x2417:
      found.rowEnd = bytes.u8(at) !== 0
      break
    case 0x6649:
      found.depth = Math.min(bytes.u32(at), 64)
      found.inTable = found.depth > 0
      break
    case 0x244b:
      found.innerCell = bytes.u8(at) !== 0
      break
    case 0x244c:
      found.innerRowEnd = bytes.u8(at) !== 0
      break
    case 0x2640:
      found.outline = bytes.u8(at)
      break
    case 0x442d:
      found.shading = shading80(bytes.u16(at))
      break
    case 0xc64d:
      found.shading = shading(bytes, at + 1)
      break
    case 0x6424:
    case 0x6425:
    case 0x6426:
    case 0x6427:
      found.borders[code - 0x6424] = border80(bytes, at)
      break
    case 0xc64e:
    case 0xc64f:
    case 0xc650:
    case 0xc651:
      found.borders[code - 0xc64e] = border(bytes, at + 1)
      break
    case 0x261b:
      found.frame.position = bytes.u8(at)
      break
    case 0x8418:
      found.frame.x = bytes.i16(at)
      break
    case 0x8419:
      found.frame.y = bytes.i16(at)
      break
    case 0x841a:
      found.frame.width = bytes.u16(at)
      break
    case 0x442b:
      found.frame.height = bytes.u16(at)
      break
    case 0x2423:
      found.frame.wrap = bytes.u8(at)
      break
    case 0x246d:
      found.contextual = bytes.u8(at) !== 0
      break
    case 0xc63e:
      if (bytes.u8(at) >= ANLD_SIZE) found.anld = { bytes, at: at + 1 }
      break
    case 0x6646: {
      // Properties too many for their page, kept in the data stream: their length, then them.
      if (!data || depth > 0) break
      const place = bytes.u32(at)
      const length = data.u16(place)
      for (const one of wordProperties(data, place + 2, place + 2 + length)) applyParagraph(found, data, one, data, depth + 1)
      break
    }
    default:
      if (((code >> 10) & 7) === 5) {
        found.table ??= plainTable()
        applyTable(found.table, bytes, property)
      }
  }
}

// Styles

interface WordStyle {
  /** 1 a paragraph's, 2 a character's, 3 a table's, 4 a list's. */
  kind: number
  base: number
  /** The built-in style it is, by Word's number for it: 1 to 9 the headings. */
  builtIn: number
  paragraph?: Properties | undefined
  character?: Properties | undefined
}

/**
 * The document's styles (`STSH`), each resolved over those it comes from when first asked for. Word 97 and Word 6 write
 * them alike, but for their names and properties; Word 2 writes all their names, then all their characters, then all
 * their paragraphs' properties, then which each comes from, every style known by a code of one byte.
 */
class StyleSheet {
  private readonly styles: (WordStyle | undefined)[] = []
  private readonly font: number
  private readonly paragraphs = new Map<number, ParagraphProperties>()
  private readonly characters = new Map<number, CharacterProperties>()
  private readonly data: Reader | undefined

  constructor(file: OlderWordFile, decode: (bytes: Uint8Array) => string) {
    this.data = file.data
    this.font = file.version === 2 ? this.readTwo(file.table, file.part('styles'), decode) : this.read(file, decode)
  }

  /** Word 97's and Word 6's styles, and the font of their text by default. */
  private read({ table, version, part }: OlderWordFile, decode: (bytes: Uint8Array) => string): number {
    const place = part('styles')
    if (place.size < 6) return 0
    const six = version === 6
    const header = table.u16(place.at)
    const count = table.u16(place.at + 2)
    const base = table.u16(place.at + 4)
    const end = place.at + place.size
    let at = place.at + 2 + header
    for (let index = 0; index < count && at + 2 <= end; index++) {
      const length = table.u16(at)
      const start = at + 2
      at = start + length
      if (length < 2 || at > end) {
        this.styles.push(undefined)
        continue
      }
      // A style cut short is known by its built-in number alone, as a paragraph's style of no properties.
      const second = length >= 4 ? table.u16(start + 2) : 1 | (0xfff << 4)
      const style: WordStyle = { kind: second & 0xf, base: second >> 4, builtIn: table.u16(start) & 0xfff }
      // Word 97 names a style in 16 bits after its length in two bytes, Word 6 in 8 after its length in one, each
      // name ending in a zero; its properties follow, each part at an even place from the style's start.
      const named = start + base
      let upx = six ? (named + 1 < at ? named + 2 + table.u8(named) : at) : named + 2 < at ? named + 2 + table.u16(named) * 2 + 2 : at
      if ((upx - start) & 1) upx++
      const parts: WordPlace[] = []
      for (let count = length >= 6 ? table.u16(start + 4) & 0xf : 0; count > 0 && upx + 2 <= at; count--) {
        const size = table.u16(upx)
        parts.push({ at: upx + 2, size: Math.max(0, Math.min(size, at - upx - 2)) })
        upx += 2 + size + (size & 1)
      }
      const properties = (part: WordPlace | undefined, skip: number): Properties | undefined => {
        if (!part || part.size < skip) return undefined
        return six ? wordProperties97(6, table, part.at + skip, part.at + part.size, decode) : { bytes: table, at: part.at + skip, end: part.at + part.size }
      }
      if (style.kind === 1) {
        // A paragraph style's paragraph properties follow the number of the style.
        style.paragraph = properties(parts[0], 2)
        style.character = properties(parts[1], 0)
      } else if (style.kind === 2) style.character = properties(parts[0], 0)
      this.styles.push(style)
    }
    return header >= 14 ? table.u16(place.at + 14) : 0
  }

  /**
   * Word 2's styles: a style's code is its place less the count of built-in ones; the built-in headings 1 to 9 are the
   * codes 254 down to 246, and a style of the document's own may be named as one. Its characters are described as a
   * run's are (`CHP`), and its paragraph's properties follow its code and six bytes of its lines' heights.
   */
  private readTwo(table: Reader, place: WordPlace, decode: (bytes: Uint8Array) => string): number {
    if (place.size < 4) return 0
    const end = place.at + place.size
    const builtIns = table.u16(place.at)
    const block = (at: number) => ({ at: at + 2, end: Math.min(end, at + table.u16(at)) })
    const names = block(place.at + 2)
    const found: { name: string | undefined; character?: Properties | undefined; paragraph?: Properties | undefined }[] = []
    let at = names.at
    while (at < names.end && found.length < 256) {
      const length = table.u8(at++)
      // A style left undefined is one byte; a built-in one has no name of its own.
      found.push({ name: length === 0xff ? undefined : length > 0 && at + length <= names.end ? decode(table.bytes(at, length)).toLowerCase() : '' })
      if (length !== 0xff) at += length
    }
    const characters = block(names.end)
    at = characters.at
    for (let slot = 0; at < characters.end && slot < found.length; slot++) {
      const length = table.u8(at++)
      if (length === 0xff) continue
      const style = found[slot] as (typeof found)[number]
      style.character = twoCharacters(table, at, Math.min(length, characters.end - at))
      at += length
    }
    const paragraphs = block(characters.end)
    at = paragraphs.at
    for (let slot = 0; at < paragraphs.end && slot < found.length; slot++) {
      const length = table.u8(at++)
      if (length === 0xff) continue
      const style = found[slot] as (typeof found)[number]
      if (length >= 7) style.paragraph = wordProperties97(2, table, at + 7, Math.min(at + length, paragraphs.end), decode)
      at += length
    }
    // Then how many styles say which they come from, and for each the next style's code and its base's.
    const links = paragraphs.end
    const linked = links + 2 <= end ? Math.min(table.u16(links), found.length) : 0
    for (const [slot, style] of found.entries()) {
      if (style.name === undefined) continue
      const code = (slot - builtIns) & 0xff
      const base = slot < linked && links + 4 + slot * 2 <= end ? table.u8(links + 3 + slot * 2) : 222
      const level = /^heading (\d)$/.exec(style.name)?.[1]
      const named = level ? Number(level) : style.name === 'title' ? 62 : style.name === 'subtitle' ? 74 : code === 0 ? 0 : 0xffe
      // Every style comes at last from the null style (222), which is none.
      this.styles[code] = {
        kind: 1,
        base: base === code || base === 222 ? 0xfff : base,
        builtIn: code >= 246 && code <= 254 ? 255 - code : named,
        paragraph: style.paragraph,
        character: style.character
      }
    }
    return 0
  }

  /** The heading a paragraph style makes, by the built-in style it is: Heading 1 to 9, the title and the subtitle. */
  heading(index: number): number | undefined {
    const builtIn = this.styles[index]?.builtIn ?? 0
    return builtIn >= 1 && builtIn <= 9 ? Math.min(builtIn, 6) : builtIn === 62 ? 1 : builtIn === 74 ? 2 : undefined
  }

  /** The chain of styles a style comes from, the most general first, a loop cut where it closes. */
  private chain(index: number, kind: number): WordStyle[] {
    const chain: WordStyle[] = []
    const seen = new Set<number>()
    for (let at = index; at !== 0xfff && !seen.has(at) && chain.length < 12; ) {
      seen.add(at)
      const style = this.styles[at]
      if (style?.kind !== kind) break
      chain.unshift(style)
      at = style.base
    }
    return chain
  }

  paragraph(index: number): ParagraphProperties {
    let found = this.paragraphs.get(index)
    if (!found) {
      found = plainParagraph(index)
      for (const style of this.chain(index, 1)) {
        for (const property of each(style.paragraph)) applyParagraph(found, (style.paragraph as Properties).bytes, property, this.data)
        if (style.paragraph?.numbering !== undefined) found.numbering = style.paragraph.numbering
      }
      found.style = index
      this.paragraphs.set(index, found)
    }
    return found
  }

  /** The characters of a paragraph style: those of the styles it comes from, then its own. */
  character(index: number): CharacterProperties {
    let found = this.characters.get(index)
    if (!found) {
      found = plainCharacter(this.font)
      for (const style of this.chain(index, 1)) {
        const styled = { ...found }
        for (const property of each(style.character)) applyCharacter(found, (style.character as Properties).bytes, property, styled)
      }
      this.characters.set(index, found)
    }
    return found
  }

  /** A character style over the characters of a paragraph's style. */
  styled(under: CharacterProperties, index: number): CharacterProperties {
    const found = { ...under }
    for (const style of this.chain(index, 2)) {
      const styled = { ...found }
      for (const property of each(style.character)) applyCharacter(found, (style.character as Properties).bytes, property, styled)
    }
    return found
  }
}

// Lists

interface ListLevel {
  start: number
  /** Word's number format: 0 decimal, 1 and 2 roman, 3 and 4 letters, 23 a bullet, 255 none. */
  format: number
  align: number
  legal: boolean
  /** Its text, each character below 9 the number of that level. */
  text: string
  /** After the number: 0 a tab, 1 a space, 2 nothing. */
  follow: number
  paragraph: Properties | undefined
  character: Properties | undefined
}

/** How long Word 97's description of an automatic number of Word 6 is (`ANLD`): its look, then 32 characters of text. */
const ANLD_SIZE = 84

/** Word's number formats as `listMark` names them. */
const NUMBER_FORMATS: Record<number, string> = {
  0: 'decimal',
  1: 'upperRoman',
  2: 'lowerRoman',
  3: 'upperLetter',
  4: 'lowerLetter',
  5: 'ordinal',
  6: 'cardinalText',
  7: 'ordinalText',
  22: 'decimalZero',
  23: 'bullet',
  255: 'none'
}

/** A list's level (`LVL`), and where the next one starts. */
function readLevel(table: Reader, at: number): { level: ListLevel; next: number } {
  const flags = table.u8(at + 5)
  const character = table.u8(at + 24)
  const paragraph = table.u8(at + 25)
  const textAt = at + 28 + paragraph + character
  const length = Math.min(table.u16(textAt), 255)
  let text = ''
  for (let index = 0; index < length; index++) text += String.fromCharCode(table.u16(textAt + 2 + index * 2))
  return {
    level: {
      start: table.i32(at),
      format: table.u8(at + 4),
      align: flags & 3,
      legal: (flags & 4) !== 0,
      text,
      follow: table.u8(at + 15),
      paragraph: paragraph > 0 ? { bytes: table, at: at + 28, end: at + 28 + paragraph } : undefined,
      character: character > 0 ? { bytes: table, at: at + 28 + paragraph, end: textAt } : undefined
    },
    next: textAt + 2 + length * 2
  }
}

/** The document's lists (`PlfLst`) and the overrides paragraphs name them by (`PlfLfo`), with each list's counts as they go. */
class Lists {
  private readonly lists = new Map<number, ListLevel[]>()
  private readonly overrides: { list: number; starts: Map<number, number>; levels: Map<number, ListLevel>; used: boolean }[] = []
  private readonly counts = new Map<number, (number | undefined)[]>()

  constructor(table: Reader, lists: WordPlace, overrides: WordPlace) {
    if (lists.size >= 2) {
      const count = Math.min(table.i16(lists.at), 4096)
      let at = lists.at + 2 + Math.max(0, count) * 28
      for (let index = 0; index < count; index++) {
        const entry = lists.at + 2 + index * 28
        const simple = (table.u8(entry + 26) & 1) !== 0
        const levels: ListLevel[] = []
        for (let level = 0; level < (simple ? 1 : 9); level++) {
          const read = readLevel(table, at)
          levels.push(read.level)
          at = read.next
        }
        this.lists.set(table.i32(entry), levels)
      }
    }
    if (overrides.size >= 4) {
      const count = Math.min(table.u32(overrides.at), 4096)
      let at = overrides.at + 4 + count * 16
      for (let index = 0; index < count; index++) {
        const entry = overrides.at + 4 + index * 16
        const changed = table.u8(entry + 12)
        const override = { list: table.i32(entry), starts: new Map<number, number>(), levels: new Map<number, ListLevel>(), used: false }
        // Each override's data: a place, then each level it changes, its start and, when it says, the level itself.
        at += 4
        for (let level = 0; level < changed; level++) {
          const start = table.i32(at)
          const flags = table.u32(at + 4)
          const which = flags & 0xf
          at += 8
          if (flags & 0x10) override.starts.set(which, start)
          if (flags & 0x20) {
            const read = readLevel(table, at)
            override.levels.set(which, read.level)
            if (!(flags & 0x10)) override.starts.set(which, read.level.start)
            at = read.next
          }
        }
        this.overrides.push(override)
      }
    }
  }

  /** The level a paragraph's list and level name, for its indents and its number's look. */
  level(list: number, at: number): ListLevel | undefined {
    const override = this.overrides[list - 1]
    if (!override) return undefined
    const levels = this.lists.get(override.list)
    return override.levels.get(at) ?? levels?.[levels.length === 1 ? 0 : at]
  }

  /** The next number of a list at a level, written as the level says: the levels above it are counted where they stand. */
  next(list: number, at: number): { text: string; level: ListLevel } | undefined {
    const override = this.overrides[list - 1]
    const levels = override && this.lists.get(override.list)
    const level = this.level(list, at)
    if (!override || !levels || !level) return undefined
    const counts = this.counts.get(override.list) ?? []
    this.counts.set(override.list, counts)
    if (!override.used) {
      override.used = true
      for (const [which, start] of override.starts) counts[which] = start - 1
    }
    const startOf = (which: number) => this.level(list, which)?.start ?? 1
    counts[at] = counts[at] === undefined ? startOf(at) : (counts[at] as number) + 1
    for (let deeper = at + 1; deeper < 9; deeper++) counts[deeper] = undefined
    let text = ''
    for (const character of level.text) {
      const code = character.charCodeAt(0)
      if (code < 9) {
        const which = this.level(list, code)
        const format = level.legal && which?.format !== 22 ? 'decimal' : (NUMBER_FORMATS[which?.format ?? 0] ?? 'decimal')
        text += format === 'none' || format === 'bullet' ? '' : listMark(format, counts[code] ?? startOf(code))
      } else text += character
    }
    return { text, level }
  }
}

// Sections

interface Section {
  /** Where its text ends. */
  end: number
  width: number
  height: number
  margins: DocumentPage['margins']
  columns: number
  gap: number
  /** How it starts: 0 on the same page, 1 in a new column, 2 on a new page, 3 an even one, 4 an odd one. */
  start: number
  titlePage: boolean
  restart: boolean
  first: number
  format: number
  /** Which headers and footers Word 6 and 2 kept for it, a bit for each kind (`grpfIhdt`). */
  headers: number
  /** Where its text sits down its pages: 0 at the top, 1 in the middle, 2 spread, 3 at the bottom (`vjc`). */
  vertical: number
}

/**
 * A section's properties, from Word's defaults and those its `SEPX` sets: its length in two bytes, then them, in Word
 * 97 and Word 6, whose are written as Word 97's; its length in one byte in Word 2.
 */
function readSection(file: OlderWordFile, at: number, end: number, decode: (bytes: Uint8Array) => string): Section {
  const { word: main, version } = file
  const found = { width: 12240, height: 15840, left: 1800, right: 1800, top: 1440, bottom: 1440, header: 720, footer: 720, gutter: 0 }
  const section = { columns: 1, gap: 720, start: 2, titlePage: false, restart: false, first: 1, format: 0, headers: 0, vertical: 0 }
  const counted = version === 2 ? 1 : 2
  if (at !== 0xffffffff && at + counted <= main.length) {
    const length = version === 2 ? main.u8(at) : main.u16(at)
    const last = Math.min(at + counted + length, main.length)
    const properties = version === 97 ? { bytes: main, at: at + 2, end: last } : wordProperties97(version, main, at + counted, last, decode)
    const word = properties.bytes
    for (const { code, at: operand } of each(properties)) {
      switch (code) {
        case 0x3009:
          section.start = word.u8(operand)
          break
        case 0x300a:
          section.titlePage = word.u8(operand) !== 0
          break
        case 0x500b:
          section.columns = word.u16(operand) + 1
          break
        case 0x900c:
          section.gap = word.i16(operand)
          break
        case 0x300e:
          section.format = word.u8(operand)
          break
        case 0x3011:
          section.restart = word.u8(operand) !== 0
          break
        case 0x3014:
          section.headers = word.u8(operand)
          break
        case 0x301a:
          section.vertical = word.u8(operand)
          break
        case 0x501c:
          section.first = word.u16(operand)
          break
        case 0x7044:
          section.first = word.u32(operand)
          break
        case 0xb017:
          found.header = word.u16(operand)
          break
        case 0xb018:
          found.footer = word.u16(operand)
          break
        case 0xb01f:
          found.width = word.u16(operand)
          break
        case 0xb020:
          found.height = word.u16(operand)
          break
        case 0xb021:
          found.left = word.u16(operand)
          break
        case 0xb022:
          found.right = word.u16(operand)
          break
        case 0x9023:
          found.top = Math.abs(word.i16(operand))
          break
        case 0x9024:
          found.bottom = Math.abs(word.i16(operand))
          break
        case 0xb025:
          found.gutter = word.u16(operand)
          break
      }
    }
  }
  const within = (value: number, lowest: number, highest: number) => Math.min(Math.max(value, lowest), highest)
  // Word's pages are 0.1 to 22 inches across and down.
  const width = within(found.width / 20, 7.2, 1584)
  const height = within(found.height / 20, 7.2, 1584)
  return {
    end,
    width,
    height,
    margins: {
      top: within(found.top / 20, 0, height / 2),
      right: within(found.right / 20, 0, width / 2),
      bottom: within(found.bottom / 20, 0, height / 2),
      left: within((found.left + found.gutter) / 20, 0, width / 2),
      header: within(found.header / 20, 0, height / 2),
      footer: within(found.footer / 20, 0, height / 2)
    },
    columns: within(section.columns, 1, 12),
    gap: within(section.gap / 20, 0, width / 2),
    start: section.start,
    titlePage: section.titlePage,
    restart: section.restart,
    first: section.first,
    format: section.format,
    headers: section.headers,
    vertical: section.vertical
  }
}

// Reading

/** A field open as a story is read: its code, whether its result is being read, and what it stands for. */
interface OpenField {
  code: string
  result: boolean
  replaced: boolean
  object?: number | undefined
  link?: string | undefined
}

/**
 * A story being read: its open fields, the mark of the note it is, when it is one, and Word 6's automatic numbers as
 * they are counted along it: the paragraphs numbered one after another, and each outline level.
 */
interface Story {
  fields: OpenField[]
  note?: { mark: number; label: string } | undefined
  body: boolean
  numbers?: { run: number | undefined; outline: (number | undefined)[] } | undefined
}

/**
 * A character of the text: its place in the text, where the file keeps it, its code, the piece it is in, and its byte
 * when the piece keeps it in 8 bits alone (-1 otherwise).
 */
interface WordCharacter {
  place: number
  at: number
  code: number
  piece: number
  byte: number
}

/** What a paragraph's content is read into: its pieces, and where pages break between them. */
type Piece = DocumentSpan | 'page'

/** A paragraph read, with the properties that place it: in a table, ending a row, breaking a page before it. */
interface ParagraphRead {
  paragraph: DocumentParagraph
  pieces: Piece[]
  properties: ParagraphProperties
  /** Whether its mark ends a cell, or its section. */
  cellEnd: boolean
  sectionEnd: boolean
  hidden: boolean
  /** The place of its first character in the text. */
  start: number
}

/** A row being read: its cells' blocks, then its properties once its end is read. */
interface RowRead {
  cells: DocumentBlock[][]
  table: TableProperties | undefined
  /** Whether Word last started a page with it. */
  newPage?: boolean | undefined
}

class OlderWordReader {
  private readonly file: OlderWordFile
  private readonly styles: StyleSheet
  private readonly lists: Lists
  private readonly fonts: WordFont[]
  readonly sections: Section[]
  private section = 0
  private readonly characterRuns: FormattedRun[]
  private readonly paragraphRuns: FormattedRun[]
  /** Each run's properties as Word 97 writes them, by where the run's are. */
  private readonly runProperties = new Map<string, { style: number; properties: Properties }>()
  private readonly characterLooks = new Map<string, CharacterProperties>()
  /** The 8-bit text's characters, and a byte that starts a character of two, in the document's code page. */
  private readonly narrow: { decode: (bytes: Uint8Array) => string; table: string; leads: (byte: number) => boolean }
  private readonly pieces: TextPiece[]
  private readonly footnotes = new Map<number, { from: number; to: number }>()
  private readonly endnotes = new Map<number, { from: number; to: number }>()
  private readonly spaced = new WeakMap<DocumentParagraph, { style: number; contextual: boolean; autoBefore: boolean; autoAfter: boolean }>()
  private blocks = 0
  /** How many more characters may be read. */
  private budget: number
  cut = false
  readonly pages: { section: number; bands: PageBand[]; notes: DocumentPage['notes'] }[] = []
  private pending = true
  /** Footnotes and endnotes are counted apart, each from its first number and in its format (`settings`). */
  private readonly noteCounts = { foot: 0, end: 0 }
  private readonly noteFormats: { foot: { first: number; format: string }; end: { first: number; format: string } }
  private noteQueue: DocumentPage['notes'] = []
  readonly endNotes: DocumentLook['endNotes'] = []

  constructor(file: OlderWordFile) {
    this.file = file
    const { word, table, version } = file
    const decoder = codePageDecoder(file.codePage)
    const decode = (bytes: Uint8Array) => decoder.decode(bytes)
    this.narrow = {
      decode,
      table: Array.from({ length: 256 }, (_, index) => (leadsTwoBytes(file.codePage, index) ? '?' : (decode(Uint8Array.of(index))[0] ?? '?'))).join(''),
      leads: (byte) => leadsTwoBytes(file.codePage, byte)
    }
    this.styles = new StyleSheet(file, decode)
    this.lists = new Lists(table, file.part('lists'), file.part('listOverrides'))
    this.fonts = readFonts(file, decode)
    this.characterRuns = formattedRuns(word, version, file.runPages.characters, false)
    this.paragraphRuns = formattedRuns(word, version, file.runPages.paragraphs, true)
    this.pieces = [...file.pieces].sort((one, other) => one.start - other.start)
    const [text = 0, foot = 0, header = 0, macro = 0, comment = 0] = file.lengths
    const [, , , , , end = 0] = file.lengths
    this.readNotes(this.footnotes, 'footnoteReferences', 'footnoteTexts', { start: text, length: foot })
    this.readNotes(this.endnotes, 'endnoteReferences', 'endnoteTexts', { start: text + foot + header + macro + comment, length: end })
    const [, , , , , , boxes = 0, headerBoxes = 0] = file.lengths
    const boxesStart = text + foot + header + macro + comment + end
    this.readTextBoxes('textBoxes', { start: boxesStart, length: boxes })
    this.readTextBoxes('headerTextBoxes', { start: boxesStart + boxes, length: headerBoxes })
    this.budget = file.limit * 2
    this.sections = this.readSections(text)
    this.pageStarts = this.readPageStarts(text)
    // The settings keep each kind of note's first number, and their formats in the bits Word 6 put them in.
    const settings = file.part('settings')
    const formats = settings.size >= 0x38 ? table.u16(settings.at + 0x36) : 0
    const first = (at: number) => (settings.size >= at + 2 ? Math.max(1, table.u16(settings.at + at) >> 2) : 1)
    this.noteFormats = {
      foot: { first: first(2), format: PAGE_FORMATS[(formats >> 2) & 15] ?? 'decimal' },
      end: { first: first(0x34), format: PAGE_FORMATS[(formats >> 6) & 15] ?? 'lowerRoman' }
    }
  }

  /** Where each note's reference is in the text, and where its own text is in its story, kept within that story. */
  private readNotes(notes: Map<number, { from: number; to: number }>, references: WordPart, texts: WordPart, story: { start: number; length: number }): void {
    const { table } = this.file
    const placed = this.file.part(references)
    const written = this.file.part(texts)
    const count = placed.size >= 4 ? Math.min(Math.floor((placed.size - 4) / 6), 10_000) : 0
    const within = (place: number) => story.start + Math.min(place, story.length)
    for (let index = 0; index < count; index++) {
      if (written.at + (index + 2) * 4 > written.at + written.size) break
      notes.set(table.u32(placed.at + index * 4), { from: within(table.u32(written.at + index * 4)), to: within(table.u32(written.at + (index + 1) * 4)) })
    }
  }

  /** Each section's end and properties (`PLCFSED`): their descriptors take twelve bytes, six in Word 2, each naming where its properties are. */
  private readSections(text: number): Section[] {
    const { table } = this.file
    const place = this.file.part('sections')
    const size = this.file.version === 2 ? 6 : 12
    const count = place.size >= 4 ? Math.min(Math.floor((place.size - 4) / (4 + size)), 1000) : 0
    const sections: Section[] = []
    for (let index = 0; index < count; index++) {
      const descriptor = place.at + (count + 1) * 4 + index * size
      sections.push(readSection(this.file, table.u32(descriptor + 2), table.u32(place.at + (index + 1) * 4), this.narrow.decode))
    }
    if (sections.length === 0) sections.push(readSection(this.file, 0xffffffff, text, this.narrow.decode))
    return sections
  }

  /** Where a new page of the body begins, by the place of its first character in the text, as Word last broke them. */
  private readonly pageStarts: ReadonlySet<number>

  /**
   * Where the Word that saved the document last broke its pages, when it left its cache of them (`BkdMother`): a list of
   * the places where each of its pages, or columns, began, each with the number of the page it is on, two bytes, then
   * four more. A new page begins where that number changes. A cache that does not hold together with the text, its
   * places out of order or its pages counted backwards, is none.
   */
  private readPageStarts(text: number): Set<number> {
    const { table } = this.file
    const place = this.file.part('pageBreaks')
    const starts = new Set<number>()
    if (place.size < 14 || (place.size - 4) % 10 !== 0) return starts
    const count = Math.min((place.size - 4) / 10, 100_000)
    let previous = 0
    let page = -1
    for (let index = 0; index < count; index++) {
      const at = table.u32(place.at + index * 4)
      const number = table.u16(place.at + (count + 1) * 4 + index * 6)
      if ((index === 0 && at !== 0) || at < previous || number < page) return new Set()
      if (index > 0 && number !== page && at < text) starts.add(at)
      previous = at
      page = number
    }
    return starts
  }

  get full(): boolean {
    return this.blocks >= BLOCK_LIMIT
  }

  private get current(): Section {
    return this.sections[this.section] ?? (this.sections[0] as Section)
  }

  /** The width of the text of the section being read. */
  private get textWidth(): number {
    const section = this.current
    return Math.max(36, section.width - section.margins.left - section.margins.right)
  }

  // Pages

  private get page() {
    if (this.pending || this.pages.length === 0) {
      this.pending = false
      const section = this.current
      this.pages.push({ section: this.section, bands: [{ columns: section.columns, gap: section.gap, blocks: [] }], notes: [] })
    }
    return this.pages.at(-1) as OlderWordReader['pages'][number]
  }

  /** A block of the body on its page, with the notes it named at the foot of that page. */
  private place(block: DocumentBlock): void {
    const page = this.page
    page.bands.at(-1)?.blocks.push(block)
    page.notes.push(...this.noteQueue)
    this.noteQueue = []
  }

  /** The next content goes on a new page, unless the page has none yet. */
  private breakPage(): void {
    const page = this.pages.at(-1)
    if (page?.bands.some((band) => band.blocks.length > 0)) this.pending = true
  }

  /** A section ends: the next starts on a new page, or on the same one in a band of its own. */
  private endSection(): void {
    if (this.section >= this.sections.length - 1) return
    this.section++
    const next = this.current
    if (next.start === 0 && !this.pending && this.pages.length > 0) this.pages.at(-1)?.bands.push({ columns: next.columns, gap: next.gap, blocks: [] })
    else this.breakPage()
  }

  // Text

  /**
   * The characters of a range of the text, each with its place in the file and the piece it is in. A damaged file may
   * name the same text for many notes or headers: past twice as many characters as a preview shows, the rest is left out.
   */
  private *characters(from: number, to: number): Generator<WordCharacter> {
    const { word } = this.file
    for (const [index, piece] of this.pieces.entries()) {
      const start = Math.max(from, piece.start)
      const end = Math.min(to, piece.end)
      for (let place = start; place < end; place++) {
        if (--this.budget < 0) {
          this.cut = true
          return
        }
        const offset = place - piece.start
        if (piece.narrow) {
          // In a code page of two-byte characters, a character of two is at its first byte's place, and the second
          // byte's place is passed over.
          const at = piece.at + offset
          const byte = word.u8(at)
          if (this.narrow.leads(byte) && place + 1 < end) {
            const pair = this.narrow.decode(word.bytes(at, 2))
            yield { place, at, code: pair.length === 1 ? pair.charCodeAt(0) : 0x3f, piece: index, byte: -1 }
            place++
          } else yield { place, at, code: this.narrow.table.charCodeAt(byte), piece: index, byte }
        } else {
          const at = piece.at + offset * 2
          yield { place, at, code: word.u16(at), piece: index, byte: -1 }
        }
      }
    }
  }

  /** The properties every character of a piece takes: Word 97's own, Word 6's written as Word 97's. */
  private pieceProperties(piece: number): Properties | undefined {
    const found = this.pieces[piece]
    const key = `piece:${piece}`
    const known = this.runProperties.get(key)
    if (known) return known.properties
    const { table, version } = this.file
    let properties: Properties | undefined
    if (found?.properties) {
      const { at, size } = found.properties
      properties = version === 97 ? { bytes: table, at, end: at + size } : wordProperties97(version, table, at, at + size, this.narrow.decode)
    } else if (found?.property !== undefined && version === 6)
      properties = wordProperties97(6, reader(Uint8Array.of(found.property & 0xff, found.property >> 8)), 0, 2, this.narrow.decode)
    if (properties) this.runProperties.set(key, { style: 0, properties })
    return properties
  }

  /** A run's characters' properties as Word 97 writes them. */
  private characterProperties(run: FormattedRun): Properties {
    const key = `characters:${run.at}`
    let known = this.runProperties.get(key)
    if (!known) {
      known = { style: 0, properties: characterRun(this.file.word, this.file.version, run, this.narrow.decode) }
      this.runProperties.set(key, known)
    }
    return known.properties
  }

  /** A character's properties: its paragraph style's, its character style's, its own, then its piece's. */
  private characterAt(at: number, style: number, piece: number): CharacterProperties {
    // Characters one after another are mostly of one run, or of none, of one style and piece: the last one's
    // properties are theirs.
    const run = runAt(this.characterRuns, at)
    const last = this.lastCharacter
    if (last && last.run === run && style === last.style && piece === last.piece) return last.found
    const found = this.characterOf(run, style, piece)
    this.lastCharacter = { run, style, piece, found }
    return found
  }

  private lastCharacter: { run: FormattedRun | undefined; style: number; piece: number; found: CharacterProperties } | undefined

  private characterOf(run: FormattedRun | undefined, style: number, piece: number): CharacterProperties {
    const key = `${run?.at ?? -1}:${style}:${piece}`
    let found = this.characterLooks.get(key)
    if (found) return found
    const paragraph = this.styles.character(style)
    let styled = paragraph
    found = { ...paragraph }
    const sources: (Properties | undefined)[] = [run && this.characterProperties(run), this.pieceProperties(piece)]
    for (const source of sources)
      for (const property of each(source)) {
        if (property.code === 0x4a30) {
          styled = this.styles.styled(paragraph, (source as Properties).bytes.u16(property.at))
          found = { ...styled, special: found.special, symbol: found.symbol }
        } else if (property.code === 0x2a33) found = { ...styled, special: found.special, symbol: found.symbol }
        else applyCharacter(found, (source as Properties).bytes, property, styled)
      }
    if (this.characterLooks.size < 20_000) this.characterLooks.set(key, found)
    return found
  }

  /** A paragraph's properties, by the place of its mark: its style's, its list level's, then its own and its piece's. */
  private paragraphAt(at: number, piece: number): ParagraphProperties {
    const run = runAt(this.paragraphRuns, at)
    const { data } = this.file
    const key = `paragraphs:${run?.at ?? -1}`
    let own = run && this.runProperties.get(key)
    if (run && !own) {
      own = paragraphRun(this.file.word, this.file.version, run, this.narrow.decode)
      this.runProperties.set(key, own)
    }
    const style = own?.style ?? 0
    const sources: (Properties | undefined)[] = [own?.properties, this.pieceProperties(piece)]
    const apply = (found: ParagraphProperties) => {
      for (const source of sources) {
        for (const property of each(source)) applyParagraph(found, (source as Properties).bytes, property, data)
        if (source?.numbering !== undefined) found.numbering = source.numbering
      }
      return found
    }
    const found = apply(copyParagraph(this.styles.paragraph(style)))
    const level = found.list > 0 ? this.lists.level(found.list, found.level) : undefined
    if (!level?.paragraph) return found
    // A list's level sets its indents over the style's, under the paragraph's own.
    const listed = copyParagraph(this.styles.paragraph(style))
    for (const property of each(level.paragraph)) applyParagraph(listed, level.paragraph.bytes, property, data)
    return apply(listed)
  }

  private fontName(index: number): string | undefined {
    return this.fonts[index]?.name || undefined
  }

  private readonly fontTables = new Map<number, string>()

  /**
   * A character of 8 bits as its font writes it: Word 6, 95 and 2 keep a character in the code page of its font's
   * character set (a Russian font's in Cyrillic, whatever the document's language), when that is another code page of
   * one byte a character than the document's.
   */
  private recoded(byte: number, code: number, font: number): number {
    const codePage = this.fonts[font]?.codePage
    if (byte < 0x80 || codePage === undefined || codePage === this.file.codePage || leadsTwoBytes(this.file.codePage, 0x81)) return code
    let table = this.fontTables.get(codePage)
    if (!table) {
      const decoder = codePageDecoder(codePage)
      table = Array.from({ length: 128 }, (_, index) => decoder.decode(Uint8Array.of(0x80 + index))[0] ?? '?').join('')
      this.fontTables.set(codePage, table)
    }
    return table.charCodeAt(byte - 0x80)
  }

  textLook(found: CharacterProperties): TextLook {
    const look: TextLook = {}
    const font = this.fontName(found.font)
    if (font) look.font = font
    look.size = found.size / 2
    if (found.color) look.color = found.color
    if (found.bold) look.bold = true
    if (found.italic) look.italic = true
    const underline = underlineOf(found.underline)
    if (underline) look.underline = underline
    if (found.struck) look.struck = true
    const highlight = found.highlight ?? found.shading
    if (highlight) look.highlight = highlight
    if (found.position === 1) look.position = 'super'
    else if (found.position === 2) look.position = 'sub'
    if (found.caps) look.caps = 'all'
    else if (found.smallCaps) look.caps = 'small'
    if (found.spacing !== 0) look.spacing = found.spacing / 20
    return look
  }

  private paragraphLook(found: ParagraphProperties): ParagraphLook {
    const look: ParagraphLook = {}
    const align = (['left', 'center', 'right', 'justify', 'justify'] as const)[found.align]
    if (align && align !== 'left') look.align = align
    if (found.left !== 0) look.start = found.left / 20
    if (found.right !== 0) look.end = found.right / 20
    if (found.first !== 0) look.firstLine = found.first / 20
    look.before = found.beforeAuto ? 14 : found.before / 20
    look.after = found.afterAuto ? 14 : found.after / 20
    const { value, multiple } = found.line
    if (multiple) {
      if (value > 0 && value !== 240) look.line = { rule: 'multiple', value: value / 240 }
    } else if (value !== 0) look.line = { rule: value < 0 ? 'exact' : 'least', value: Math.abs(value) / 20 }
    if (found.shading) look.shading = found.shading
    const [top, left, bottom, right] = found.borders.map(borderLook)
    if (top || left || bottom || right) look.borders = { top, left, bottom, right }
    const tabs = found.tabs.flatMap((tab): TabStop[] =>
      tab.align === 4
        ? []
        : [
            {
              position: tab.position / 20,
              align: tab.align === 1 ? 'center' : tab.align === 2 ? 'right' : tab.align === 3 ? 'decimal' : 'left',
              leader:
                tab.leader === 1 || tab.leader === 5 ? 'dot' : tab.leader === 2 ? 'hyphen' : tab.leader === 3 || tab.leader === 4 ? 'underscore' : undefined
            }
          ]
    )
    if (tabs.length > 0) look.tabs = tabs
    return look
  }

  /** The paragraph whose mark is the last of `characters`, its content in pieces, fields followed through it. */
  private readParagraph(characters: readonly WordCharacter[], story: Story, sectionEnds: ReadonlySet<number>): ParagraphRead {
    this.blocks++
    const markCharacter = characters.at(-1) as (typeof characters)[number]
    const ending = markCharacter.code === 0x0d || markCharacter.code === 0x07 || (markCharacter.code === 0x0c && sectionEnds.has(markCharacter.place + 1))
    const properties = this.paragraphAt(markCharacter.at, markCharacter.piece)
    const markProperties = this.characterAt(markCharacter.at, properties.style, markCharacter.piece)
    const mark = this.textLook(markProperties)
    const pieces: Piece[] = []
    const add = (piece: Piece) => {
      const last = pieces.at(-1)
      if (
        typeof piece !== 'string' &&
        'text' in piece &&
        last &&
        typeof last !== 'string' &&
        'text' in last &&
        last.look === piece.look &&
        last.link === piece.link
      )
        last.text += piece.text
      else pieces.push(piece)
    }
    const looks = new Map<CharacterProperties, TextLook>()
    const lookOf = (found: CharacterProperties) => {
      let look = looks.get(found)
      if (!look) {
        look = this.textLook(found)
        looks.set(found, look)
      }
      return look
    }
    const content = ending ? characters.slice(0, -1) : characters
    // Where Word last started a page, in the body but for its tables, whose rows it starts pages with.
    const breaks = story.body && !properties.inTable && this.pageStarts.size > 0
    if (breaks && this.pageStarts.has((characters[0] as WordCharacter).place)) pieces.push('page')
    for (const [index, character] of content.entries()) {
      const { code } = character
      if (breaks && index > 0 && this.pageStarts.has(character.place)) pieces.push('page')
      const field = story.fields.at(-1)
      if (code === 0x13) {
        story.fields.push({ code: '', result: false, replaced: false })
        continue
      }
      if (code === 0x14) {
        if (field) this.separateField(field, character.at, pieces, story, lookOf(this.characterAt(character.at, properties.style, character.piece)))
        continue
      }
      if (code === 0x15) {
        story.fields.pop()
        continue
      }
      // A field's code is not shown: only its result is.
      if (field && story.fields.some((one) => !one.result)) {
        if (!field.result) field.code += String.fromCharCode(code)
        continue
      }
      if (field && story.fields.some((one) => one.replaced)) continue
      const found = this.characterAt(character.at, properties.style, character.piece)
      if (found.hidden || found.deleted) continue
      const look = lookOf(found)
      const link = field && story.fields.findLast((one) => one.link)?.link
      if (code === 0x09) add({ tab: true, look })
      else if (code === 0x0b) add({ break: true })
      else if (code === 0x0c) add('page')
      else if (code === 0x0e) add({ break: true })
      else if (code === 0x1e) add({ text: '‑', look, link })
      else if (code === 0x01 && found.special) {
        const placed = this.inlineFigure(character.at, field)
        if (placed) add(placed)
      } else if (code === 0x08) {
        for (const placed of this.floatingFigure(character.place)) add(placed)
      } else if (code === 0x02 && found.special) {
        const note = this.noteAt(character.place, story)
        if (note) add({ note: note.mark, look, label: note.label })
      } else if (code === 0x28 && found.special && found.symbol) {
        // A symbol a font draws, as the character it stands for.
        const font = this.fontName(found.symbol.font)
        const symbol = found.symbol.code
        if (isSymbolFont(font)) add({ text: symbolCharacter(font as string, String.fromCharCode(symbol)), look: { ...look, font: undefined }, link })
        else add({ text: String.fromCharCode(symbol >= 0xf000 ? symbol - 0xf000 : symbol), look: font ? { ...look, font } : look, link })
      } else if (code >= 0x20) {
        // Text goes on the run before it when it is set alike, as most of it is.
        const text = String.fromCharCode(this.recoded(character.byte, code, found.font))
        const last = pieces.at(-1)
        if (last && typeof last !== 'string' && 'text' in last && last.look === look && last.link === link) last.text += text
        else pieces.push({ text, look, link })
      }
    }
    const paragraph: DocumentParagraph = { kind: 'paragraph', look: this.paragraphLook(properties), spans: [], mark }
    const heading = this.styles.heading(properties.style) ?? (properties.outline < 9 ? Math.min(properties.outline + 1, 6) : undefined)
    if (heading) paragraph.heading = heading
    const hidden = (markProperties.hidden || markProperties.deleted) && pieces.length === 0
    if (properties.list > 0 && !hidden && !(properties.inTable && properties.rowEnd)) {
      const numbered = this.lists.next(properties.list, properties.level)
      if (numbered && numbered.text !== '') {
        const found = { ...markProperties, underline: 0, highlight: undefined, shading: undefined }
        for (const property of each(numbered.level.character)) applyCharacter(found, numbered.level.character?.bytes as Reader, property, markProperties)
        const look = this.textLook(found)
        // A bullet of a font of symbols, as the character it stands for.
        const symbol = isSymbolFont(look.font)
        const text = symbol ? [...numbered.text].map((character) => symbolCharacter(look.font as string, character)).join('') : numbered.text
        paragraph.marker = {
          text: numbered.level.follow === 1 ? `${text} ` : text,
          look: symbol ? { ...look, font: undefined } : look,
          tab: numbered.level.follow === 0
        }
        if (numbered.level.align === 1) paragraph.marker.align = 'center'
        else if (numbered.level.align === 2) paragraph.marker.align = 'right'
      }
    } else if (properties.numbering > 0 && !(properties.inTable && properties.rowEnd)) {
      const marker = hidden ? undefined : this.autonumber(properties, markProperties, story)
      if (marker) paragraph.marker = marker
    } else if (story.numbers) story.numbers.run = undefined
    this.spaced.set(paragraph, {
      style: properties.style,
      contextual: properties.contextual,
      autoBefore: properties.beforeAuto,
      autoAfter: properties.afterAuto
    })
    return {
      paragraph,
      pieces,
      properties,
      cellEnd: markCharacter.code === 0x07,
      sectionEnd: markCharacter.code === 0x0c && ending,
      hidden,
      start: characters[0]?.place ?? markCharacter.place
    }
  }

  /**
   * Word 6's automatic number of a paragraph, as its description (`ANLD`) says: paragraphs numbered one after another
   * count on from the first one's start, a paragraph at an outline level counts at that level, the deeper ones starting
   * again, and a bulleted one shows its text alone; its text before and after the number, its format, and its own font,
   * size, colour, weight and slant over its paragraph mark's. A paragraph whose numbering pauses keeps the count.
   */
  private autonumber(properties: ParagraphProperties, mark: CharacterProperties, story: Story): DocumentParagraph['marker'] {
    const level = properties.numbering
    story.numbers ??= { run: undefined, outline: [] }
    const numbers = story.numbers
    if (level < 1 || level > 11) return undefined
    const anld = properties.anld
    const { bytes, at } = anld ?? { bytes: reader(new Uint8Array(ANLD_SIZE)), at: 0 }
    const start = anld ? bytes.u16(at + 10) : 1
    let count: number
    if (level >= 10) {
      count = numbers.run === undefined ? start : numbers.run + 1
      numbers.run = count
    } else {
      count = (numbers.outline[level - 1] ?? start - 1) + 1
      numbers.outline[level - 1] = count
      numbers.outline.length = level
    }
    // Its text: the characters before the number up to the first limit, those after it up to the second.
    const text = Array.from({ length: 32 }, (_, index) => String.fromCharCode(bytes.u16(at + 20 + index * 2)))
    const before = Math.min(bytes.u8(at + 1), 32)
    const after = Math.min(Math.max(bytes.u8(at + 2), before), 32)
    const flags = bytes.u8(at + 3)
    const format = NUMBER_FORMATS[bytes.u8(at)] ?? 'decimal'
    const shown =
      level === 11 || format === 'bullet' || format === 'none'
        ? ''
        : // A number that includes the levels above it shows them first, each followed by a point.
          `${
            flags & 4 && level <= 9
              ? numbers.outline
                  .slice(0, level - 1)
                  .map((upper) => `${upper ?? 1}.`)
                  .join('')
              : ''
          }${listMark(format, count)}`
    const found = { ...mark, underline: 0, highlight: undefined, shading: undefined }
    const set = bytes.u8(at + 4)
    if (anld) {
      if (flags & 0x10) found.bold = (set & 0x08) !== 0
      if (flags & 0x20) found.italic = (set & 0x10) !== 0
      if (flags & 0x40) found.smallCaps = (set & 0x20) !== 0
      if (flags & 0x80) found.caps = (set & 0x40) !== 0
      if (set & 0x01) found.struck = (set & 0x80) !== 0
      if (set & 0x02) found.underline = bytes.u8(at + 5) & 7
      if (bytes.u8(at + 5) >> 3) found.color = icoColor(bytes.u8(at + 5) >> 3)
      found.font = bytes.u16(at + 6)
      if (bytes.u16(at + 8) > 0) found.size = bytes.u16(at + 8)
    }
    const look = this.textLook(found)
    const symbol = isSymbolFont(look.font)
    const words = (from: number, to: number) => {
      const part = text.slice(from, to).join('').replace(/\0+$/, '')
      return symbol ? [...part].map((character) => symbolCharacter(look.font as string, character)).join('') : part
    }
    const written = `${set & 0x04 ? ' ' : ''}${words(0, before)}${shown}${words(before, after)}`
    if (written.trim() === '') return undefined
    // A number set with a hanging indent is followed by a tab to the text, else by a space.
    const hanging = (flags & 0x08) !== 0
    const marker: NonNullable<DocumentParagraph['marker']> = {
      text: hanging ? written : `${written} `,
      look: symbol ? { ...look, font: undefined } : look,
      tab: hanging
    }
    if ((flags & 3) === 1) marker.align = 'center'
    else if ((flags & 3) === 2) marker.align = 'right'
    return marker
  }

  /** A field's code is read: a page's number or the count of pages stands for its result, a link's result links. */
  private separateField(field: OpenField, at: number, pieces: Piece[], story: Story, look: TextLook): void {
    field.result = true
    const code = field.code.trim()
    const kind = /^PAGE\b/i.test(code) ? 'page' : /^(NUMPAGES|SECTIONPAGES)\b/i.test(code) ? 'pages' : undefined
    if (kind && !story.fields.some((one) => one !== field && one.replaced)) {
      pieces.push({ field: kind, look })
      field.replaced = true
    }
    const target = /^HYPERLINK\s+"([^"]+)"/i.exec(code)?.[1]
    if (target && /^(https?:|mailto:)/i.test(target)) field.link = target
    field.object = this.file.figures.object(at)
  }

  private inlineFigure(at: number, field: OpenField | undefined): DocumentSpan | undefined {
    const figure = this.file.figures.inline(at, { object: field?.object, chart: /^\s*EMBED\s+\S*Chart/i.test(field?.code ?? '') })
    const rule = figure === undefined ? this.file.figures.rule(at) : undefined
    if (rule)
      return {
        box: {
          width: (this.textWidth * rule.share) / 1000,
          height: rule.height,
          fill: rule.color ?? '#a0a0a0',
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
          blocks: []
        }
      }
    if (figure === undefined) return undefined
    const size = this.file.figures.size(figure)
    // An equation of Equation Editor or MathType is shown by its picture, its linear text the picture's words.
    return { placed: { figure, alt: this.file.figures.equation?.(field?.object) ?? '', width: size?.width, height: size?.height } }
  }

  /** A shape anchored at a character, placed as Word places it: at a side of the text it wraps, or at its place over it. */
  private floatingFigure(character: number): DocumentSpan[] {
    const anchor = this.file.figures.anchor(character)
    if (!anchor) return []
    const figure = this.file.figures.floating(character)
    if (figure !== undefined) return [{ placed: { figure, alt: '', width: anchor.width, height: anchor.height, ...this.floatingPlace(anchor) } }]
    // A box of text, or a group's boxes, each at its place within the group's, over the text.
    return this.file.figures.boxes(character).map((box): DocumentSpan => {
      const alone = box.left === 0 && box.top === 0 && box.width === anchor.width && box.height === anchor.height
      const at = this.floatingAt(anchor)
      return {
        box: {
          width: box.width,
          height: box.height,
          fill: box.fill,
          line: box.line && { width: box.line.width, style: 'solid', color: box.line.color },
          insets: box.insets,
          blocks: this.boxBlocks(box.shape),
          ...(alone ? this.floatingPlace(anchor) : { at: { ...at, x: at.x + box.left, y: at.y + box.top } })
        }
      }
    })
  }

  /**
   * Where a floating shape goes as Word places it: in the line when text wraps above and below it, at the side of the
   * text it is nearer when text wraps around it, at its place over the text when text does not wrap.
   */
  private floatingPlace(anchor: FloatingAnchor): Pick<PlacedFigure, 'float' | 'at'> {
    const section = this.current
    if (anchor.wrap === 1) return {}
    if (anchor.wrap === 3) return { at: this.floatingAt(anchor) }
    const x = anchor.left + (anchor.across === 'page' ? 0 : section.margins.left)
    return { float: x + anchor.width / 2 > section.width / 2 ? 'right' : 'left' }
  }

  /** A floating shape's place: across from the page's edge or the text's, down from the page's top or its paragraph's. */
  private floatingAt(anchor: FloatingAnchor): NonNullable<PlacedFigure['at']> {
    const { margins } = this.current
    const x = anchor.left + (anchor.across === 'page' ? 0 : margins.left)
    if (anchor.down === 'paragraph') return { x: x - margins.left, y: anchor.top, from: 'paragraph' }
    return { x, y: anchor.top + (anchor.down === 'page' ? 0 : margins.top), from: 'page' }
  }

  /** The text boxes' stories, by the shape each begins in. */
  private readonly textBoxes = new Map<number, { from: number; to: number }>()
  /** Each box's paragraphs once read, and whether one is being read: a box holds no other, though a damaged file may say so. */
  private readonly boxesRead = new Map<number, DocumentBlock[]>()
  private readingBox = false

  /**
   * Where each box's text is in its story (`PlcftxbxTxt`): a range of it for each box, named by the shape it begins in
   * (`lid`), its paragraphs' last mark ending it; a spare, kept for boxes to come, names none, as the last always is.
   */
  private readTextBoxes(part: WordPart, story: { start: number; length: number }): void {
    const { table } = this.file
    const place = this.file.part(part)
    const count = place.size >= 4 ? Math.min(Math.floor((place.size - 4) / 26), 10_000) : 0
    for (let index = 0; index < count - 1; index++) {
      const descriptor = place.at + (count + 1) * 4 + index * 22
      if (table.u16(descriptor + 8) !== 0) continue
      const shape = table.u32(descriptor + 14)
      const from = Math.min(table.u32(place.at + index * 4), story.length)
      const to = Math.min(table.u32(place.at + (index + 1) * 4), story.length)
      if (to > from && !this.textBoxes.has(shape)) this.textBoxes.set(shape, { from: story.start + from, to: story.start + to })
    }
  }

  /** A box's paragraphs, read from its story once; none for a box of no text, or within another box. */
  private boxBlocks(shape: number): DocumentBlock[] {
    const range = this.textBoxes.get(shape)
    if (!range || this.readingBox) return []
    let blocks = this.boxesRead.get(shape)
    if (!blocks) {
      this.readingBox = true
      try {
        blocks = this.readBlocks(range.from, range.to, { fields: [], body: false })
      } finally {
        this.readingBox = false
      }
      this.boxesRead.set(shape, blocks)
    }
    return blocks
  }

  /** The mark of a note whose reference is at a place of the body, its text read and kept for its page or the end; in a note, its own mark. */
  private noteAt(place: number, story: Story): { mark: number; label: string } | undefined {
    if (!story.body) return story.note
    const foot = this.footnotes.get(place)
    const end = foot ? undefined : this.endnotes.get(place)
    const range = foot ?? end
    if (!range) return undefined
    const kind = foot ? 'foot' : 'end'
    const mark = ++this.noteCounts[kind]
    const { first, format } = this.noteFormats[kind]
    const note = { mark, label: listMark(format, first + mark - 1) }
    const blocks = this.readBlocks(range.from, range.to, { fields: [], note, body: false })
    if (foot) this.noteQueue.push({ mark, blocks })
    else this.endNotes.push({ mark, blocks })
    return note
  }

  // Blocks

  /** The paragraphs of a range of the text, each read as its mark ends it. */
  private *paragraphs(from: number, to: number, story: Story, sectionEnds: ReadonlySet<number>): Generator<ParagraphRead> {
    let characters: WordCharacter[] = []
    for (const character of this.characters(from, Math.min(to, this.file.limit))) {
      characters.push(character)
      const { code } = character
      if (code === 0x0d || code === 0x07 || (code === 0x0c && sectionEnds.has(character.place + 1))) {
        yield this.readParagraph(characters, story, sectionEnds)
        characters = []
        if (this.full) {
          this.cut = true
          return
        }
      }
    }
    if (characters.length > 0) yield this.readParagraph(characters, story, sectionEnds)
    if (to > this.file.limit) this.cut = true
  }

  /**
   * A paragraph's pieces as its spans, or as its parts between the pages they break. As Word 97 to 2003 lays them out,
   * the line after a break, even empty, is on the next page: a paragraph that only breaks a page starts the next with an
   * empty line.
   */
  private split({ paragraph, pieces }: ParagraphRead): (DocumentParagraph | undefined)[] {
    const runs: DocumentSpan[][] = [[]]
    for (const piece of pieces) {
      if (piece === 'page') runs.push([])
      else runs.at(-1)?.push(piece)
    }
    if (runs.length === 1) {
      paragraph.spans = runs[0] ?? []
      return [paragraph]
    }
    const firstShown = runs.findIndex((spans) => spans.length > 0)
    const lastShown = runs.findLastIndex((spans) => spans.length > 0)
    const spacing = this.spaced.get(paragraph)
    return runs.map((spans, index) => {
      if (spans.length === 0 && index < runs.length - 1) return undefined
      const look = { ...paragraph.look }
      if (index > firstShown) {
        look.before = 0
        look.firstLine = 0
      }
      if (index < lastShown) look.after = 0
      const part: DocumentParagraph = { ...paragraph, look, spans, marker: index === firstShown ? paragraph.marker : undefined }
      if (spacing) this.spaced.set(part, spacing)
      return part
    })
  }

  /** A row's cells, their content and their properties, as a table's: built once the table ends. */
  private table(rows: RowRead[]): DocumentTable {
    // The table's columns are every edge of every row's cells, in twentieths of a point.
    const edgesOf = (row: RowRead) => {
      const edges = row.table?.edges ?? []
      if (edges.length >= 2) return edges
      const count = Math.max(1, row.cells.length)
      return Array.from({ length: count + 1 }, (_, index) => Math.round((index * this.textWidth * 20) / count))
    }
    const grid = [...new Set(rows.flatMap(edgesOf))].sort((one, other) => one - other)
    const column = (edge: number) => {
      let best = 0
      for (const [index, value] of grid.entries()) if (Math.abs(value - edge) < Math.abs((grid[best] as number) - edge)) best = index
      return best
    }
    const first = rows[0]?.table
    const table: DocumentTable = {
      kind: 'table',
      columns: grid.slice(1).map((edge, index) => Math.max(0, (edge - (grid[index] as number)) / 20)),
      rows: []
    }
    const align = first?.align === 1 ? 'center' : first?.align === 2 ? 'right' : undefined
    if (align) table.align = align
    else if (grid[0]) table.indent = (grid[0] as number) / 20
    // A cell merged down is part of the one that starts the merge, open in its column until a row ends it.
    const open = new Map<number, TableCell>()
    rows.forEach((row, rowIndex) => {
      const properties = row.table ?? plainTable()
      const edges = edgesOf(row)
      const cells: TableCell[] = []
      const last = rowIndex === rows.length - 1
      let previous: TableCell | undefined
      row.cells.forEach((blocks, index) => {
        const cell = properties.cells[index] ?? plainCell()
        const from = column(edges[index] ?? 0)
        const to = column(edges[index + 1] ?? edges.at(-1) ?? 0)
        // Merged across with the one before it: that cell spans its columns too.
        if (cell.flags & 2 && previous) {
          previous.columns += Math.max(0, to - from)
          return
        }
        if ((cell.flags & 0x60) === 0x20) {
          const above = open.get(from)
          if (above) {
            above.rows++
            return
          }
        }
        const lastCell = index === row.cells.length - 1
        // A cell's own border, in its colour in full when the row gives one, else the table's at its edge or between cells.
        const side = (at: number, outer: Border | undefined, inner: Border | undefined, edge: boolean) => {
          const own = cell.borders[at]
          if (!own || own.type === 0) return borderLook(edge ? outer : inner)
          return borderLook({ ...own, color: properties.colors[at]?.[index] ?? own.color })
        }
        const [top, left, bottom, right, across, down] = properties.borders
        const gap = properties.gapHalf / 20
        const padding = { left: gap, right: gap, ...properties.padding, ...cell.padding }
        const read: TableCell = {
          columns: Math.max(1, to - from),
          rows: 1,
          borders: {
            top: side(0, top, across, rowIndex === 0),
            left: side(1, left, down, index === 0),
            bottom: side(2, bottom, across, last),
            right: side(3, right, down, lastCell)
          },
          insets: padding,
          blocks: blocks.length > 0 ? blocks : [{ kind: 'paragraph', look: {}, spans: [], mark: {} }]
        }
        this.spaceContextually(read.blocks)
        if (cell.shading) read.shading = cell.shading
        if (cell.vertical === 1) read.vertical = 'middle'
        else if (cell.vertical === 2) read.vertical = 'bottom'
        if ((cell.flags & 0x60) === 0x60) open.set(from, read)
        else open.delete(from)
        cells.push(read)
        previous = read
      })
      const height = properties.height
      table.rows.push(height === 0 ? { cells } : { height: { value: Math.abs(height) / 20, exact: height < 0 }, cells })
    })
    return table
  }

  /**
   * The blocks of a range of the text, its tables assembled from their rows: a note's, a header's or a footer's, or the
   * body's, which are placed on pages as they are read.
   */
  private readBlocks(from: number, to: number, story: Story, sectionEnds: ReadonlySet<number> = new Set()): DocumentBlock[] {
    const blocks: DocumentBlock[] = []
    const out = (block: DocumentBlock) => {
      if (story.body) this.place(block)
      else blocks.push(block)
    }
    // A frame's paragraphs, one after another while their frame is the same; then the frames waiting for the paragraph
    // after them, which holds them, as Word anchors a frame to the paragraph after it.
    let frame: { key: string; properties: FrameProperties; blocks: DocumentBlock[] } | undefined
    let waiting: DocumentSpan[] = []
    const closeFrame = () => {
      if (!frame) return
      const placed = this.frameBox(frame.properties, frame.blocks)
      if ('kind' in placed) for (const block of placed.blocks) out(block)
      else waiting.push(placed)
      frame = undefined
    }
    const anchorWaiting = (mark: TextLook) => {
      if (waiting.length === 0) return
      out({ kind: 'paragraph', look: {}, spans: waiting, mark })
      waiting = []
    }
    // The tables open, the outermost first: one nested in a cell goes into that cell once it ends.
    const open: { rows: RowRead[]; row: RowRead }[] = []
    const closeTables = (depth: number) => {
      while (open.length > depth) {
        const { rows, row } = open.pop() as (typeof open)[number]
        if (row.cells.some((cell) => cell.length > 0)) rows.push(row)
        if (rows.length === 0) continue
        const parent = open.at(-1)
        if (parent) {
          parent.row.cells.at(-1)?.push(this.table(rows))
          continue
        }
        // Cut where Word last broke its pages, its heading rows written again at the top of each page.
        const body = rows.findIndex((one) => !one.table?.header)
        const heads = body > 0 ? rows.slice(0, body) : []
        let part: RowRead[] = []
        for (const [index, one] of rows.entries()) {
          if (one.newPage && index > 0 && part.length > 0) {
            out(this.table(part))
            this.breakPage()
            part = index > heads.length ? [...heads] : []
          }
          part.push(one)
        }
        out(this.table(part))
      }
    }
    for (const read of this.paragraphs(from, to, story, sectionEnds)) {
      const { properties } = read
      const depth = Math.min(properties.depth, 16)
      if (depth >= 1) {
        if (open.length === 0) {
          closeFrame()
          anchorWaiting(read.paragraph.mark)
        }
        closeTables(depth)
        while (open.length < depth) open.push({ rows: [], row: { cells: [[]], table: undefined } })
        const table = open[depth - 1] as (typeof open)[number]
        // A row of the outermost table ends with a mark of its own, a nested one's with a paragraph that says so.
        // An outermost row Word last started a page with, which it does at its first character.
        if (depth === 1 && story.body && table.row.cells.length === 1 && table.row.cells[0]?.length === 0 && this.pageStarts.has(read.start) && read.start > 0)
          table.row.newPage = true
        if (depth === 1 ? properties.rowEnd : properties.innerRowEnd) {
          table.row.cells.pop()
          table.row.table = properties.table
          table.rows.push(table.row)
          table.row = { cells: [[]], table: undefined }
          continue
        }
        const cellEnd = depth === 1 ? read.cellEnd : properties.innerCell
        if (!read.hidden || cellEnd) table.row.cells.at(-1)?.push(...this.split(read).filter((part) => part !== undefined))
        if (cellEnd) table.row.cells.push([])
        continue
      }
      closeTables(0)
      // A paragraph that only ends its section, empty, makes no line.
      if (read.hidden || (read.sectionEnd && read.pieces.length === 0)) continue
      if (framed(properties.frame)) {
        const key = JSON.stringify(properties.frame)
        if (frame?.key !== key) closeFrame()
        frame ??= { key, properties: properties.frame, blocks: [] }
        frame.blocks.push(...this.split(read).filter((part) => part !== undefined))
        continue
      }
      closeFrame()
      if (story.body && properties.pageBreakBefore) this.breakPage()
      const parts = this.split(read)
      parts.forEach((part, index) => {
        if (index > 0 && story.body) this.breakPage()
        if (!part) return
        if (waiting.length > 0) {
          part.spans.unshift(...waiting)
          waiting = []
        }
        out(part)
      })
    }
    closeTables(0)
    closeFrame()
    anchorWaiting(this.normal)
    this.spaceContextually(blocks)
    return blocks
  }

  /**
   * A frame's paragraphs as Word places them: at the side of the text it names, the text wrapping around it, when it
   * is down at its paragraph's place; centred in the text's width there, its paragraphs in the line; at its place over
   * the text otherwise, across from the page's edge or the text's, down from the page's top, the margin's or its
   * paragraph's. Its width and height are its own, or its content's.
   */
  private frameBox(frame: FrameProperties, blocks: DocumentBlock[]): DocumentSpan | { kind: 'blocks'; blocks: DocumentBlock[] } {
    const section = this.current
    const { margins } = section
    const box: TextBox = { insets: { top: 0, right: 0, bottom: 0, left: 0 }, blocks }
    if (frame.width > 0) box.width = frame.width / 20
    // The high bit of its height says it is at least that tall.
    if ((frame.height & 0x7fff) > 0) box.height = (frame.height & 0x7fff) / 20
    const across = frame.position === undefined ? 0 : (frame.position >> 6) & 3
    const down = frame.position === undefined ? 2 : (frame.position >> 4) & 3
    // A place by name: left 0, centre -4, right -8, inside -12, outside -16; down, at the text's place 0, top -4,
    // centre -8, bottom -12, inside -16, outside -20.
    const named = [0, -4, -8, -12, -16].includes(frame.x)
    const atParagraph = down >= 2 && (frame.y === 0 || frame.y === 1)
    if (frame.wrap !== 3 && atParagraph && named) {
      if (frame.x === -4)
        return { kind: 'blocks', blocks: blocks.map((block) => (block.kind === 'paragraph' ? { ...block, look: { ...block.look, align: 'center' } } : block)) }
      box.float = frame.x === -8 || frame.x === -16 ? 'right' : 'left'
      return { box }
    }
    const width = box.width ?? 0
    const height = box.height ?? 0
    const left = across === 2 ? 0 : margins.left
    const right = across === 2 ? section.width : section.width - margins.right
    const x = frame.x === -4 ? (left + right - width) / 2 : frame.x === -8 || frame.x === -16 ? right - width : named ? left : left + (frame.x - 1) / 20
    if (down >= 2) {
      const y = frame.y === 0 || frame.y <= -4 ? 0 : (frame.y - 1) / 20
      box.at = { x: x - margins.left, y, from: 'paragraph' }
      return { box }
    }
    const top = down === 1 ? 0 : margins.top
    const bottom = down === 1 ? section.height : section.height - margins.bottom
    const y =
      frame.y === -8 ? (top + bottom - height) / 2 : frame.y === -12 || frame.y === -20 ? bottom - height : frame.y <= 0 ? top : top + (frame.y - 1) / 20
    box.at = { x, y, from: 'page' }
    return { box }
  }

  /** The body, its blocks placed on pages, breaking where it says and between its sections. */
  readBody(): void {
    const text = this.file.lengths[0] ?? 0
    const story: Story = { fields: [], body: true }
    let from = 0
    for (const [index, section] of this.sections.entries()) {
      if (this.full || from >= text) break
      if (index > 0) this.endSection()
      const to = Math.min(section.end, text)
      this.readBlocks(from, to, story, new Set([to]))
      from = to
    }
    if (this.pages.length === 0) this.place({ kind: 'paragraph', look: {}, spans: [], mark: {} })
    for (const page of this.pages) for (const band of page.bands) this.spaceContextually(band.blocks)
  }

  /**
   * Paragraphs of one style next to each other, where their style says so, have no space between them; the automatic
   * space after one and before the next overlap, the larger kept.
   */
  private spaceContextually(blocks: DocumentBlock[]): void {
    blocks.forEach((block, index) => {
      const next = blocks[index + 1]
      if (block.kind !== 'paragraph' || next?.kind !== 'paragraph') return
      const one = this.spaced.get(block)
      const other = this.spaced.get(next)
      if (!one || !other) return
      if (one.style === other.style) {
        if (one.contextual) block.look.after = 0
        if (other.contextual) next.look.before = 0
      }
      if (one.autoAfter && other.autoBefore) next.look.before = Math.max(0, (next.look.before ?? 0) - (block.look.after ?? 0))
    })
  }

  // Headers and footers

  private readonly headerBlocks = new Map<string, DocumentBlock[]>()

  /**
   * A section's header or footer of a kind (0 even pages' header, 1 odd pages', 2 and 3 their footers, 4 the first
   * page's header, 5 its footer): its own, or the one a section before it has.
   */
  story(section: number, kind: number): DocumentBlock[] {
    const range = this.file.version === 97 ? this.headerRange(section, kind) : this.olderHeaderRange(section, kind)
    if (!range) return []
    const [text = 0, foot = 0] = this.file.lengths
    const key = `${range.from}:${range.to}`
    let blocks = this.headerBlocks.get(key)
    if (!blocks) {
      blocks = this.readBlocks(text + foot + range.from, text + foot + range.to, { fields: [], body: false })
      // The story's last paragraph mark ends it, and makes no line of its own.
      const last = blocks.at(-1)
      if (blocks.length > 1 && last?.kind === 'paragraph' && last.spans.length === 0 && !last.marker) blocks.pop()
      this.headerBlocks.set(key, blocks)
    }
    return blocks
  }

  /** Where a story of the headers' is (`PLCFHDD`), by its place in their list, within the headers' text. */
  private headerEntry(entry: number): { from: number; to: number } | undefined {
    const { table } = this.file
    const place = this.file.part('headers')
    const [, , header = 0] = this.file.lengths
    if (entry < 0 || entry + 1 >= Math.floor(place.size / 4)) return undefined
    const from = Math.min(table.u32(place.at + entry * 4), header)
    const to = Math.min(table.u32(place.at + (entry + 1) * 4), header)
    return to > from ? { from, to } : undefined
  }

  /** Word 97 lists six stories for the notes' separators, then six for each section, an empty one taking the one before. */
  private headerRange(section: number, kind: number): { from: number; to: number } | undefined {
    for (let index = section; index >= 0; index--) {
      const found = this.headerEntry(6 + index * 6 + kind)
      if (found) return found
    }
    return undefined
  }

  /**
   * Word 6 and 2 list only the stories each section says it has (`grpfIhdt`), after those of the notes' separators
   * the settings say there are: a section without one of a kind has none, and one whose story of that kind is empty
   * takes the section's before.
   */
  private olderHeaderRange(section: number, kind: number): { from: number; to: number } | undefined {
    const settings = this.file.part('settings')
    const count = (bits: number) => [0, 1, 2, 3, 4, 5].filter((bit) => bits & (1 << bit)).length
    const starts: number[] = []
    let next = settings.size >= 2 ? count(this.file.table.u16(settings.at) >> 8) : 0
    for (const found of this.sections.slice(0, section + 1)) {
      starts.push(next)
      next += count(found.headers)
    }
    for (let index = section; index >= 0; index--) {
      const headers = this.sections[index]?.headers ?? 0
      if (!(headers & (1 << kind))) return undefined
      const found = this.headerEntry((starts[index] ?? 0) + count(headers & ((1 << kind) - 1)))
      if (found && found.to - found.from >= 2) return found
    }
    return undefined
  }

  get normal(): TextLook {
    return this.textLook(this.styles.character(0))
  }
}

/** A font of the document: its name, and the code page its character set names, when it names one. */
interface WordFont {
  name: string
  codePage: number | undefined
}

/** The code pages of the character sets Windows names fonts by, those of one byte a character. */
const CHARACTER_SET_CODE_PAGES: Record<number, number> = { 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 }

/** The code pages the fonts of Windows 3.1 named by their last word, their character set left Western. */
const NAMED_CODE_PAGES: [RegExp, number][] = [
  [/ CE$/, 1250],
  [/ Cyr$/i, 1251],
  [/ Greek$/i, 1253],
  [/ Tur$/i, 1254],
  [/ Baltic$/i, 1257]
]

/**
 * The document's fonts (`SttbfFfn`), by their number: after their count in Word 97, each name in 16 bits 40 bytes into
 * its entry; after the table's length before it, each name in 8 bits, six bytes in in Word 6, three in Word 2, after
 * its character set (`chs`), which says which code page its characters of 8 bits are in.
 */
function readFonts({ table, version, part }: OlderWordFile, decode: (bytes: Uint8Array) => string): WordFont[] {
  const fonts: WordFont[] = []
  const place = part('fonts')
  if (place.size < 4) return fonts
  const count = version === 97 ? Math.min(table.u16(place.at), 4096) : 4096
  const end = place.at + place.size
  const named = version === 97 ? 40 : version === 6 ? 6 : 3
  for (let at = place.at + (version === 97 ? 4 : 2), index = 0; index < count && at < end; index++) {
    const size = table.u8(at) + 1
    const last = Math.min(at + size, end)
    let name = ''
    if (version === 97)
      for (let character = at + named; character + 2 <= last; character += 2) {
        const code = table.u16(character)
        if (code === 0) break
        name += String.fromCharCode(code)
      }
    else {
      let character = at + named
      while (character < last && table.u8(character) !== 0) character++
      if (at + named < character) name = decode(table.bytes(at + named, character - at - named))
    }
    // Word 97 writes every character its font does not name in Western European in 16 bits.
    const setAt = at + (version === 6 ? 4 : 2)
    const set = setAt < last ? table.u8(setAt) : 0
    const codePage = CHARACTER_SET_CODE_PAGES[set] ?? (set === 0 ? NAMED_CODE_PAGES.find(([pattern]) => pattern.test(name))?.[1] : undefined)
    fonts.push({ name, codePage: version === 97 ? undefined : codePage })
    at += size
  }
  return fonts
}

/** Word's formats of page numbers as `listMark` names them. */
const PAGE_FORMATS = ['decimal', 'upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter']

/**
 * A Word document's look, of Word 97 to 2003, 6 and 95, or 2: its pages as its sections lay them out, broken where Word
 * last broke them when it kept where, else where its text breaks them, each with its header, footer and footnotes, and
 * its endnotes at the end.
 */
export function readOlderWordLook(file: OlderWordFile): { look: DocumentLook; cut: boolean } {
  const wordReader = new OlderWordReader(file)
  wordReader.readBody()
  const settings = file.part('settings')
  const facing = settings.size >= 2 && (file.table.u16(settings.at) & 1) !== 0
  const tab = settings.size >= 12 ? file.table.u16(settings.at + 10) / 20 : 36
  const pages: DocumentPage[] = []
  let number = 0
  let previous = -1
  for (const page of wordReader.pages) {
    const section = wordReader.sections[page.section] ?? (wordReader.sections[0] as Section)
    const firstOfSection = page.section !== previous
    previous = page.section
    number = firstOfSection && section.restart ? section.first : number + 1
    const even = number % 2 === 0
    const kind = firstOfSection && section.titlePage ? 4 : even && facing ? 0 : 1
    pages.push({
      width: section.width,
      height: section.height,
      number: listMark(PAGE_FORMATS[section.format] ?? 'decimal', number),
      margins: section.margins,
      header: wordReader.story(page.section, kind),
      footer: wordReader.story(page.section, kind === 4 ? 5 : kind + 2),
      notes: page.notes,
      bands: page.bands.filter((band, index) => band.blocks.length > 0 || index === 0),
      vertical: section.vertical === 1 ? 'middle' : section.vertical === 3 ? 'bottom' : undefined
    })
  }
  return { look: { pages, endNotes: wordReader.endNotes, text: wordReader.normal, tab: Math.min(Math.max(tab || 36, 9), 288) }, cut: wordReader.cut }
}
