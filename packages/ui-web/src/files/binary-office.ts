/**
 * The older Office formats read in the window itself, with no service and no library (docs/SPEC.md, section 9.7):
 * the documents of Word 6 to 2003 (.doc), the workbooks of Excel 5 to 2003 (.xls) and the presentations of PowerPoint
 * 97 to 2003 (.ppt). Each is a compound file (`compound.ts`) whose streams hold the binary records each app wrote,
 * read for what a preview shows, as the newer formats are: a document as Markdown, a workbook's sheets as tables, the
 * text of each slide, and the pictures of each (`office-art.ts`).
 *
 * Every offset read is checked against its stream, so a damaged file fails with a sentence rather than reading past
 * its end. A file protected with a password says so.
 */

import { type ChartContext, type ChartRecord, readOlderChart } from './binary-chart.ts'
import { openCompound } from './compound.ts'
import { builtInFormat, formatNumber, generalNumber, type NumberFormatOptions } from './number-format.ts'
import { ART, ArtFigures, type ArtRecord, artRecords, artShape, artShapes, childOf, type StoredPicture, storedPictures, twipPixels } from './office-art.ts'
import { type CellValue, cellRange } from './office-figures.ts'
import {
  BLOCK_LIMIT,
  COLUMN_LIMIT,
  figureMark,
  joinBlocks,
  markdownTable,
  type OfficeFigure,
  type OfficePreview,
  PROTECTED,
  plain,
  ROW_LIMIT,
  SHEET_LIMIT,
  SLIDE_LIMIT
} from './office-text.ts'

/** The most characters of a document read: past them, a preview shows the start. */
const CHARACTER_LIMIT = 4_000_000

const damaged = (): never => {
  throw new Error('The file is damaged: its text could not be read.')
}

/** Little-endian numbers from bytes, each read checked against their end. */
function reader(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const within = (at: number, size: number) => at >= 0 && at + size <= bytes.length
  return {
    length: bytes.length,
    u8: (at: number) => (within(at, 1) ? data.getUint8(at) : damaged()),
    u16: (at: number) => (within(at, 2) ? data.getUint16(at, true) : damaged()),
    i16: (at: number) => (within(at, 2) ? data.getInt16(at, true) : damaged()),
    u32: (at: number) => (within(at, 4) ? data.getUint32(at, true) : damaged()),
    f64: (at: number) => (within(at, 8) ? data.getFloat64(at, true) : damaged()),
    bytes: (at: number, size: number) => (within(at, size) ? bytes.subarray(at, at + size) : damaged())
  }
}
type Reader = ReturnType<typeof reader>

/** Text of 8-bit characters whose high byte is zero, as Excel and PowerPoint write it. */
const latin1 = (bytes: Uint8Array) => {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}
const utf16 = (bytes: Uint8Array) => new TextDecoder('utf-16le').decode(bytes)

// Word

/** What a preview needs of a paragraph's formatting: its style, whether it is in a table or ends a row, its list. */
interface ParagraphFormat {
  style: number
  inTable: boolean
  rowEnd: boolean
  list: boolean
  level: number
  /** Its outline level, set on it directly: 0 to 8 for a heading's 1 to 9. */
  outline?: number
}

/** How many bytes a property's operand takes, from the property's code, or from its operand when it says. */
function operandSize(property: number, word: Reader, at: number): number {
  switch ((property >> 13) & 7) {
    case 0:
    case 1:
      return 1
    case 2:
    case 4:
    case 5:
      return 2
    case 3:
      return 4
    case 7:
      return 3
  }
  // A table's definition counts its operand in two bytes, the rest of it plus one.
  if (property === 0xd608 || property === 0xd606) return word.u16(at) + 1
  // Tab stops changed, past 255 of them, list what they take away and add.
  if (property === 0xc615 && word.u8(at) === 255) {
    const removed = word.u8(at + 1)
    return 3 + removed * 4 + word.u8(at + 2 + removed * 4) * 3
  }
  return word.u8(at) + 1
}

/** A paragraph's format, from its style and the properties set on it (`grpprl`). */
function paragraphFormat(word: Reader, at: number, size: number): ParagraphFormat {
  const format: ParagraphFormat = { style: word.u16(at), inTable: false, rowEnd: false, list: false, level: 0 }
  let place = at + 2
  const end = at + size
  while (place + 2 <= end) {
    const property = word.u16(place)
    place += 2
    const operand = operandSize(property, word, place)
    if (property === 0x2416) format.inTable = word.u8(place) !== 0
    else if (property === 0x2417) format.rowEnd = word.u8(place) !== 0
    else if (property === 0x6649) format.inTable = word.u32(place) > 0
    else if (property === 0x460b) format.list = word.u16(place) !== 0
    else if (property === 0x260a) format.level = Math.min(word.u8(place), 8)
    else if (property === 0x2640) format.outline = word.u8(place)
    place += operand
  }
  return format
}

/**
 * The heading level of each style a document defines: the built-in headings and title, or a style named as one. Its
 * names are in UTF-16 (`wide`, Word 97) or 8-bit (Word 6 and 95).
 */
function headingStyles(table: Reader, at: number, size: number, wide: boolean): Map<number, number> {
  const levels = new Map<number, number>()
  if (size < 4) return levels
  const header = table.u16(at)
  const count = table.u16(at + 2)
  const base = table.u16(at + 4)
  let place = at + 2 + header
  const end = at + size
  for (let style = 0; style < count && place + 2 <= end; style++) {
    const length = table.u16(place)
    if (length >= 2 && place + 2 + length <= end) {
      // Built-in styles are known by their number whatever the language of their names: 1 to 9 the headings.
      const builtIn = table.u16(place + 2) & 0x0fff
      let name = ''
      const named = place + 2 + base
      if (wide && base > 0 && named + 2 <= place + 2 + length) {
        const characters = Math.min(table.u16(named), (place + 2 + length - named - 2) >> 1)
        name = utf16(table.bytes(named + 2, characters * 2)).toLowerCase()
      } else if (!wide && base > 0 && named + 1 <= place + 2 + length) {
        const characters = Math.min(table.u8(named), place + 2 + length - named - 1)
        name = latin1(table.bytes(named + 1, characters)).toLowerCase()
      }
      const level =
        builtIn >= 1 && builtIn <= 9
          ? builtIn
          : builtIn === 62 || name === 'title'
            ? 1
            : builtIn === 74 || name === 'subtitle'
              ? 2
              : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0)
      if (level > 0) levels.set(style, Math.min(level, 6))
    }
    place += 2 + length
  }
  return levels
}

/**
 * How many bytes a property of Word 6 and 95 takes with its one-byte code: most a fixed size by their code, some
 * counting their operand in their first byte, tab stops past 255 in their own way.
 */
