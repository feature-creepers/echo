/**
 * A Word document of 97 to 2003 as it looks (docs/SPEC.md, section 9.7), read into `document-look.ts` from the binary
 * records `binary-office.ts` finds: each paragraph and run in its style over the ones it comes from, then its own
 * properties (`sprm`s) and those of the piece of text it is in; lists numbered and bulleted as their list and its
 * overrides say at each level; tables with their columns, merged cells, row heights, borders, padding and shading;
 * pictures and charts in their line or floating; sections with their pages' size, margins and columns, their headers
 * and footers (first, odd and even pages) with the page's number and the count of pages; footnotes at their page's foot
 * and endnotes at the end. Word keeps no trace in these files of where it last broke their pages, so they break where
 * the text breaks them and between sections.
 */

import { type Reader, type WordProperty, wordProperties } from './binary-records.ts'
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
  TextLook
} from './document-look.ts'
import { BLOCK_LIMIT } from './office-text.ts'
import { isSymbolFont, listMark, symbolCharacter } from './word-look.ts'

/** Where a part of the file is, and how long it is. */
export interface WordPlace {
  at: number
  size: number
}

/**
 * A piece of the text: its characters' places in the text, where the file keeps them, in 8 bits or 16, and the
 * properties every character of it takes, in the table stream.
 */
export interface TextPiece {
  start: number
  end: number
  at: number
  narrow: boolean
  properties?: WordPlace | undefined
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
}

/** The figures of the document, as `binary-office.ts` reads them: in the text by the place of their character, floating by their anchor. */
export interface WordFigures {
  inline(place: number, field: { object?: number | undefined; chart: boolean }): number | undefined
  object(place: number): number | undefined
  floating(character: number): number | undefined
  anchor(character: number): FloatingAnchor | undefined
  /** The rule across the text a special character is, once its figure was asked for: its share of the width in thousandths, its height in points, its colour. */
  rule(place: number): { share: number; height: number; color: string | undefined } | undefined
  /** A figure's size in the text, in points. */
  size(figure: number): { width?: number | undefined; height?: number | undefined } | undefined
}

/** A Word 97 document's streams and the parts its header names, as `binary-office.ts` found them. */
export interface OlderWordFile {
  word: Reader
  table: Reader
  data: Reader | undefined
  /** A part of the table stream, by its place in the header's list (`FibRgFcLcb97`). */
  part(index: number): WordPlace
  /** The length of each story, in characters: the text, its footnotes, headers, macros, comments, endnotes and boxes. */
  lengths: readonly number[]
  pieces: readonly TextPiece[]
  figures: WordFigures
  /** Past this many characters of the text, the rest is left out. */
  limit: number
}

// Parts of the table stream, by their place in the header's list.
const PART = {
  styles: 1,
  footnoteReferences: 2,
  footnoteTexts: 3,
  sections: 6,
  headers: 11,
  characters: 12,
  paragraphs: 13,
  fonts: 15,
  settings: 31,
  endnoteReferences: 46,
  endnoteTexts: 47,
  lists: 73,
  listOverrides: 74
}

/** A list of properties and the stream it is in. */
interface Properties {
  bytes: Reader
  at: number
  end: number
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
}

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
  table: undefined
})

