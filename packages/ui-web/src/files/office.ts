/**
 * Office files read in the window itself, with no service and no library (docs/SPEC.md, section 9.7): Word, Excel and
 * PowerPoint's (.docx, .xlsx, .pptx) and OpenDocument's (.odt, .ods, .odp). Each is a ZIP archive of XML parts,
 * unpacked with the window's own decompression and read for what a preview shows. A document becomes Markdown, shown
 * as the Prose block shows it, with its strong, slanted and struck text, its links, and its pictures and charts where
 * they are, and a Word document its pages as they look (`word-look.ts`); a workbook, its sheets as tables, each followed
 * by its pictures and charts; a presentation, the text of each slide, its pictures and charts, and the slide drawn as
 * it looks. The older binary formats (.doc, .xls, .ppt) are compound files, read by `binary-office.ts`.
 */

import { type Archive, openArchive, partOf, relationships, resolvePart, textOf } from './archive.ts'
import {
  olderWorkbookView,
  readOlderExcel,
  readOlderPowerPoint,
  readOlderPowerPointStorage,
  readOlderSheets,
  readOlderWord,
  readOlderWordStorage,
  storageProgram
} from './binary-office.ts'
import { type Compound, openCompound } from './compound.ts'
import { cellValue, serialNow, withConditions } from './conditional-formats.ts'
import type { TextLook } from './document-look.ts'
import { type CellArea, cellArea, heldExtent, sheetFigure } from './embedded-sheet.ts'
import { isEquationProgram } from './equation-editor.ts'
import { builtInFormat, formatNumber, generalNumber, type NumberFormatOptions, numberColor } from './number-format.ts'
import {
  type CellRange,
  type CellSource,
  type CellValue,
  cellRange,
  emuPixels,
  Figures,
  formulaPicture,
  lengthPixels,
  readChart,
  readOpenChart
} from './office-figures.ts'
import { mathText, objectFormula } from './office-math.ts'
import {
  BLOCK_LIMIT,
  type CellAnchor,
  type CellPoint,
  COLUMN_LIMIT,
  type Format,
  figureMark,
  heldLines,
  type InlinePart,
  inlineLines,
  joinBlocks,
  markdownTable,
  type ObjectRead,
  type ObjectReader,
  type OfficeFigure,
  type OfficePreview,
  type PictureFigure,
  PROTECTED,
  partsText,
  plain,
  ROW_LIMIT,
  SHEET_LIMIT,
  SLIDE_LIMIT
} from './office-text.ts'
import { readOpenLook } from './open-look.ts'
import { dataStyles, type OpenRun, readOpenSheetLook, readSheetViews } from './open-sheet-look.ts'
import { drawOpenPage, type OpenDeck, openDeck } from './open-slide-drawing.ts'
import { fontFaces, StyleBook } from './open-styles.ts'
import { readSheetConditions } from './sheet-conditions.ts'
import {
  type CellKind,
  type LaidRun,
  paletteColor,
  readRunFont,
  readSheetLook,
  readWorkbookStyles,
  readWorkbookTheme,
  type SheetLayout,
  type SheetLook,
  type WorkbookStyles,
  wholeRun
} from './sheet-look.ts'
import { drawSlide } from './slide-drawing.ts'
import { DRAWINGS_LIMIT } from './slide-svg.ts'
import { readWordLook } from './word-look.ts'
import { type SheetObject, shapeNumber, sheetObjects } from './workbook-objects.ts'
import { childAt, childrenNamed, decodeEntities, nodeEvents, type XmlEvent, type XmlNode, xmlEvents, xmlTree } from './xml.ts'

export { type Archive, openArchive } from './archive.ts'
export type { OfficeFigure, OfficePreview } from './office-text.ts'
export { decodeEntities, type XmlEvent, xmlEvents } from './xml.ts'

/** The extensions read, and what each is. */
export const OFFICE_KINDS = {
  docx: 'document',
  xlsx: 'workbook',
  pptx: 'presentation',
  odt: 'document',
  ods: 'workbook',
  odp: 'presentation',
  doc: 'document',
  xls: 'workbook',
  ppt: 'presentation'
} as const

/** A picture or a chart a drawing places, as it is read: what it shows, its words and its size. */
interface Drawn {
  picture?: string | undefined
  chart?: string | undefined
  alt: string
  width?: number | undefined
  height?: number | undefined
}

/** A picture or a chart, as a drawing places one (a sheet's drawing, a slide). */
const isDrawn = (name: string) => name === 'xdr:pic' || name === 'xdr:graphicFrame' || name === 'p:pic' || name === 'p:graphicFrame'

/** The figure a picture or a chart read stands for, by its place in the file's figures. */
async function drawnFigure(drawn: Drawn, targets: ReadonlyMap<string, string>, figures: Figures): Promise<number | undefined> {
  if (drawn.chart !== undefined) return figures.chart(targets.get(drawn.chart), drawn.alt, readChart)
  return drawn.picture === undefined ? undefined : figures.picture(targets.get(drawn.picture), drawn.alt, drawn)
}

/** A figure a drawing places, by its place in the file's figures, and where a sheet's drawing anchors it. */
interface PlacedFigure {
  figure: number
  anchor?: CellAnchor | undefined
}

/** English Metric Units in points: 12,700 to the point. */
const emuPoints = (value: string | undefined): number | undefined => {
  const emu = Number(value)
  return value !== undefined && Number.isFinite(emu) ? emu / 12_700 : undefined
}

/** The parts of a place in a sheet's cells as its anchor writes them, and how each is read. */
const POINT_PARTS: Record<string, { key: keyof Omit<CellPoint, 'shares'>; read: (text: string) => number | undefined }> = {
  'xdr:col': { key: 'column', read: (text) => Number(text) },
  'xdr:row': { key: 'row', read: (text) => Number(text) },
  'xdr:colOff': { key: 'x', read: (text) => emuPoints(text.trim()) },
  'xdr:rowOff': { key: 'y', read: (text) => emuPoints(text.trim()) }
}

/** Whether an anchor says where what it holds starts: at a cell, or from the sheet's corner. */
const placing = (anchor: CellAnchor | undefined): anchor is CellAnchor =>
  anchor !== undefined && (anchor.from !== undefined || (anchor.left !== undefined && anchor.top !== undefined))

/** An anchor of a sheet's drawing, which places what it holds on the sheet's cells. */
const isAnchor = (name: string) => name === 'xdr:twoCellAnchor' || name === 'xdr:oneCellAnchor' || name === 'xdr:absoluteAnchor'

/**
 * The pictures and charts a DrawingML drawing places, in order: a sheet's drawing part, a slide. A slide's background
 * and what is kept for older apps (`mc:Fallback`) are passed over. On a sheet, each is where its anchor puts it on the
 * cells, but for the pictures of a group, which share their group's anchor. An object of another app a sheet's drawing
 * places, by the shape Excel draws it as for older apps (`a14:compatExt`), is the figure `objects` makes of it, in its
 * place.
 */
async function drawnFigures(
  xml: string,
  targets: ReadonlyMap<string, string>,
  figures: Figures,
  objects?: (shape: number, anchor: CellAnchor | undefined) => Promise<number | undefined>
): Promise<PlacedFigure[]> {
  const found: PlacedFigure[] = []
  let drawn: Drawn | undefined
  // The object of another app an anchor of a sheet's drawing places.
  let object: number | undefined
  // A sheet's anchor may give the size of what it holds before it.
  let anchored: { width?: number | undefined; height?: number | undefined } = {}
  // Where the anchor puts what it holds, read as it comes: its places in the cells, or its corner and size.
  let anchor: CellAnchor | undefined
  let point: CellPoint | undefined
  let part: (typeof POINT_PARTS)[string] | undefined
  let grouped = 0
  let passed = 0
  let background = false
  for (const event of xmlEvents(xml)) {
    if (passed > 0) {
      if (event.type === 'open' && event.name === 'mc:Fallback') passed++
      else if (event.type === 'close' && event.name === 'mc:Fallback') passed--
      continue
    }
    if (event.type === 'open') {
      const { name, attributes } = event
      if (name === 'mc:Fallback') passed = 1
      else if (name === 'p:bg') background = true
      else if (background) continue
      else if (isAnchor(name)) {
        anchor = {}
        grouped = 0
      } else if (anchor && (name === 'xdr:from' || name === 'xdr:to')) point = { row: 0, column: 0, x: 0, y: 0 }
      else if (point && POINT_PARTS[name]) part = POINT_PARTS[name]
      else if (anchor && name === 'xdr:pos') {
        anchor.left = emuPoints(attributes.x)
        anchor.top = emuPoints(attributes.y)
      } else if (name === 'xdr:grpSp') grouped++
      else if (isDrawn(name)) drawn ??= { alt: '', ...anchored }
      else if (name === 'xdr:ext' && !drawn) {
        anchored = { width: emuPixels(attributes.cx), height: emuPixels(attributes.cy) }
        if (anchor) {
          anchor.width = emuPoints(attributes.cx)
          anchor.height = emuPoints(attributes.cy)
        }
      } else if (name === 'a14:compatExt' && objects) object = shapeNumber(attributes.spid)
      else if (!drawn) continue
      else if (name === 'xdr:cNvPr' || name === 'p:cNvPr') drawn.alt ||= attributes.descr || attributes.title || ''
      else if (name === 'a:blip') drawn.picture ??= attributes['r:embed']
      else if (name === 'c:chart') drawn.chart ??= attributes['r:id']
      else if ((name === 'a:ext' || name === 'xdr:ext') && attributes.cx !== undefined && drawn.width === undefined) {
        drawn.width = emuPixels(attributes.cx)
        drawn.height = emuPixels(attributes.cy)
      }
    } else if (event.type === 'text') {
      const value = part && point ? part.read(event.text) : undefined
      if (part && point && value !== undefined && Number.isFinite(value)) point[part.key] = value
    } else {
      const name = event.name
      if (name === 'p:bg') background = false
      else if (POINT_PARTS[name]) part = undefined
      else if ((name === 'xdr:from' || name === 'xdr:to') && anchor && point) {
        if (name === 'xdr:from') anchor.from = point
        else anchor.to = point
        point = undefined
      } else if (name === 'xdr:grpSp') grouped = Math.max(0, grouped - 1)
      else if (isAnchor(name)) {
        anchored = {}
        const placed = object === undefined || !objects ? undefined : await objects(object, anchor)
        if (placed !== undefined) found.push({ figure: placed, anchor: placing(anchor) ? anchor : undefined })
        object = undefined
        anchor = undefined
      } else if (drawn && isDrawn(name)) {
        const figure = await drawnFigure(drawn, targets, figures)
        if (figure !== undefined) found.push({ figure, anchor: grouped > 0 || !placing(anchor) ? undefined : { ...anchor } })
        drawn = undefined
      }
    }
  }
  return found
}

/** A toggle of a run's format as Word writes it: on unless its value says off. */
const toggled = (attributes: Record<string, string>) => !['0', 'false', 'off', 'none'].includes(attributes['w:val'] ?? 'on')