function sixPropertySize(word: Reader, at: number): number {
  const code = word.u8(at)
  if (TWO_BYTE_OPERANDS.has(code)) return 3
  if (COUNTED_OPERANDS.has(code)) return 2 + word.u8(at + 1)
  if (FOUR_BYTE_OPERANDS.has(code)) return 5
  if (code === 23) {
    const size = word.u8(at + 1)
    if (size !== 255) return 2 + size
    const removed = word.u8(at + 2)
    return 2 + 2 + removed * 4 + word.u8(at + 3 + removed * 4) * 3
  }
  if (code === 68 || code === 193 || code === 199) return 6
  if (code === 73 || code === 95 || code === 136 || code === 137) return 4
  if (code === 120 || code === 187) return 13
  return 2
}

const TWO_BYTE_OPERANDS = new Set([
  2, 16, 17, 18, 19, 21, 22, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 69, 72, 80, 93, 96, 97, 99, 101, 105, 106, 107,
  109, 110, 121, 122, 123, 124, 140, 141, 144, 145, 148, 149, 154, 155, 156, 157, 160, 161, 164, 165, 166, 167, 168, 169, 170, 171, 182, 183, 184, 189, 195,
  197, 198
])
const COUNTED_OPERANDS = new Set([3, 12, 15, 81, 103, 108, 188, 190, 191])
const FOUR_BYTE_OPERANDS = new Set([20, 70, 74, 192, 194, 196, 200])

/**
 * A paragraph's format in Word 6 and 95, from its style and its properties, each a one-byte code: in a table (24),
 * ending a row (25), numbered or bulleted at a level (13, `nLvlAnm`, 1 to 9 an outline's levels, more a list of one).
 */
function sixParagraphFormat(word: Reader, at: number, size: number): ParagraphFormat {
  const format: ParagraphFormat = { style: word.u16(at), inTable: false, rowEnd: false, list: false, level: 0 }
  let place = at + 2
  const end = at + size
  while (place + 1 < end) {
    const code = word.u8(place)
    if (code === 24) format.inTable = (word.u8(place + 1) & 1) !== 0
    else if (code === 25) format.rowEnd = (word.u8(place + 1) & 1) !== 0
    else if (code === 13) {
      const level = word.u8(place + 1)
      format.list = level > 0
      format.level = level >= 1 && level <= 9 ? level - 1 : 0
    }
    place += sixPropertySize(word, place)
  }
  return format
}

/** The code page of a language's 8-bit text, as Windows wrote it, by the language's identifier. */
export function languageCodePage(language: number): number {
  const primary = language & 0x3ff
  if (primary === 0x1a) return language === 0x0c1a ? 1251 : 1250
  if (primary === 0x04) return language === 0x0804 || language === 0x1004 ? 936 : 950
  return LANGUAGE_CODE_PAGES[primary] ?? 1252
}

const LANGUAGE_CODE_PAGES: Record<number, number> = {
  2: 1251,
  25: 1251,
  34: 1251,
  35: 1251,
  47: 1251,
  63: 1251,
  5: 1250,
  14: 1250,
  21: 1250,
  24: 1250,
  27: 1250,
  28: 1250,
  36: 1250,
  8: 1253,
  31: 1254,
  13: 1255,
  1: 1256,
  32: 1256,
  41: 1256,
  37: 1257,
  38: 1257,
  39: 1257,
  42: 1258,
  30: 874,
  17: 932,
  18: 949
}

/** A decoder of 8-bit text in a Windows code page; Western European for one the window does not know. */
export function codePageDecoder(codePage: number): TextDecoder {
  const label =
    codePage >= 1250 && codePage <= 1258
      ? `windows-${codePage}`
      : (
          { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 1200: 'utf-16le', 65001: 'utf-8' } as Record<
            number,
            string
          >
        )[codePage]
  try {
    return new TextDecoder(label ?? 'windows-1252')
  } catch {
    return new TextDecoder('windows-1252')
  }
}

/** Where a part of a Word document is in its table stream, and how long it is. */
interface WordPlace {
  at: number
  size: number
}

/** The runs of characters of a Word 97 document that have properties of their own, from their pages, in order. */
function characterRuns(word: Reader, table: Reader, place: WordPlace): { start: number; end: number; at: number; size: number }[] {
  const runs: { start: number; end: number; at: number; size: number }[] = []
  const listed = place.size >= 4 ? Math.floor((place.size - 4) / 8) : 0
  for (let index = 0; index < listed; index++) {
    const page = (table.u32(place.at + (listed + 1) * 4 + index * 4) & 0x3fffff) * 512
    if (page + 512 > word.length) continue
    const count = Math.min(word.u8(page + 511), 101)
    for (let run = 0; run < count; run++) {
      const offset = word.u8(page + (count + 1) * 4 + run) * 2
      if (offset > 0) runs.push({ start: word.u32(page + run * 4), end: word.u32(page + (run + 1) * 4), at: page + offset + 1, size: word.u8(page + offset) })
    }
  }
  return runs.sort((one, other) => one.start - other.start)
}

/** What a run of characters says of the special character it holds: where its picture is, and whether it is an object. */
function characterPicture(word: Reader, at: number, size: number): { location?: number; object: boolean; data: boolean } {
  const found: { location?: number; object: boolean; data: boolean } = { object: false, data: false }
  let place = at
  while (place + 2 <= at + size) {
    const property = word.u16(place)
    place += 2
    const operand = operandSize(property, word, place)
    if (property === 0x6a03) found.location = word.u32(place)
    else if (property === 0x080a) found.object = word.u8(place) !== 0
    else if (property === 0x0806) found.data = word.u8(place) !== 0
    place += operand
  }
  return found
}

/**
 * The pictures of a Word 97 document. One in its text is a character whose run names where it is in the `Data`
 * stream: a header (`PICF`) with its size, then its shape and the entry of the store that holds it. One floating over
 * the text is anchored at a character, and drawn from the document's OfficeArt, in its table stream, its picture kept
 * in the main stream. A picture that cannot be read is left out: the text is still worth showing.
 */
