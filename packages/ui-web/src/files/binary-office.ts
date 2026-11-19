/**
 * The older Office formats read in the window itself, with no service and no library (docs/SPEC.md, section 9.7):
 * the documents of Word 6 to 2003 (.doc), the workbooks of Excel 2 to 2003 (.xls) and the presentations of PowerPoint
 * 3 to 2003 (.ppt). Each is a compound file (`compound.ts`) whose streams hold the binary records each app wrote,
 * but for Excel 2 to 4 and PowerPoint 3, which wrote theirs straight into the file. They are read for what a preview
 * shows, as the newer formats are: a document as Markdown, a workbook's sheets as tables, the text of each slide, and
 * the pictures of each (`office-art.ts`).
 *
 * Every offset read is checked against its stream, so a damaged file fails with a sentence rather than reading past
 * its end. A file protected with a password says so.
 */

import { unpack } from './archive.ts'
import { type ChartContext, type ChartRecord, readGraphChart, readOlderChart } from './binary-chart.ts'
import { codePageDecoder, damaged, languageCodePage, type Reader, reader, wordProperties } from './binary-records.ts'
import { type Compound, openCompound } from './compound.ts'
import { cellValue, serialNow, withConditions } from './conditional-formats.ts'
import { type CellArea, heldExtent } from './embedded-sheet.ts'
import { objectEquation } from './equation-editor.ts'
import { builtInFormat, formatNumber, generalNumber, type NumberFormatOptions, numberColor } from './number-format.ts'
import {
  ART,
  ArtFigures,
  type ArtRecord,
  type ArtShape,
  artRecords,
  artShape,
  artShapes,
  childOf,
  type StoredPicture,
  storedPictures,
  twipPixels
} from './office-art.ts'
import { type CellValue, cellRange, pictureType } from './office-figures.ts'
import {
  BLOCK_LIMIT,
  type CellAnchor,
  COLUMN_LIMIT,
  figureMark,
  heldLines,
  joinBlocks,
  markdownTable,
  type ObjectRead,
  type ObjectReader,
  type OfficeChart,
  type OfficeFigure,
  type OfficePreview,
  type PictureFigure,
  PROTECTED,
  plain,
  ROW_LIMIT,
  SHEET_LIMIT,
  SLIDE_LIMIT
} from './office-text.ts'
import { readOlderConditions } from './older-sheet-conditions.ts'
import { type OlderBookRecords, type OlderSheetRecords, readOlderBookStyles, readOlderPalette, readOlderSheetLook } from './older-sheet-look.ts'
import { drawOlderSlide, type OlderDeck, olderDeck } from './older-slide-drawing.ts'
import { type FloatingAnchor, type FloatingBox, readOlderWordLook, type TextPiece, type WordPart, type WordPlace } from './older-word-look.ts'
import { characterRun, type FormattedRun, formattedRuns, type Properties, paragraphRun, runAt, type WordVersion } from './older-word-properties.ts'
import { type CellKind, type LaidRun, paletteColor, type SheetLayout, type SheetLook, type WorkbookStyles } from './sheet-look.ts'
import { DRAWINGS_LIMIT } from './slide-svg.ts'

/** The most characters of a document read: past them, a preview shows the start. */
const CHARACTER_LIMIT = 4_000_000

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

/**
 * A paragraph's format, from its style and its properties as Word 97 writes them (`grpprl`, an older version's written
 * so), Word 6's automatic number at a level standing for a list's (1 to 9 an outline's levels, more a list of one).
 */