const copyParagraph = (found: ParagraphProperties): ParagraphProperties => ({
  ...found,
  borders: [...found.borders],
  tabs: [...found.tabs],
  table: found.table && copyTable(found.table)
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
    case 0x246d:
      found.contextual = bytes.u8(at) !== 0
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

/** The document's styles (`STSH`), each resolved over those it comes from when first asked for. */
class StyleSheet {
  private readonly styles: (WordStyle | undefined)[] = []
  private readonly font: number
  private readonly paragraphs = new Map<number, ParagraphProperties>()
  private readonly characters = new Map<number, CharacterProperties>()
  private readonly data: Reader | undefined

  constructor(table: Reader, place: WordPlace, data: Reader | undefined) {
    this.data = data
    let font = 0
    if (place.size >= 6) {
      const header = table.u16(place.at)
      const count = table.u16(place.at + 2)
      const base = table.u16(place.at + 4)
      if (header >= 14) font = table.u16(place.at + 2 + 12)
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
        const named = start + base
        let upx = named + 2 < at ? named + 2 + table.u16(named) * 2 + 2 : at
        const parts: Properties[] = []
        for (let count = length >= 6 ? table.u16(start + 4) & 0xf : 0; count > 0 && upx + 2 <= at; count--) {
          const size = table.u16(upx)
          parts.push({ bytes: table, at: upx + 2, end: Math.min(upx + 2 + size, at) })
          upx += 2 + size + (size & 1)
        }
        if (style.kind === 1) {
          // A paragraph style's paragraph properties follow the number of the style.
          const paragraph = parts[0]
          if (paragraph) style.paragraph = { ...paragraph, at: paragraph.at + 2 }
          style.character = parts[1]
        } else if (style.kind === 2) style.character = parts[0]
        this.styles.push(style)
      }
    }
    this.font = font
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
      for (const style of this.chain(index, 1))
        for (const property of each(style.paragraph)) applyParagraph(found, (style.paragraph as Properties).bytes, property, this.data)
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
}

/** A section's properties, from Word's defaults and those its `SEPX` sets. */
function readSection(word: Reader, at: number, end: number): Section {
  const found = { width: 12240, height: 15840, left: 1800, right: 1800, top: 1440, bottom: 1440, header: 720, footer: 720, gutter: 0 }
  const section = { columns: 1, gap: 720, start: 2, titlePage: false, restart: false, first: 1, format: 0 }
  if (at !== 0xffffffff && at + 2 <= word.length) {
    const length = word.u16(at)
    for (const { code, at: operand } of wordProperties(word, at + 2, Math.min(at + 2 + length, word.length)))
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
    format: section.format
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

/** A story being read: its open fields, and the mark of the note it is, when it is one. */
interface Story {
  fields: OpenField[]
  note?: { mark: number; label: string } | undefined
  body: boolean
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
}

/** A row being read: its cells' blocks, then its properties once its end is read. */
interface RowRead {
  cells: DocumentBlock[][]
  table: TableProperties | undefined
}

/** The runs of characters or paragraphs with properties of their own, from their pages (`FKP`) in the main stream. */
function formattedRuns(word: Reader, table: Reader, place: WordPlace, paragraphs: boolean): { start: number; end: number; at: number; size: number }[] {
  const runs: { start: number; end: number; at: number; size: number }[] = []
  const listed = place.size >= 4 ? Math.floor((place.size - 4) / 8) : 0
  for (let index = 0; index < listed; index++) {
    const page = (table.u32(place.at + (listed + 1) * 4 + index * 4) & 0x3fffff) * 512
    if (page + 512 > word.length) continue
    const count = Math.min(word.u8(page + 511), 101)
    for (let run = 0; run < count; run++) {
      const offset = word.u8(page + (count + 1) * 4 + run * (paragraphs ? 13 : 1)) * 2
      const start = word.u32(page + run * 4)
      const end = word.u32(page + (run + 1) * 4)
      if (offset === 0) {
        if (paragraphs) runs.push({ start, end, at: -1, size: 0 })
        continue
      }
      const length = word.u8(page + offset)
      if (!paragraphs) runs.push({ start, end, at: page + offset + 1, size: length })
      else if (length === 0) runs.push({ start, end, at: page + offset + 2, size: word.u8(page + offset + 1) * 2 })
      else runs.push({ start, end, at: page + offset + 1, size: length * 2 - 1 })
    }
  }
  return runs.sort((one, other) => one.start - other.start)
}

/** The run a place falls in, by halves. */
function runAt<Run extends { start: number; end: number }>(runs: readonly Run[], place: number): Run | undefined {
  let low = 0
  let high = runs.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const run = runs[middle] as Run
    if (place < run.start) high = middle - 1
    else if (place >= run.end) low = middle + 1
    else return run
  }
  return undefined
}

/** The characters of Windows' Western European code page, which Word 97 writes its 8-bit text in. */
const WESTERN = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, index) => index))