function wordPictures(
  word: Reader,
  main: Uint8Array,
  table: Reader,
  tableBytes: Uint8Array,
  data: Uint8Array | undefined,
  places: { characters: WordPlace; anchors: WordPlace; drawings: WordPlace }
) {
  const figures = new ArtFigures()
  let runs: ReturnType<typeof characterRuns> | undefined
  const runAt = (place: number) => {
    runs ??= characterRuns(word, table, places.characters)
    let low = 0
    let high = runs.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const run = runs[middle] as (typeof runs)[number]
      if (place < run.start) high = middle - 1
      else if (place >= run.end) low = middle + 1
      else return run
    }
    return undefined
  }

  // A picture in the text: its header gives its size, in twentieths of a point scaled by thousandths.
  const inline = (location: number): number | undefined => {
    if (!data) return figures.unshown('', 'picture')
    const picture = reader(data)
    const length = picture.u32(location)
    const header = picture.u16(location + 4)
    const mode = picture.u16(location + 6)
    const scaled = (goal: number, scale: number) => twipPixels((picture.i16(location + goal) * (picture.u16(location + scale) || 1000)) / 1000)
    const size = { width: scaled(0x1c, 0x20), height: scaled(0x1e, 0x22) }
    // A picture of Word 6's kind, a metafile of its own, is one its app shows.
    if (mode !== 0x64 && mode !== 0x66) return figures.picture(`data:${location}`, undefined, '', size)
    let at = location + header
    if (mode === 0x66) at += 1 + picture.u8(at)
    const end = Math.min(location + length, data.length)
    let shape: ReturnType<typeof artShape>
    let entries = end
    for (const record of artRecords(data, at, end)) {
      if (record.type === ART.shape) {
        shape = artShape(data, record)
        entries = record.at + record.size
        break
      }
    }
    // The shape names its picture by its place in the document's store; the entry after it holds that picture itself.
    const stored = storedPictures(data, { type: ART.store, instance: 0, container: true, at: entries, size: end - entries })
    return figures.picture(`data:${location}`, stored(1), shape?.alt ?? '', size)
  }

  // Pictures floating over the text: their anchors by character, their shapes by identifier, their pictures in the store.
  const anchors = new Map<number, { id: number; width?: number | undefined; height?: number | undefined }>()
  const shapes = new Map<number, ReturnType<typeof artShapes>[number]>()
  let stored: (place: number) => StoredPicture | undefined = () => undefined
  try {
    const count = places.anchors.size >= 4 ? Math.floor((places.anchors.size - 4) / 30) : 0
    for (let index = 0; index < count; index++) {
      const spa = places.anchors.at + (count + 1) * 4 + index * 26
      const span = (from: number, to: number) => twipPixels((table.u32(spa + to) | 0) - (table.u32(spa + from) | 0))
      anchors.set(table.u32(places.anchors.at + index * 4), { id: table.u32(spa), width: span(4, 12), height: span(8, 16) })
    }
    const end = Math.min(places.drawings.at + places.drawings.size, tableBytes.length)
    const [group] = places.drawings.size > 0 ? artRecords(tableBytes, places.drawings.at, end) : []
    if (group?.type === ART.drawingGroup) {
      stored = storedPictures(tableBytes, childOf(tableBytes, group, ART.store), main)
      // After the group, each drawing follows a byte that says whether it is the main text's or its headers'.
      for (let at = group.at + group.size; at + 9 <= end; ) {
        const [drawing] = artRecords(tableBytes, at + 1, end)
        if (drawing?.type !== ART.drawing) break
        for (const shape of artShapes(tableBytes, drawing)) shapes.set(shape.id, shape)
        at = drawing.at + drawing.size
      }
    }
  } catch {
    // Floating pictures that cannot be read are left out.
  }
  const floating = (character: number): number | undefined => {
    const anchor = anchors.get(character)
    const shape = anchor && shapes.get(anchor.id)
    if (!anchor || shape?.picture === undefined) return undefined
    return figures.picture(`store:${shape.picture}`, stored(shape.picture), shape.alt, anchor)
  }

  return {
    figures,
    /** The figure of a special character in the text, at its place in the main stream; `chart` when its field says so. */
    inline(place: number, chart: boolean): number | undefined {
      try {
        const run = runAt(place)
        if (!run) return undefined
        const found = characterPicture(word, run.at, run.size)
        if (found.object) return figures.unshown('', chart ? 'chart' : 'picture')
        return found.data || found.location === undefined ? undefined : inline(found.location)
      } catch {
        return undefined
      }
    },
    /** The figure of a shape anchored at a character, by the character's place in the text. */
    floating(character: number): number | undefined {
      try {
        return floating(character)
      } catch {
        return undefined
      }
    }
  }
}

/** Where a figure stands in a paragraph's text until the paragraph is written: characters no text of the file keeps. */
const FIGURE_START = '\ue000'
const FIGURE_END = '\ue001'

/**
 * A Word document of 97 to 2003, or of Word 6 and 95, as Markdown: its headings, paragraphs, list items and tables,
 * in order, and the pictures of a Word 97 document where they are. Word 6 and 95 keep everything in one stream,
 * behind a header of their own, their text in the 8-bit code page of the document's language and their properties in
 * one-byte codes.
 */