/**
 * What a Word document's styles say: the heading level of each paragraph style, by the style's name whatever the
 * language of its identifier ("heading 1", "Title"), and the format each character style gives, with what it is based on.
 */
async function wordStyles(archive: Archive): Promise<{ headings: Map<string, number>; formats: Map<string, Format> }> {
  const headings = new Map<string, number>()
  const own = new Map<string, Format & { basedOn?: string | undefined }>()
  let style: (Format & { id: string; character: boolean; basedOn?: string | undefined }) | undefined
  let properties = false
  for (const event of xmlEvents((await textOf(archive, 'word/styles.xml')) ?? '')) {
    if (event.type === 'close') {
      if (event.name === 'w:rPr') properties = false
      else if (event.name === 'w:style' && style) {
        if (style.character) own.set(style.id, style)
        style = undefined
      }
      continue
    }
    if (event.type !== 'open') continue
    const value = event.attributes['w:val'] ?? ''
    if (event.name === 'w:style') style = { id: event.attributes['w:styleId'] ?? '', character: event.attributes['w:type'] === 'character' }
    else if (!style) continue
    else if (event.name === 'w:name') {
      const name = value.toLowerCase()
      const level = name === 'title' ? 1 : name === 'subtitle' ? 2 : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0)
      if (level > 0) headings.set(style.id, Math.min(level, 6))
    } else if (event.name === 'w:basedOn') style.basedOn = value
    else if (event.name === 'w:rPr') properties = true
    else if (properties && event.name === 'w:b') style.bold = toggled(event.attributes)
    else if (properties && event.name === 'w:i') style.italic = toggled(event.attributes)
    else if (properties && (event.name === 'w:strike' || event.name === 'w:dstrike')) style.struck = toggled(event.attributes)
  }
  // A style's format is its own over what it is based on, a few steps up at most.
  const formats = new Map<string, Format>()
  for (const id of own.keys()) {
    const format: Format = {}
    let at = own.get(id)
    for (let steps = 0; at && steps < 10; steps++) {
      format.bold ??= at.bold
      format.italic ??= at.italic
      format.struck ??= at.struck
      at = at.basedOn === undefined ? undefined : own.get(at.basedOn)
    }
    formats.set(id, format)
  }
  return { headings, formats }
}

/** Which lists of a Word document are numbered, by their identifier and level: any but bullets. */
async function wordNumbering(archive: Archive): Promise<(list: string, level: number) => boolean> {
  const formats = new Map<string, Map<number, string>>()
  const lists = new Map<string, string>()
  let abstract: Map<number, string> | undefined
  let level = 0
  let list: string | undefined
  for (const event of xmlEvents((await textOf(archive, 'word/numbering.xml')) ?? '')) {
    if (event.type === 'close') {
      if (event.name === 'w:abstractNum') abstract = undefined
      else if (event.name === 'w:num') list = undefined
      continue
    }
    if (event.type !== 'open') continue
    if (event.name === 'w:abstractNum') {
      abstract = new Map()
      formats.set(event.attributes['w:abstractNumId'] ?? '', abstract)
    } else if (event.name === 'w:lvl' && abstract) level = Number(event.attributes['w:ilvl'] ?? 0)
    else if (event.name === 'w:numFmt' && abstract) abstract.set(level, event.attributes['w:val'] ?? 'bullet')
    else if (event.name === 'w:num') list = event.attributes['w:numId']
    else if (event.name === 'w:abstractNumId' && list !== undefined) lists.set(list, event.attributes['w:val'] ?? '')
  }
  return (id, at) => {
    const format = formats.get(lists.get(id) ?? '')?.get(at)
    return format !== undefined && format !== 'bullet' && format !== 'none'
  }
}

/**
 * A paragraph of a Word document as it is read: its parts, its style, where it is in a list, and the text of the
 * documents it holds as objects.
 */
interface WordParagraph {
  parts: InlinePart[]
  style?: string | undefined
  list?: string | undefined
  level: number
  held?: { markdown: string; lines: string[] }[]
}

/** A run's text with its format and where it leads, as the parts of a paragraph keep it. */
const runPart = (text: string, format: Format | undefined, link: string | undefined): InlinePart => ({ text, ...format, link })

/**
 * A Word document as Markdown: its headings, paragraphs with their strong, slanted and struck text and their links,
 * its bulleted and numbered lists, its tables, and its pictures and charts where they are placed. A text box's
 * paragraphs come before the paragraph that holds it; what Word keeps for older apps (`mc:Fallback`) is passed over.
 */
export async function readDocument(archive: Archive, options: NumberFormatOptions = {}): Promise<OfficePreview> {
  const xml = await textOf(archive, 'word/document.xml')
  if (xml === undefined) throw new Error('This is not a Word document.')
  const { headings, formats } = await wordStyles(archive)
  const numbered = await wordNumbering(archive)
  const targets = await relationships(archive, 'word/document.xml')
  const figures = new Figures(archive, options, embeddedCells(archive, options), embeddedObjects(options))
  const blocks: string[] = []
  // The paragraphs open, a text box's within the one that holds it, and the runs open, likewise.
  const paragraphs: WordParagraph[] = []
  const runs: Format[] = []
  let link: string | undefined
  let inText = false
  let drawing: Drawn | undefined
  let drawings = 0
  let passed = 0
  let depth = 0
  let table: string[][] = []
  let row: string[] | undefined
  let cell: string[] | undefined
  let equation: XmlEvent[] | undefined
  let displayed = false
  // The object of another app a drawing holds: its relationship's identifier and its program.
  let object: { id: string; program: string } | undefined

  const finish = (paragraph: WordParagraph) => {
    write(paragraph)
    // A document held as an object follows the paragraph that holds it, as a quotation of its text.
    for (const held of paragraph.held ?? []) {
      if (cell) cell.push(plain(held.lines.join(' ')))
      else blocks.push(held.markdown)
    }
  }
  const write = (paragraph: WordParagraph) => {
    const text = partsText(paragraph.parts).replace(/\s+/g, ' ').trim()
    const shown = paragraph.parts.filter((part): part is { figure: number; alt: string } => 'figure' in part)
    if (cell) {
      cell.push(inlineLines(paragraph.parts).join(' '))
      return
    }
    if (text === '' && shown.length === 0) return
    const level = paragraph.style === undefined ? undefined : headings.get(paragraph.style)
    if (level && text !== '') {
      blocks.push(`${'#'.repeat(level)} ${plain(text)}`)
      if (shown.length > 0) blocks.push(shown.map((part) => figureMark(part.figure, part.alt)).join(' '))
      return
    }
    const lines = inlineLines(paragraph.parts)
    if (paragraph.list === undefined) {
      blocks.push(lines.join('  \n'))
      return
    }
    const indent = '  '.repeat(Math.min(paragraph.level, 8))
    blocks.push(`${indent}${numbered(paragraph.list, paragraph.level) ? '1.' : '-'} ${lines.join(`  \n${indent}  `)}`)
  }

  for (const event of xmlEvents(xml)) {
    if (blocks.length >= BLOCK_LIMIT) break
    if (passed > 0) {
      if (event.type === 'open' && event.name === 'mc:Fallback') passed++
      else if (event.type === 'close' && event.name === 'mc:Fallback') passed--
      continue
    }
    const paragraph = paragraphs.at(-1)
    const run = runs.at(-1)
    // An equation is read whole once it ends, as linear text in its paragraph; one of a display, on a line of its own.
    if (equation) {
      equation.push(event)
      if (event.type === 'close' && event.name === 'm:oMath') {
        const text = mathText(equation)
        equation = undefined
        if (paragraph && text !== '') {
          if (displayed && paragraph.parts.length > 0) paragraph.parts.push(runPart('\n', {}, link))
          paragraph.parts.push(runPart(text, {}, link))
        }
      }
      continue
    }
    if (event.type === 'open' && event.name === 'm:oMath') {
      equation = [event]
      continue
    }
    if (event.type !== 'text' && event.name === 'm:oMathPara') displayed = event.type === 'open'
    if (event.type === 'text') {
      if (inText && paragraph) paragraph.parts.push(runPart(event.text, run, link))
      continue
    }
    if (event.type === 'open') {
      const value = event.attributes['w:val'] ?? ''
      switch (event.name) {
        case 'mc:Fallback':
          passed = 1
          break
        case 'w:tbl':
          if (++depth === 1) table = []
          break
        case 'w:tr':
          if (depth === 1) row = []
          break
        case 'w:tc':
          if (depth === 1) cell = []
          break
        case 'w:p':
          paragraphs.push({ parts: [], level: 0 })
          break
        case 'w:pStyle':
          if (paragraph) paragraph.style = value
          break
        case 'w:numPr':
          // A list it does not name is bulleted.
          if (paragraph && run === undefined) paragraph.list = ''
          break
        case 'w:numId':
          // A list of identifier 0 is no list: it takes a paragraph out of one.
          if (paragraph && run === undefined) paragraph.list = value === '0' ? undefined : value
          break
        case 'w:ilvl':
          if (paragraph && run === undefined) paragraph.level = Number(value) || 0
          break
        case 'w:r':
          runs.push({})
          break
        case 'w:rStyle':
          if (run) Object.assign(run, formats.get(value))
          break
        case 'w:b':
          if (run) run.bold = toggled(event.attributes)
          break
        case 'w:i':
          if (run) run.italic = toggled(event.attributes)
          break
        case 'w:strike':
        case 'w:dstrike':
          if (run) run.struck = toggled(event.attributes)
          break
        case 'w:hyperlink': {
          const target = targets.get(event.attributes['r:id'] ?? '')
          const anchor = event.attributes['w:anchor']
          link = target ?? (anchor === undefined ? undefined : `#${anchor}`)
          break
        }
        case 'w:tab':
          // A tab in a paragraph's properties is a tab stop, not a tab.
          if (paragraph && run) paragraph.parts.push(runPart('\t', run, link))
          break
        case 'w:br':
        case 'w:cr':
          if (paragraph && run) paragraph.parts.push(runPart('\n', run, link))
          break
        case 'w:t':
          inText = true
          break
        case 'w:drawing':
        case 'w:pict':
        case 'w:object':
          if (drawings++ === 0) {
            drawing = { alt: '' }
            object = undefined
          }
          break
        case 'o:OLEObject': {
          const id = event.attributes['r:id']
          if (drawing && id !== undefined) object = { id, program: event.attributes.ProgID ?? '' }
          break
        }
        case 'wp:extent':
          if (drawing) {
            drawing.width = emuPixels(event.attributes.cx)
            drawing.height = emuPixels(event.attributes.cy)
          }
          break
        case 'wp:docPr':
          if (drawing) drawing.alt = event.attributes.descr || event.attributes.title || ''
          break
        case 'a:blip':
          if (drawing) drawing.picture ??= event.attributes['r:embed']
          break
        case 'c:chart':
          if (drawing) drawing.chart ??= event.attributes['r:id']
          break
        case 'v:shape':
          if (drawing && drawing.width === undefined) {
            const style = event.attributes.style ?? ''
            drawing.width = lengthPixels(/(?:^|;)\s*width:([^;]+)/.exec(style)?.[1])
            drawing.height = lengthPixels(/(?:^|;)\s*height:([^;]+)/.exec(style)?.[1])
          }
          break
        case 'v:imagedata':
          if (drawing) {
            drawing.picture ??= event.attributes['r:id']
            drawing.alt ||= event.attributes['o:title'] ?? ''
          }
          break
      }
      continue
    }
    switch (event.name) {
      case 'w:t':
        inText = false
        break
      case 'w:r':
        runs.pop()
        break
      case 'w:hyperlink':
        link = undefined
        break
      case 'w:drawing':
      case 'w:pict':
      case 'w:object':
        if (--drawings === 0 && drawing) {
          const placed: Drawn = drawing
          drawing = undefined
          const held = object
          object = undefined
          // An equation of Equation Editor or MathType is written as linear text in its place, as Word's own are.
          const written = held && isEquationProgram(held.program) ? await figures.equation(targets.get(held.id)) : undefined
          if (written !== undefined) {
            paragraph?.parts.push(runPart(written, {}, link))
            break
          }
          // A document is shown by its text, after the paragraph, its picture kept for the look.
          const quoted = held && (await figures.text(targets.get(held.id), held.program))
          if (quoted && paragraph) {
            paragraph.held = [...(paragraph.held ?? []), quoted]
            break
          }
          // What another object holds is shown in place of its picture when it is read here: a worksheet as its sheet.
          const figure = (held && (await figures.object(targets.get(held.id), held.program, placed.alt))) ?? (await drawnFigure(placed, targets, figures))
          if (figure !== undefined && paragraph) paragraph.parts.push({ figure, alt: placed.alt })
        }
        break
      case 'w:p': {
        const finished = paragraphs.pop()
        if (finished) finish(finished)
        break
      }
      case 'w:tc':
        if (depth === 1 && cell && row) {
          row.push(cell.filter(Boolean).join(' '))
          cell = undefined
        }
        break
      case 'w:tr':
        if (depth === 1 && row) {
          table.push(row)
          row = undefined
        }
        break
      case 'w:tbl':
        if (--depth === 0 && table.length > 0) blocks.push(markdownTable(table, (written) => written))
        break
    }
  }
  // Its look is read after its text, with the same figures; a document whose look cannot be read shows its text.
  const look = await readWordLook(archive, figures).catch(() => undefined)
  return { kind: 'document', markdown: joinBlocks(blocks), figures: figures.list, cut: blocks.length >= BLOCK_LIMIT || (look?.cut ?? false), look: look?.look }
}