function paragraphFormat(style: number, properties: Properties): ParagraphFormat {
  const format: ParagraphFormat = { style, inTable: false, rowEnd: false, list: false, level: 0 }
  const { bytes } = properties
  for (const { code, at } of wordProperties(bytes, properties.at, properties.end)) {
    if (code === 0x2416) format.inTable = bytes.u8(at) !== 0
    else if (code === 0x2417) format.rowEnd = bytes.u8(at) !== 0
    else if (code === 0x6649) format.inTable = bytes.u32(at) > 0
    else if (code === 0x460b) format.list = bytes.u16(at) !== 0
    else if (code === 0x260a) format.level = Math.min(bytes.u8(at), 8)
    else if (code === 0x2640) format.outline = bytes.u8(at)
  }
  const level = properties.numbering
  if (level !== undefined) {
    format.list = level > 0
    format.level = level >= 1 && level <= 9 ? level - 1 : 0
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
 * The heading level of each style of a Word 2 document, by its code: the built-in headings 1 to 9 are the codes 254
 * down to 246, and a style may be named as one. Its style sheet lists the names first, the built-in styles' then the
 * document's own, a style's code its place less the count of built-in ones.
 */
function twoHeadingStyles(word: Reader, at: number, size: number): Map<number, number> {
  const levels = new Map<number, number>()
  for (let level = 1; level <= 9; level++) levels.set(255 - level, Math.min(level, 6))
  if (size < 4) return levels
  const builtIn = word.u16(at)
  const end = Math.min(at + size, at + 2 + word.u16(at + 2))
  for (let place = at + 4, index = 0; place < end; index++) {
    // A style left undefined is one byte.
    const length = word.u8(place)
    if (length === 0xff) {
      place++
      continue
    }
    if (length > 0 && place + 1 + length <= end) {
      const name = latin1(word.bytes(place + 1, length)).toLowerCase()
      const level = name === 'title' ? 1 : name === 'subtitle' ? 2 : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0)
      if (level > 0) levels.set((index - builtIn) & 0xff, Math.min(level, 6))
    }
    place += 1 + length
  }
  return levels
}

/** What a run of characters says of the special character it holds: where its picture is, and whether it is an object. */
function characterPicture(properties: Properties): { location?: number; object: boolean; data: boolean } {
  const found: { location?: number; object: boolean; data: boolean } = { object: false, data: false }
  const { bytes } = properties
  for (const { code, at } of wordProperties(bytes, properties.at, properties.end)) {
    if (code === 0x6a03) found.location = bytes.u32(at)
    else if (code === 0x080a) found.object = bytes.u8(at) !== 0
    else if (code === 0x0806) found.data = bytes.u8(at) !== 0
  }
  return found
}

/**
 * The chart an object of another app holds, in its own storage of the file: Microsoft Graph's, known by the version
 * its records start with, or the first of an Excel workbook's. None for any other object, or one that cannot be read.
 */
export function embeddedChart(storage: Compound): OfficeChart | undefined {
  try {
    const stream = storage.stream('Workbook') ?? storage.stream('Book')
    if (!stream || stream.length < 8 || readU16(stream, 0) !== 0x0809) return undefined
    if (readU16(stream, 4) === GRAPH_VERSION) return readGraphChart(stream)
    for (const sheet of sheetsOf(storage))
      for (const figure of sheet.figures) if (figure.kind === 'chart') return { title: figure.title, chart: figure.chart, series: figure.series }
  } catch {
    // An object that cannot be read is one its app shows.
  }
  return undefined
}

/** The version Microsoft Graph writes at the start of its records, which no Excel writes. */
const GRAPH_VERSION = 0x0680

/**
 * The pictures of a Word 97 document, and of a Word 6 or 95 one. One in its text is a character whose run names where
 * it is in the `Data` stream (in the main stream before Word 97): a header (`PICF`) with its size, then its shape and
 * the entry of the store that holds it, or a metafile in Word 6's way. One floating over the text is anchored at a
 * character, and drawn from the document's OfficeArt, in its table stream, its picture kept in the main stream. An
 * object of another app (a field `EMBED`) is in a storage of its own under `ObjectPool`, named by its field's
 * separator; a chart's is drawn from it when its picture is not one the window shows. A picture that cannot be read is
 * left out: the text is still worth showing.
 */
function wordPictures(
  main: Uint8Array,
  characters: (place: number) => Properties | undefined,
  streams: { data: Uint8Array | undefined; objects: Compound | undefined; read?: ObjectReader | undefined },
  floats?: { table: Reader; tableBytes: Uint8Array; anchors: WordPlace; headerAnchors: WordPlace; headerStart: number; drawings: WordPlace }
) {
  const { data, objects } = streams
  const figures = new ArtFigures()
  // Each figure's size in the text, in points, and the rules drawn in its place, by where they are, for the document's look.
  const sizes = new Map<number, { width?: number | undefined; height?: number | undefined }>()
  const rules = new Map<number, NonNullable<ArtShape['rule']>>()
  const objectChart = (id: number | undefined) => {
    const storage = id === undefined ? undefined : objects?.storage(`_${id}`)
    return storage && embeddedChart(storage)
  }
  const equations = new Map<number, string | undefined>()
  const objectEquationOf = (id: number) => {
    if (!equations.has(id)) {
      let storage: Compound | undefined
      try {
        storage = objects?.storage(`_${id}`)
      } catch {
        storage = undefined
      }
      equations.set(id, storage && objectEquation(storage))
    }
    return equations.get(id)
  }

  // A picture in the text: its header gives its size, in twentieths of a point scaled by thousandths. An object's
  // picture the window does not show gives way to the chart the object holds, when it holds one.
  const inline = (location: number, object?: number): number | undefined => {
    const instead = () => {
      const chart = object === undefined ? undefined : objectChart(object)
      return chart && figures.chart(chart)
    }
    if (!data) return instead() ?? figures.unshown('', 'picture')
    const picture = reader(data)
    const length = picture.u32(location)
    const header = picture.u16(location + 4)
    const mode = picture.u16(location + 6)
    const twips = (goal: number, scale: number) => (picture.i16(location + goal) * (picture.u16(location + scale) || 1000)) / 1000
    const size = { width: twipPixels(twips(0x1c, 0x20)), height: twipPixels(twips(0x1e, 0x22)) }
    const points = (value: number) => (value > 0 ? value / 20 : undefined)
    const sized = (figure: number | undefined) => {
      if (figure !== undefined) sizes.set(figure, { width: points(twips(0x1c, 0x20)), height: points(twips(0x1e, 0x22)) })
      return figure
    }
    // A picture of Word 6's kind is a WMF after its header, without a header of its own, drawn in its window.
    if (mode !== 0x64 && mode !== 0x66) {
      const end = Math.min(location + length, data.length)
      const metafile = location + header < end ? data.subarray(location + header, end) : undefined
      const kept = metafile && { bytes: metafile, packed: false, size: metafile.length, hint: size }
      return sized(instead() ?? figures.picture(`data:${location}`, kept ? { metafile: kept } : undefined, '', size))
    }
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
    // A rule across the text is drawn as one, with no picture.
    if (shape?.rule && shape.picture === undefined) {
      rules.set(location, shape.rule)
      return undefined
    }
    const stored = storedPictures(data, { type: ART.store, instance: 0, container: true, at: entries, size: end - entries })(1)
    const shown = stored?.bytes !== undefined && pictureType(stored.bytes) !== undefined
    return sized((shown ? undefined : instead()) ?? figures.picture(`data:${location}`, stored, shape?.alt ?? '', size))
  }

  // Pictures floating over the text: their anchors by character, their shapes by identifier, their pictures in the store.
  const anchors = new Map<number, { id: number; width?: number | undefined; height?: number | undefined; place: FloatingAnchor }>()
  const shapes = new Map<number, ReturnType<typeof artShapes>[number]>()
  let stored: (place: number) => StoredPicture | undefined = () => undefined
  try {
    if (!floats) throw new Error('Only Word 97 floats its pictures over the text.')
    const { table, tableBytes, drawings } = floats
    // The main text's anchors by their place in it, the headers' by their place in the headers' text, after the notes'.
    const readAnchors = (placed: WordPlace, start: number) => {
      const count = placed.size >= 4 ? Math.min(Math.floor((placed.size - 4) / 30), 10_000) : 0
      for (let index = 0; index < count; index++) {
        const spa = placed.at + (count + 1) * 4 + index * 26
        const span = (from: number, to: number) => twipPixels((table.u32(spa + to) | 0) - (table.u32(spa + from) | 0))
        // Where it is, from what, and how text wraps around it (`FSPA`).
        const flags = table.u16(spa + 20)
        const left = table.u32(spa + 4) | 0
        const top = table.u32(spa + 8) | 0
        const id = table.u32(spa)
        const place: FloatingAnchor = {
          left: left / 20,
          top: top / 20,
          width: Math.max(0, (table.u32(spa + 12) | 0) - left) / 20,
          height: Math.max(0, (table.u32(spa + 16) | 0) - top) / 20,
          across: (['margin', 'page', 'column'] as const)[(flags >> 1) & 3] ?? 'column',
          down: (['margin', 'page', 'paragraph'] as const)[(flags >> 3) & 3] ?? 'paragraph',
          wrap: (flags >> 5) & 0xf,
          shape: id
        }
        anchors.set(start + table.u32(placed.at + index * 4), { id, width: span(4, 12), height: span(8, 16), place })
      }
    }
    readAnchors(floats.anchors, 0)
    readAnchors(floats.headerAnchors, floats.headerStart)
    const end = Math.min(drawings.at + drawings.size, tableBytes.length)
    const [group] = drawings.size > 0 ? artRecords(tableBytes, drawings.at, end) : []
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

  // What an object holds, shown in place of its picture once read when it is read here: a worksheet as its sheet. The
  // object's storage gives the reader the stream that holds it, a workbook of 2007 or later's package or 97's own.
  const reads = new Map<number, Promise<ObjectRead | undefined>>()
  const readObject = (object: number, program: string): Promise<ObjectRead | undefined> => {
    const { read } = streams
    let found = reads.get(object)
    if (!found) {
      let storage: Compound | undefined
      try {
        storage = objects?.storage(`_${object}`)
      } catch {
        storage = undefined
      }
      found = storage && read ? read(program, storage).catch(() => undefined) : Promise.resolve(undefined)
      reads.set(object, found)
    }
    return found
  }
  // An object shown as its program's icon keeps it: its storage's `ObjInfo` stream says so (`fIcon`).
  const shownAsIcon = (object: number) => {
    try {
      return ((objects?.storage(`_${object}`)?.stream('\x03ObjInfo')?.[0] ?? 0) & 0x40) !== 0
    } catch {
      return false
    }
  }
  const held = (figure: number | undefined, field: { object?: number | undefined; program?: string | undefined }) => {
    const { object, program } = field
    if (figure !== undefined && object !== undefined && program !== undefined && streams.read)
      figures.later(figure, () => readObject(object, program), shownAsIcon(object))
    return figure
  }

  // A special character's figure: an object's chart or what says it is one, or the picture its run names.
  const inlineAt = (place: number, field: { object?: number | undefined; chart: boolean; program?: string | undefined }): number | undefined => {
    try {
      const properties = characters(place)
      if (!properties) return undefined
      const found = characterPicture(properties)
      if (found.object) {
        const chart = objectChart(found.location)
        return chart ? figures.chart(chart) : figures.unshown('', field.chart ? 'chart' : 'picture')
      }
      return found.data || found.location === undefined ? undefined : held(inline(found.location, field.object), field)
    } catch {
      return undefined
    }
  }

  // The text and the look ask for the same figures: each is read once.
  const read = new Map<string, number | undefined>()
  const once = (key: string, find: () => number | undefined) => {
    if (!read.has(key)) read.set(key, find())
    return read.get(key)
  }
  return {
    figures,
    /**
     * The figure of a special character in the text, at its place in the main stream, within the result of a field
     * that names an object (its storage's number) and says whether it is a chart.
     */
    inline(place: number, field: { object?: number | undefined; chart: boolean; program?: string | undefined }): number | undefined {
      return once(`inline:${place}`, () => inlineAt(place, field))
    },
    /** What an object holds, by the number of its storage and its program, read once: a document's text, a sheet. */
    read(object: number | undefined, program: string | undefined): Promise<ObjectRead | undefined> {
      return object === undefined || program === undefined ? Promise.resolve(undefined) : readObject(object, program)
    },
    /** The equation of Equation Editor or MathType an object holds, by the number of its storage, as linear text. */
    equation(object: number | undefined): string | undefined {
      return object === undefined ? undefined : objectEquationOf(object)
    },
    /** The object a field's separator names, by the number of its storage; none for a field of no object. */
    object(place: number): number | undefined {
      try {
        const properties = characters(place)
        const found = properties && characterPicture(properties)
        return found?.object ? found.location : undefined
      } catch {
        return undefined
      }
    },
    /** The figure of a shape anchored at a character, by the character's place in the text. */
    floating(character: number): number | undefined {
      return once(`floating:${character}`, () => {
        try {
          return floating(character)
        } catch {
          return undefined
        }
      })
    },
    /** The rule across the text a special character is, by its place in the main stream, once its figure was asked for. */
    rule(place: number): ArtShape['rule'] {
      try {
        const properties = characters(place)
        const found = properties && characterPicture(properties)
        return found?.location === undefined ? undefined : rules.get(found.location)
      } catch {
        return undefined
      }
    },
    /** Where a shape anchored at a character is, and how text wraps around it. */
    anchor(character: number): FloatingAnchor | undefined {
      return anchors.get(character)?.place
    },
    /**
     * The boxes of text a shape anchored at a character is or holds: the shape itself, or the shapes of a group it is,
     * each at its place within the group's, in points from the anchor's corner, with its fill, line and insets.
     */
    boxes(character: number): FloatingBox[] {
      const anchor = anchors.get(character)
      if (!anchor) return []
      const { place } = anchor
      const own = shapes.get(anchor.id)
      if (own?.box) return [{ shape: own.id, left: 0, top: 0, width: place.width, height: place.height, ...own.box }]
      const found: FloatingBox[] = []
      for (const shape of shapes.values())
        if (shape.box && shape.within?.group === anchor.id && found.length < 256)
          found.push({
            shape: shape.id,
            left: shape.within.left * place.width,
            top: shape.within.top * place.height,
            width: shape.within.width * place.width,
            height: shape.within.height * place.height,
            ...shape.box
          })
      return found
    },
    size(figure: number) {
      return sizes.get(figure)
    }
  }
}

/** The figures of a document whose pictures are not read: none anywhere. */
const NO_FIGURES = {
  inline: () => undefined,
  object: () => undefined,
  floating: () => undefined,
  anchor: () => undefined,
  boxes: () => [],
  rule: () => undefined,
  size: () => undefined
}

/** Where a figure stands in a paragraph's text until the paragraph is written: characters no text of the file keeps. */
const FIGURE_START = '\ue000'
const FIGURE_END = '\ue001'

/**
 * Where Word 6 and 95, and Word 2, keep the parts of a document, in their header: where each starts, then how long it
 * is, in four bytes in Word 6 and two in Word 2. Their pages of runs follow the count of all those a quick save left.
 */
const OLDER_PARTS: Record<6 | 2, Record<WordPart | 'characters' | 'paragraphs' | 'complex', number | undefined>> = {
  6: {
    styles: 0x60,
    footnoteReferences: 0x68,
    footnoteTexts: 0x70,
    sections: 0x88,
    headers: 0xb0,
    characters: 0xb8,
    paragraphs: 0xc0,
    fonts: 0xd0,
    settings: 0x150,
    complex: 0x160,
    endnoteReferences: 0x1d2,
    endnoteTexts: 0x1da,
    lists: undefined,
    listOverrides: undefined,
    textBoxes: undefined,
    headerTextBoxes: undefined,
    pageBreaks: undefined
  },
  2: {
    styles: 0x5e,
    footnoteReferences: 0x64,
    footnoteTexts: 0x6a,
    sections: 0x7c,
    headers: 0x9a,
    characters: 0xa0,
    paragraphs: 0xa6,
    fonts: 0xb2,
    settings: 0x112,
    complex: 0x11e,
    endnoteReferences: undefined,
    endnoteTexts: undefined,
    lists: undefined,
    listOverrides: undefined,
    textBoxes: undefined,
    headerTextBoxes: undefined,
    pageBreaks: undefined
  }
}

/** Where Word 97 keeps the parts of a document, by their place in its header's list of where and how long (`FibRgFcLcb97`). */
const PARTS_97: Record<Exclude<WordPart, 'pageBreaks'> | 'characters' | 'paragraphs' | 'complex' | 'anchors' | 'headerAnchors' | 'drawings', number> = {
  styles: 1,
  footnoteReferences: 2,
  footnoteTexts: 3,
  sections: 6,
  headers: 11,
  characters: 12,
  paragraphs: 13,
  fonts: 15,
  settings: 31,
  complex: 33,
  anchors: 40,
  headerAnchors: 41,
  endnoteReferences: 46,
  endnoteTexts: 47,
  drawings: 50,
  textBoxes: 56,
  headerTextBoxes: 58,
  lists: 73,
  listOverrides: 74
}

/**
 * A Word document of 97 to 2003, of Word 6 and 95, or of Word 2, as Markdown: its headings, paragraphs, list items and
 * tables, in order, and the pictures of a Word 97, 6 or 95 document where they are; and its look, but for a document of
 * Word 1. Word 6 and 95 keep everything in one stream, behind a header of their own, their text in the 8-bit code page
 * of the document's language and their properties in one-byte codes; Word 2 wrote the same straight into the file,
 * with places and codes of its own.
 */
export async function readOlderWord(bytes: Uint8Array, objects?: ObjectReader): Promise<OfficePreview> {
  // Word 1 wrote its documents as Word 2 did, a few of its places and properties its own.
  const one = readU16(bytes, 0) === 0xa59b
  const two = one || readU16(bytes, 0) === 0xa5db
  return readWord(two ? undefined : openCompound(bytes), bytes, one, objects)
}

/** A Word 97 document held as an object, from its storage, as `readOlderWord` reads one, its own objects by their pictures. */
export function readOlderWordStorage(storage: Compound): Promise<OfficePreview> {
  return readWord(storage, new Uint8Array(), false)
}

async function readWord(file: Compound | undefined, bytes: Uint8Array, one: boolean, objects?: ObjectReader): Promise<OfficePreview> {
  const two = !file
  const stream = file ? file.stream('WordDocument') : bytes
  if (!stream) throw new Error('This is not a Word document.')
  const word = reader(stream)
  // Word 2's header ends with the count of its pages of paragraph formats.
  if (word.length < (one ? 0x192 : two ? 0x146 : 0x200)) damaged()
  const identifier = word.u16(0)
  const number = word.u16(2)
  if (identifier !== 0xa5ec && identifier !== 0xa5dc && !two) throw new Error('This is not a Word document.')
  const six = number < 0xc1
  if (six && number < 0x65 && !two) throw new Error('It is a document of Word 2 or older, which is not read here.')
  const version: WordVersion = one ? 1 : two ? 2 : six || !file ? 6 : 97
  const flags = word.u16(0x0a)
  if (flags & 0x0100) throw new Error(PROTECTED)
  const tableStream = version !== 97 || !file ? stream : file.stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!tableStream) damaged()
  const table = reader(tableStream as Uint8Array)

  // Where things are: in Word 97 a fixed part, then counts of 16-bit and 32-bit values, then pairs of where and how
  // long; in Word 6 and 95, at places of their own; in Word 2, at others, how long in two bytes. Word 1 keeps its
  // quick save's pieces at a place of its own.
  let textLength: number
  let lengths: number[]
  let part: (name: WordPart | 'characters' | 'paragraphs' | 'complex' | 'anchors' | 'headerAnchors' | 'drawings') => WordPlace
  const none = { at: 0, size: 0 }
  if (version === 97) {
    const shorts = word.u16(32)
    const longsAt = 34 + shorts * 2
    const longs = word.u16(longsAt)
    textLength = Math.min(word.u32(longsAt + 2 + 3 * 4), CHARACTER_LIMIT)
    const pairsAt = longsAt + 2 + longs * 4
    const pairCount = word.u16(pairsAt)
    if (pairCount < 34) damaged()
    lengths = Array.from({ length: 8 }, (_, index) => (index + 3 < longs ? word.u32(longsAt + 2 + (index + 3) * 4) : 0))
    // The version that saved it, after the parts' places when it is newer than Word 97 (`nFibNew`), says which cache of
    // its pages' breaks is its own: Word 97's, 2000's and 2002's, or 2003's; Word 2007 and later keep none.
    const newer = pairsAt + 2 + pairCount * 8
    const savedBy = newer + 4 <= word.length && word.u16(newer) > 0 ? word.u16(newer + 2) : number
    const breaks = savedBy < 0xd9 ? 64 : savedBy < 0x10c ? 103 : savedBy === 0x10c ? 155 : undefined
    part = (name) => {
      const index = name === 'pageBreaks' ? breaks : PARTS_97[name]
      return index !== undefined && index < pairCount ? { at: word.u32(pairsAt + 2 + index * 8), size: word.u32(pairsAt + 6 + index * 8) } : none
    }
  } else {
    textLength = Math.min(word.u32(0x34), CHARACTER_LIMIT)
    lengths = Array.from({ length: 8 }, (_, index) => word.u32(0x34 + index * 4))
    const places = OLDER_PARTS[version === 6 ? 6 : 2]
    part = (name) => {
      const at = name === 'complex' && one ? 0x112 : places[name as keyof typeof places]
      if (at === undefined) return none
      return { at: word.u32(at), size: version === 6 ? word.u32(at + 4) : word.u16(at + 4) }
    }
    // Word 2 leaves its fonts' table without its length: it reaches the part after it.
    if (version === 2) {
      const counted = part
      part = (name) => {
        const found = counted(name)
        if (name !== 'fonts' || found.size > 2) return found
        const next = word.u32(0xb8)
        return { at: found.at, size: next > found.at ? Math.min(next - found.at, 4096) : 0 }
      }
    }
  }
  const complex = version === 97 || flags & 0x0004 ? part('complex') : undefined

  // The text is in pieces, each where the file keeps it: in 8-bit characters, or in UTF-16. A Word 6 file saved
  // whole has one, from the start of its text; one saved quickly lists them, all 8-bit, Word 2 their size in two bytes.
  // Word 97 and 6 list the properties some pieces share first, each piece naming its own by their place in the list,
  // or Word 6's one property in its name.
  const pieces: TextPiece[] = []
  const shared: WordPlace[] = []
  // A file saved whole keeps every story's text in one run from its start: the body's, then its notes', headers' and
  // the rest, up to where its text ends (`fcMac`).
  if (complex === undefined) {
    const start = word.u32(0x18)
    pieces.push({ start: 0, end: Math.max(textLength, Math.min(word.u32(0x1c), word.length) - start), at: start, narrow: true })
  } else
    for (let at = complex.at; at < complex.at + complex.size; ) {
      const kind = table.u8(at)
      if (kind === 1) {
        shared.push({ at: at + 3, size: Math.max(0, table.i16(at + 1)) })
        at += 3 + Math.max(0, table.i16(at + 1))
        continue
      }
      if (kind !== 2) damaged()
      const size = two ? table.u16(at + 1) : table.u32(at + 1)
      const list = at + (two ? 3 : 5)
      const count = Math.floor((size - 4) / 12)
      for (let index = 0; index < count; index++) {
        const raw = table.u32(list + (count + 1) * 4 + index * 8 + 2)
        const narrow = six || (raw & 0x40000000) !== 0
        const offset = six ? raw : raw & 0x3fffffff
        const modifier = table.u16(list + (count + 1) * 4 + index * 8 + 6)
        const piece: TextPiece = {
          start: table.u32(list + index * 4),
          end: table.u32(list + (index + 1) * 4),
          at: narrow && !six ? offset / 2 : offset,
          narrow
        }
        if (!two && modifier & 1) piece.properties = shared[modifier >> 1]
        else if (version === 6 && (modifier >> 1) & 0x7f) piece.property = ((modifier >> 1) & 0x7f) | (modifier & 0xff00)
        pieces.push(piece)
      }
      break
    }
  if (pieces.length === 0) damaged()

  // The runs of characters and of paragraphs are in pages of 512 bytes, numbered in four bytes in Word 97 and in two
  // before it, whose list a quick save may leave short of the pages that follow.
  const runPages = (kind: 'characters' | 'paragraphs'): number[] => {
    const place = part(kind)
    const numberSize = version === 97 ? 4 : 2
    const listed = place.size >= 4 ? Math.floor((place.size - 4) / (4 + numberSize)) : 0
    const pages: number[] = []
    for (let index = 0; index < listed; index++) {
      const at = place.at + (listed + 1) * 4 + index * numberSize
      pages.push(version === 97 ? table.u32(at) & 0x3fffff : table.u16(at))
    }
    if (version !== 97 && listed > 0) {
      const all = word.u16(kind === 'paragraphs' ? (version === 2 ? 0x144 : 0x190) : version === 2 ? 0x142 : 0x18e)
      for (let next = (pages.at(-1) ?? 0) + 1; pages.length < Math.min(all, 4096); next++) pages.push(next)
    }
    return pages
  }
  const pages = { characters: version === 1 ? [] : runPages('characters'), paragraphs: runPages('paragraphs') }

  // Word 97 writes its 8-bit text in Western European; Word 2 to 95, in the code page of the document's language,
  // which may take two bytes for a character: the marks that matter are single bytes, found before decoding.
  const codePage = version === 97 ? 1252 : word.u16(0x14) === 256 ? 10000 : languageCodePage(word.u16(0x06))
  const narrow = codePageDecoder(codePage)
  const decode = (bytes: Uint8Array) => narrow.decode(bytes)

  // Each paragraph's format is found by where its mark is in the file, each run's of characters by where it is.
  const runs = formattedRuns(word, version, pages.paragraphs, true)
  const formats = new Map<FormattedRun, ParagraphFormat>()
  const plainFormat = (): ParagraphFormat => ({ style: 0, inTable: false, rowEnd: false, list: false, level: 0 })
  const formatAt = (place: number): ParagraphFormat | undefined => {
    const run = runAt(runs, place)
    if (!run) return undefined
    let format = formats.get(run)
    if (!format) {
      // A format that cannot be read is no format: the text is still worth showing.
      try {
        const { style, properties } = paragraphRun(word, version, run, decode)
        format = paragraphFormat(style, properties)
      } catch {
        format = plainFormat()
      }
      formats.set(run, format)
    }
    return format
  }
  let characters: FormattedRun[] | undefined
  const characterProperties = (place: number): Properties | undefined => {
    characters ??= formattedRuns(word, version, pages.characters, false)
    const run = runAt(characters, place)
    return run && characterRun(word, version, run, decode)
  }
  const pictures =
    file && (version === 97 || version === 6)
      ? wordPictures(
          stream,
          characterProperties,
          { data: version === 97 ? file.stream('Data') : stream, objects: file.storage('ObjectPool'), read: objects },
          version === 97
            ? {
                table,
                tableBytes: tableStream as Uint8Array,
                anchors: part('anchors'),
                headerAnchors: part('headerAnchors'),
                headerStart: (lengths[0] ?? 0) + (lengths[1] ?? 0),
                drawings: part('drawings')
              }
            : undefined
        )
      : undefined
  const styles = part('styles')
  let headings = new Map<number, number>()
  try {
    headings = two ? twoHeadingStyles(word, styles.at, styles.size) : headingStyles(table, styles.at, styles.size, version === 97)
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
  const fields: { code: string; coding: boolean; object?: number | undefined }[] = []
  // The text of the documents held as objects, by the place of their figures.
  const quotes = new Map<number, Promise<ObjectRead | undefined>>()
  const figure = (found: number | undefined) => {
    if (found !== undefined) paragraph += `${FIGURE_START}${found}${FIGURE_END}`
  }
  const take = (code: number, char: string, place: number, character: number) => {
    const field = fields.at(-1)
    if (code === 0x13) fields.push({ code: '', coding: true })
    else if (code === 0x14) {
      if (field) {
        field.coding = false
        if (place >= 0) field.object = pictures?.object(place)
      }
    } else if (code === 0x15) fields.pop()
    else if (fields.some((one) => one.coding)) {
      if (field?.coding) field.code += char
    } else if (code === 0x0d || code === 0x0c) endParagraph('\r', place)
    else if (code === 0x07) endParagraph('\x07', place)
    else if (code === 0x0b) paragraph += '\n'
    else if (code === 0x1e) paragraph += '-'
    else if (code === 0x01 && place >= 0) {
      // An equation of Equation Editor or MathType is written as linear text in its place, as Word's own are.
      const equation = pictures?.equation(field?.object)
      const program = /^\s*EMBED\s+(\S+)/i.exec(field?.code ?? '')?.[1]
      if (equation !== undefined) paragraph += equation
      else {
        const found = pictures?.inline(place, { object: field?.object, chart: /^\s*EMBED\s+\S*Chart/i.test(field?.code ?? ''), program })
        figure(found)
        // A document or a presentation held as an object is shown by its text, once read, after the paragraph that
        // holds it; what another object holds is no text, and leaves its figure in place.
        if (found !== undefined && pictures && program !== undefined) quotes.set(found, pictures.read(field?.object, program))
      }
    } else if (code === 0x08) figure(pictures?.floating(character))
    else if (code === 0x09 || (code >= 0x20 && char !== FIGURE_START && char !== FIGURE_END)) paragraph += char
  }
  let read = 0
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
  // The document's look, read after its text with the same figures; one whose look cannot be read shows its text.
  let look: ReturnType<typeof readOlderWordLook> | undefined
  const dataStream = version === 97 ? file?.stream('Data') : undefined
  if (version !== 1)
    try {
      look = readOlderWordLook({
        version,
        word,
        table,
        data: dataStream && reader(dataStream),
        part,
        runPages: pages,
        codePage,
        lengths,
        pieces,
        figures: pictures ?? NO_FIGURES,
        limit: CHARACTER_LIMIT
      })
    } catch {
      look = undefined
    }
  await pictures?.figures.drawPacked()
  const figures = pictures?.figures.list ?? []
  // Each figure's place in the text becomes its mark, once the text around it is written as Markdown.
  const held = new Map<number, ObjectRead | undefined>()
  for (const [place, read] of quotes) held.set(place, await read)
  // A document held is quoted on lines of its own, or written on its cell's line in a table.
  const markdown = joinBlocks(blocks)
    .replace(new RegExp(`${FIGURE_START}(\\d+)${FIGURE_END}`, 'g'), (_, place: string, at: number, whole: string) => {
      const text = held.get(Number(place))
      if (text?.kind === 'text') return whole[whole.lastIndexOf('\n', at) + 1] === '|' ? plain(text.lines.join(' ')) : `\n\n${text.markdown}\n\n`
      const found = figures[Number(place)]
      return found ? figureMark(Number(place), found.kind === 'chart' ? found.title : found.alt) : ''
    })
    // The space around a quotation, and the blank lines it doubles, are left out.
    .replace(/[ \t]+\n\n>/g, '\n\n>')
    .replace(/(\n>[^\n]*)\n\n[ \t]+/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  const cut = blocks.length >= BLOCK_LIMIT || read >= CHARACTER_LIMIT
  return look ? { kind: 'document', markdown, figures, cut: cut || look.cut, look: look.look } : { kind: 'document', markdown, figures, cut }
}

/** A 16-bit number at the start of a file, before it is known to be anything. */
const readU16 = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
const readU32 = (bytes: Uint8Array, at: number) => (readU16(bytes, at) | (readU16(bytes, at + 2) << 16)) >>> 0

// Excel

/**
 * Which sheet of an Excel 5 to 2003 workbook's stream an object of it shows, and the block of cells: the sheet the
 * workbook was left on (`WINDOW1`, counting every sheet it lists) and the block its object was sized to (`OLESIZE`).
 */
export function olderWorkbookView(stream: Uint8Array): { active?: string | undefined; area?: CellArea | undefined } {
  const view: { active?: string | undefined; area?: CellArea | undefined } = {}
  try {
    const book = reader(stream)
    if (book.u16(0) !== 0x0809) return view
    const eight = book.u16(4) === 0x0500
    let active = 0
    const names: string[] = []
    for (const record of records(book, 0)) {
      if (record.type === 0x003d && record.size >= 12) active = book.u16(record.at + 10)
      else if (record.type === 0x00de && record.size >= 8)
        view.area = { top: book.u16(record.at + 2), bottom: book.u16(record.at + 4), left: book.u8(record.at + 6), right: book.u8(record.at + 7) }
      else if (record.type === 0x0085 && record.size >= 8) {
        const length = book.u8(record.at + 6)
        const wide = !eight && (book.u8(record.at + 7) & 0x01) !== 0
        names.push(
          eight ? latin1(book.bytes(record.at + 7, length)) : wide ? utf16(book.bytes(record.at + 8, length * 2)) : latin1(book.bytes(record.at + 8, length))
        )
      } else if (record.type === 0x000a) break
    }
    view.active = names[active]
  } catch {
    // A workbook whose records cannot be read shows its first sheet, as far as it goes.
  }
  return view
}

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
    return this.richText().text
  }
  /**
   * A string of Excel's with its formatting runs: where each stretch starts and the number of its font, four bytes
   * each after its characters. Its phonetic guide is passed over.
   */
  richText(): { text: string; runs: LaidRun[] } {
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
    const stretches: LaidRun[] = []
    for (let index = 0; index < runs; index++) {
      const start = this.u16()
      stretches.push({ start, font: this.u16() })
    }
    this.skip(extra)
    return { text, runs: stretches }
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
  /** Where each figure is on the sheet, in the order of the figures, when its drawing says. */
  anchors?: (CellAnchor | undefined)[] | undefined
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
 * A workbook of Excel 97 to 2003, of Excel 5 and 95, or of Excel 2 to 4, its sheets each as rows of its cells' values
 * as their formats show them. Excel 5 and 95 write their text in 8-bit characters of the workbook's code page, with no
 * table of strings, and so do Excel 2 to 4. What the objects of other apps of an Excel 97 workbook hold is read by
 * `objects` when given. A workbook held as an object (`held`) has its sheets' looks reach as far as the block its
 * object shows and the pictures its sheets place, which are drawn over its cells.
 */
export async function readOlderExcel(
  bytes: Uint8Array,
  options: NumberFormatOptions = {},
  objects?: ObjectReader,
  held?: CellArea | true
): Promise<OfficePreview> {
  const parts = workbookParts(bytes, options, objects)
  await parts.figures.drawPacked()
  // Each sheet's look, from its records and the styles it uses, the workbook's or, in Excel 2 to 4, often its own, each
  // read once; a sheet whose look cannot be read shows as a table.
  const read = new Map<OlderBookRecords, Promise<WorkbookStyles | undefined>>()
  const stylesOf = (looks: OlderBookRecords) => {
    const known = read.get(looks) ?? readOlderBookStyles(looks).catch(() => undefined)
    read.set(looks, known)
    return known
  }
  return {
    kind: 'workbook',
    sheets: await Promise.all(
      withFigures(parts).map(async ({ name, rows, cut, figures, cells, anchors }, index) => {
        const { layout, laid, looks } = parts.sheets[index] ?? {}
        const styles = looks && (await stylesOf(looks))
        let look: SheetLook | undefined
        if (styles && layout && laid && (rows.length > 0 || (held && figures.length > 0))) {
          const extent = { rows: rows.length, columns: Math.max(0, ...rows.map((row) => row.length)) }
          try {
            look = readOlderSheetLook(laid, layout, styles, held ? heldExtent(extent, held === true ? undefined : held, anchors ?? []) : extent)
          } catch {
            look = undefined
          }
          // Its conditional formats, worked out from its cells' values.
          const date1904 = laid.date1904 ?? false
          if (look && laid.conditions)
            look = withConditions(look, () => readOlderConditions(laid.conditions ?? [], styles.colors), {
              value: (row, column) => cellValue(layout.kinds[row]?.[column], rows[row]?.[column], cells.get(`${row},${column}`)?.number),
              now: serialNow(date1904),
              date1904
            })
        }
        return { name, rows, cut, figures, look, ...(anchors ? { anchors } : {}) }
      })
    )
  }
}

/**
 * A workbook's sheets as they are read, each with the places of its figures in the workbook's, the records of its look
 * and those of the styles it uses.
 */
interface WorkbookParts {
  sheets: (Omit<OlderSheet, 'figures'> & {
    places: { figure: number; anchor?: CellAnchor | undefined }[]
    layout?: SheetLayout | undefined
    laid?: OlderSheetRecords | undefined
    looks?: OlderBookRecords | undefined
  })[]
  figures: ArtFigures
}

/** The sheets of a workbook with their figures as they are now, and where each is on its sheet when its drawing says. */
const withFigures = ({ sheets, figures }: WorkbookParts): OlderSheet[] =>
  sheets.map(({ name, rows, cut, cells, places }) => {
    const shown = places.filter(({ figure }) => figures.list[figure] !== undefined)
    const anchors = shown.map(({ anchor }) => anchor)
    return {
      name,
      rows,
      cut,
      cells,
      figures: figures.at(shown.map(({ figure }) => figure)),
      ...(anchors.some((anchor) => anchor !== undefined) ? { anchors } : {})
    }
  })

/** The beginnings of a part of a workbook (`BOF`), in Excel 2, 3, 4, and 5 and later. */
const BEGINNINGS = new Map([
  [0x0009, 2],
  [0x0209, 3],
  [0x0409, 4],
  [0x0809, 5]
])

/** The sheets of a workbook, read as `readOlderExcel` shows them, a metafile kept packed not drawn yet. */
export function readOlderSheets(bytes: Uint8Array, options: NumberFormatOptions = {}): OlderSheet[] {
  return withFigures(workbookParts(bytes, options))
}

function workbookParts(bytes: Uint8Array, options: NumberFormatOptions, objects?: ObjectReader): WorkbookParts {
  // Excel 2, 3 and 4 wrote their records straight into the file, and some programs write Excel 5's and 97's so too.
  const first = BEGINNINGS.get(readU16(bytes, 0))
  if (bytes.length >= 4 && first !== undefined && readU16(bytes, 2) < 32) return first < 5 ? earliestSheets(bytes, options) : bookParts(bytes, options)
  const file = openCompound(bytes)
  const stream = file.stream('Workbook') ?? file.stream('Book')
  if (!stream) throw new Error('This is not an Excel workbook.')
  // The objects of other apps are each kept in a storage of the file's own, named by the sheet's object record.
  const storage = (name: string) => {
    try {
      return file.storage(name)
    } catch {
      return undefined
    }
  }
  return bookParts(stream, options, { storage, read: objects })
}

/** The sheets of a workbook's stream in an object's storage. */
function sheetsOf(file: Compound): OlderSheet[] {
  const stream = file.stream('Workbook') ?? file.stream('Book')
  if (!stream) throw new Error('This is not an Excel workbook.')
  return withFigures(bookParts(stream, {}))
}

/** The kinds of part an Excel 2 to 4 file's beginning names: a worksheet, and the records of Excel 4's workbook. */
const WORKSHEET = 0x0010
const WORKBOOK = 0x0100

/** A part of an Excel 2 to 4 file, from its beginning to its end, with the formats and styles it keeps. */
interface EarliestPart {
  at: number
  kind: number
  version: number
  name: Uint8Array | undefined
  codes: Uint8Array[]
  styles: number[]
  codePage: number | undefined
  date1904: boolean | undefined
  /** The records of its look: its fonts, its styles of cells in full and its palette. */
  looks: OlderBookRecords
}

/**
 * The sheets of a file of Excel 2, 3 or 4, whose records are written straight into it rather than in a compound file:
 * a worksheet alone, or Excel 4's workbook, its own records first, then each sheet after a record naming it
 * (`SHEETHDR`). A part keeps its formats in order and its styles (`XF`), each naming a format by its place, its fonts
 * and its palette; a cell of Excel 2 keeps its format, font, alignment, borders and shading itself as well. A sheet
 * with no formats or styles of its own uses the workbook's.
 */
function earliestSheets(bytes: Uint8Array, options: NumberFormatOptions): WorkbookParts {
  const book = reader(bytes)
  const parts: EarliestPart[] = []
  let part: EarliestPart | undefined
  let named: Uint8Array | undefined
  let depth = 0
  for (const { type, at, size } of records(book, 0)) {
    const version = BEGINNINGS.get(type)
    if (version !== undefined) {
      if (depth++ === 0) {
        const looks: OlderBookRecords = {
          version,
          fonts: [],
          fontColors: [],
          styles: [],
          explicit: [],
          palette: undefined,
          extended: [],
          theme: undefined,
          eight: latin1
        }
        part = {
          at: at - 4,
          kind: size >= 4 ? book.u16(at + 2) : 0,
          version,
          name: named,
          codes: [],
          styles: [],
          codePage: undefined,
          date1904: undefined,
          looks
        }
        parts.push(part)
        named = undefined
      }
      continue
    }
    if (type === 0x000a) {
      if (--depth <= 0) [depth, part] = [0, undefined]
      continue
    }
    if (type === 0x008f && depth === 0 && size >= 5) named = book.bytes(at + 5, Math.min(book.u8(at + 4), size - 5))
    if (!part || depth !== 1) continue
    if (type === 0x002f) throw new Error(PROTECTED)
    if (type === 0x0042 && size >= 2) part.codePage = book.u16(at)
    else if (type === 0x0022 && size >= 2) part.date1904 = book.u16(at) === 1
    else if (type === 0x001e && size >= 1) part.codes.push(book.bytes(at + 1, Math.min(book.u8(at), size - 1)))
    else if (type === 0x041e && size >= 3) part.codes.push(book.bytes(at + 3, Math.min(book.u8(at + 2), size - 3)))
    else if ((type === 0x0243 || type === 0x0443) && size >= 2) {
      part.styles.push(book.u8(at + 1))
      part.looks.styles.push(book.bytes(at, size))
    } else if (type === 0x0043 && part.version === 2 && size >= 4) part.looks.styles.push(book.bytes(at, size))
    // Excel 2's fonts (`FONT`) are followed by their colour (`FONTCOLOR`); Excel 3's and 4's keep theirs.
    else if (((type === 0x0031 && part.version === 2) || type === 0x0231) && size >= 5) part.looks.fonts.push(book.bytes(at, size))
    else if (type === 0x0045 && size >= 2 && part.looks.fonts.length > 0) part.looks.fontColors[part.looks.fonts.length - 1] = book.u16(at)
    else if (type === 0x0092) part.looks.palette = book.bytes(at, size)
  }
  const workbook = parts.find((one) => one.kind === WORKBOOK)
  const sheets = parts
    .filter((one) => one.kind === WORKSHEET)
    .slice(0, SHEET_LIMIT)
    .map((sheet) => {
      const decoder = codePageDecoder(sheet.codePage ?? workbook?.codePage ?? 1252)
      const eight = (text: Uint8Array) => decoder.decode(text)
      const codes = (sheet.codes.length > 0 || !workbook ? sheet : workbook).codes.map(eight)
      const styles = (sheet.styles.length > 0 || !workbook ? sheet : workbook).styles
      const looks = (sheet.looks.styles.length > 0 || !workbook ? sheet : workbook).looks
      looks.eight = eight
      // Excel 2's cells name one of its styles when it keeps them, else keep their attributes themselves, each set of
      // them a style of its own after the records'; the style names a format, in six bits of its own.
      const kept = new Map<string, number>()
      const twoStyle = (attributes: Uint8Array, extended: number | undefined) => {
        const index = (attributes[0] ?? 0) & 0x3f
        if (looks.styles.length > 0) return index === 63 ? (extended ?? 0) : index
        // The first style is plain, for the cells with none of their own.
        if (looks.explicit.length === 0) kept.set('0,0,0', looks.explicit.push(new Uint8Array(3)) - 1)
        const key = attributes.join(',')
        const known = kept.get(key) ?? looks.explicit.push(attributes) - 1
        kept.set(key, known)
        return known
      }
      const twoFormat = (style: number) => (looks.styles[style]?.[2] ?? looks.explicit[style - looks.styles.length]?.[1] ?? 0) & 0x3f
      // Excel 3's and 4's cells name their style, which names their format.
      const formatOf = (style: number) => codes[sheet.version === 2 ? twoFormat(style) : (styles[style] ?? 0)] ?? 'General'
      const shown = { ...options, date1904: sheet.date1904 ?? workbook?.date1904 ?? false }
      const colors = { palette: readOlderPalette(looks.palette) }
      const { rows, cut, cells, layout, laid } = sheetRows(
        book,
        sheet.at,
        { strings: [], version: sheet.version, eight },
        formatOf,
        shown,
        (index) => paletteColor(index, colors),
        twoStyle
      )
      // A worksheet alone has no name but its file's.
      return { name: sheet.name ? eight(sheet.name) : '', rows, cut, cells, places: [], layout, laid, looks }
    })
  return { sheets, figures: new ArtFigures() }
}

/** Where the objects of other apps of a workbook are kept, by the name of their storage, and what reads them. */
interface HeldObjects {
  storage: (name: string) => Compound | undefined
  read?: ObjectReader | undefined
}

/** The sheets of a workbook's stream of Excel 5 to 2003, the objects of other apps it holds found in `held`. */
function bookParts(stream: Uint8Array, options: NumberFormatOptions, held?: HeldObjects): WorkbookParts {
  const book = reader(stream)
  if (book.u16(0) !== 0x0809) throw new Error('This is not an Excel workbook.')
  const version = book.u16(4)
  if (version !== 0x0600 && version !== 0x0500) throw new Error('This is not an Excel workbook.')
  const five = version === 0x0500
  // Excel 5 and 95's 8-bit text is in the workbook's code page; Excel 97's, in the first 256 characters of Unicode.
  let narrow = five ? codePageDecoder(1252) : undefined
  const eight = (bytes: Uint8Array) => (narrow ? narrow.decode(bytes) : latin1(bytes))

  const strings: string[] = []
  // The stretches of the shared strings that have them, by their place.
  const stringRuns: (LaidRun[] | undefined)[] = []
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
  // The records of its look: its fonts, its styles of cells in full, its palette, their colours in full and its theme.
  const looks: OlderBookRecords = {
    version: five ? 5 : 8,
    fonts: [],
    fontColors: [],
    styles: [],
    explicit: [],
    palette: undefined,
    extended: [],
    theme: undefined,
    eight
  }
  const theme: Uint8Array[] = []
  let theming = false
  let shared: Uint8Array[] | undefined
  const readShared = () => {
    if (!shared) return
    const parts = new Continued(shared)
    parts.skip(4)
    const count = parts.u32()
    try {
      for (let index = 0; index < count; index++) {
        const { text, runs } = parts.richText()
        strings.push(text)
        if (runs.length > 0) stringRuns[strings.length - 1] = runs
      }
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
    // A theme's package continues past its record in records of their own (`CONTINUEFRT11`), after a header of four bytes.
    if (theming && record.type === 0x0875 && record.size >= 4) {
      theme.push(book.bytes(record.at + 4, record.size - 4))
      continue
    }
    theming = false
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
    } else if (record.type === 0x00e0 && record.size >= 4) {
      styles.push(book.u16(record.at + 2))
      looks.styles.push(book.bytes(record.at, record.size))
    } else if (record.type === 0x0031 && record.size >= 15) looks.fonts.push(book.bytes(record.at, record.size))
    else if (record.type === 0x0092) looks.palette = book.bytes(record.at, record.size)
    else if (record.type === 0x087d && record.size >= 20) looks.extended.push(book.bytes(record.at, record.size))
    else if (record.type === 0x0896 && record.size > 16) {
      theme.push(book.bytes(record.at + 16, record.size - 16))
      theming = true
    } else if (record.type === 0x0022 && record.size >= 2) date1904 = book.u16(record.at) === 1
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
  if (theme.length > 0) looks.theme = joined(theme)
  // The palette a format names its colours from (`[Color10]`), the workbook's own over Excel's.
  const colors = { palette: readOlderPalette(looks.palette) }
  const palette = (index: number) => paletteColor(index, colors)
  const figures = new ArtFigures()
  const store = joined(group)
  const [drawingGroup] = artRecords(store)
  const stored = storedPictures(store, drawingGroup?.type === ART.drawingGroup ? childOf(store, drawingGroup, ART.store) : undefined)

  const read = sheets
    .slice(0, SHEET_LIMIT)
    .map(({ name, at, chart }) =>
      chart
        ? { name, rows: [], cut: false, cells: new Map<string, CellValue>(), drawing: new Uint8Array(), charts: [chartRecords(book, at)], objects: [] }
        : { name, ...sheetRows(book, at, { strings, runs: stringRuns, version: five ? 5 : 8, eight }, shownBy, shown, palette) }
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
  return {
    sheets: read.map(({ drawing, charts, objects, ...sheet }) => ({
      ...sheet,
      places: sheetFigures({ drawing, charts, objects }, stored, figures, context, held),
      looks
    })),
    figures
  }
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

/** The objects a sheet places, as they are read: its drawing, the records of each chart, and each object in order. */
interface SheetObjects {
  drawing: Uint8Array
  charts: ChartRecord[][]
  objects: ObjectRecord[]
}

/**
 * An object of a sheet as its record (`OBJ`) names it: its kind, and for an object of another app, the storage of the
 * file that keeps it, its program's name, and whether it shows as its program's icon.
 */
interface ObjectRecord {
  kind: number
  storage?: string | undefined
  program?: string | undefined
  icon?: boolean | undefined
}

/** The kinds of object a sheet's object record names. */
const CHART_OBJECT = 0x05
const PICTURE_OBJECT = 0x08

/**
 * An object record of Excel 97, its parts one after the other, each a type and a length: its kind (`ftCmo`), whether
 * it shows as an icon (`ftPioGrbit`), and, for an object of another app, its picture's formula (`ftPictFmla`): the
 * formula's length, its tokens after six bytes, the name of its program (`PictFmlaEmbedInfo`), then the number of the
 * storage that keeps it, which is named `MBD` and that number in eight hexadecimal digits.
 */
function objectRecord(book: Reader, at: number, size: number): ObjectRecord {
  const found: ObjectRecord = { kind: book.u16(at + 4) }
  const end = at + size
  for (let part = at; part + 4 <= end; ) {
    const type = book.u16(part)
    const length = book.u16(part + 2)
    const body = part + 4
    if (type === 0x0000 || body + length > end) break
    if (type === 0x0008 && length >= 2) found.icon = (book.u16(body) & 0x0008) !== 0
    else if (type === 0x0009 && length >= 2) {
      const formula = book.u16(body)
      const formulaEnd = body + 2 + formula
      if (formula >= 6 && formulaEnd <= body + length) {
        const named = body + 8 + (book.u16(body + 2) & 0x7fff)
        if (named + 4 <= formulaEnd && book.u8(named) === 0x03) {
          const characters = book.u8(named + 1)
          const wide = (book.u8(named + 3) & 0x01) !== 0
          if (named + 4 + characters * (wide ? 2 : 1) <= formulaEnd)
            found.program = wide ? utf16(book.bytes(named + 4, characters * 2)) : latin1(book.bytes(named + 4, characters))
        }
        if (formulaEnd + 4 <= body + length) found.storage = `MBD${book.u32(formulaEnd).toString(16).toUpperCase().padStart(8, '0')}`
      }
    }
    part = body + length
  }
  return found
}

/**
 * The pictures and charts a sheet places, by their places in the workbook's figures, in the order of its objects: a
 * picture from its drawing's next shape that shows one, a chart from the next chart's records. Those no object names
 * follow. An object of another app shows the picture its app last drew of it, an equation's linear text its words, and
 * gives way to what `held` reads of it once the file is read: a worksheet as its sheet, a document's text its words.
 */
function sheetFigures(
  placed: SheetObjects,
  stored: (place: number) => StoredPicture | undefined,
  figures: ArtFigures,
  context: ChartContext,
  held?: HeldObjects
): { figure: number; anchor?: CellAnchor | undefined }[] {
  const [container] = artRecords(placed.drawing)
  const shapes = container?.type === ART.drawing ? artShapes(placed.drawing, container).filter((shape) => shape.picture !== undefined) : []
  const found: { figure: number; anchor?: CellAnchor | undefined }[] = []
  let picture = 0
  let chart = 0
  const nextPicture = (object?: ObjectRecord) => {
    const shape = shapes[picture++]
    if (shape?.picture === undefined) return
    const storage = object?.storage === undefined ? undefined : held?.storage(object.storage)
    let equation: string | undefined
    try {
      equation = storage && objectEquation(storage)
    } catch {
      equation = undefined
    }
    const figure = figures.picture(`store:${shape.picture}`, stored(shape.picture), equation ?? shape.alt)
    if (figure === undefined) return
    found.push({ figure, anchor: sheetAnchor(placed.drawing, shape.anchor) })
    const read = held?.read
    if (storage && equation === undefined && read) {
      const program = storageProgram(storage) || object?.program || ''
      figures.later(figure, () => read(program, storage), object?.icon ?? false)
    }
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
    if (figure !== undefined) found.push({ figure })
  }
  for (const object of placed.objects) {
    if (object.kind === PICTURE_OBJECT) nextPicture(object)
    else if (object.kind === CHART_OBJECT) nextChart()
  }
  while (picture < shapes.length) nextPicture()
  while (chart < placed.charts.length) nextChart()
  return found
}

/**
 * Where a shape of a sheet's drawing is on its cells (`OfficeArtClientAnchorSheet`): after two bytes of flags, its first
 * column and how far into it in 1024ths of its width, its first row and how far into it in 256ths of its height, then
 * the same of its last cell.
 */
function sheetAnchor(bytes: Uint8Array, record: ArtRecord | undefined): CellAnchor | undefined {
  if (!record || record.size < 18 || record.at + 18 > bytes.length) return undefined
  const value = (at: number) => readU16(bytes, record.at + at)
  return {
    from: { column: value(2), x: value(4) / 1024, row: value(6), y: value(8) / 256, shares: true },
    to: { column: value(10), x: value(12) / 1024, row: value(14), y: value(16) / 256, shares: true }
  }
}

/** The records of a formula, in Excel 5 and later, in Excel 3, and in Excel 4. */
const FORMULAS = new Set([0x0006, 0x0206, 0x0406])

/**
 * The rows of a sheet, from its records: its cells in their columns, empty ones kept so the columns line up. Its
 * version is Excel's, from 2 to 8: Excel 2's cells have records of their own, each keeping three bytes of attributes
 * that say its style (`twoStyle`), and before Excel 97 text is 8-bit.
 */
function sheetRows(
  book: Reader,
  from: number,
  text: { strings: readonly string[]; runs?: readonly (LaidRun[] | undefined)[]; version: number; eight: (bytes: Uint8Array) => string },
  formatOf: (style: number) => string,
  options: NumberFormatOptions,
  palette: (index: number) => string | undefined = () => undefined,
  twoStyle: (attributes: Uint8Array, extended: number | undefined) => number = () => 0
): { rows: string[][]; cut: boolean; cells: Map<string, CellValue>; layout: SheetLayout; laid: OlderSheetRecords } & SheetObjects {
  const { strings, version, eight } = text
  const five = version < 8
  const rows: string[][] = []
  // Each cell's style, what it holds and the colour its format writes its number in, and the records of the sheet's layout, for its look.
  const layout: SheetLayout = { styles: [], kinds: [], heights: [], numberColors: [] }
  const laid: OlderSheetRecords = { two: version === 2, columns: [], rows: [], merges: [], date1904: options.date1904 }
  const styled = (row: number, column: number, style: number, kind: CellKind, value?: number) => {
    if (row >= ROW_LIMIT || column >= COLUMN_LIMIT) return
    layout.styles[row] ??= []
    layout.kinds[row] ??= []
    layout.numberColors[row] ??= []
    layout.styles[row][column] = style
    layout.kinds[row][column] = kind
    if (value !== undefined) layout.numberColors[row][column] = numberColor(value, formatOf(style), palette)
  }
  // The sheet's drawing, in records of its own and those that continue them, among the records of its objects, and
  // each chart's records, between its own beginning and end.
  const drawing: Uint8Array[] = []
  let drawn = false
  const charts: ChartRecord[][] = []
  const objects: ObjectRecord[] = []
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
  // A string's stretches in fonts of their own, each naming its font by its number.
  const stretched = (row: number, column: number, runs: readonly LaidRun[] | undefined) => {
    if (!runs || runs.length === 0 || row >= ROW_LIMIT || column >= COLUMN_LIMIT) return
    layout.runs ??= []
    const line = layout.runs[row] ?? []
    layout.runs[row] = line
    line[column] = [...runs]
  }
  // A number as the format of its cell's style shows it.
  const number = (row: number, column: number, value: number, style: number) => {
    const code = formatOf(style)
    put(row, column, /^general$/i.test(code) ? generalNumber(value) : formatNumber(value, code, options), value)
    styled(row, column, style, 'number', value)
  }
  let depth = 0
  // A formula's text result follows it in a record of its own.
  let waiting: { row: number; column: number } | undefined
  // The style Excel 2's next cell names when its own attributes say it is the 63rd or later (`IXFE`).
  let extended: number | undefined
  // A formula's last result: a number, or marked by its last two bytes as text, a boolean, an error or nothing.
  const formula = (row: number, column: number, result: number, style: number) => {
    waiting = undefined
    if (book.u16(result + 6) !== 0xffff) number(row, column, book.f64(result), style)
    else {
      const kind = book.u8(result)
      if (kind === 0) waiting = { row, column }
      else if (kind === 1 || kind === 2) put(row, column, flag(book.u8(result + 2), kind === 2))
      styled(row, column, style, kind === 0 ? 'text' : kind === 1 ? 'logical' : kind === 2 ? 'error' : 'empty')
    }
  }
  // A formula's text result, after the formula it is the result of.
  const result = (value: string) => {
    if (waiting) put(waiting.row, waiting.column, value)
    waiting = undefined
  }
  for (const { type, at, size } of records(book, from)) {
    if (BEGINNINGS.has(type)) {
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
    if (type === 0x005d && size >= 6 && (five || book.u16(at) === 0x15)) objects.push(five ? { kind: book.u16(at + 4) } : objectRecord(book, at, size))
    const row = () => book.u16(at)
    const column = () => book.u16(at + 2)
    if (version === 2) {
      // The records of the sheet's layout, Excel 2's own.
      if (type === 0x0024) laid.columns.push(book.bytes(at, size))
      else if (type === 0x0008) laid.rows.push(book.bytes(at, size))
      else if (type === 0x0055 && size >= 2) laid.defaultWidth = book.u16(at)
      else if (type === 0x0025 && size >= 2) laid.defaultHeight = book.u16(at) & 0x7fff
      else if (type === 0x003e) laid.window = book.bytes(at, size)
      else if (type === 0x0044 && size >= 2) extended = book.u16(at)
      else if (type === 0x0007) result(eight(book.bytes(at + 1, book.u8(at))))
      if (type < 0x0001 || type > 0x0006 || size < 7) continue
      // Excel 2's cells keep three bytes of attributes after their place, which say their style.
      const style = twoStyle(book.bytes(at + 4, 3), extended)
      extended = undefined
      if (type === 0x0001) styled(row(), column(), style, 'empty')
      else if (type === 0x0002) number(row(), column(), book.u16(at + 7), style)
      else if (type === 0x0003) number(row(), column(), book.f64(at + 7), style)
      else if (type === 0x0004) {
        put(row(), column(), eight(book.bytes(at + 8, book.u8(at + 7))))
        styled(row(), column(), style, 'text')
      } else if (type === 0x0005) {
        put(row(), column(), flag(book.u8(at + 7), book.u8(at + 8) !== 0))
        styled(row(), column(), style, book.u8(at + 8) !== 0 ? 'error' : 'logical')
      } else if (type === 0x0006) formula(row(), column(), at + 7, style)
      continue
    }
    // The records of the sheet's layout, and the cells with a style but no value.
    if (type === 0x007d) laid.columns.push(book.bytes(at, size))
    else if (type === 0x0208) laid.rows.push(book.bytes(at, size))
    else if (type === 0x00e5) laid.merges.push(book.bytes(at, size))
    else if (type === 0x0055 && size >= 2) laid.defaultWidth = book.u16(at)
    else if (type === 0x0099 && size >= 2) laid.standardWidth = book.u16(at)
    else if (type === 0x0225 && size >= 4) laid.defaultHeight = book.u16(at + 2)
    else if (type === 0x023e) laid.window = book.bytes(at, size)
    else if (type === 0x00a0) laid.zoom = book.bytes(at, size)
    else if (type === 0x01b0 || type === 0x01b1 || type === 0x0879 || type === 0x087a || type === 0x087b) {
      laid.conditions ??= []
      laid.conditions.push({ type, bytes: book.bytes(at, size) })
    } else if (type === 0x0201 && size >= 6) styled(row(), column(), book.u16(at + 4), 'empty')
    else if (type === 0x00be && size >= 6)
      for (let index = 0; index < Math.min(Math.floor((size - 6) / 2), COLUMN_LIMIT); index++)
        styled(row(), column() + index, book.u16(at + 4 + index * 2), 'empty')
    if (type === 0x00fd) {
      put(row(), column(), strings[book.u32(at + 6)] ?? '')
      styled(row(), column(), book.u16(at + 4), 'text')
      stretched(row(), column(), text.runs?.[book.u32(at + 6)])
    } else if (type === 0x0203) number(row(), column(), book.f64(at + 6), book.u16(at + 4))
    else if (type === 0x027e) number(row(), column(), rkNumber(book.u32(at + 6)), book.u16(at + 4))
    else if (type === 0x00bd) {
      const first = column()
      for (let index = 0; index < Math.floor((size - 6) / 6); index++)
        number(row(), first + index, rkNumber(book.u32(at + 6 + index * 6)), book.u16(at + 4 + index * 6))
    } else if (type === 0x0205) {
      put(row(), column(), flag(book.u8(at + 6), book.u8(at + 7) !== 0))
      styled(row(), column(), book.u16(at + 4), book.u8(at + 7) !== 0 ? 'error' : 'logical')
    } else if (type === 0x0204 || type === 0x0207 || type === 0x00d6) {
      // Text in a cell, plain or with runs of format after it (Excel 5 and 95), or a formula's text result.
      const start = type === 0x0207 ? at : at + 6
      const length = book.u16(start)
      const wide = !five && (book.u8(start + 2) & 0x01) !== 0
      const shown = five ? eight(book.bytes(start + 2, length)) : wide ? utf16(book.bytes(start + 3, length * 2)) : latin1(book.bytes(start + 3, length))
      if (type !== 0x0207) {
        put(row(), column(), shown)
        styled(row(), column(), book.u16(at + 4), 'text')
        waiting = undefined
      } else result(shown)
      // A string with runs of format after its characters (`RSTRING`): a byte each in Excel 5, two in Excel 97.
      if (type === 0x00d6) {
        let after = start + (five ? 2 + length : 3 + length * (wide ? 2 : 1))
        const count = five ? book.u8(after) : book.u16(after)
        after += five ? 1 : 2
        const runs: LaidRun[] = []
        for (let index = 0; index < Math.min(count, 256) && after + (five ? 2 : 4) <= at + size; index++, after += five ? 2 : 4)
          runs.push(five ? { start: book.u8(after), font: book.u8(after + 1) } : { start: book.u16(after), font: book.u16(after + 2) })
        stretched(row(), column(), runs)
      }
    } else if (FORMULAS.has(type)) formula(row(), column(), at + 6, book.u16(at + 4))
  }
  while (rows.length > 0 && (rows.at(-1)?.every((value) => value === '') ?? false)) rows.pop()
  return { rows, cut, cells, drawing: joined(drawing), charts, objects, layout, laid }
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

// PowerPoint 95

/**
 * A record of PowerPoint 95, whose records share no layout with 97's: its type, its instance, its length and a fourth
 * word, in four bytes each, then its body; a container's instance is 0xffff.
 */
interface NinetyFiveRecord {
  type: number
  container: boolean
  at: number
  size: number
}

/** The records directly inside a stretch of a PowerPoint 95 presentation's stream. */
function* ninetyFiveChildren(stream: Reader, from: number, end: number): Generator<NinetyFiveRecord> {
  for (let at = from; at + 16 <= end; ) {
    const size = stream.u32(at + 8)
    if (size > end - at - 16) return
    yield { type: stream.u32(at), container: stream.u32(at + 4) === 0xffff, at: at + 16, size }
    at += 16 + size
  }
}

/** The first record of a type directly inside a container of PowerPoint 95. */
function ninetyFiveChild(stream: Reader, record: NinetyFiveRecord | undefined, type: number): NinetyFiveRecord | undefined {
  if (!record?.container) return undefined
  for (const child of ninetyFiveChildren(stream, record.at, record.at + record.size)) if (child.type === type) return child
  return undefined
}

/** Whether a presentation's stream is PowerPoint 95's: it opens with a container of type 3, where 97's opens with two bytes of version and instance. */
const ninetyFiveStream = (raw: Uint8Array) => raw.length >= 16 && readU32(raw, 0) === 3 && readU32(raw, 4) === 0xffff

const NINETY_FIVE = {
  document: 0x03e8,
  list: 0x07d0,
  slide: 0x03ee,
  notes: 0x03f0,
  shape: 0x0bc0,
  placeholder: 0x0bc2,
  runs: 0x07ec,
  holder: 0x0fa2,
  kind: 0x0fa3,
  box: 0x0fe0,
  text: 0x07ee
}

/**
 * The texts of a slide of PowerPoint 95, in the order of its shapes, groups included, each with whether it is a title:
 * every holder of text, its kind first, numbered as 97 numbers a text's (0 a title, 6 a title slide's), then its text
 * box, whose first record is its text. Only a placeholder's text is a title: a free shape's keeps the kind of the text
 * it was copied from, and PowerPoint lists a slide whose only title is one as untitled. Its page of notes is left out,
 * as a slide of 97's notes are.
 */
function ninetyFiveTexts(
  stream: Reader,
  record: NinetyFiveRecord,
  decoder: TextDecoder,
  depth = 0,
  placeholder = false
): { title: boolean; lines: string[] }[] {
  const found: { title: boolean; lines: string[] }[] = []
  for (const child of ninetyFiveChildren(stream, record.at, record.at + record.size)) {
    if (child.type === NINETY_FIVE.holder && child.container) {
      const kind = ninetyFiveChild(stream, child, NINETY_FIVE.kind)
      const text = ninetyFiveChild(stream, ninetyFiveChild(stream, child, NINETY_FIVE.box), NINETY_FIVE.text)
      if (!text) continue
      const lines = decoder
        .decode(stream.bytes(text.at, text.size))
        .split('\r')
        .map((line) => line.replaceAll('\v', ' ').trim())
        .filter(Boolean)
      if (lines.length > 0) found.push({ title: placeholder && kind !== undefined && kind.size >= 4 && TITLE_TYPES.has(stream.u32(kind.at)), lines })
    } else if (child.container && depth < 16 && child.type !== NINETY_FIVE.notes && child.type !== NINETY_FIVE.runs) {
      const inside = child.type === NINETY_FIVE.placeholder || (child.type !== NINETY_FIVE.shape && placeholder)
      found.push(...ninetyFiveTexts(stream, child, decoder, depth + 1, inside))
    }
  }
  return found
}

/**
 * The slides of a PowerPoint 95 presentation, in the order of its first list, the one of its slides, before its
 * masters'; and whether their text, in the order of its shapes, is the text it keeps for searching (`Text_Content`),
 * slide after slide and shape after shape, as PowerPoint 95 writes it there: what tells that its records were read as
 * they were meant. A field (a date, a time, a slide's number) is a star in a shape's text, and its value as it was
 * last saved is in the text kept for searching: it is read there.
 */
function ninetyFiveSlides(
  raw: Uint8Array,
  decoder: TextDecoder,
  searched: string | undefined
): { slides: { title: string; lines: string[] }[]; cut: boolean; searched: boolean } {
  const stream = reader(raw)
  const [top] = ninetyFiveChildren(stream, 0, stream.length)
  const list = ninetyFiveChild(stream, ninetyFiveChild(stream, top, NINETY_FIVE.document), NINETY_FIVE.list)
  const slides: { title: string; lines: string[] }[] = []
  const kept = searched === undefined ? undefined : paragraphed(searched)
  let from = 0
  for (const record of list ? ninetyFiveChildren(stream, list.at, list.at + list.size) : []) {
    if (record.type !== NINETY_FIVE.slide || !record.container) continue
    if (slides.length >= SLIDE_LIMIT) return { slides, cut: true, searched: from >= 0 }
    const slide = { title: '', lines: [] as string[] }
    for (const text of ninetyFiveTexts(stream, record, decoder)) {
      let lines = text.lines
      if (kept !== undefined && from >= 0) {
        const found = searchedShape(kept, paragraphed(lines.join('\r')), from)
        from = found ? found.end : -1
        if (found) lines = found.text.split('\r').filter(Boolean)
      }
      if (text.title && slide.title === '') slide.title = lines.join(' ')
      else slide.lines.push(...lines)
    }
    slides.push(slide)
  }
  return { slides, cut: false, searched: from >= 0 }
}

/** Text with its runs of spaces and line breaks as one space, and its paragraph ends, blank paragraphs gone, as one, to compare two copies of it. */
const paragraphed = (text: string) =>
  text
    .replace(/[^\S\r]+/g, ' ')
    .replace(/ ?\r[\r ]*/g, '\r')
    .trim()

/**
 * Where a shape's text is in the text kept for searching, from a place on, and its text with each field's value: the
 * text between the parts around its star, within one paragraph; from the paragraph's start when the shape opens with
 * a field, to its end when the shape ends with one. Each part is found after the one before, so the search goes
 * through the text once.
 */
function searchedShape(kept: string, shape: string, from: number): { end: number; text: string } | undefined {
  const [first = '', ...parts] = shape.split('*')
  // A shape's text starts a paragraph of the text kept, so one that opens with a field starts at the next paragraph.
  const start = first !== '' ? kept.indexOf(first, from) : from === 0 || kept[from - 1] === '\r' ? from : kept.indexOf('\r', from) + 1
  if (start < from || start < 0) return undefined
  let end = start + first.length
  let text = first
  for (const [index, part] of parts.entries()) {
    const paragraphEnd = kept.indexOf('\r', end)
    const next = part === '' && index === parts.length - 1 ? (paragraphEnd < 0 ? kept.length : paragraphEnd) : kept.indexOf(part, end)
    const value = next < 0 ? '\r' : kept.slice(end, next)
    if (value.includes('\r')) return undefined
    text += value + part
    end = next + part.length
  }
  return { end, text }
}

/**
 * The code page a compound file's summary names for its text (its first property, `PID_CODEPAGE`), when it names one
 * of eight bits: PowerPoint 95 and 4 write their text in it.
 */
function summaryCodePage(file: Compound): number | undefined {
  const summary = file.stream('\u0005SummaryInformation')
  if (!summary || summary.length < 48) return undefined
  try {
    const properties = reader(summary)
    const section = properties.u32(44)
    const count = Math.min(properties.u32(section + 4), 1024)
    for (let index = 0; index < count; index++) {
      if (properties.u32(section + 8 + index * 8) !== 1) continue
      const at = section + properties.u32(section + 12 + index * 8)
      const codePage = properties.u16(at) === 2 ? properties.u16(at + 4) : undefined
      return codePage === 1200 ? undefined : codePage
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * A presentation of PowerPoint 95, slide by slide in the order of its list, each with its title and the lines of its
 * other text, from its records; when they cannot be read, or their text is not the one it keeps for searching, that
 * text instead. Microsoft never described these records; libmwaw, the library LibreOffice opens them with, reads the
 * same ones. Its slides are not drawn: nothing at hand shows how PowerPoint 95 drew them, to check a drawing against.
 */
function readNinetyFive(file: Compound, raw: Uint8Array): OfficePreview {
  const decoder = codePageDecoder(summaryCodePage(file) ?? 1252)
  const searched = file.stream('Text_Content')
  const text = searched && decoder.decode(searched.subarray(0, Math.min(searched.length, CHARACTER_LIMIT)))
  let read: ReturnType<typeof ninetyFiveSlides> | undefined
  try {
    read = ninetyFiveSlides(raw, decoder, text)
  } catch {
    read = undefined
  }
  if (read && read.slides.length > 0 && read.searched)
    return { kind: 'presentation', slides: read.slides.map((slide) => ({ ...slide, figures: [] })), cut: read.cut }
  if (text === undefined) throw new Error('The file is damaged: its text could not be read.')
  return ninetyFiveText(text, searched !== undefined && searched.length > CHARACTER_LIMIT)
}

/**
 * A presentation of PowerPoint 95, as the text it keeps for searching (`Text_Content`): each of its shapes'
 * paragraphs apart, its slides one after the other with nothing to tell where one ends.
 */
function ninetyFiveText(text: string, longer: boolean): OfficePreview {
  // Paragraphs end with a carriage return, a shape's last with two; a line breaks within one at a vertical tab.
  const blocks = text
    .split(/\r\r+/)
    .map((shape) =>
      shape
        .split('\r')
        .map((line) => plain(line.replace(/\v/g, ' ').trim()))
        .filter((line) => line !== '')
        .join('  \n')
    )
    .filter((block) => block !== '')
  return {
    kind: 'document',
    markdown: joinBlocks(blocks.slice(0, BLOCK_LIMIT)),
    figures: [],
    cut: blocks.length > BLOCK_LIMIT || longer
  }
}

// PowerPoint 3 and 4

/**
 * What a presentation of PowerPoint 2 to 4 says of itself at its start: a mark that reads 0x0BADDEED in the order of
 * the computer that wrote it, big-endian on a Mac, little-endian on a PC, then its version. PowerPoint 4 keeps it in a
 * compound file, as the stream `PP40`; PowerPoint 3 and older write it as the file itself, with no compound file.
 */
function olderPresentationHead(bytes: Uint8Array): { version: number; littleEndian: boolean } | undefined {
  if (bytes.length < 32) return undefined
  const mark = readU32(bytes, 0)
  const littleEndian = mark === 0x0baddeed ? true : mark === 0xeddead0b ? false : undefined
  if (littleEndian === undefined) return undefined
  return { version: reader(bytes, littleEndian).u32(4), littleEndian }
}

/**
 * What a frame of PowerPoint 3 or 4 is (32 bytes each), as far as its text needs: whether it has some, by the flag of
 * its third byte (the highest bit, in the PC's order the lowest); whether it groups others (its kind 4), and which, by
 * the first and last of them in its last eight bytes; and, in PowerPoint 4, the kind of placeholder it is (1 a title, 2
 * a body, 3 an object, 0 none), from its first word. The kind is in that word's top three bits on a Mac and its lowest
 * three on a PC, the placeholder in bits 1 and 2 on a Mac and 12 and 13 on a PC; PowerPoint 3 gives its kind in the
 * first byte, high half on a Mac, low half on a PC.
 */
function fourFrame(frames: Reader, index: number, version: number, littleEndian: boolean): { text: boolean; group?: [number, number]; placeholder?: number } {
  const at = index * 32
  const text = (frames.u8(at + 2) & (littleEndian ? 0x01 : 0x80)) !== 0
  const word = frames.u16(at)
  const first = frames.u8(at)
  const kind = version === 3 ? (littleEndian ? first & 7 : (first >> 4) & 7) : littleEndian ? word & 7 : (word >> 13) & 7
  const group: [number, number] | undefined = kind === 4 ? [frames.u32(at + 24), frames.u32(at + 28)] : undefined
  const placeholder = version === 3 ? undefined : littleEndian ? (word >> 12) & 3 : (word >> 1) & 3
  return { text, ...(group ? { group } : {}), ...(placeholder === undefined ? {} : { placeholder }) }
}

/** The most frames of a slide gathered into groups, past which the rest are read in the order of their list. */
const GROUPED_LIMIT = 1 << 16

/**
 * The texts of a slide of PowerPoint 3 or 4 (its `TextZone`), in order: after a head of 14 bytes, each a box of 58
 * bytes (its paragraph's style, its place, its first font and ruler) whose last four give its length, its characters,
 * a byte to make them even, then its runs of fonts and of paragraphs, each a head of 12 bytes (a tag, the length again,
 * the size of a run and their count) and the runs. A text whose parts do not fit ends the list, as libmwaw ends it.
 */
function fourTexts(zone: Reader, decoder: TextDecoder): string[] {
  const texts: string[] = []
  let at = 14
  while (at + 58 < zone.length) {
    const size = zone.u32(at + 54)
    if (size > zone.length - at - 58 - 18) break
    const text = decoder.decode(zone.bytes(at + 58, size))
    let after = at + 58 + size + (size & 1)
    // The runs of fonts, then of paragraphs: each head says how long a run is and how many follow.
    for (const last of [false, true]) {
      const runSize = zone.u16(after + 6)
      const runs = zone.u32(after + 8)
      if (runSize < 4 || runs > (zone.length - after) / runSize || after + 12 + runSize * runs + (last ? 0 : 8) > zone.length) return texts
      after += 12 + runSize * runs
    }
    texts.push(text)
    at = after
  }
  return texts
}

/**
 * A slide of PowerPoint 3 or 4, from its content (`SlideContent`, 38 bytes): its texts and its frames. A frame with
 * text takes the next of the slide's texts, in the order of the list, but for its title and its body, the two frames
 * the content names, whose texts come last, the title's first. They are read in the order the slide is drawn, a
 * group's frames where the group is, each once, as libmwaw sends them. The title's frame's text is the slide's title,
 * in PowerPoint 4 when the frame says it still is one: a slide can name as its title a frame that no longer is, and
 * PowerPoint, converting it, makes its text a text box's. Lines are the paragraphs of each text, a line break inside
 * one read as a space.
 */
function fourSlide(
  content: Reader,
  zone: (index: number) => Reader | undefined,
  version: number,
  littleEndian: boolean,
  decoder: TextDecoder
): { title: string; lines: string[] } {
  const slide = { title: '', lines: [] as string[] }
  const kept = zone(content.u32(0))
  const texts = kept ? fourTexts(kept, decoder) : []
  const frames = zone(content.u32(4))
  if (!frames) return slide
  const title = content.i16(14)
  const body = content.i16(16)
  const listed = Array.from({ length: Math.floor(frames.length / 32) }, (_, index) => fourFrame(frames, index, version, littleEndian))
  const main = listed.filter((frame, index) => frame.text && (index === title || index === body)).length
  const places = new Map<number, number>()
  let other = 0
  listed.forEach((frame, index) => {
    if (!frame.text) return
    // The body is the first main text when the slide has no title, the second when it has one.
    places.set(index, index === title ? texts.length - main : index === body ? texts.length - main + (title === -1 ? 0 : 1) : other++)
  })
  const seen = new Set<number>()
  let grouped = 0
  for (let start = 0; start < listed.length; start++) {
    const waiting = [start]
    for (let index = waiting.pop(); index !== undefined; index = waiting.pop()) {
      const frame = listed[index]
      if (!frame || seen.has(index)) continue
      seen.add(index)
      const place = places.get(index)
      if (place === undefined) {
        // A group whose frames are not all in the list has none, as libmwaw reads it.
        const [first, last] = frame.group && frame.group[1] < listed.length ? frame.group : [1, 0]
        for (let child = last; child >= first && grouped < GROUPED_LIMIT; child--, grouped++) if (!seen.has(child)) waiting.push(child)
        continue
      }
      const lines = (texts[place] ?? '')
        .split('\r')
        .map((line) => line.replaceAll('\v', ' ').trim())
        .filter(Boolean)
      if (lines.length === 0) continue
      if (index === title && slide.title === '' && (frame.placeholder === undefined || frame.placeholder === 1)) slide.title = lines.join(' ')
      else slide.lines.push(...lines)
    }
  }
  return slide
}

/**
 * The slides of a presentation of PowerPoint 3 or 4, in the order of its list, as libmwaw's reader of them
 * (`PowerPoint3Parser`) lays them out, Microsoft having described none: a table of zones, each a length and a place,
 * whose count is at 12 and place at 8; the document's information (zone named at 22, 142 bytes in PowerPoint 3, 146
 * in 4) names its root (22 bytes), which names the list of slides (16 bytes a slide after a head of 16), each naming
 * its slide (32 bytes, 34 in 4), which names its content. Pages of notes and masters are left out.
 */
function fourSlides(
  stream: Uint8Array,
  version: number,
  littleEndian: boolean,
  decoder: TextDecoder
): { slides: { title: string; lines: string[] }[]; cut: boolean } {
  const data = reader(stream, littleEndian)
  const table = data.u32(8)
  const count = data.u16(12)
  const zone = (index: number): Reader | undefined => {
    if (index < 0 || index >= count || table + index * 8 + 8 > stream.length) return undefined
    const length = data.u32(table + index * 8) & 0x3fffffff
    const begin = data.u32(table + index * 8 + 4)
    if (length === 0 || begin + length > stream.length) return undefined
    return reader(stream.subarray(begin, begin + length), littleEndian)
  }
  const information = zone(data.u16(22))
  if (information?.length !== (version === 3 ? 142 : 146)) return damaged()
  const root = zone(information.u32(34))
  if (root?.length !== 22) return damaged()
  const list = zone(root.u32(6))
  if (!list || list.length % 16 !== 0) return damaged()
  const slides: { title: string; lines: string[] }[] = []
  const listed = Math.min(list.u16(0), list.length / 16 - 1)
  for (let index = 0; index < listed; index++) {
    if (slides.length >= SLIDE_LIMIT) return { slides, cut: true }
    const slide = zone(list.u32(16 + index * 16 + 12))
    const content = slide?.length === (version === 3 ? 32 : 34) ? zone(slide.u32(8)) : undefined
    // A slide whose records cannot be found is kept, empty, so the others keep their numbers.
    slides.push(content?.length === 38 ? fourSlide(content, zone, version, littleEndian, decoder) : { title: '', lines: [] })
  }
  return { slides, cut: false }
}

/**
 * A presentation of PowerPoint 4 or older: PowerPoint 3's and 4's slides one by one, each with its title and the
 * lines of its other text, in the Mac's own characters when a Mac wrote it, else in the code page its summary names.
 * They are not drawn. PowerPoint 2 and 1, whose files say version 2, laid out theirs another way, each of the Mac and
 * the PC its own, and only two small test files of them are public to check a reading against: they are not read.
 */
function readOlderPresentation(stream: Uint8Array, head: { version: number; littleEndian: boolean }, file: Compound | undefined): OfficePreview {
  if (head.version === 2) throw new Error('It is a presentation of PowerPoint 2 or older, which is not read here.')
  if (head.version !== 3 && head.version !== 4) throw new Error('The file is damaged: its slides could not be read.')
  const decoder = head.littleEndian ? codePageDecoder((file && summaryCodePage(file)) ?? 1252) : codePageDecoder(10000)
  let read: ReturnType<typeof fourSlides> | undefined
  try {
    read = fourSlides(stream, head.version, head.littleEndian, decoder)
  } catch {
    read = undefined
  }
  if (!read || read.slides.length === 0) throw new Error('The file is damaged: its slides could not be read.')
  return { kind: 'presentation', slides: read.slides.map((slide) => ({ ...slide, figures: [] })), cut: read.cut }
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

/** The most bytes an object of another app is unpacked to: a preview never needs more. */
const OBJECT_LIMIT = 32 * 1024 * 1024

/**
 * The objects of other apps a presentation keeps (its `ExObjList`), by their number: where each one's storage is,
 * as the directory of where each object is names it.
 */
function presentationObjects(raw: Uint8Array, container: PowerPointRecord): Map<number, number> {
  const objects = new Map<number, number>()
  const list = childOf(raw, container, 0x0409)
  for (const embedded of list ? artRecords(raw, list.at, list.at + list.size) : []) {
    const atom = embedded.type === 0x0fcc ? childOf(raw, embedded, 0x0fc3) : undefined
    if (atom && atom.size >= 20) objects.set(readU32(raw, atom.at + 8), readU32(raw, atom.at + 16))
  }
  return objects
}

/** The program an object's storage names in its `CompObj` stream (`Word.Document.8`); empty when it names none. */
export function storageProgram(storage: Compound): string {
  try {
    const kept = storage.stream('\x01CompObj')
    return (kept && /\b(?:Word\.Document|Excel\.Sheet|Excel\.Chart|PowerPoint\.(?:Show|Slide)|Equation)(?:\.\w+)?/.exec(latin1(kept))?.[0]) ?? ''
  } catch {
    return ''
  }
}

/**
 * An object's storage as PowerPoint keeps it (`ExOleObjStg`): a compound file of its own, packed by zlib after its
 * size when the record says so.
 */
async function objectStorage(raw: Uint8Array, record: PowerPointRecord | undefined): Promise<Compound | undefined> {
  if (record?.type !== 0x1011 || record.size < 4) return undefined
  const kept = raw.subarray(record.at, record.at + record.size)
  if (record.instance !== 1) return openCompound(kept)
  const size = readU32(kept, 0)
  if (size > OBJECT_LIMIT) return undefined
  return openCompound(await unpack(kept.subarray(4), 'deflate', size))
}

/**
 * A PowerPoint 97 to 2003 presentation's slides, in order: each one's title, the lines of its other text, and the
 * slide drawn as it looks (`older-slide-drawing.ts`). A slide that cannot be drawn shows its pictures instead: an
 * object of another app by its picture, a chart's drawn from its storage when the window does not show that picture.
 * A presentation of PowerPoint 95, or of 4 or older, is read its own way.
 */
export async function readOlderPowerPoint(bytes: Uint8Array, read?: ObjectReader): Promise<OfficePreview> {
  // PowerPoint 3 and older wrote a presentation as the file itself; PowerPoint 4 keeps the same in a compound file.
  const bare = olderPresentationHead(bytes)
  if (bare) return readOlderPresentation(bytes, bare, undefined)
  return readPowerPointFile(openCompound(bytes), read, true)
}

/**
 * A presentation of PowerPoint held as an object, from its storage, as `readOlderPowerPoint` reads one, for its slides'
 * text: its slides not drawn, nor its pictures shown, and its own objects left to their pictures.
 */
export function readOlderPowerPointStorage(storage: Compound): Promise<OfficePreview> {
  return readPowerPointFile(storage, undefined, false)
}

async function readPowerPointFile(file: Compound, read: ObjectReader | undefined, drawn: boolean): Promise<OfficePreview> {
  const four = file.stream('PP40')
  if (four) {
    const head = olderPresentationHead(four)
    if (!head) throw new Error('The file is damaged: its slides could not be read.')
    return readOlderPresentation(four, head, file)
  }
  const raw = file.stream('PowerPoint Document')
  if (!raw) throw new Error('This is not a PowerPoint presentation.')
  if (file.stream('EncryptedSummary')) throw new Error(PROTECTED)
  // PowerPoint 95 names its user without a record of 97's (`CurrentUserAtom`), and keeps its text for searching apart.
  const user = file.stream('Current User')
  if (ninetyFiveStream(raw) || (user && file.stream('Text_Content') && readU16(user, 2) !== 0x0ff6)) return readNinetyFive(file, raw)
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
  const objects = presentationObjects(raw, container)
  // The storage of the object a shape shows, through the list of objects, by its client data's reference.
  const storageOf = async (client: ArtRecord | undefined): Promise<Compound | undefined> => {
    const reference = client && childOf(raw, client, 0x0bc1)
    const persisted = reference && reference.size >= 4 ? objects.get(readU32(raw, reference.at)) : undefined
    const at = persisted === undefined ? undefined : places.get(persisted)
    if (at === undefined) return undefined
    try {
      return await objectStorage(raw, recordAt(stream, at))
    } catch {
      return undefined
    }
  }
  // The chart an object's shape shows, from its storage, when its picture is not one the window shows.
  const objectChart = async (client: ArtRecord | undefined): Promise<OfficeChart | undefined> => {
    const storage = await storageOf(client)
    return storage && embeddedChart(storage)
  }

  let deck: OlderDeck | undefined
  try {
    deck = drawn ? olderDeck(raw, places, container, stored, objectChart) : undefined
  } catch {
    deck = undefined
  }
  let drawnBytes = 0
  const slides: { title: string; lines: string[]; figures: OfficeFigure[]; drawing?: PictureFigure }[] = []
  const placedBySlide: number[][] = []
  for (const [index, { texts, persisted }] of found.entries()) {
    // Text boxes of its own, beyond its placeholders, are in the slide's drawing, and so are its pictures.
    const at = places.get(persisted)
    const drawn = at === undefined ? undefined : recordAt(stream, at)
    const all = drawn?.type === 0x03ee ? [...texts, ...drawingTexts(stream, drawn)] : texts
    const slide: { title: string; lines: string[]; figures: OfficeFigure[]; drawing?: PictureFigure } = { title: '', lines: [], figures: [] }
    for (const text of all) {
      if (text.title && slide.title === '') slide.title = text.lines.join(' ')
      else slide.lines.push(...text.lines.filter((line) => !slide.lines.includes(line)))
    }
    // An equation of Equation Editor or MathType on the slide, an object, is a line of its text; a document of Word,
    // the lines of its own, and a worksheet of Excel its cells, a row to a line, its program named in its storage.
    const drawing = drawn?.type === 0x03ee ? childOf(raw, drawn, 0x040c) : undefined
    const shapes = drawing && childOf(raw, drawing, ART.drawing)
    for (const shape of shapes ? artShapes(raw, shapes) : []) {
      const storage = shape.client && (await storageOf(shape.client))
      if (!storage) continue
      const equation = objectEquation(storage)
      const program = storageProgram(storage)
      const lines = equation !== undefined ? [equation] : read ? heldLines(await read(program, storage).catch(() => undefined)) : []
      slide.lines.push(...lines.filter((line) => !slide.lines.includes(line)))
    }
    const drawnSlide =
      deck && drawn?.type === 0x03ee && drawnBytes < DRAWINGS_LIMIT ? await drawOlderSlide(deck, drawn, persisted, index + 1).catch(() => undefined) : undefined
    if (drawnSlide) {
      drawnBytes += drawnSlide.svg.length
      const alt = [slide.title, ...slide.lines].filter(Boolean).join('. ')
      slide.drawing = {
        kind: 'picture',
        type: 'image/svg+xml',
        bytes: drawnSlide.svg,
        alt,
        width: Math.round(drawnSlide.width),
        height: Math.round(drawnSlide.height)
      }
      placedBySlide.push([])
      slides.push(slide)
      continue
    }
    const placed: number[] = []
    for (const shape of shapes && drawn ? artShapes(raw, shapes) : []) {
      if (shape.picture === undefined) continue
      const picture = stored(shape.picture)
      const shown = picture?.bytes !== undefined && pictureType(picture.bytes) !== undefined
      const chart = shown ? undefined : await objectChart(shape.client)
      const figure = chart ? figures.chart(chart) : figures.picture(`store:${shape.picture}`, picture, shape.alt, slideAnchorSize(raw, shape.anchor))
      if (figure !== undefined) placed.push(figure)
    }
    placedBySlide.push(placed)
    slides.push(slide)
  }
  await figures.drawPacked()
  slides.forEach((slide, index) => {
    slide.figures = figures.at(placedBySlide[index] ?? [])
  })
  return { kind: 'presentation', slides, cut }
}