export function readOlderWord(bytes: Uint8Array): OfficePreview {
  if (bytes.length >= 2 && (readU16(bytes, 0) === 0xa59b || readU16(bytes, 0) === 0xa5db))
    throw new Error('It is a document of Word 2 or older, which is not read here.')
  const file = openCompound(bytes)
  const stream = file.stream('WordDocument')
  if (!stream) throw new Error('This is not a Word document.')
  const word = reader(stream)
  if (word.length < 0x200) damaged()
  const identifier = word.u16(0)
  const version = word.u16(2)
  if (identifier !== 0xa5ec && identifier !== 0xa5dc) throw new Error('This is not a Word document.')
  const six = version < 0xc1
  if (six && version < 0x65) throw new Error('It is a document of Word 2 or older, which is not read here.')
  const flags = word.u16(0x0a)
  if (flags & 0x0100) throw new Error(PROTECTED)
  const tableStream = six ? stream : file.stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!tableStream) damaged()
  const table = reader(tableStream as Uint8Array)

  // Where things are: in Word 97 a fixed part, then counts of 16-bit and 32-bit values, then pairs of where and how
  // long; in Word 6 and 95, at places of their own.
  let textLength: number
  let styles: WordPlace
  let formats: WordPlace
  let complex: WordPlace | undefined
  let pictures: ReturnType<typeof wordPictures> | undefined
  if (six) {
    textLength = Math.min(word.u32(0x34), CHARACTER_LIMIT)
    styles = { at: word.u32(0x60), size: word.u32(0x64) }
    formats = { at: word.u32(0xc0), size: word.u32(0xc4) }
    complex = flags & 0x0004 ? { at: word.u32(0x160), size: word.u32(0x164) } : undefined
  } else {
    const shorts = word.u16(32)
    const longsAt = 34 + shorts * 2
    const longs = word.u16(longsAt)
    textLength = Math.min(word.u32(longsAt + 2 + 3 * 4), CHARACTER_LIMIT)
    const pairsAt = longsAt + 2 + longs * 4
    const pairCount = word.u16(pairsAt)
    if (pairCount < 34) damaged()
    const pair = (index: number) => ({ at: word.u32(pairsAt + 2 + index * 8), size: word.u32(pairsAt + 6 + index * 8) })
    styles = pair(1)
    formats = pair(13)
    complex = pair(33)
    const none = { at: 0, size: 0 }
    pictures = wordPictures(word, stream, table, tableStream as Uint8Array, file.stream('Data'), {
      characters: pair(12),
      anchors: pair(40),
      drawings: pairCount > 50 ? pair(50) : none
    })
  }

  // The text is in pieces, each where the file keeps it: in 8-bit characters, or in UTF-16. A Word 6 file saved
  // whole has one, from the start of its text; one saved quickly lists them, all 8-bit.
  const pieces: { start: number; end: number; at: number; narrow: boolean }[] = []
  if (complex === undefined) pieces.push({ start: 0, end: textLength, at: word.u32(0x18), narrow: true })
  else
    for (let at = complex.at; at < complex.at + complex.size; ) {
      const kind = table.u8(at)
      if (kind === 1) {
        at += 3 + Math.max(0, table.i16(at + 1))
        continue
      }
      if (kind !== 2) damaged()
      const size = table.u32(at + 1)
      const list = at + 5
      const count = Math.floor((size - 4) / 12)
      for (let index = 0; index < count; index++) {
        const raw = table.u32(list + (count + 1) * 4 + index * 8 + 2)
        const narrow = six || (raw & 0x40000000) !== 0
        const offset = six ? raw : raw & 0x3fffffff
        pieces.push({ start: table.u32(list + index * 4), end: table.u32(list + (index + 1) * 4), at: narrow && !six ? offset / 2 : offset, narrow })
      }
      break
    }
  if (pieces.length === 0) damaged()

  // Each paragraph's format is found by where its mark is in the file, in pages of runs of 512 bytes: their numbers
  // in four bytes in Word 97, in two in Word 6, whose list a quick save may leave short of the pages that follow.
  const runs: { start: number; end: number; at?: number; size?: number; format?: ParagraphFormat }[] = []
  const numberSize = six ? 2 : 4
  const listed = formats.size >= 4 ? Math.floor((formats.size - 4) / (4 + numberSize)) : 0
  const pageNumbers: number[] = []
  for (let index = 0; index < listed; index++) {
    const at = formats.at + (listed + 1) * 4 + index * numberSize
    pageNumbers.push(six ? table.u16(at) : table.u32(at) & 0x3fffff)
  }
  if (six && listed > 0) {
    const all = word.u16(0x190)
    for (let next = (pageNumbers.at(-1) ?? 0) + 1; pageNumbers.length < Math.min(all, 4096); next++) pageNumbers.push(next)
  }
  const entrySize = six ? 7 : 13
  for (const number of pageNumbers) {
    const page = number * 512
    if (page + 512 > word.length) continue
    const count = word.u8(page + 511)
    for (let run = 0; run < count; run++) {
      const offset = word.u8(page + (count + 1) * 4 + run * entrySize) * 2
      const found: (typeof runs)[number] = { start: word.u32(page + run * 4), end: word.u32(page + (run + 1) * 4) }
      if (offset > 0) {
        const length = word.u8(page + offset)
        found.at = length === 0 && !six ? page + offset + 2 : page + offset + 1
        found.size = length === 0 && !six ? word.u8(page + offset + 1) * 2 : length * 2 - 1
      }
      runs.push(found)
    }
  }
  runs.sort((one, other) => one.start - other.start)
  const plainFormat = (): ParagraphFormat => ({ style: 0, inTable: false, rowEnd: false, list: false, level: 0 })
  const formatAt = (place: number): ParagraphFormat | undefined => {
    let low = 0
    let high = runs.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const run = runs[middle] as (typeof runs)[number]
      if (place < run.start) high = middle - 1
      else if (place >= run.end) low = middle + 1
      else {
        if (!run.format) {
          // A format that cannot be read is no format: the text is still worth showing.
          try {
            run.format =
              run.at === undefined || run.size === undefined
                ? plainFormat()
                : six
                  ? sixParagraphFormat(word, run.at, run.size)
                  : paragraphFormat(word, run.at, run.size)
          } catch {
            run.format = plainFormat()
          }
        }
        return run.format
      }
    }
    return undefined
  }
  let headings = new Map<number, number>()
  try {
    headings = headingStyles(table, styles.at, styles.size, !six)
  } catch {
    // Styles that cannot be read name no headings.
  }

  const blocks: string[] = []
  let rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let paragraph = ''
  let lastWasCell = false
  const flushTable = () => {
    if (row.length > 0) rows.push(row)
    if (rows.length > 0) blocks.push(markdownTable(rows))
    rows = []
    row = []
    cell = ''
  }
  const endParagraph = (mark: '\r' | '\x07', place: number | undefined) => {
    const format = place === undefined || runs.length === 0 ? undefined : formatAt(place)
    const text = paragraph.trim()
    paragraph = ''
    const inTable = format ? format.inTable : mark === '\x07'
    if (inTable) {
      // Without formats, an empty cell's mark right after another's ends the row: a guess where the file says nothing.
      const rowEnd = format ? format.rowEnd : lastWasCell && text === '' && cell === ''
      if (rowEnd) {
        rows.push(row)
        row = []
        lastWasCell = false
      } else if (mark === '\x07') {
        row.push(`${cell}${text}`.trim())
        cell = ''
        lastWasCell = true
      } else cell += `${text}\n`
      return
    }
    lastWasCell = false
    flushTable()
    if (text === '') return
    const level =
      format === undefined
        ? undefined
        : (headings.get(format.style) ?? (format.outline !== undefined && format.outline < 9 ? Math.min(format.outline + 1, 6) : undefined))
    const lines = text.split('\n').map(plain)
    if (level) blocks.push(`${'#'.repeat(level)} ${lines.join(' ')}`)
    else if (format?.list) blocks.push(`${'  '.repeat(format.level)}- ${lines.join('  \n  ')}`)
    else blocks.push(lines.join('  \n'))
  }

  // Fields hold their code, then what they show: only what they show is text. An object's code names its kind.
  const fields: { code: string; coding: boolean }[] = []
  const figure = (found: number | undefined) => {
    if (found !== undefined) paragraph += `${FIGURE_START}${found}${FIGURE_END}`
  }
  const take = (code: number, char: string, place: number, character: number) => {
    const field = fields.at(-1)
    if (code === 0x13) fields.push({ code: '', coding: true })
    else if (code === 0x14) {
      if (field) field.coding = false
    } else if (code === 0x15) fields.pop()
    else if (fields.some((one) => one.coding)) {
      if (field?.coding) field.code += char
    } else if (code === 0x0d || code === 0x0c) endParagraph('\r', place)
    else if (code === 0x07) endParagraph('\x07', place)
    else if (code === 0x0b) paragraph += '\n'
    else if (code === 0x1e) paragraph += '-'
    else if (code === 0x01 && place >= 0) figure(pictures?.inline(place, /^\s*EMBED\s+\S*Chart/i.test(field?.code ?? '')))
    else if (code === 0x08) figure(pictures?.floating(character))
    else if (code === 0x09 || (code >= 0x20 && char !== FIGURE_START && char !== FIGURE_END)) paragraph += char
  }
  let read = 0
  // Word 97 writes its 8-bit text in Western European; Word 6 and 95, in the code page of the document's language,
  // which may take two bytes for a character: the marks that matter are single bytes, found before decoding.
  const narrow = six
    ? word.u16(0x14) === 256
      ? new TextDecoder('macintosh')
      : codePageDecoder(languageCodePage(word.u16(0x06)))
    : new TextDecoder('windows-1252')
  for (const piece of [...pieces].sort((one, other) => one.start - other.start)) {
    if (blocks.length >= BLOCK_LIMIT || read >= textLength) break
    const count = Math.min(piece.end, textLength) - piece.start
    if (count <= 0) continue
    read += count
    if (piece.narrow) {
      const part = word.bytes(piece.at, count)
      let from = 0
      const flush = (to: number) => {
        if (to > from) for (const char of narrow.decode(part.subarray(from, to))) take(char.codePointAt(0) ?? 0, char, -1, -1)
      }
      for (let index = 0; index < part.length && blocks.length < BLOCK_LIMIT; index++) {
        const byte = part[index] as number
        if (byte >= 0x20) continue
        flush(index)
        from = index + 1
        take(byte, String.fromCharCode(byte), piece.at + index, piece.start + index)
      }
      flush(part.length)
      continue
    }
    const text = utf16(word.bytes(piece.at, count * 2))
    for (let index = 0; index < text.length && blocks.length < BLOCK_LIMIT; index++) {
      const char = text[index] as string
      take(char.charCodeAt(0), char, piece.at + index * 2, piece.start + index)
    }
  }
  if (paragraph.trim() !== '') endParagraph('\r', undefined)
  flushTable()
  const figures = pictures?.figures.list ?? []
  // Each figure's place in the text becomes its mark, once the text around it is written as Markdown.
  const markdown = joinBlocks(blocks).replace(new RegExp(`${FIGURE_START}(\\d+)${FIGURE_END}`, 'g'), (_, place: string) => {
    const found = figures[Number(place)]
    return found ? figureMark(Number(place), found.kind === 'chart' ? found.title : found.alt) : ''
  })
  return { kind: 'document', markdown, figures, cut: blocks.length >= BLOCK_LIMIT || read >= CHARACTER_LIMIT }
}