/** A cell's column from its reference: "A1" is 0, "AB7" is 27. */
export function columnOf(reference: string): number {
  let column = 0
  for (const letter of /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? 'A') column = column * 26 + (letter.charCodeAt(0) - 64)
  return column - 1
}

/**
 * The format each style of a workbook gives its numbers, by the style's place (`cellXfs`): its own format's code,
 * or the code of one Excel numbers itself.
 */
async function workbookFormats(archive: Archive, part: string): Promise<string[]> {
  const codes = new Map<number, string>()
  const formats: string[] = []
  let styles = false
  for (const event of xmlEvents((await textOf(archive, part)) ?? '')) {
    if (event.type === 'open' && event.name === 'numFmt') codes.set(Number(event.attributes.numFmtId), event.attributes.formatCode ?? 'General')
    else if (event.type === 'open' && event.name === 'cellXfs') styles = true
    else if (event.type === 'close' && event.name === 'cellXfs') styles = false
    else if (event.type === 'open' && event.name === 'xf' && styles) {
      const id = Number(event.attributes.numFmtId ?? 0)
      formats.push(codes.get(id) ?? builtInFormat(id))
    }
  }
  return formats
}

/** A sheet of a workbook as it is read: its rows as shown, its cells with their numbers, how they are laid out, and its own part. */
interface SheetRead {
  name: string
  rows: string[][]
  cut: boolean
  cells: Map<string, CellValue>
  layout: SheetLayout
  xml: string
  target: string
}

/** The cells of a workbook's sheets as a chart's formulas name them. */
const sheetCells = (sheets: readonly { name: string; cells: Map<string, CellValue> }[]): CellRange =>
  cellRange(new Map(sheets.map((sheet) => [sheet.name, sheet.cells])))

/**
 * The cells of the workbook a document's or a presentation's chart keeps inside the file, for a chart that kept no
 * values: the part its `c:externalData` names, a workbook of Excel 2007 or later, or of 97 to 2003, held as it is or
 * in a compound file's `Package` stream. A workbook outside the file is not reached.
 */
export function embeddedCells(archive: Archive, options: NumberFormatOptions = {}): CellSource {
  return async ({ part, xml }) => {
    const data = /<c:externalData\b[^>]*\br:id="([^"]*)"/.exec(xml)?.[1]
    const target = data === undefined ? undefined : (await relationships(archive, part)).get(data)
    const read = target === undefined ? undefined : partOf(archive, target)
    const bytes = read && (await read())
    if (!bytes) return undefined
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return sheetCells((await workbookSheets(openArchive(bytes), options)).sheets)
    // Office keeps a workbook of 2007 or later inside a compound file as its `Package` stream, one of 97 to 2003 as it is.
    const held = openCompound(bytes).stream('Package')
    if (held) return sheetCells((await workbookSheets(openArchive(held), options)).sheets)
    return sheetCells(readOlderSheets(bytes, options))
  }
}

/**
 * What objects of other apps hold, shown in place of their pictures: a worksheet of Excel, newer or older, held as it
 * is or in a compound file's `Package` stream, as the block of cells of its active sheet its object shows; a document
 * of Word and a presentation of PowerPoint, newer or older, by their text.
 */
export function embeddedObjects(options: NumberFormatOptions = {}): ObjectReader {
  return async (program, source) => {
    const kind = heldKind(program, source)
    if (kind === 'sheet') {
      const bytes = source instanceof Uint8Array ? source : (source.stream('Package') ?? source.stream('Workbook') ?? source.stream('Book'))
      return bytes && embeddedSheet(bytes, options)
    }
    if (kind === 'document') return embeddedText(source, options)
    if (kind === 'presentation') return embeddedSlides(source, 0)
    return undefined
  }
}

/** What an object of another app holds that is read here, by its program. */
type HeldKind = 'sheet' | 'document' | 'presentation'
const HELD_PROGRAMS: [RegExp, HeldKind][] = [
  [/^Excel\.Sheet\b/i, 'sheet'],
  [/^Word\.Document\b/i, 'document'],
  [/^PowerPoint\.(?:Show|Slide)\b/i, 'presentation']
]
const programKind = (program: string): HeldKind | undefined => HELD_PROGRAMS.find(([pattern]) => pattern.test(program.trim()))?.[1]

/**
 * What an object of another app holds, by its program, else by its file: Excel names an object made from a file by its
 * kind alone ("Document", "Worksheet"), so a name that is no program's is told by the parts or streams it holds. A
 * program named in full that is not read here is left alone.
 */
export function heldKind(program: string, source: Uint8Array | Compound): HeldKind | undefined {
  return programKind(program) ?? (/\w\.\w/.test(program) ? undefined : fileKind(source, 0))
}

function fileKind(source: Uint8Array | Compound, depth: number): HeldKind | undefined {
  if (depth > 2) return undefined
  try {
    if (source instanceof Uint8Array) {
      if (source[0] === 0x50 && source[1] === 0x4b) {
        const archive = openArchive(source)
        if (partOf(archive, 'xl/workbook.xml')) return 'sheet'
        if (partOf(archive, 'ppt/presentation.xml')) return 'presentation'
        return partOf(archive, 'word/document.xml') ? 'document' : undefined
      }
      return source[0] === 0xd0 && source[1] === 0xcf ? fileKind(openCompound(source), depth + 1) : undefined
    }
    // A storage names its program in its `CompObj` stream, else holds a package or an older file's streams.
    const named = programKind(storageProgram(source))
    if (named) return named
    const held = source.stream('Package')
    if (held) return fileKind(held, depth + 1)
    if (source.stream('Workbook') || source.stream('Book')) return 'sheet'
    if (source.stream('PowerPoint Document')) return 'presentation'
    return source.stream('WordDocument') ? 'document' : undefined
  } catch {
    return undefined
  }
}

/** The most of a held document's text shown, in characters. */
const HELD_TEXT_LIMIT = 4000

/**
 * A document of Word held as an object, by its text: newer, held as it is or in a compound file's `Package` stream, or
 * of 97 to 2003, its storage a Word document of its own. Its pictures are left out, their words kept.
 */