class OlderWordReader {
  private readonly file: OlderWordFile
  private readonly styles: StyleSheet
  private readonly lists: Lists
  private readonly fonts: string[]
  readonly sections: Section[]
  private section = 0
  private readonly characterRuns: ReturnType<typeof formattedRuns>
  private readonly paragraphRuns: ReturnType<typeof formattedRuns>
  private readonly characterLooks = new Map<string, CharacterProperties>()
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
    const { word, table, data } = file
    this.styles = new StyleSheet(table, file.part(PART.styles), data)
    this.lists = new Lists(table, file.part(PART.lists), file.part(PART.listOverrides))
    this.fonts = readFonts(table, file.part(PART.fonts))
    this.characterRuns = formattedRuns(word, table, file.part(PART.characters), false)
    this.paragraphRuns = formattedRuns(word, table, file.part(PART.paragraphs), true)
    this.pieces = [...file.pieces].sort((one, other) => one.start - other.start)
    const [text = 0, foot = 0, header = 0, macro = 0, comment = 0] = file.lengths
    const [, , , , , end = 0] = file.lengths
    this.readNotes(this.footnotes, PART.footnoteReferences, PART.footnoteTexts, { start: text, length: foot })
    this.readNotes(this.endnotes, PART.endnoteReferences, PART.endnoteTexts, { start: text + foot + header + macro + comment, length: end })
    this.budget = file.limit * 2
    this.sections = this.readSections(text)
    // The settings keep each kind of note's first number, and their formats in the bits Word 6 put them in.
    const settings = file.part(PART.settings)
    const formats = settings.size >= 0x38 ? table.u16(settings.at + 0x36) : 0
    const first = (at: number) => (settings.size >= at + 2 ? Math.max(1, table.u16(settings.at + at) >> 2) : 1)
    this.noteFormats = {
      foot: { first: first(2), format: PAGE_FORMATS[(formats >> 2) & 15] ?? 'decimal' },
      end: { first: first(0x34), format: PAGE_FORMATS[(formats >> 6) & 15] ?? 'lowerRoman' }
    }
  }

  /** Where each note's reference is in the text, and where its own text is in its story, kept within that story. */
  private readNotes(notes: Map<number, { from: number; to: number }>, references: number, texts: number, story: { start: number; length: number }): void {
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

  private readSections(text: number): Section[] {
    const { word, table } = this.file
    const place = this.file.part(PART.sections)
    const count = place.size >= 4 ? Math.min(Math.floor((place.size - 4) / 16), 1000) : 0
    const sections: Section[] = []
    for (let index = 0; index < count; index++) {
      const descriptor = place.at + (count + 1) * 4 + index * 12
      sections.push(readSection(word, table.u32(descriptor + 2), table.u32(place.at + (index + 1) * 4)))
    }
    if (sections.length === 0) sections.push(readSection(word, 0xffffffff, text))
    return sections
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
  private *characters(from: number, to: number): Generator<{ place: number; at: number; code: number; piece: number }> {
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
          const at = piece.at + offset
          yield { place, at, code: WESTERN.charCodeAt(word.u8(at)), piece: index }
        } else {
          const at = piece.at + offset * 2
          yield { place, at, code: word.u16(at), piece: index }
        }
      }
    }
  }

  private pieceProperties(piece: number): Properties | undefined {
    const place = this.pieces[piece]?.properties
    return place && { bytes: this.file.table, at: place.at, end: place.at + place.size }
  }

  /** A character's properties: its paragraph style's, its character style's, its own, then its piece's. */
  private characterAt(at: number, style: number, piece: number): CharacterProperties {
    const run = runAt(this.characterRuns, at)
    const key = `${run?.at ?? -1}:${style}:${piece}`
    let found = this.characterLooks.get(key)
    if (found) return found
    const paragraph = this.styles.character(style)
    let styled = paragraph
    found = { ...paragraph }
    const sources: (Properties | undefined)[] = [run && { bytes: this.file.word, at: run.at, end: run.at + run.size }, this.pieceProperties(piece)]
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
    const { word, data } = this.file
    const style = run && run.at >= 0 && run.size >= 2 ? word.u16(run.at) : 0
    const sources: (Properties | undefined)[] = [
      run && run.at >= 0 ? { bytes: word, at: run.at + 2, end: run.at + run.size } : undefined,
      this.pieceProperties(piece)
    ]
    const apply = (found: ParagraphProperties) => {
      for (const source of sources) for (const property of each(source)) applyParagraph(found, (source as Properties).bytes, property, data)
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
    return this.fonts[index] || undefined
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
  private readParagraph(
    characters: readonly { place: number; at: number; code: number; piece: number }[],
    story: Story,
    sectionEnds: ReadonlySet<number>
  ): ParagraphRead {
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
    for (const character of content) {
      const { code } = character
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
      if (story.fields.some((one) => !one.result)) {
        if (field && !field.result) field.code += String.fromCharCode(code)
        continue
      }
      if (story.fields.some((one) => one.replaced)) continue
      const found = this.characterAt(character.at, properties.style, character.piece)
      if (found.hidden || found.deleted) continue
      const look = lookOf(found)
      const link = story.fields.findLast((one) => one.link)?.link
      if (code === 0x09) add({ tab: true, look })
      else if (code === 0x0b) add({ break: true })
      else if (code === 0x0c) add('page')
      else if (code === 0x0e) add({ break: true })
      else if (code === 0x1e) add({ text: '‑', look, link })
      else if (code === 0x01 && found.special) {
        const placed = this.inlineFigure(character.at, field)
        if (placed) add(placed)
      } else if (code === 0x08) {
        const placed = this.floatingFigure(character.place)
        if (placed) add(placed)
      } else if (code === 0x02 && found.special) {
        const note = this.noteAt(character.place, story)
        if (note) add({ note: note.mark, look, label: note.label })
      } else if (code === 0x28 && found.special && found.symbol) {
        // A symbol a font draws, as the character it stands for.
        const font = this.fontName(found.symbol.font)
        const symbol = found.symbol.code
        if (isSymbolFont(font)) add({ text: symbolCharacter(font as string, String.fromCharCode(symbol)), look: { ...look, font: undefined }, link })
        else add({ text: String.fromCharCode(symbol >= 0xf000 ? symbol - 0xf000 : symbol), look: font ? { ...look, font } : look, link })
      } else if (code >= 0x20) add({ text: String.fromCharCode(code), look, link })
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
    }
    this.spaced.set(paragraph, {
      style: properties.style,
      contextual: properties.contextual,
      autoBefore: properties.beforeAuto,
      autoAfter: properties.afterAuto
    })
    return { paragraph, pieces, properties, cellEnd: markCharacter.code === 0x07, sectionEnd: markCharacter.code === 0x0c && ending, hidden }
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
    return { placed: { figure, alt: '', width: size?.width, height: size?.height } }
  }

  /** A shape anchored at a character, placed as Word places it: at a side of the text it wraps, or at its place over it. */
  private floatingFigure(character: number): DocumentSpan | undefined {
    const figure = this.file.figures.floating(character)
    const anchor = this.file.figures.anchor(character)
    if (figure === undefined || !anchor) return undefined
    const placed: PlacedFigure = { figure, alt: '', width: anchor.width, height: anchor.height }
    const section = this.current
    const { margins } = section
    // Across, from the page's left edge.
    const x = anchor.left + (anchor.across === 'page' ? 0 : margins.left)
    if (anchor.wrap === 1) return { placed }
    if (anchor.wrap !== 3) placed.float = x + anchor.width / 2 > section.width / 2 ? 'right' : 'left'
    else if (anchor.down === 'paragraph') placed.at = { x: x - margins.left, y: anchor.top, from: 'paragraph' }
    else placed.at = { x, y: anchor.top + (anchor.down === 'page' ? 0 : margins.top), from: 'page' }
    return { placed }
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
    let characters: { place: number; at: number; code: number; piece: number }[] = []
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
    // The tables open, the outermost first: one nested in a cell goes into that cell once it ends.
    const open: { rows: RowRead[]; row: RowRead }[] = []
    const closeTables = (depth: number) => {
      while (open.length > depth) {
        const { rows, row } = open.pop() as (typeof open)[number]
        if (row.cells.some((cell) => cell.length > 0)) rows.push(row)
        if (rows.length === 0) continue
        const table = this.table(rows)
        const parent = open.at(-1)
        if (parent) parent.row.cells.at(-1)?.push(table)
        else out(table)
      }
    }
    for (const read of this.paragraphs(from, to, story, sectionEnds)) {
      const { properties } = read
      const depth = Math.min(properties.depth, 16)
      if (depth >= 1) {
        closeTables(depth)
        while (open.length < depth) open.push({ rows: [], row: { cells: [[]], table: undefined } })
        const table = open[depth - 1] as (typeof open)[number]
        // A row of the outermost table ends with a mark of its own, a nested one's with a paragraph that says so.
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
      if (story.body && properties.pageBreakBefore) this.breakPage()
      const parts = this.split(read)
      parts.forEach((part, index) => {
        if (index > 0 && story.body) this.breakPage()
        if (part) out(part)
      })
    }
    closeTables(0)
    this.spaceContextually(blocks)
    return blocks
  }

  /** The body, its blocks placed on pages, breaking where it says and between its sections. */
  readBody(): void {
    const text = this.file.lengths[0] ?? 0
    let from = 0
    for (const [index, section] of this.sections.entries()) {
      if (this.full || from >= text) break
      if (index > 0) this.endSection()
      const to = Math.min(section.end, text)
      this.readBlocks(from, to, { fields: [], body: true }, new Set([to]))
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
    const { table } = this.file
    const place = this.file.part(PART.headers)
    const count = Math.floor(place.size / 4)
    const [text = 0, foot = 0, header = 0] = this.file.lengths
    for (let index = section; index >= 0; index--) {
      const entry = 6 + index * 6 + kind
      if (entry + 1 >= count) continue
      const from = Math.min(table.u32(place.at + entry * 4), header)
      const to = Math.min(table.u32(place.at + (entry + 1) * 4), header)
      if (to <= from) continue
      const key = `${from}:${to}`
      let blocks = this.headerBlocks.get(key)
      if (!blocks) {
        blocks = this.readBlocks(text + foot + from, text + foot + to, { fields: [], body: false })
        // The story's last paragraph mark ends it, and makes no line of its own.
        const last = blocks.at(-1)
        if (blocks.length > 1 && last?.kind === 'paragraph' && last.spans.length === 0 && !last.marker) blocks.pop()
        this.headerBlocks.set(key, blocks)
      }
      return blocks
    }
    return []
  }

  get normal(): TextLook {
    return this.textLook(this.styles.character(0))
  }
}

/** The names of the document's fonts (`SttbfFfn`), by their number. */
function readFonts(table: Reader, place: WordPlace): string[] {
  const fonts: string[] = []
  if (place.size < 4) return fonts
  const count = Math.min(table.u16(place.at), 4096)
  const end = place.at + place.size
  for (let at = place.at + 4, index = 0; index < count && at < end; index++) {
    const size = table.u8(at) + 1
    let name = ''
    for (let character = at + 40; character + 2 <= Math.min(at + size, end); character += 2) {
      const code = table.u16(character)
      if (code === 0) break
      name += String.fromCharCode(code)
    }
    fonts.push(name)
    at += size
  }
  return fonts
}

/** Word's formats of page numbers as `listMark` names them. */
const PAGE_FORMATS = ['decimal', 'upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter']

/**
 * A Word 97 document's look: its pages as its sections lay them out, broken where its text breaks them, each with its
 * header, footer and footnotes, and its endnotes at the end.
 */
export function readOlderWordLook(file: OlderWordFile): { look: DocumentLook; cut: boolean } {
  const reader = new OlderWordReader(file)
  reader.readBody()
  const settings = file.part(PART.settings)
  const facing = settings.size >= 2 && (file.table.u16(settings.at) & 1) !== 0
  const tab = settings.size >= 12 ? file.table.u16(settings.at + 10) / 20 : 36
  const pages: DocumentPage[] = []
  let number = 0
  let previous = -1
  for (const page of reader.pages) {
    const section = reader.sections[page.section] ?? (reader.sections[0] as Section)
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
      header: reader.story(page.section, kind),
      footer: reader.story(page.section, kind === 4 ? 5 : kind + 2),
      notes: page.notes,
      bands: page.bands.filter((band, index) => band.blocks.length > 0 || index === 0)
    })
  }
  return { look: { pages, endNotes: reader.endNotes, text: reader.normal, tab: Math.min(Math.max(tab || 36, 9), 288) }, cut: reader.cut }
}