/** A 16-bit number at the start of a file, before it is known to be anything. */
const readU16 = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)

// Excel

/** A workbook's records in order, each with its type and where its content is. */
function* records(book: Reader, from: number): Generator<{ type: number; at: number; size: number }> {
  for (let at = from; at + 4 <= book.length; ) {
    const type = book.u16(at)
    const size = book.u16(at + 2)
    if (at + 4 + size > book.length) damaged()
    yield { type, at: at + 4, size }
    at += 4 + size
  }
}

/**
 * Bytes split over a record and the records that continue it, read as one, except that text crossing from one to the
 * next says again whether its characters are one byte or two.
 */
class Continued {
  private readonly parts: Uint8Array[]
  private part = 0
  private place = 0
  constructor(parts: Uint8Array[]) {
    this.parts = parts
  }
  private current(): Uint8Array {
    while (this.part < this.parts.length && this.place >= (this.parts[this.part]?.length ?? 0)) {
      this.part++
      this.place = 0
    }
    return this.parts[this.part] ?? damaged()
  }
  u8(): number {
    const part = this.current()
    return part[this.place++] as number
  }
  u16(): number {
    return this.u8() | (this.u8() << 8)
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0
  }
  skip(count: number) {
    for (let left = count; left > 0; ) {
      const part = this.current()
      const step = Math.min(left, part.length - this.place)
      this.place += step
      left -= step
    }
  }
  /** A string of Excel's (`XLUnicodeRichExtendedString`), its formatting runs and phonetic guide passed over. */
  text(): string {
    const length = this.u16()
    const flags = this.u8()
    const runs = flags & 0x08 ? this.u16() : 0
    const extra = flags & 0x04 ? this.u32() : 0
    let wide = (flags & 0x01) !== 0
    let text = ''
    for (let left = length; left > 0; ) {
      let part = this.parts[this.part]
      if (!part || this.place >= part.length) {
        this.current()
        part = this.parts[this.part] as Uint8Array
        wide = (this.u8() & 0x01) !== 0
      }
      const available = Math.floor((part.length - this.place) / (wide ? 2 : 1))
      if (available === 0) damaged()
      const take = Math.min(left, available)
      const slice = part.subarray(this.place, this.place + take * (wide ? 2 : 1))
      text += wide ? utf16(slice) : latin1(slice)
      this.place += slice.length
      left -= take
    }
    this.skip(runs * 4 + extra)
    return text
  }
}

/** A number as Excel packs it in four bytes (`RK`): a float's high half or a 30-bit integer, perhaps a hundredth of it. */
export function rkNumber(value: number): number {
  let number: number
  if (value & 0x02) number = (value | 0) >> 2
  else {
    const bytes = new DataView(new ArrayBuffer(8))
    bytes.setUint32(4, value & 0xfffffffc, true)
    number = bytes.getFloat64(0, true)
  }
  return value & 0x01 ? number / 100 : number
}

const ERRORS: Record<number, string> = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' }
const flag = (value: number, error: boolean) => (error ? (ERRORS[value] ?? '#N/A') : value ? 'TRUE' : 'FALSE')

/** What a workbook of Excel 4 or older says: a file of records of its own, not a compound file. */
const EXCEL_4 = 'It is a workbook of Excel 4 or older, which is not read here.'

/**
 * A sheet of an older workbook as it is read: its rows as shown, each cell with its number, for the charts that name
 * it, and the pictures its drawing places.
 */
export interface OlderSheet {
  name: string
  rows: string[][]
  cut: boolean
  cells: Map<string, CellValue>
  figures: OfficeFigure[]
}

/** Bytes kept in several records, one after the other. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}

/**
 * A workbook of Excel 97 to 2003, or of Excel 5 and 95, its sheets each as rows of its cells' values as their formats
 * show them. Excel 5 and 95 write their text in 8-bit characters of the workbook's code page, with no table of strings.
 */
export function readOlderExcel(bytes: Uint8Array, options: NumberFormatOptions = {}): OfficePreview {
  return { kind: 'workbook', sheets: readOlderSheets(bytes, options).map(({ name, rows, cut, figures }) => ({ name, rows, cut, figures })) }
}