async function embeddedText(source: Uint8Array | Compound, options: NumberFormatOptions): Promise<ObjectRead | undefined> {
  let preview: OfficePreview
  if (source instanceof Uint8Array) {
    if (source[0] === 0x50 && source[1] === 0x4b) preview = await readDocument(openArchive(source), options)
    else if (source[0] === 0xd0 && source[1] === 0xcf) return embeddedText(openCompound(source), options)
    else return undefined
  } else {
    const held = source.stream('Package')
    preview = held ? await readDocument(openArchive(held), options) : await readOlderWordStorage(source)
  }
  if (preview.kind !== 'document') return undefined
  let markdown = preview.markdown.replace(/!\[((?:\\.|[^\]\\])*)\]\(figure:\d+\)/g, '$1').trim()
  if (markdown === '') return undefined
  if (markdown.length > HELD_TEXT_LIMIT) markdown = `${markdown.slice(0, markdown.lastIndexOf('\n\n', HELD_TEXT_LIMIT) + 1 || HELD_TEXT_LIMIT).trimEnd()}\n\n…`
  // Its lines as plain text, for a slide's lines and a table's cell.
  const lines = markdown
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s*(#+|[-*]|\d+\.|>|\|)\s+/, '')
        .replace(/\*\*|~~|(?<![\\\w])_|_(?!\w)|\[([^\]]*)\]\([^)]*\)/g, (_, text: string | undefined) => text ?? '')
        .replace(/\\([\\`*_[\]<>|#~.+-])/g, '$1')
        .trim()
    )
    .filter((line) => line !== '' && !/^[-| ]+$/.test(line))
  return { kind: 'text', markdown: markdown.replace(/^/gm, '> ').replace(/^> $/gm, '>'), lines }
}

/**
 * A presentation of PowerPoint held as an object, by the text of its slides: newer, held as it is or in a compound
 * file's `Package` stream, or of 97 to 2003, its storage a presentation of its own. A PowerPoint slide held as an
 * object is a presentation of the one slide.
 */
async function embeddedSlides(source: Uint8Array | Compound, depth: number): Promise<ObjectRead | undefined> {
  if (depth > 2) return undefined
  if (source instanceof Uint8Array) {
    if (source[0] === 0x50 && source[1] === 0x4b) return slidesText(await presentationText(openArchive(source)))
    return source[0] === 0xd0 && source[1] === 0xcf ? embeddedSlides(openCompound(source), depth + 1) : undefined
  }
  const held = source.stream('Package')
  if (held) return embeddedSlides(held, depth + 1)
  const preview = await readOlderPowerPointStorage(source)
  return preview.kind === 'presentation' ? slidesText(preview.slides) : undefined
}

/** The title and lines of each slide of a newer presentation, in order, its objects and drawings left out. */
async function presentationText(archive: Archive): Promise<{ title: string; lines: string[] }[]> {
  const presentation = await textOf(archive, 'ppt/presentation.xml')
  if (presentation === undefined) return []
  const targets = await relationships(archive, 'ppt/presentation.xml')
  const slides: { title: string; lines: string[] }[] = []
  for (const event of xmlEvents(presentation)) {
    if (slides.length >= SLIDE_LIMIT) break
    if (event.type !== 'open' || event.name !== 'p:sldId') continue
    const target = targets.get(event.attributes['r:id'] ?? '')
    const xml = target === undefined ? undefined : await textOf(archive, target)
    if (xml !== undefined) slides.push(slideText(xml))
  }
  return slides
}

/**
 * Slides held as an object, as the text a document quotes: each slide's title strong, then its lines, one under the
 * other, a slide apart from the next, and as many slides as fit the most of a held document's text shown; and the same
 * as plain lines, a title on a line of its own.
 */
function slidesText(slides: readonly { title: string; lines: readonly string[] }[]): ObjectRead | undefined {
  const blocks: string[] = []
  const lines: string[] = []
  let length = 0
  for (const slide of slides) {
    const title = slide.title.replace(/\s+/g, ' ').trim()
    const own = slide.lines.map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line !== '')
    if (title === '' && own.length === 0) continue
    const block = [...(title === '' ? [] : [`**${plain(title)}**`]), ...own.map(plain)].join('  \n')
    if (blocks.length > 0 && length + block.length > HELD_TEXT_LIMIT) {
      blocks.push('…')
      break
    }
    blocks.push(block)
    length += block.length
    lines.push(...(title === '' ? [] : [title]), ...own)
  }
  if (blocks.length === 0) return undefined
  return { kind: 'text', markdown: blocks.join('\n\n').replace(/^/gm, '> ').replace(/^> $/gm, '>'), lines }
}

async function embeddedSheet(bytes: Uint8Array, options: NumberFormatOptions, depth = 0): Promise<OfficeFigure | undefined> {
  let preview: OfficePreview
  let active: string | undefined
  let area: CellArea | undefined
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const archive = openArchive(bytes)
    const workbook = (await textOf(archive, 'xl/workbook.xml')) ?? ''
    // The sheet the workbook was left on, and the block of cells its object was sized to.
    const tab = Number(/<workbookView\b[^>]*\bactiveTab="(\d+)"/.exec(workbook)?.[1] ?? 0)
    active = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)][tab]?.[1]
    active = active === undefined ? undefined : decodeEntities(active)
    area = cellArea(/<oleSize\b[^>]*\bref="([^"]*)"/.exec(workbook)?.[1])
    preview = await readWorkbook(archive, options, undefined, area ?? true)
  } else if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    // A compound file: a workbook of 2007 or later in its `Package` stream, or one of 97 to 2003 in its own.
    const file = openCompound(bytes)
    const held = file.stream('Package')
    if (held && depth === 0) return embeddedSheet(held, options, 1)
    const stream = file.stream('Workbook') ?? file.stream('Book')
    if (!stream) return undefined
    return embeddedSheet(stream, options, 1)
  } else {
    const view = olderWorkbookView(bytes)
    active = view.active
    area = view.area
    preview = await readOlderExcel(bytes, options, undefined, area ?? true)
  }
  if (preview.kind !== 'workbook') return undefined
  const sheet = preview.sheets.find((one) => one.name === active) ?? preview.sheets[0]
  const look = sheet?.look
  // Its pictures are placed over its cells where their anchors put them; a sheet holding a chart, or a picture whose
  // place is not known, which its cells alone would leave out, is shown by its object's picture.
  const anchors = sheet?.anchors ?? []
  const placed = sheet?.figures.map((figure, index) => ({ figure, anchor: anchors[index] })) ?? []
  if (!sheet || !look || placed.some(({ figure, anchor }) => figure.kind !== 'picture' || anchor === undefined)) return undefined
  return sheetFigure({ name: sheet.name, rows: sheet.rows, look }, area, '', placed)
}

/** An Excel workbook's sheets as they are read, with the options its numbers are shown by. */
async function workbookSheets(
  archive: Archive,
  options: NumberFormatOptions
): Promise<{ sheets: SheetRead[]; shown: NumberFormatOptions; styles: WorkbookStyles }> {
  const workbook = await textOf(archive, 'xl/workbook.xml')
  if (workbook === undefined) throw new Error('This is not an Excel workbook.')
  const targets = await relationships(archive, 'xl/workbook.xml')
  // A workbook may count its dates from 1904.
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook)
  const shown: NumberFormatOptions = { ...options, date1904 }
  const stylesPart = [...targets.values()].find((target) => /styles\.xml$/i.test(target)) ?? 'xl/styles.xml'
  const formats = await workbookFormats(archive, stylesPart)
  const themePart = [...targets.values()].find((target) => /theme\/[^/]+\.xml$/i.test(target)) ?? 'xl/theme/theme1.xml'
  const styles = readWorkbookStyles(await textOf(archive, stylesPart), readWorkbookTheme(await textOf(archive, themePart)))
  const palette = (index: number) => paletteColor(index, styles.colors)

  const strings: string[] = []
  // Each shared string's stretches in fonts of their own (`r`), each with the font it sets (`rPr`), if any.
  const stringRuns: (StringRun[] | undefined)[] = []
  let shared: string | undefined
  let inText = false
  // Phonetic guides (`rPh`) hold readings of East Asian text, not the text itself.
  let phonetic = false
  const stretches = new Stretches((node) => readRunFont(node, styles.colors))
  for (const event of xmlEvents((await textOf(archive, 'xl/sharedStrings.xml')) ?? '')) {
    if (shared !== undefined && !phonetic && stretches.read(event, shared.length)) continue
    if (event.type === 'open' && event.name === 'si') shared = ''
    else if (event.type === 'open' && event.name === 'rPh') phonetic = true
    else if (event.type === 'close' && event.name === 'rPh') phonetic = false
    else if (event.type === 'open' && event.name === 't') inText = !phonetic
    else if (event.type === 'close' && event.name === 't') inText = false
    else if (event.type === 'close' && event.name === 'si') {
      strings.push(shared ?? '')
      stringRuns.push(stretches.take())
      shared = undefined
    } else if (event.type === 'text' && inText && shared !== undefined) shared += event.text
  }

  const sheets: SheetRead[] = []
  for (const event of xmlEvents(workbook)) {
    if (sheets.length >= SHEET_LIMIT) break
    if (event.type !== 'open' || event.name !== 'sheet') continue
    const target = targets.get(event.attributes['r:id'] ?? '')
    const xml = target === undefined ? undefined : await textOf(archive, target)
    if (xml === undefined || target === undefined) continue
    const text = {
      strings,
      runs: stringRuns,
      stretches: new Stretches((node) => readRunFont(node, styles.colors)),
      look: (style: number) => styles.cells[style]?.text ?? styles.text
    }
    sheets.push({ name: event.attributes.name ?? `Sheet ${sheets.length + 1}`, ...sheetRows(xml, text, formats, shown, palette), xml, target })
  }
  return { sheets, shown, styles }
}

/**
 * An Excel workbook's sheets, each as rows of its cells' values as their formats show them, then the pictures and
 * charts its drawing places and the objects of other apps it holds, what these hold read by `objects` when given. A
 * workbook held as an object (`held`) has its sheets' looks reach as far as the block its object shows and the figures
 * its sheets place, which are drawn over its cells.
 */
export async function readWorkbook(
  archive: Archive,
  options: NumberFormatOptions = {},
  objects?: ObjectReader,
  held?: CellArea | true
): Promise<OfficePreview> {
  const { sheets, shown, styles } = await workbookSheets(archive, options)
  // The sheets are read before their charts, which may name their cells rather than keep their values.
  const cells = sheetCells(sheets)
  const figures = new Figures(archive, shown, async () => cells, objects)
  const read: Extract<OfficePreview, { kind: 'workbook' }>['sheets'] = []
  for (const { name, rows, cut, xml, target, layout, cells: values } of sheets) {
    // A sheet's pictures and charts are in its drawing, a part of their own, and so are its objects of other apps,
    // which it lists; one its drawing does not place follows the others.
    const targets = await relationships(archive, target)
    const listed = new Map((await sheetObjects(archive, xml, targets).catch(() => [])).map((object) => [object.shape, object]))
    const object = async (shape: number) => {
      const found = listed.get(shape)
      listed.delete(shape)
      return found && objectFigure(found, figures)
    }
    const drawing = targets.get(/<drawing\b[^>]*\br:id="([^"]*)"/.exec(xml)?.[1] ?? '')
    const drawn = drawing === undefined ? undefined : await textOf(archive, drawing)
    const placed = drawn === undefined || drawing === undefined ? [] : await drawnFigures(drawn, await relationships(archive, drawing), figures, object)
    for (const [shape, { anchor }] of [...listed]) {
      const figure = await object(shape)
      if (figure !== undefined) placed.push({ figure, anchor })
    }
    const kept = placed.filter(({ figure }) => figures.list[figure] !== undefined)
    const anchors = kept.map(({ anchor }) => anchor)
    // Its look, read from its part with its cells' styles; a sheet whose look cannot be read shows as a table.
    let look: SheetLook | undefined
    const extent = { rows: rows.length, columns: Math.max(0, ...rows.map((row) => row.length)) }
    try {
      look = readSheetLook(xml, layout, styles, held ? heldExtent(extent, held === true ? undefined : held, anchors) : extent)
    } catch {
      look = undefined
    }
    // Its conditional formats, worked out from its cells' values.
    if (look)
      look = withConditions(look, () => readSheetConditions(xml, styles, name), {
        value: (row, column) => cellValue(layout.kinds[row]?.[column], rows[row]?.[column], values.get(`${row},${column}`)?.number),
        now: serialNow(shown.date1904 ?? false),
        date1904: shown.date1904 ?? false
      })
    read.push({
      name,
      rows,
      cut,
      figures: kept.flatMap(({ figure }) => figures.list[figure] ?? []),
      look,
      ...(anchors.some((anchor) => anchor !== undefined) ? { anchors } : {})
    })
  }
  return { kind: 'workbook', sheets: read }
}

/**
 * An object of another app a sheet holds, as its figure: the picture Excel last drew of it at its size, an equation's
 * linear text its words, a worksheet as its sheet unless it shows as an icon, and a document's text its words.
 */
async function objectFigure(object: SheetObject, figures: Figures): Promise<number | undefined> {
  const { part, program, picture } = object
  const equation = await figures.equation(part)
  if (equation !== undefined) return figures.picture(picture, equation, object)
  const sheet = object.icon ? undefined : await figures.object(part, program, '')
  if (sheet !== undefined) return sheet
  const text = await figures.text(part, program)
  return figures.picture(picture, text?.lines.join(' ') ?? '', object)
}

/** The figures found at these places of a file's list. */
const figuresAt = (figures: Figures, places: readonly number[]) => places.flatMap((place) => figures.list[place] ?? [])

/** A stretch of a string as Excel keeps it, from its first character: in the font it sets, else in its cell's. */
interface StringRun {
  start: number
  font: TextLook | undefined
}

/**
 * The stretches of a string (`r`), read from its steps as they come: where each starts, and the font its properties
 * (`rPr`) set, whose elements say all of it.
 */
class Stretches {
  private runs: StringRun[] = []
  private properties: XmlNode | undefined
  private readonly font: (node: XmlNode) => TextLook
  constructor(font: (node: XmlNode) => TextLook) {
    this.font = font
  }
  /** Takes in a step of a string whose text is so long so far; whether it was one of its stretches'. */
  read(event: XmlEvent, length: number): boolean {
    if (event.type === 'open' && event.name === 'r') this.runs.push({ start: length, font: undefined })
    else if (event.type === 'open' && event.name === 'rPr') this.properties = { name: 'rPr', attributes: {}, children: [], text: '' }
    else if (event.type === 'open' && this.properties) this.properties.children.push({ name: event.name, attributes: event.attributes, children: [], text: '' })
    else if (event.type === 'close' && event.name === 'rPr' && this.properties) {
      const last = this.runs.at(-1)
      if (last) last.font = this.font(this.properties)
      this.properties = undefined
    } else return this.properties !== undefined && event.type === 'close'
    return true
  }
  /** The stretches of the string just read, when one sets a font, and a start for the next. */
  take(): StringRun[] | undefined {
    const runs = this.runs
    this.runs = []
    this.properties = undefined
    return runs.some((run) => run.font) ? runs : undefined
  }
}

/** The rows of a sheet, its cells in their columns, empty ones kept so the columns line up. */
function sheetRows(
  xml: string,
  texts: {
    strings: readonly string[]
    /** Each shared string's stretches, and a reader of a cell's own string's. */
    runs: readonly (StringRun[] | undefined)[]
    stretches: Stretches
    /** The font of a cell's style, for a stretch that leaves out its typeface, size or colour. */
    look: (style: number) => TextLook
  },
  formats: readonly string[],
  options: NumberFormatOptions,
  palette: (index: number) => string | undefined = () => undefined
): { rows: string[][]; cut: boolean; cells: Map<string, CellValue>; layout: SheetLayout } {
  const rows: string[][] = []
  // Each cell shown, by its row and column, with its number, for the charts that name it.
  const cells = new Map<string, CellValue>()
  // How each row and cell is laid out, for the sheet's look.
  const layout: SheetLayout = { styles: [], kinds: [], heights: [], numberColors: [] }
  let cut = false
  const { strings } = texts
  let row: string[] | undefined
  let cell: { column: number; type: string; value: string; format: string; style: number } | undefined
  let reading = false
  for (const event of xmlEvents(xml)) {
    if (cell?.type === 'inlineStr' && texts.stretches.read(event, cell.value.length)) continue
    if (event.type === 'open') {
      if (event.name === 'row') {
        if (rows.length >= ROW_LIMIT) {
          cut = true
          break
        }
        // A row left out is an empty row: the rows keep their numbers.
        const number = Number(event.attributes.r ?? rows.length + 1)
        while (rows.length < Math.min(number - 1, ROW_LIMIT)) rows.push([])
        row = []
        const height = Number(event.attributes.ht)
        layout.heights[rows.length] = {
          height: event.attributes.ht !== undefined && Number.isFinite(height) ? height : undefined,
          hidden: event.attributes.hidden === '1' || event.attributes.hidden === 'true'
        }
      } else if (event.name === 'c' && row) {
        const style = Number(event.attributes.s ?? 0)
        cell = {
          column: columnOf(event.attributes.r ?? ''),
          type: event.attributes.t ?? 'n',
          value: '',
          format: formats[style] ?? 'General',
          style: Number.isFinite(style) ? style : 0
        }
        if (event.attributes.r === undefined) cell.column = row.length
      } else if ((event.name === 'v' || event.name === 't') && cell) reading = true
    } else if (event.type === 'text' && reading && cell) cell.value += event.text
    else if (event.type === 'close') {
      if (event.name === 'v' || event.name === 't') reading = false
      else if (event.name === 'c' && cell && row) {
        // A string's stretches, taken from the reader of a cell's own string whether the cell is shown or not.
        const own = cell.type === 'inlineStr' ? texts.stretches.take() : cell.type === 's' ? texts.runs[Number(cell.value)] : undefined
        if (cell.column < COLUMN_LIMIT) {
          while (row.length < cell.column) row.push('')
          const text = cellText(cell, strings, options)
          row[cell.column] = text
          const number = cell.type === 'n' && cell.value.trim() !== '' ? Number(cell.value) : undefined
          cells.set(`${rows.length},${cell.column}`, { text, number: number !== undefined && Number.isFinite(number) ? number : undefined })
          const at = rows.length
          layout.styles[at] ??= []
          layout.kinds[at] ??= []
          layout.numberColors[at] ??= []
          layout.styles[at][cell.column] = cell.style
          layout.kinds[at][cell.column] = cellKind(cell)
          if (number !== undefined && Number.isFinite(number)) layout.numberColors[at][cell.column] = numberColor(number, cell.format, palette)
          // A string's stretches in their whole fonts, from the cell's where they leave something out.
          if (own) {
            const look = texts.look(cell.style)
            layout.runs ??= []
            const line = layout.runs[at] ?? []
            layout.runs[at] = line
            line[cell.column] = own.map(({ start, font }): LaidRun => ({ start, font: font ? wholeRun(font, look) : look }))
          }
        } else cut = true
        cell = undefined
      } else if (event.name === 'row' && row) {
        rows.push(row)
        row = undefined
      }
    }
  }
  while (rows.length > 0 && (rows.at(-1)?.every((value) => value === '') ?? false)) rows.pop()
  return { rows, cut, cells, layout }
}

/** What a cell holds, by its type, for where its content sits. */
function cellKind(cell: { type: string; value: string }): CellKind {
  if (cell.value.trim() === '' && cell.type !== 'inlineStr') return 'empty'
  if (cell.type === 'n' || cell.type === 'd') return 'number'
  if (cell.type === 'b') return 'logical'
  return cell.type === 'e' ? 'error' : 'text'
}

/** A cell's value as the sheet shows it: a number as its format shows it, text as it is. */
function cellText(cell: { type: string; value: string; format: string }, strings: readonly string[], options: NumberFormatOptions): string {
  const { type, value } = cell
  switch (type) {
    case 's':
      return strings[Number(value)] ?? ''
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE'
    case 'n': {
      const number = Number(value)
      if (value.trim() === '' || !Number.isFinite(number)) return value
      return /^general$/i.test(cell.format) ? generalNumber(number) : formatNumber(number, cell.format, options)
    }
    default:
      return value
  }
}

/**
 * A PowerPoint presentation's slides, in order: each one's title and the lines of its other text, and the slide drawn
 * as it looks (`slide-drawing.ts`); a slide that cannot be drawn shows its pictures and charts instead.
 */
export async function readPresentation(archive: Archive, options: NumberFormatOptions = {}): Promise<OfficePreview> {
  const presentation = await textOf(archive, 'ppt/presentation.xml')
  if (presentation === undefined) throw new Error('This is not a PowerPoint presentation.')
  const targets = await relationships(archive, 'ppt/presentation.xml')
  const cells = embeddedCells(archive, options)
  const figures = new Figures(archive, options, cells, embeddedObjects(options))
  const root = childAt(xmlTree(presentation), 'p:presentation')
  const sizeOf = childAt(root, 'p:sldSz')?.attributes
  const size = { width: Number(sizeOf?.cx) || 12_192_000, height: Number(sizeOf?.cy) || 6_858_000 }
  const chart = async (part: string) => {
    const xml = await textOf(archive, part)
    return xml === undefined ? undefined : readChart(xml, options, () => cells({ part, xml }).catch(() => undefined))
  }
  const slides: { title: string; lines: string[]; placed: number[]; drawing?: PictureFigure | undefined }[] = []
  let drawn = 0
  let cut = false
  for (const event of xmlEvents(presentation)) {
    if (event.type !== 'open' || event.name !== 'p:sldId') continue
    if (slides.length >= SLIDE_LIMIT) {
      cut = true
      break
    }
    const target = targets.get(event.attributes['r:id'] ?? '')
    const xml = target === undefined ? undefined : await textOf(archive, target)
    if (xml === undefined || target === undefined) continue
    const text = slideText(xml, await objectLines(xml, await relationships(archive, target), figures))
    const drawing =
      drawn < DRAWINGS_LIMIT
        ? await drawSlide(archive, target, size, { chart, defaultText: childAt(root, 'p:defaultTextStyle') }).catch(() => undefined)
        : undefined
    if (drawing) {
      drawn += drawing.svg.length
      const alt = [text.title, ...text.lines].filter(Boolean).join('. ')
      slides.push({
        ...text,
        placed: [],
        drawing: { kind: 'picture', type: 'image/svg+xml', bytes: drawing.svg, alt, width: Math.round(drawing.width), height: Math.round(drawing.height) }
      })
    } else slides.push({ ...text, placed: (await drawnFigures(xml, await relationships(archive, target), figures)).map(({ figure }) => figure) })
  }
  return {
    kind: 'presentation',
    slides: slides.map(({ placed, drawing, ...slide }) => ({ ...slide, figures: figuresAt(figures, placed), ...(drawing ? { drawing } : {}) })),
    cut
  }
}

/**
 * The lines a part's objects hold (`p:oleObj`, `o:OLEObject`), by their relationship's identifier: an equation of
 * Equation Editor or MathType as linear text, a document of Word by the lines of its text, a worksheet of Excel by its
 * cells, a row to a line, the slide drawing the picture Excel last drew of it.
 */
async function objectLines(xml: string, targets: ReadonlyMap<string, string>, figures: Figures): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  for (const event of xmlEvents(xml)) {
    if (event.type !== 'open' || (event.name !== 'p:oleObj' && event.name !== 'o:OLEObject')) continue
    const id = event.attributes['r:id']
    const program = event.attributes.progId ?? event.attributes.ProgID ?? ''
    if (id === undefined || found.has(id)) continue
    if (isEquationProgram(program)) {
      const written = await figures.equation(targets.get(id))
      if (written !== undefined) found.set(id, [written])
    } else {
      const lines = heldLines(await figures.held(targets.get(id), program))
      if (lines.length > 0) found.set(id, lines)
    }
  }
  return found
}

/**
 * A slide's title, from its title placeholder, and the lines of its other shapes, in order: an equation (`a14:m`) as
 * linear text in its paragraph, the picture PowerPoint keeps of it for older apps (`mc:Fallback`) passed over, and one
 * of Equation Editor or MathType, an object, as a line of its own.
 */
function slideText(xml: string, objects: ReadonlyMap<string, string[]> = new Map()): { title: string; lines: string[] } {
  let title = ''
  const lines: string[] = []
  let shape: { title: boolean; paragraphs: string[] } | undefined
  let paragraph: string | undefined
  let inText = false
  let passed = 0
  let equation: XmlEvent[] | undefined
  for (const event of xmlEvents(xml)) {
    if (passed > 0 || (event.type === 'open' && event.name === 'mc:Fallback')) {
      if (event.type === 'open' && event.name === 'mc:Fallback') passed++
      else if (event.type === 'close' && event.name === 'mc:Fallback') passed--
      continue
    }
    if (equation || (event.type === 'open' && event.name === 'm:oMath')) {
      equation ??= []
      equation.push(event)
      if (event.type === 'close' && event.name === 'm:oMath') {
        if (paragraph !== undefined) paragraph += mathText(equation)
        equation = undefined
      }
      continue
    }
    if (event.type === 'open') {
      if (event.name === 'p:sp') shape = { title: false, paragraphs: [] }
      else if (event.name === 'p:ph' && shape) shape.title = event.attributes.type === 'title' || event.attributes.type === 'ctrTitle'
      else if (event.name === 'a:p') paragraph = ''
      else if (event.name === 'a:br' && paragraph !== undefined) paragraph += ' '
      else if (event.name === 'a:t') inText = true
      else if (event.name === 'p:oleObj') lines.push(...(objects.get(event.attributes['r:id'] ?? '') ?? []))
    } else if (event.type === 'text') {
      if (inText && paragraph !== undefined) paragraph += event.text
    } else if (event.name === 'a:t') inText = false
    else if (event.name === 'a:p' && paragraph !== undefined) {
      const text = paragraph.trim()
      if (text !== '') (shape ? shape.paragraphs : lines).push(text)
      paragraph = undefined
    } else if (event.name === 'p:sp' && shape) {
      if (shape.title && title === '') title = shape.paragraphs.join(' ')
      else lines.push(...shape.paragraphs)
      shape = undefined
    }
  }
  return { title, lines }
}

/**
 * OpenDocument: every kind keeps what it holds in one part, `content.xml`, under `office:body`. Its text is in
 * paragraphs (`text:p`) and headings (`text:h`), spaces past the first written as `text:s`; a spreadsheet's and a
 * text's tables are `table:table`, whose rows and cells may stand for several alike (`number-rows-repeated`,
 * `number-columns-repeated`), as a sheet's empty end is written; a presentation's slides are `draw:page`.
 */

/** What is passed over in an OpenDocument's body: notes, comments, the text a change took out, and what drawings hold. */
const PASSED_OVER = new Set([
  'text:note',
  'office:annotation',
  'text:tracked-changes',
  'presentation:notes',
  'text:sequence-decls',
  'draw:frame',
  'draw:custom-shape',
  'draw:g'
])

/** The same in a text, whose frames are read for their pictures and charts, but not for the text of their boxes. */
const TEXT_PASSED_OVER = new Set([
  'text:note',
  'office:annotation',
  'text:tracked-changes',
  'text:sequence-decls',
  'draw:text-box',
  'draw:custom-shape',
  'draw:g'
])

/** The same in a presentation, whose slides' text is in drawings. */
const SLIDE_PASSED_OVER = new Set(['text:note', 'office:annotation', 'text:tracked-changes', 'presentation:notes', 'text:sequence-decls'])

/** What an OpenDocument's styles say: what each comes from, the format each gives its text, and which levels of each list style are numbered. */
interface OpenStyles {
  parents: Map<string, string>
  formats: Map<string, Format>
  numbered: Map<string, Set<number>>
}

/** A style's text properties as a format: only what they say, so what a style comes from fills the rest. */
function openFormat(attributes: Record<string, string>): Format {
  const format: Format = {}
  const weight = attributes['fo:font-weight']
  if (weight !== undefined) format.bold = weight === 'bold' || Number(weight) >= 600
  const slant = attributes['fo:font-style']
  if (slant !== undefined) format.italic = slant === 'italic' || slant === 'oblique'
  const line = attributes['style:text-line-through-style']
  if (line !== undefined) format.struck = line !== 'none'
  return format
}

/** Read the styles an OpenDocument part defines, up to its body: its `styles.xml`, or the automatic styles of its content. */
function readOpenStyles(xml: string, styles: OpenStyles): void {
  let style: string | undefined
  let list: Set<number> | undefined
  for (const event of xmlEvents(xml)) {
    if (event.type === 'close') {
      if (event.name === 'style:style') style = undefined
      else if (event.name === 'text:list-style') list = undefined
      continue
    }
    if (event.type !== 'open') continue
    if (event.name === 'office:body') return
    const { name, attributes } = event
    if (name === 'style:style') {
      style = attributes['style:name']
      const parent = attributes['style:parent-style-name']
      if (style && parent) styles.parents.set(style, parent)
    } else if (name === 'style:text-properties' && style) styles.formats.set(style, openFormat(attributes))
    else if (name === 'text:list-style') {
      list = new Set()
      styles.numbered.set(attributes['style:name'] ?? '', list)
    } else if (name === 'text:list-level-style-number' && list) list.add(repeatCount(attributes['text:level']))
  }
}

/** The format a style gives, its own over what it comes from. */
function openStyleFormat(style: string | undefined, styles: OpenStyles): Format {
  const format: Format = {}
  let name = style
  for (let steps = 0; name !== undefined && steps < 10; steps++) {
    const own = styles.formats.get(name)
    format.bold ??= own?.bold
    format.italic ??= own?.italic
    format.struck ??= own?.struck
    name = styles.parents.get(name)
  }
  return format
}

/** An OpenDocument's body as steps, without what is passed over, and the styles its content defines. */
function openDocumentBody(xml: string, passed: ReadonlySet<string>): { events: XmlEvent[]; styles: OpenStyles } {
  const styles: OpenStyles = { parents: new Map(), formats: new Map(), numbered: new Map() }
  readOpenStyles(xml, styles)
  const events: XmlEvent[] = []
  let body = false
  let skipped: string | undefined
  let depth = 0
  for (const event of xmlEvents(xml)) {
    if (!body) {
      if (event.type === 'open' && event.name === 'office:body') body = true
      continue
    }
    if (skipped !== undefined) {
      if (event.type === 'open' && event.name === skipped) depth++
      else if (event.type === 'close' && event.name === skipped && --depth === 0) skipped = undefined
      continue
    }
    if (event.type === 'open' && passed.has(event.name)) {
      skipped = event.name
      depth = 1
      continue
    }
    events.push(event)
  }
  return { events, styles }
}

/** What a step within a paragraph adds to its text, as OpenDocument writes spaces, tabs and line breaks. Nothing for any other step. */
function inlineText(event: XmlEvent): string | undefined {
  // Within a paragraph, a run of white space in the XML is one space: more are written as `text:s`.
  if (event.type === 'text') return event.text.replace(/\s+/g, ' ')
  if (event.type !== 'open') return undefined
  if (event.name === 'text:s') return ' '.repeat(Math.min(repeatCount(event.attributes['text:c']), 1000))
  if (event.name === 'text:tab') return '\t'
  if (event.name === 'text:line-break') return '\n'
  return undefined
}

/** How many alike a row, a cell or a run of spaces stands for: 1 when it does not say. */
function repeatCount(value: string | undefined): number {
  const count = Number(value ?? 1)
  return Number.isInteger(count) && count > 0 ? count : 1
}

/** The heading level a paragraph style gives, by its name or the name of a style it comes from: "Title", "Heading 2". */
function openHeadingLevel(style: string | undefined, parents: ReadonlyMap<string, string>): number | undefined {
  let name = style
  for (let steps = 0; name !== undefined && steps < 10; steps++) {
    // OpenDocument writes a space in a style's name as `_20_`.
    const readable = name.replace(/_20_/g, ' ').toLowerCase()
    if (readable === 'title') return 1
    if (readable === 'subtitle') return 2
    const level = Number(/^heading (\d)$/.exec(readable)?.[1] ?? 0)
    if (level > 0) return Math.min(level, 6)
    name = parents.get(name)
  }
  return undefined
}

/** An OpenDocument's `content.xml`. Throws when there is none: the file is not one. */
async function openDocumentContent(archive: Archive, kind: string): Promise<string> {
  const xml = await textOf(archive, 'content.xml')
  if (xml === undefined) throw new Error(`This is not an OpenDocument ${kind}.`)
  // A file protected with a password keeps its content encrypted, which its manifest says.
  let entry: string | undefined
  for (const event of xmlEvents((await textOf(archive, 'META-INF/manifest.xml')) ?? '')) {
    if (event.type === 'open' && event.name === 'manifest:file-entry') entry = event.attributes['manifest:full-path']
    else if (event.type === 'open' && event.name === 'manifest:encryption-data' && entry === 'content.xml') throw new Error(PROTECTED)
  }
  return xml
}

const isCell = (name: string) => name === 'table:table-cell' || name === 'table:covered-table-cell'
const isParagraph = (name: string) => name === 'text:p' || name === 'text:h'

/** A frame of OpenDocument as it is read: the picture or the object it shows, its words and its size. */
interface OpenFrame {
  image?: string | undefined
  object?: string | undefined
  alt: string
  width?: number | undefined
  height?: number | undefined
}

/** A frame as it opens, sized as it is drawn. */
const openFrame = (attributes: Record<string, string>): OpenFrame => ({
  alt: '',
  width: lengthPixels(attributes['svg:width']),
  height: lengthPixels(attributes['svg:height'])
})

/** A path in an OpenDocument's archive from a frame's address: "Pictures/1.png", "./Object 1". Nothing for an address outside it. */
const openPart = (address: string | undefined) => (address === undefined || /^[a-z][a-z\d+.-]*:/i.test(address) ? undefined : resolvePart('', address))

/** Read a step within a frame: what it shows, and its title and description as its words. */
function readFrameStep(frame: OpenFrame, event: XmlEvent, describing: { now: boolean }): void {
  if (event.type === 'open') {
    if (event.name === 'draw:image') frame.image ??= event.attributes['xlink:href']
    else if (event.name === 'draw:object') frame.object ??= event.attributes['xlink:href']
    else if (event.name === 'svg:title' || event.name === 'svg:desc') describing.now = frame.alt === ''
  } else if (event.type === 'text') {
    if (describing.now) frame.alt += event.text
  } else if (event.name === 'svg:title' || event.name === 'svg:desc') describing.now = false
}

/**
 * A frame's object as linear text when it is an equation (MathML), for the words of its picture, or in its place when
 * it keeps none.
 */
async function frameFormula(frame: OpenFrame, archive: Archive): Promise<string | undefined> {
  const object = openPart(frame.object)
  return object === undefined ? undefined : objectFormula(archive, object)
}

/**
 * The figure a frame shows: its object's chart, else its picture. An object that is not a chart shows the picture its
 * app last drew of it (`ObjectReplacements/`), a StarView metafile among them, or nothing when it keeps none.
 */
async function frameFigure(frame: OpenFrame, figures: Figures): Promise<number | undefined> {
  const object = openPart(frame.object)
  const chart = object === undefined ? undefined : await figures.chart(`${object}/content.xml`, frame.alt, readOpenChart)
  return chart ?? figures.picture(openPart(frame.image), frame.alt, frame)
}

/**
 * The pictures and charts of an OpenDocument spreadsheet or presentation, by the sheet or the slide (`container`)
 * whose frames place them, in order. An equation's linear text is its picture's words, or is drawn in its place when it
 * keeps none. Speaker notes and comments are passed over.
 */
async function openFrames(xml: string, container: string, figures: Figures, archive: Archive): Promise<number[][]> {
  const placed: number[][] = []
  let body = false
  let notes = 0
  let frames = 0
  let frame: OpenFrame | undefined
  const describing = { now: false }
  for (const event of xmlEvents(xml)) {
    if (!body) {
      body = event.type === 'open' && event.name === 'office:body'
      continue
    }
    const noting = event.type !== 'text' && (event.name === 'presentation:notes' || event.name === 'office:annotation')
    if (noting) notes += event.type === 'open' ? 1 : -1
    if (noting || notes > 0) continue
    if (event.type === 'open' && event.name === container && frames === 0) placed.push([])
    else if (event.type === 'open' && event.name === 'draw:frame') {
      if (frames++ === 0) frame = openFrame(event.attributes)
    } else if (event.type === 'close' && event.name === 'draw:frame') {
      if (--frames === 0 && frame) {
        const formula = frame.object && !frame.alt ? await frameFormula(frame, archive) : undefined
        if (formula) frame.alt = formula
        const figure = (await frameFigure(frame, figures)) ?? (formula ? figures.drawing(formulaPicture(formula, frame)) : undefined)
        if (figure !== undefined) placed.at(-1)?.push(figure)
        frame = undefined
      }
    } else if (frame && frames === 1) readFrameStep(frame, event, describing)
  }
  return placed
}

/** A paragraph of OpenDocument as it is read: its parts, its heading level, and the format its style gives. */
interface OpenParagraph {
  parts: InlinePart[]
  level: number | undefined
  format: Format
}

/**
 * An OpenDocument text as Markdown: its headings, paragraphs with their strong, slanted and struck text and their
 * links, its bulleted and numbered lists, its tables, and the pictures and charts its frames show where they are.
 */
export async function readOpenText(archive: Archive): Promise<OfficePreview> {
  const content = await openDocumentContent(archive, 'text')
  const preview = await readOpenTextMarkdown(archive, content)
  // Its look is read after its text, with the same figures; a text whose look cannot be read shows its Markdown.
  const figureOf = async (node: XmlNode) => {
    const frame = openFrame(node.attributes)
    const describing = { now: false }
    for (const event of nodeEvents(node)) if (event.type !== 'open' || event.name !== 'draw:frame') readFrameStep(frame, event, describing)
    const formula = frame.object && !frame.alt ? await frameFormula(frame, archive) : undefined
    if (formula) frame.alt = formula
    return (await frameFigure(frame, preview.figuresRead)) ?? formula
  }
  const look = await readOpenLook(archive, content, figureOf, (drawing) => preview.figuresRead.drawing(drawing)).catch(() => undefined)
  return { kind: 'document', markdown: preview.markdown, figures: preview.figuresRead.list, cut: preview.cut || (look?.cut ?? false), look: look?.look }
}

/** An OpenDocument text's Markdown, and its figures as they were read, for its look to find them among. */
async function readOpenTextMarkdown(archive: Archive, content: string): Promise<{ markdown: string; cut: boolean; figuresRead: Figures }> {
  const named: OpenStyles = { parents: new Map(), formats: new Map(), numbered: new Map() }
  readOpenStyles((await textOf(archive, 'styles.xml')) ?? '', named)
  const { events, styles: automatic } = openDocumentBody(content, TEXT_PASSED_OVER)
  // The styles of the content come from the named ones, and stand over them.
  const styles: OpenStyles = {
    parents: new Map([...named.parents, ...automatic.parents]),
    formats: new Map([...named.formats, ...automatic.formats]),
    numbered: new Map([...named.numbered, ...automatic.numbered])
  }
  const figures = new Figures(archive)
  const blocks: string[] = []
  let paragraph: OpenParagraph | undefined
  const spans: Format[] = []
  let link: string | undefined
  // The lists open, each with its style when it names one: a list within another follows the outer one's.
  const lists: (string | undefined)[] = []
  let frame: OpenFrame | undefined
  let frames = 0
  const describing = { now: false }
  let depth = 0
  let table: string[][] = []
  let row: string[] | undefined
  let cell: string[] | undefined

  const numbered = () => {
    const style = lists.findLast((name) => name !== undefined)
    return style !== undefined && (styles.numbered.get(style)?.has(lists.length) ?? false)
  }

  for (const event of events) {
    if (blocks.length >= BLOCK_LIMIT) break
    if (event.type === 'open' && event.name === 'draw:frame') {
      if (frames++ === 0) frame = openFrame(event.attributes)
      continue
    }
    if (frames > 0) {
      if (event.type === 'close' && event.name === 'draw:frame' && --frames === 0 && frame) {
        // An equation's linear text is its picture's words, or stands in its place when it has none.
        const formula = frame.object && !frame.alt ? await frameFormula(frame, archive) : undefined
        if (formula) frame.alt = formula
        const figure = await frameFigure(frame, figures)
        if (figure !== undefined && paragraph) paragraph.parts.push({ figure, alt: frame.alt })
        else if (formula && paragraph) paragraph.parts.push({ text: formula, ...paragraph.format })
        frame = undefined
      } else if (frame && frames === 1) readFrameStep(frame, event, describing)
      continue
    }
    const added = paragraph ? inlineText(event) : undefined
    if (paragraph && added !== undefined) {
      paragraph.parts.push({ text: added, ...paragraph.format, ...definedFormat(spans), link })
      continue
    }
    if (event.type === 'open') {
      const { name, attributes } = event
      if (name === 'table:table' && ++depth === 1) table = []
      else if (name === 'table:table-row' && depth === 1) row = []
      else if (isCell(name) && depth === 1) cell = []
      else if (name === 'text:list') lists.push(attributes['text:style-name'])
      else if (isParagraph(name)) {
        const style = attributes['text:style-name']
        const level = name === 'text:h' ? Math.min(repeatCount(attributes['text:outline-level']), 6) : openHeadingLevel(style, styles.parents)
        paragraph = { parts: [], level, format: openStyleFormat(style, styles) }
      } else if (name === 'text:span') spans.push(openStyleFormat(attributes['text:style-name'], styles))
      else if (name === 'text:a') link = attributes['xlink:href']
      continue
    }
    if (event.type !== 'close') continue
    if (isParagraph(event.name) && paragraph) {
      const text = partsText(paragraph.parts).replace(/\s+/g, ' ').trim()
      const shown = paragraph.parts.filter((part): part is { figure: number; alt: string } => 'figure' in part)
      if (cell) cell.push(inlineLines(paragraph.parts).join(' '))
      else if (paragraph.level && text !== '') {
        blocks.push(`${'#'.repeat(paragraph.level)} ${plain(text)}`)
        if (shown.length > 0) blocks.push(shown.map((part) => figureMark(part.figure, part.alt)).join(' '))
      } else if (text !== '' || shown.length > 0) {
        const lines = inlineLines(paragraph.parts)
        const indent = '  '.repeat(Math.max(0, lists.length - 1))
        if (lists.length > 0) blocks.push(`${indent}${numbered() ? '1.' : '-'} ${lines.join(`  \n${indent}  `)}`)
        else blocks.push(lines.join('  \n'))
      }
      paragraph = undefined
    } else if (event.name === 'text:span') spans.pop()
    else if (event.name === 'text:a') link = undefined
    else if (event.name === 'text:list') lists.pop()
    else if (isCell(event.name) && depth === 1 && cell && row) {
      row.push(cell.filter(Boolean).join(' '))
      cell = undefined
    } else if (event.name === 'table:table-row' && depth === 1 && row) {
      table.push(row)
      row = undefined
    } else if (event.name === 'table:table' && --depth === 0 && table.length > 0) blocks.push(markdownTable(table, (written) => written))
  }
  return { markdown: joinBlocks(blocks), cut: blocks.length >= BLOCK_LIMIT, figuresRead: figures }
}

/** What the spans open say of a format, the innermost over the outer ones: only what they say. */
function definedFormat(spans: readonly Format[]): Format {
  const format: Format = {}
  for (const span of spans) {
    if (span.bold !== undefined) format.bold = span.bold
    if (span.italic !== undefined) format.italic = span.italic
    if (span.struck !== undefined) format.struck = span.struck
  }
  return format
}

/** How deep a cell's spans are followed: a stretch deeper is in the look of the span it is within at that depth. */
const SPAN_DEPTH = 20

/**
 * A cell's stretches in spans, from the start of its text, the text before the first in its cell's own look, each
 * stretch the last that starts where it does; none when no stretch is in a span of a style.
 */
function openRuns(runs: readonly OpenRun[], length: number): OpenRun[] | undefined {
  if (!runs.some((run) => run.styles.some((name) => name !== '') && run.start < length)) return undefined
  const ordered = [{ start: 0, styles: [] }, ...runs]
  return ordered.filter((run, index) => run.start < length && (ordered[index + 1]?.start ?? length) !== run.start)
}

/** A cell's value as stored, for a cell that shows no text of its own. */
function storedValue(attributes: Record<string, string>): string {
  const flag = attributes['office:boolean-value']
  if (flag !== undefined) return flag === 'true' ? 'TRUE' : 'FALSE'
  return attributes['office:string-value'] ?? attributes['office:value'] ?? attributes['office:date-value'] ?? attributes['office:time-value'] ?? ''
}

/**
 * An OpenDocument spreadsheet's sheets, each as rows of its cells as the sheet shows them, then the pictures and charts
 * it places. Empty rows and cells count only once something follows them: a sheet's empty end is written as thousands of them.
 */
export async function readOpenSpreadsheet(archive: Archive): Promise<OfficePreview> {
  const content = await openDocumentContent(archive, 'spreadsheet')
  const { events } = openDocumentBody(content, PASSED_OVER)
  const figures = new Figures(archive)
  const placed = await openFrames(content, 'table:table', figures, archive)
  const sheets: Extract<OfficePreview, { kind: 'workbook' }>['sheets'] = []
  // The stretches of each sheet's cells' text in spans of their own, by row and column, for the cells that have them.
  const stretches: (OpenRun[] | undefined)[][][] = []
  let sheet: { name: string; rows: string[][]; runs: (OpenRun[] | undefined)[][]; cut: boolean; emptyRows: number } | undefined
  let row: { cells: string[]; runs: (OpenRun[] | undefined)[]; repeated: number; emptyCells: number } | undefined
  // A cell's stretches where its shown text has them, and those of the paragraph being read where it has them so far,
  // in the spans it is within and the number of those too deep to be followed.
  let cell: { paragraphs: string[]; stored: string; repeated: number; runs: OpenRun[]; spans: string[]; deeper: number; reading: OpenRun[] } | undefined
  let paragraph: string | undefined

  for (const event of events) {
    const added = paragraph !== undefined ? inlineText(event) : undefined
    if (paragraph !== undefined && added !== undefined) {
      paragraph += added
      continue
    }
    if (event.type === 'open') {
      if (event.name === 'table:table') {
        if (sheets.length >= SHEET_LIMIT) break
        sheet = { name: event.attributes['table:name'] ?? `Sheet ${sheets.length + 1}`, rows: [], runs: [], cut: false, emptyRows: 0 }
      } else if (event.name === 'table:table-row' && sheet) {
        row = { cells: [], runs: [], repeated: repeatCount(event.attributes['table:number-rows-repeated']), emptyCells: 0 }
      } else if (isCell(event.name) && row) {
        cell = {
          paragraphs: [],
          stored: storedValue(event.attributes),
          repeated: repeatCount(event.attributes['table:number-columns-repeated']),
          runs: [],
          spans: [],
          deeper: 0,
          reading: []
        }
      } else if (event.name === 'text:p' && cell) paragraph = ''
      else if (event.name === 'text:span' && cell && paragraph !== undefined) {
        if (cell.spans.length >= SPAN_DEPTH) cell.deeper++
        else {
          cell.spans.push(event.attributes['text:style-name'] ?? '')
          cell.reading.push({ start: paragraph.length, styles: [...cell.spans] })
        }
      }
      continue
    }
    if (event.type !== 'close') continue
    if (event.name === 'text:span' && cell && paragraph !== undefined && cell.deeper > 0) cell.deeper--
    else if (event.name === 'text:span' && cell && paragraph !== undefined && cell.spans.length > 0) {
      cell.spans.pop()
      cell.reading.push({ start: paragraph.length, styles: [...cell.spans] })
    } else if (event.name === 'text:p' && cell && paragraph !== undefined) {
      // The paragraph's stretches where they fall in its cell's text, which joins its paragraphs trimmed with a space.
      const shown = paragraph.trim()
      const leading = paragraph.length - paragraph.trimStart().length
      const at = cell.paragraphs.reduce((length, one) => length + one.length + 1, 0)
      for (const { start, styles } of cell.reading) cell.runs.push({ start: at + Math.min(Math.max(start - leading, 0), shown.length), styles })
      cell.paragraphs.push(shown)
      cell.reading = []
      cell.spans = []
      cell.deeper = 0
      paragraph = undefined
    } else if (isCell(event.name) && cell && row && sheet) {
      // What the sheet shows, its paragraphs; else the value stored.
      const text = cell.paragraphs.length > 0 ? cell.paragraphs.join(' ') : cell.stored
      const runs = cell.paragraphs.length > 0 ? openRuns(cell.runs, text.length) : undefined
      if (text === '') row.emptyCells += cell.repeated
      else {
        const wanted = row.cells.length + row.emptyCells + cell.repeated
        while (row.cells.length < COLUMN_LIMIT && row.emptyCells > 0) {
          row.cells.push('')
          row.emptyCells--
        }
        for (let copy = 0; copy < cell.repeated && row.cells.length < COLUMN_LIMIT; copy++) {
          if (runs) row.runs[row.cells.length] = runs
          row.cells.push(text)
        }
        row.emptyCells = 0
        if (wanted > COLUMN_LIMIT) sheet.cut = true
      }
      cell = undefined
    } else if (event.name === 'table:table-row' && row && sheet) {
      if (row.cells.length === 0) sheet.emptyRows += row.repeated
      else {
        const wanted = sheet.rows.length + sheet.emptyRows + row.repeated
        while (sheet.rows.length < ROW_LIMIT && sheet.emptyRows > 0) {
          sheet.rows.push([])
          sheet.emptyRows--
        }
        for (let copy = 0; copy < row.repeated && sheet.rows.length < ROW_LIMIT; copy++) {
          if (row.runs.length > 0) sheet.runs[sheet.rows.length] = row.runs
          sheet.rows.push([...row.cells])
        }
        sheet.emptyRows = 0
        if (wanted > ROW_LIMIT) sheet.cut = true
      }
      row = undefined
    } else if (event.name === 'table:table' && sheet) {
      stretches[sheets.length] = sheet.runs
      sheets.push({ name: sheet.name, rows: sheet.rows, cut: sheet.cut, figures: figuresAt(figures, placed[sheets.length] ?? []) })
      sheet = undefined
    }
  }
  // Each sheet's look, from its table and the spreadsheet's styles and settings; a sheet whose look cannot be read shows as a table.
  const document = childAt(xmlTree(content), 'office:document-content')
  const stylesRoot = childAt(xmlTree((await textOf(archive, 'styles.xml')) ?? ''), 'office:document-styles')
  const book = new StyleBook(childAt(document, 'office:automatic-styles'), childAt(stylesRoot, 'office:automatic-styles'), childAt(stylesRoot, 'office:styles'))
  const fonts = fontFaces([stylesRoot, document])
  const views = readSheetViews(await textOf(archive, 'settings.xml'))
  const numbers = dataStyles([document, stylesRoot])
  const tables = childrenNamed(childAt(document, 'office:body', 'office:spreadsheet'), 'table:table')
  sheets.forEach((read, index) => {
    const table = tables[index]
    if (!table || read.rows.length === 0) return
    try {
      read.look = readOpenSheetLook(
        table,
        { rows: read.rows.length, columns: Math.max(0, ...read.rows.map((row) => row.length)) },
        book,
        fonts,
        views(read.name),
        { numbers, stretches: stretches[index], name: read.name, shown: read.rows }
      )
    } catch {
      read.look = undefined
    }
  })
  return { kind: 'workbook', sheets }
}

const isShape = (name: string) => name === 'draw:frame' || name === 'draw:custom-shape'

/**
 * An OpenDocument presentation's slides, in order: each one's title, from its title frame, the lines of its other text,
 * an equation's linear text among them where its frame is, and its pictures and charts.
 */
export async function readOpenPresentation(archive: Archive): Promise<OfficePreview> {
  const content = await openDocumentContent(archive, 'presentation')
  const { events } = openDocumentBody(content, SLIDE_PASSED_OVER)
  const figures = new Figures(archive)
  const placed = await openFrames(content, 'draw:page', figures, archive)
  const tree = xmlTree(content)
  const pages = childrenNamed(childAt(tree, 'office:document-content', 'office:body', 'office:presentation'), 'draw:page')
  let deck: OpenDeck | undefined
  try {
    deck = await openDeck(archive, tree)
  } catch {
    deck = undefined
  }
  let drawn = 0
  const slides: { title: string; lines: string[]; figures: OfficeFigure[]; drawing?: PictureFigure }[] = []
  let cut = false
  let slide: { title: string; lines: string[]; figures: OfficeFigure[]; drawing?: PictureFigure } | undefined
  let shape: { title: boolean; paragraphs: string[]; object?: string | undefined } | undefined
  let shapes = 0
  let paragraph: string | undefined

  for (const event of events) {
    const added = paragraph !== undefined ? inlineText(event) : undefined
    if (paragraph !== undefined && added !== undefined) {
      paragraph += added.replace(/\n/g, ' ')
      continue
    }
    if (event.type === 'open') {
      if (event.name === 'draw:page') {
        if (slides.length >= SLIDE_LIMIT) {
          cut = true
          break
        }
        slide = { title: '', lines: [], figures: figuresAt(figures, placed[slides.length] ?? []) }
      } else if (isShape(event.name) && slide && ++shapes === 1) shape = { title: event.attributes['presentation:class'] === 'title', paragraphs: [] }
      else if (isParagraph(event.name) && slide) paragraph = ''
      else if (event.name === 'draw:object' && shape) shape.object ??= event.attributes['xlink:href']
      continue
    }
    if (event.type !== 'close') continue
    if (isParagraph(event.name) && paragraph !== undefined && slide) {
      const text = paragraph.trim()
      if (text !== '') (shape ? shape.paragraphs : slide.lines).push(text)
      paragraph = undefined
    } else if (isShape(event.name) && slide && shapes > 0 && --shapes === 0 && shape) {
      // An equation is a line of its linear text, where its frame is among the slide's shapes.
      const formula = shape.object ? await frameFormula({ object: shape.object, alt: '' }, archive) : undefined
      if (formula) shape.paragraphs.push(formula)
      if (shape.title && slide.title === '') slide.title = shape.paragraphs.join(' ')
      else slide.lines.push(...shape.paragraphs)
      shape = undefined
    } else if (event.name === 'draw:page' && slide) {
      // The page drawn as it looks, in place of its pictures and charts.
      const page = pages[slides.length]
      const drawing = deck && page && drawn < DRAWINGS_LIMIT ? await drawOpenPage(deck, page, slides.length + 1).catch(() => undefined) : undefined
      if (drawing) {
        drawn += drawing.svg.length
        const alt = [slide.title, ...slide.lines].filter(Boolean).join('. ')
        slide.figures = []
        slide.drawing = {
          kind: 'picture',
          type: 'image/svg+xml',
          bytes: drawing.svg,
          alt,
          width: Math.round(drawing.width),
          height: Math.round(drawing.height)
        }
      }
      slides.push(slide)
      slide = undefined
    }
  }
  return { kind: 'presentation', slides, cut }
}

/** Whether a file is a compound file holding an encrypted package, as Word, Excel and PowerPoint protect one. */
function protectedPackage(bytes: Uint8Array): boolean {
  try {
    const compound = openCompound(bytes)
    return compound.stream('EncryptionInfo') !== undefined || compound.stream('EncryptedPackage') !== undefined
  } catch {
    return false
  }
}

/** An Office file read for its preview, by its extension; its numbers and dates written as `options` says. */
export async function readOffice(extension: string, bytes: Uint8Array, options: NumberFormatOptions = {}): Promise<OfficePreview> {
  // The older formats are compound files, not archives.
  if (extension === 'doc') return readOlderWord(bytes, embeddedObjects(options))
  if (extension === 'xls') return readOlderExcel(bytes, options, embeddedObjects(options))
  if (extension === 'ppt') return readOlderPowerPoint(bytes, embeddedObjects(options))
  // Word, Excel and PowerPoint keep a file protected with a password in a compound file, encrypted, not in an archive.
  if (protectedPackage(bytes)) throw new Error(PROTECTED)
  const archive = openArchive(bytes)
  switch (extension) {
    case 'docx':
      return readDocument(archive, options)
    case 'xlsx':
      return readWorkbook(archive, options, embeddedObjects(options))
    case 'pptx':
      return readPresentation(archive, options)
    case 'odt':
      return readOpenText(archive)
    case 'ods':
      return readOpenSpreadsheet(archive)
    case 'odp':
      return readOpenPresentation(archive)
    default:
      throw new Error('This kind of file is not read here.')
  }
}