/** The sheets of a workbook of Excel 97 to 2003, or of Excel 5 and 95, read as `readOlderExcel` shows them. */
export function readOlderSheets(bytes: Uint8Array, options: NumberFormatOptions = {}): OlderSheet[] {
  // Excel 2, 3 and 4 wrote their records straight into the file.
  if (bytes.length >= 4 && [0x0009, 0x0209, 0x0409, 0x0809].includes(readU16(bytes, 0)) && readU16(bytes, 2) < 32) throw new Error(EXCEL_4)
  const file = openCompound(bytes)
  const stream = file.stream('Workbook') ?? file.stream('Book')
  if (!stream) throw new Error('This is not an Excel workbook.')
  const book = reader(stream)
  if (book.u16(0) !== 0x0809) throw new Error('This is not an Excel workbook.')
  const version = book.u16(4)
  if (version !== 0x0600 && version !== 0x0500) throw new Error(EXCEL_4)
  const five = version === 0x0500
  // Excel 5 and 95's 8-bit text is in the workbook's code page; Excel 97's, in the first 256 characters of Unicode.
  let narrow = five ? codePageDecoder(1252) : undefined
  const eight = (bytes: Uint8Array) => (narrow ? narrow.decode(bytes) : latin1(bytes))

  const strings: string[] = []
  const sheets: { name: string; at: number; chart: boolean }[] = []
  // Every sheet's name by its place, as formulas name them, through the references to the workbook's own sheets.
  const names: string[] = []
  const books: boolean[] = []
  const references: { book: number; sheet: number }[] = []
  // The workbook's store of pictures, in a drawing group whose records continue one another.
  const group: Uint8Array[] = []
  let grouping = false
  // The formats of the workbook by their number, the format of each style by its place, and its date system.
  const codes = new Map<number, string>()
  const styles: number[] = []
  let date1904 = false
  let shared: Uint8Array[] | undefined
  const readShared = () => {
    if (!shared) return
    const parts = new Continued(shared)
    parts.skip(4)
    const count = parts.u32()
    try {
      for (let index = 0; index < count; index++) strings.push(parts.text())
    } catch {
      // A table of strings cut short keeps those read.
    }
    shared = undefined
  }
  for (const record of records(book, 0)) {
    if (grouping && (record.type === 0x003c || record.type === 0x00eb)) {
      group.push(book.bytes(record.at, record.size))
      continue
    }
    grouping = false
    if (shared && record.type === 0x003c) {
      shared.push(book.bytes(record.at, record.size))
      continue
    }
    readShared()
    if (record.type === 0x002f) throw new Error(PROTECTED)
    if (record.type === 0x00fc && !five) shared = [book.bytes(record.at, record.size)]
    else if (record.type === 0x0042 && five && record.size >= 2) narrow = codePageDecoder(book.u16(record.at))
    else if (record.type === 0x041e && five && record.size >= 3) codes.set(book.u16(record.at), eight(book.bytes(record.at + 3, book.u8(record.at + 2))))
    else if (record.type === 0x041e && record.size >= 5) {
      const length = book.u16(record.at + 2)
      const wide = (book.u8(record.at + 4) & 0x01) !== 0
      codes.set(book.u16(record.at), wide ? utf16(book.bytes(record.at + 5, length * 2)) : latin1(book.bytes(record.at + 5, length)))
    } else if (record.type === 0x00e0 && record.size >= 4) styles.push(book.u16(record.at + 2))
    else if (record.type === 0x0022 && record.size >= 2) date1904 = book.u16(record.at) === 1
    else if (record.type === 0x00eb) {
      group.push(book.bytes(record.at, record.size))
      grouping = true
    } else if (record.type === 0x0085) {
      // A sheet: where its records start, its kind and its name. Worksheets and chart sheets are shown; macros are not.
      const length = book.u8(record.at + 6)
      const wide = !five && (book.u8(record.at + 7) & 0x01) !== 0
      const name = five
        ? eight(book.bytes(record.at + 7, length))
        : wide
          ? utf16(book.bytes(record.at + 8, length * 2))
          : latin1(book.bytes(record.at + 8, length))
      names.push(name)
      const kind = book.u8(record.at + 5)
      if (kind === 0 || kind === 2) sheets.push({ name, at: book.u32(record.at), chart: kind === 2 })
    } else if (record.type === 0x01ae && record.size >= 4) books.push(book.u16(record.at + 2) === 0x0401)
    else if (record.type === 0x0017 && !five && record.size >= 2)
      for (let index = 0; index < Math.min(book.u16(record.at), Math.floor((record.size - 2) / 6)); index++)
        references.push({ book: book.u16(record.at + 2 + index * 6), sheet: book.i16(record.at + 4 + index * 6) })
    else if (record.type === 0x000a) break
  }
  readShared()
  const shownBy = (style: number) => {
    const id = styles[style] ?? 0
    return codes.get(id) ?? builtInFormat(id)
  }
  const shown: NumberFormatOptions = { ...options, date1904 }
  const figures = new ArtFigures()
  const store = joined(group)
  const [drawingGroup] = artRecords(store)
  const stored = storedPictures(store, drawingGroup?.type === ART.drawingGroup ? childOf(store, drawingGroup, ART.store) : undefined)

  const read = sheets
    .slice(0, SHEET_LIMIT)
    .map(({ name, at, chart }) =>
      chart
        ? { name, rows: [], cut: false, cells: new Map<string, CellValue>(), drawing: new Uint8Array(), charts: [chartRecords(book, at)], objects: [] }
        : { name, ...sheetRows(book, at, { strings, five, eight }, shownBy, shown) }
    )
  // The sheets are read before their charts, which may name their cells rather than keep their values.
  const context: ChartContext = {
    five,
    eight,
    number: (value, style) => {
      const code = shownBy(style)
      return /^general$/i.test(code) ? generalNumber(value) : formatNumber(value, code, shown)
    },
    sheetName: (index) => {
      const reference = references[index]
      return reference && books[reference.book] !== false ? names[reference.sheet] : undefined
    },
    cells: cellRange(new Map(read.map((sheet) => [sheet.name, sheet.cells])))
  }
  return read.map(({ drawing, charts, objects, ...sheet }) => ({
    ...sheet,
    figures: figures.at(sheetFigures({ drawing, charts, objects }, stored, figures, context))
  }))
}

/** The records of a chart sheet, from its beginning to its end. */
function chartRecords(book: Reader, from: number): ChartRecord[] {
  const found: ChartRecord[] = []
  for (const { type, at, size } of records(book, from)) {
    found.push({ type, body: book.bytes(at, size) })
    if (type === 0x000a) break
  }
  return found
}

/** The objects a sheet places, as they are read: its drawing, the records of each chart, and the kind of each object in order. */
interface SheetObjects {
  drawing: Uint8Array
  charts: ChartRecord[][]
  objects: number[]
}

/** The kinds of object a sheet's object record names. */
const CHART_OBJECT = 0x05
const PICTURE_OBJECT = 0x08

/**
 * The pictures and charts a sheet places, by their places in the workbook's figures, in the order of its objects: a
 * picture from its drawing's next shape that shows one, a chart from the next chart's records. Those no object names
 * follow.
 */
function sheetFigures(placed: SheetObjects, stored: (place: number) => StoredPicture | undefined, figures: ArtFigures, context: ChartContext): number[] {
  const [container] = artRecords(placed.drawing)
  const shapes = container?.type === ART.drawing ? artShapes(placed.drawing, container).filter((shape) => shape.picture !== undefined) : []
  const found: number[] = []
  let picture = 0
  let chart = 0
  const nextPicture = () => {
    const shape = shapes[picture++]
    const figure = shape?.picture === undefined ? undefined : figures.picture(`store:${shape.picture}`, stored(shape.picture), shape.alt)
    if (figure !== undefined) found.push(figure)
  }
  const nextChart = () => {
    const records = placed.charts[chart++]
    if (!records) return
    let read: ReturnType<typeof readOlderChart>
    try {
      read = readOlderChart(records, context)
    } catch {
      // A chart whose records cannot be read is one its app draws.
    }
    const figure = figures.chart(read)
    if (figure !== undefined) found.push(figure)
  }
  for (const kind of placed.objects) {
    if (kind === PICTURE_OBJECT) nextPicture()
    else if (kind === CHART_OBJECT) nextChart()
  }
  while (picture < shapes.length) nextPicture()
  while (chart < placed.charts.length) nextChart()
  return found
}

/** The rows of a sheet, from its records: its cells in their columns, empty ones kept so the columns line up. */
function sheetRows(
  book: Reader,
  from: number,
  text: { strings: readonly string[]; five: boolean; eight: (bytes: Uint8Array) => string },
  formatOf: (style: number) => string,
  options: NumberFormatOptions
): { rows: string[][]; cut: boolean; cells: Map<string, CellValue> } & SheetObjects {
  const { strings, five, eight } = text
  const rows: string[][] = []
  // The sheet's drawing, in records of its own and those that continue them, among the records of its objects, and
  // each chart's records, between its own beginning and end.
  const drawing: Uint8Array[] = []
  let drawn = false
  const charts: ChartRecord[][] = []
  const objects: number[] = []
  // Each cell shown, by its row and column, with its number when it holds one.
  const cells = new Map<string, CellValue>()
  let cut = false
  const put = (row: number, column: number, value: string, held?: number) => {
    if (row >= ROW_LIMIT || column >= COLUMN_LIMIT) {
      cut = true
      return
    }
    while (rows.length <= row) rows.push([])
    const line = rows[row] as string[]
    while (line.length < column) line.push('')
    line[column] = value
    cells.set(`${row},${column}`, { text: value, number: held !== undefined && Number.isFinite(held) ? held : undefined })
  }
  // A number as the format of its cell's style shows it.
  const number = (row: number, column: number, value: number, style: number) => {
    const code = formatOf(style)
    put(row, column, /^general$/i.test(code) ? generalNumber(value) : formatNumber(value, code, options), value)
  }
  let depth = 0
  // A formula's text result follows it in a record of its own.
  let waiting: { row: number; column: number } | undefined
  for (const { type, at, size } of records(book, from)) {
    if (type === 0x0809) {
      depth++
      if (depth === 2) charts.push([])
    } else if (type === 0x000a && --depth <= 0) break
    // A chart inside a sheet has records of its own, between its own beginning and end.
    if (depth >= 2) charts.at(-1)?.push({ type, body: book.bytes(at, size) })
    if (depth !== 1) continue
    if (type === 0x00ec || (drawn && type === 0x003c)) {
      drawing.push(book.bytes(at, size))
      drawn = true
      continue
    }
    drawn = false
    // An object's kind, after the header of its first part in Excel 97, after its count in Excel 5 and 95.
    if (type === 0x005d && size >= 6 && (five || book.u16(at) === 0x15)) objects.push(book.u16(at + 4))
    const row = () => book.u16(at)
    const column = () => book.u16(at + 2)
    if (type === 0x00fd) put(row(), column(), strings[book.u32(at + 6)] ?? '')
    else if (type === 0x0203) number(row(), column(), book.f64(at + 6), book.u16(at + 4))
    else if (type === 0x027e) number(row(), column(), rkNumber(book.u32(at + 6)), book.u16(at + 4))
    else if (type === 0x00bd) {
      const first = column()
      for (let index = 0; index < Math.floor((size - 6) / 6); index++)
        number(row(), first + index, rkNumber(book.u32(at + 6 + index * 6)), book.u16(at + 4 + index * 6))
    } else if (type === 0x0205) put(row(), column(), flag(book.u8(at + 6), book.u8(at + 7) !== 0))
    else if (type === 0x0204 || type === 0x0207 || type === 0x00d6) {
      // Text in a cell, plain or with runs of format after it (Excel 5 and 95), or a formula's text result.
      const start = type === 0x0207 ? at : at + 6
      const length = book.u16(start)
      const wide = !five && (book.u8(start + 2) & 0x01) !== 0
      const text = five ? eight(book.bytes(start + 2, length)) : wide ? utf16(book.bytes(start + 3, length * 2)) : latin1(book.bytes(start + 3, length))
      if (type !== 0x0207) put(row(), column(), text)
      else if (waiting) put(waiting.row, waiting.column, text)
      waiting = undefined
    } else if (type === 0x0006) {
      waiting = undefined
      // A formula's last result: a number, or marked by its last two bytes as text, a boolean, an error or nothing.
      if (book.u16(at + 12) !== 0xffff) number(row(), column(), book.f64(at + 6), book.u16(at + 4))
      else {
        const kind = book.u8(at + 6)
        if (kind === 0) waiting = { row: row(), column: column() }
        else if (kind === 1 || kind === 2) put(row(), column(), flag(book.u8(at + 8), kind === 2))
      }
    }
  }
  while (rows.length > 0 && (rows.at(-1)?.every((value) => value === '') ?? false)) rows.pop()
  return { rows, cut, cells, drawing: joined(drawing), charts, objects }
}

// PowerPoint

interface PowerPointRecord {
  type: number
  instance: number
  container: boolean
  at: number
  size: number
}

/** The records directly inside a stretch of a presentation's stream. */
function* children(stream: Reader, from: number, end: number): Generator<PowerPointRecord> {
  for (let at = from; at + 8 <= end; ) {
    const head = stream.u16(at)
    const size = stream.u32(at + 4)
    if (at + 8 + size > end) return
    yield { type: stream.u16(at + 2), instance: head >> 4, container: (head & 0x0f) === 0x0f, at: at + 8, size }
    at += 8 + size
  }
}

/** The record that starts at a place, when one does. */
function recordAt(stream: Reader, at: number): PowerPointRecord | undefined {
  if (at + 8 > stream.length) return undefined
  const [found] = children(stream, at, stream.length)
  return found
}

const TITLE_TYPES = new Set([0, 6])

/** A text record's text, its paragraphs as lines, a line break inside one as a space. */
function textOf(stream: Reader, record: PowerPointRecord): string[] {
  const text = record.type === 0x0fa0 ? utf16(stream.bytes(record.at, record.size - (record.size % 2))) : latin1(stream.bytes(record.at, record.size))
  return text
    .split('\r')
    .map((line) => line.replaceAll('\v', ' ').trim())
    .filter(Boolean)
}

/** The texts of a slide's drawing, in order, with whether each is a title: its text boxes' own text. */
function drawingTexts(stream: Reader, record: PowerPointRecord, depth = 0): { title: boolean; lines: string[] }[] {
  const found: { title: boolean; lines: string[] }[] = []
  let type: number | undefined
  for (const child of children(stream, record.at, record.at + record.size)) {
    if (child.container && depth < 16) found.push(...drawingTexts(stream, child, depth + 1))
    else if (child.type === 0x0f9f) type = stream.u32(child.at)
    else if (child.type === 0x0fa0 || child.type === 0x0fa8) found.push({ title: type !== undefined && TITLE_TYPES.has(type), lines: textOf(stream, child) })
  }
  return found
}

/** Where each object of a presentation is, by its number, from its latest save back to its first. */
function persistedObjects(file: ReturnType<typeof openCompound>, stream: Reader): { places: Map<number, number>; document?: number } {
  const places = new Map<number, number>()
  const user = file.stream('Current User')
  if (!user || user.length < 20) return { places }
  const current = reader(user)
  if (current.u32(12) === 0xf3d1c4df) throw new Error(PROTECTED)
  let document: number | undefined
  const seen = new Set<number>()
  for (let edit = current.u32(16); edit > 0 && !seen.has(edit); ) {
    seen.add(edit)
    const record = recordAt(stream, edit)
    if (record?.type !== 0x0ff5) break
    document ??= stream.u32(record.at + 16)
    const directory = recordAt(stream, stream.u32(record.at + 12))
    if (directory?.type === 0x1772) {
      for (let at = directory.at; at + 4 <= directory.at + directory.size; ) {
        const head = stream.u32(at)
        const first = head & 0xfffff
        const count = head >>> 20
        for (let index = 0; index < count; index++) if (!places.has(first + index)) places.set(first + index, stream.u32(at + 4 + index * 4))
        at += 4 + count * 4
      }
    }
    edit = stream.u32(record.at + 8)
  }
  return document === undefined ? { places } : { places, document }
}

/**
 * The size a shape's anchor on a slide gives it, in the window's pixels: its corners in master units, 576 to the inch,
 * in two bytes each, or in four.
 */
function slideAnchorSize(bytes: Uint8Array, anchor: ArtRecord | undefined): { width?: number | undefined; height?: number | undefined } {
  if (!anchor || (anchor.size !== 8 && anchor.size !== 16)) return {}
  const corners = reader(bytes.subarray(anchor.at, anchor.at + anchor.size))
  const [top, left, right, bottom] = [0, 1, 2, 3].map((index) => (anchor.size === 8 ? corners.i16(index * 2) : corners.u32(index * 4) | 0)) as [
    number,
    number,
    number,
    number
  ]
  const pixels = (units: number) => (units > 0 ? Math.round(units / 6) : undefined)
  return { width: pixels(right - left), height: pixels(bottom - top) }
}

/** A PowerPoint 97 to 2003 presentation's slides, in order: each one's title, the lines of its other text, and its pictures. */
export function readOlderPowerPoint(bytes: Uint8Array): OfficePreview {
  const file = openCompound(bytes)
  const raw = file.stream('PowerPoint Document')
  if (!raw) throw new Error('This is not a PowerPoint presentation.')
  if (file.stream('EncryptedSummary')) throw new Error(PROTECTED)
  const stream = reader(raw)
  const { places, document } = persistedObjects(file, stream)
  const documentAt = document === undefined ? undefined : places.get(document)
  const container =
    (documentAt === undefined ? undefined : recordAt(stream, documentAt)) ?? [...children(stream, 0, stream.length)].find((record) => record.type === 0x03e8)
  if (container?.type !== 0x03e8) throw new Error('This is not a PowerPoint presentation.')

  // The list of slides, in their order: each begins with its reference, then the text of its placeholders.
  const found: { texts: { title: boolean; lines: string[] }[]; persisted: number }[] = []
  let cut = false
  const list = [...children(stream, container.at, container.at + container.size)].find((record) => record.type === 0x0ff0 && record.instance === 0)
  let type: number | undefined
  for (const record of list ? children(stream, list.at, list.at + list.size) : []) {
    if (record.type === 0x03f3) {
      if (found.length >= SLIDE_LIMIT) {
        cut = true
        break
      }
      found.push({ texts: [], persisted: stream.u32(record.at) })
      type = undefined
    } else if (record.type === 0x0f9f) type = stream.u32(record.at)
    else if (record.type === 0x0fa0 || record.type === 0x0fa8)
      found.at(-1)?.texts.push({ title: type !== undefined && TITLE_TYPES.has(type), lines: textOf(stream, record) })
  }

  // The pictures of the presentation are in its store, each entry saying where its picture is in the `Pictures` stream.
  const figures = new ArtFigures()
  const drawingGroup = childOf(raw, container, 0x040b)
  const group = drawingGroup && childOf(raw, drawingGroup, ART.drawingGroup)
  const stored = storedPictures(raw, group && childOf(raw, group, ART.store), file.stream('Pictures'))

  const slides = found.map(({ texts, persisted }) => {
    // Text boxes of its own, beyond its placeholders, are in the slide's drawing, and so are its pictures.
    const at = places.get(persisted)
    const drawn = at === undefined ? undefined : recordAt(stream, at)
    const all = drawn?.type === 0x03ee ? [...texts, ...drawingTexts(stream, drawn)] : texts
    const slide = { title: '', lines: [] as string[], figures: [] as OfficeFigure[] }
    for (const text of all) {
      if (text.title && slide.title === '') slide.title = text.lines.join(' ')
      else slide.lines.push(...text.lines.filter((line) => !slide.lines.includes(line)))
    }
    const drawing = drawn?.type === 0x03ee ? childOf(raw, drawn, 0x040c) : undefined
    const shapes = drawing && childOf(raw, drawing, ART.drawing)
    const placed = (shapes ? artShapes(raw, shapes) : []).flatMap((shape) => {
      if (shape.picture === undefined) return []
      const figure = figures.picture(`store:${shape.picture}`, stored(shape.picture), shape.alt, slideAnchorSize(raw, shape.anchor))
      return figure === undefined ? [] : [figure]
    })
    slide.figures = figures.at(placed)
    return slide
  })
  return { kind: 'presentation', slides, cut }
}
