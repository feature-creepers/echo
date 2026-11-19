/**
 * Office files read in the window itself, with no service and no library (docs/SPEC.md, section 9.7): Word, Excel and
 * PowerPoint's (.docx, .xlsx, .pptx) and OpenDocument's (.odt, .ods, .odp). Each is a ZIP archive of XML parts,
 * unpacked with the window's own decompression and read for what a preview shows. A document becomes Markdown, shown
 * as the Prose block shows it; a workbook, its sheets as tables; a presentation, the text of each slide. Their look,
 * pictures and charts are left to their app. The older binary formats (.doc, .xls, .ppt) are compound files, read by
 * `binary-office.ts`.
 */

import { readExcel97, readPowerPoint97, readWord97 } from './binary-office.ts'
import { BLOCK_LIMIT, COLUMN_LIMIT, markdownTable, type OfficePreview, plain, ROW_LIMIT, SHEET_LIMIT, SLIDE_LIMIT } from './office-text.ts'

export type { OfficePreview } from './office-text.ts'

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

/** The most a part of an archive is unpacked to: a preview never needs more, and a crafted archive stops there. */
const PART_LIMIT = 32 * 1024 * 1024

/** The parts of a ZIP archive by name, each unpacked when asked for. */
export type Archive = Map<string, () => Promise<Uint8Array>>

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Read a ZIP archive's directory. Throws when it is not one. */
export function openArchive(bytes: Uint8Array): Archive {
  const data = view(bytes)
  // The end of the directory is in the last 64 KB and 22 bytes: a comment may follow it.
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (data.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('This is not a ZIP archive.')
  const count = data.getUint16(end + 10, true)
  let at = data.getUint32(end + 16, true)
  const parts: Archive = new Map()
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || data.getUint32(at, true) !== 0x02014b50) throw new Error('The archive is damaged.')
    const method = data.getUint16(at + 10, true)
    const packed = data.getUint32(at + 20, true)
    const size = data.getUint32(at + 24, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const local = data.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
    parts.set(name, async () => {
      if (local + 30 > bytes.length || data.getUint32(local, true) !== 0x04034b50) throw new Error('The archive is damaged.')
      const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true)
      const stored = bytes.subarray(start, start + packed)
      if (method === 0) return stored
      if (method !== 8) throw new Error('The archive is packed in a way that is not read here.')
      if (size > PART_LIMIT) throw new Error('A part of the file is too large to show.')
      return inflate(stored)
    })
  }
  return parts
}

/** Unpack deflated bytes with the window's own decompression, stopping past the limit. */
async function inflate(packed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > PART_LIMIT) {
      await reader.cancel()
      throw new Error('A part of the file is too large to show.')
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    whole.set(chunk, offset)
    offset += chunk.byteLength
  }
  return whole
}

/** A step through an XML part: an element opened, with its attributes, closed, or text between. */
export type XmlEvent = { type: 'open'; name: string; attributes: Record<string, string> } | { type: 'close'; name: string } | { type: 'text'; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Text with its entities read: `&amp;`, `&#233;`, `&#xE9;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity] ?? whole
  })
}

/**
 * The steps through an XML part, as the Office formats write them: elements, attributes and text. A self-closed
 * element is opened and closed; declarations, comments and instructions are passed over.
 */
export function* xmlEvents(xml: string): Generator<XmlEvent> {
  let at = 0
  while (at < xml.length) {
    const open = xml.indexOf('<', at)
    if (open < 0) {
      if (at < xml.length) yield { type: 'text', text: decodeEntities(xml.slice(at)) }
      return
    }
    if (open > at) yield { type: 'text', text: decodeEntities(xml.slice(at, open)) }
    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open)
      at = close < 0 ? xml.length : close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open)
      yield { type: 'text', text: xml.slice(open + 9, close < 0 ? xml.length : close) }
      at = close < 0 ? xml.length : close + 3
      continue
    }
    const close = xml.indexOf('>', open)
    if (close < 0) return
    const tag = xml.slice(open + 1, close)
    at = close + 1
    if (tag.startsWith('?') || tag.startsWith('!')) continue
    if (tag.startsWith('/')) {
      yield { type: 'close', name: tag.slice(1).trim() }
      continue
    }
    const selfClosed = tag.endsWith('/')
    const body = selfClosed ? tag.slice(0, -1) : tag
    const name = /^[^\s/>]+/.exec(body)?.[0] ?? ''
    const attributes: Record<string, string> = {}
    for (const match of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributes[match[1] as string] = decodeEntities(match[3] ?? match[4] ?? '')
    }
    yield { type: 'open', name, attributes }
    if (selfClosed) yield { type: 'close', name }
  }
}

const textOf = async (archive: Archive, name: string): Promise<string | undefined> => {
  const part = archive.get(name)
  return part ? new TextDecoder().decode(await part()) : undefined
}

/** Where the relationships of a part point, by their identifiers, as paths in the archive. */
async function relationships(archive: Archive, part: string): Promise<Map<string, string>> {
  const folder = part.slice(0, part.lastIndexOf('/') + 1)
  const xml = await textOf(archive, `${folder}_rels/${part.slice(folder.length)}.rels`)
  const found = new Map<string, string>()
  for (const event of xmlEvents(xml ?? '')) {
    if (event.type !== 'open' || event.name !== 'Relationship') continue
    const { Id: id, Target: target } = event.attributes
    if (id && target) found.set(id, resolvePart(folder, target))
  }
  return found
}

/** A target of a relationship as a path in the archive: from the archive's top when it starts with "/", else from the part's folder. */
function resolvePart(folder: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : folder + target).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.' && part !== '') resolved.push(part)
  }
  return resolved.join('/')
}

/** The heading level of each paragraph style a document defines, by the style's name: "heading 1", "Title". */
async function headingStyles(archive: Archive): Promise<Map<string, number>> {
  const levels = new Map<string, number>()
  let style: string | undefined
  for (const event of xmlEvents((await textOf(archive, 'word/styles.xml')) ?? '')) {
    if (event.type === 'open' && event.name === 'w:style') style = event.attributes['w:styleId']
    if (event.type === 'open' && event.name === 'w:name' && style !== undefined) {
      const name = (event.attributes['w:val'] ?? '').toLowerCase()
      const level = name === 'title' ? 1 : name === 'subtitle' ? 2 : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0)
      if (level > 0) levels.set(style, Math.min(level, 6))
    }
  }
  return levels
}

/** A Word document as Markdown: its headings, paragraphs, list items and tables, in order. */
export async function readDocument(archive: Archive): Promise<OfficePreview> {
  const xml = await textOf(archive, 'word/document.xml')
  if (xml === undefined) throw new Error('This is not a Word document.')
  const headings = await headingStyles(archive)
  const blocks: string[] = []
  let paragraph: { text: string; style?: string | undefined; list: boolean } | undefined
  let inText = false
  let depth = 0
  let table: string[][] = []
  let row: string[] | undefined
  let cell: string[] | undefined

  for (const event of xmlEvents(xml)) {
    if (blocks.length >= BLOCK_LIMIT) break
    if (event.type === 'text') {
      if (inText && paragraph) paragraph.text += event.text
      continue
    }
    if (event.type === 'open') {
      if (event.name === 'w:tbl' && ++depth === 1) table = []
      else if (event.name === 'w:tr' && depth === 1) row = []
      else if (event.name === 'w:tc' && depth === 1) cell = []
      else if (event.name === 'w:p') paragraph = { text: '', list: false }
      else if (event.name === 'w:pStyle' && paragraph) paragraph.style = event.attributes['w:val']
      else if (event.name === 'w:numPr' && paragraph) paragraph.list = true
      else if (event.name === 'w:tab' && paragraph) paragraph.text += '\t'
      else if ((event.name === 'w:br' || event.name === 'w:cr') && paragraph) paragraph.text += '\n'
      else if (event.name === 'w:t') inText = true
      continue
    }
    if (event.name === 'w:t') inText = false
    else if (event.name === 'w:p' && paragraph) {
      const text = paragraph.text.trim()
      if (cell) cell.push(text)
      else if (text !== '') {
        const level = paragraph.style === undefined ? undefined : headings.get(paragraph.style)
        const lines = text.split('\n').map(plain)
        blocks.push(level ? `${'#'.repeat(level)} ${lines.join(' ')}` : paragraph.list ? `- ${lines.join('  \n  ')}` : lines.join('  \n'))
      }
      paragraph = undefined
    } else if (event.name === 'w:tc' && depth === 1 && cell && row) {
      row.push(cell.filter(Boolean).join(' '))
      cell = undefined
    } else if (event.name === 'w:tr' && depth === 1 && row) {
      table.push(row)
      row = undefined
    } else if (event.name === 'w:tbl' && --depth === 0 && table.length > 0) blocks.push(markdownTable(table))
  }
  return { kind: 'document', markdown: blocks.join('\n\n'), cut: blocks.length >= BLOCK_LIMIT }
}

/** A cell's column from its reference: "A1" is 0, "AB7" is 27. */
export function columnOf(reference: string): number {
  let column = 0
  for (const letter of /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? 'A') column = column * 26 + (letter.charCodeAt(0) - 64)
  return column - 1
}

/** An Excel workbook's sheets, each as rows of its cells' values as stored. */
export async function readWorkbook(archive: Archive): Promise<OfficePreview> {
  const workbook = await textOf(archive, 'xl/workbook.xml')
  if (workbook === undefined) throw new Error('This is not an Excel workbook.')
  const targets = await relationships(archive, 'xl/workbook.xml')

  const strings: string[] = []
  let shared: string | undefined
  let inText = false
  // Phonetic guides (`rPh`) hold readings of East Asian text, not the text itself.
  let phonetic = false
  for (const event of xmlEvents((await textOf(archive, 'xl/sharedStrings.xml')) ?? '')) {
    if (event.type === 'open' && event.name === 'si') shared = ''
    else if (event.type === 'open' && event.name === 'rPh') phonetic = true
    else if (event.type === 'close' && event.name === 'rPh') phonetic = false
    else if (event.type === 'open' && event.name === 't') inText = !phonetic
    else if (event.type === 'close' && event.name === 't') inText = false
    else if (event.type === 'close' && event.name === 'si') {
      strings.push(shared ?? '')
      shared = undefined
    } else if (event.type === 'text' && inText && shared !== undefined) shared += event.text
  }

  const sheets: { name: string; rows: string[][]; cut: boolean }[] = []
  for (const event of xmlEvents(workbook)) {
    if (sheets.length >= SHEET_LIMIT) break
    if (event.type !== 'open' || event.name !== 'sheet') continue
    const target = targets.get(event.attributes['r:id'] ?? '')
    const xml = target === undefined ? undefined : await textOf(archive, target)
    if (xml === undefined) continue
    sheets.push({ name: event.attributes.name ?? `Sheet ${sheets.length + 1}`, ...sheetRows(xml, strings) })
  }
  return { kind: 'workbook', sheets }
}

/** The rows of a sheet, its cells in their columns, empty ones kept so the columns line up. */
function sheetRows(xml: string, strings: readonly string[]): { rows: string[][]; cut: boolean } {
  const rows: string[][] = []
  let cut = false
  let row: string[] | undefined
  let cell: { column: number; type: string; value: string } | undefined
  let reading = false
  for (const event of xmlEvents(xml)) {
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
      } else if (event.name === 'c' && row) {
        cell = { column: columnOf(event.attributes.r ?? ''), type: event.attributes.t ?? 'n', value: '' }
        if (event.attributes.r === undefined) cell.column = row.length
      } else if ((event.name === 'v' || event.name === 't') && cell) reading = true
    } else if (event.type === 'text' && reading && cell) cell.value += event.text
    else if (event.type === 'close') {
      if (event.name === 'v' || event.name === 't') reading = false
      else if (event.name === 'c' && cell && row) {
        if (cell.column < COLUMN_LIMIT) {
          while (row.length < cell.column) row.push('')
          row[cell.column] = cellText(cell.type, cell.value, strings)
        } else cut = true
        cell = undefined
      } else if (event.name === 'row' && row) {
        rows.push(row)
        row = undefined
      }
    }
  }
  while (rows.length > 0 && (rows.at(-1)?.every((value) => value === '') ?? false)) rows.pop()
  return { rows, cut }
}

/** A cell's value as the sheet shows it, as far as it can be without its formats: a number stays as stored. */
function cellText(type: string, value: string, strings: readonly string[]): string {
  switch (type) {
    case 's':
      return strings[Number(value)] ?? ''
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE'
    default:
      return value
  }
}

/** A PowerPoint presentation's slides, in order: each one's title and the lines of its other text. */
export async function readPresentation(archive: Archive): Promise<OfficePreview> {
  const presentation = await textOf(archive, 'ppt/presentation.xml')
  if (presentation === undefined) throw new Error('This is not a PowerPoint presentation.')
  const targets = await relationships(archive, 'ppt/presentation.xml')
  const slides: { title: string; lines: string[] }[] = []
  let cut = false
  for (const event of xmlEvents(presentation)) {
    if (event.type !== 'open' || event.name !== 'p:sldId') continue
    if (slides.length >= SLIDE_LIMIT) {
      cut = true
      break
    }
    const target = targets.get(event.attributes['r:id'] ?? '')
    const xml = target === undefined ? undefined : await textOf(archive, target)
    if (xml !== undefined) slides.push(slideText(xml))
  }
  return { kind: 'presentation', slides, cut }
}

/** A slide's title, from its title placeholder, and the lines of its other shapes, in order. */
function slideText(xml: string): { title: string; lines: string[] } {
  let title = ''
  const lines: string[] = []
  let shape: { title: boolean; paragraphs: string[] } | undefined
  let paragraph: string | undefined
  let inText = false
  for (const event of xmlEvents(xml)) {
    if (event.type === 'open') {
      if (event.name === 'p:sp') shape = { title: false, paragraphs: [] }
      else if (event.name === 'p:ph' && shape) shape.title = event.attributes.type === 'title' || event.attributes.type === 'ctrTitle'
      else if (event.name === 'a:p') paragraph = ''
      else if (event.name === 'a:br' && paragraph !== undefined) paragraph += ' '
      else if (event.name === 'a:t') inText = true
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

/** The same in a presentation, whose slides' text is in drawings. */
const SLIDE_PASSED_OVER = new Set(['text:note', 'office:annotation', 'text:tracked-changes', 'presentation:notes', 'text:sequence-decls'])

/** An OpenDocument's body as steps, without what is passed over, and the parents of its automatic styles, by name. */
function openDocumentBody(xml: string, passed: ReadonlySet<string>): { events: XmlEvent[]; parents: Map<string, string> } {
  const events: XmlEvent[] = []
  const parents = new Map<string, string>()
  let body = false
  let skipped: string | undefined
  let depth = 0
  for (const event of xmlEvents(xml)) {
    if (!body) {
      const name = event.type === 'open' && event.name === 'style:style' ? event.attributes['style:name'] : undefined
      const parent = event.type === 'open' ? event.attributes['style:parent-style-name'] : undefined
      if (name && parent) parents.set(name, parent)
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
  return { events, parents }
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
  return xml
}

const isCell = (name: string) => name === 'table:table-cell' || name === 'table:covered-table-cell'
const isParagraph = (name: string) => name === 'text:p' || name === 'text:h'

/** An OpenDocument text as Markdown: its headings, paragraphs, list items and tables, in order. */
export async function readOpenText(archive: Archive): Promise<OfficePreview> {
  const { events, parents } = openDocumentBody(await openDocumentContent(archive, 'text'), PASSED_OVER)
  const blocks: string[] = []
  let paragraph: { text: string; level: number | undefined } | undefined
  let lists = 0
  let depth = 0
  let table: string[][] = []
  let row: string[] | undefined
  let cell: string[] | undefined

  for (const event of events) {
    if (blocks.length >= BLOCK_LIMIT) break
    const added = paragraph ? inlineText(event) : undefined
    if (paragraph && added !== undefined) {
      paragraph.text += added
      continue
    }
    if (event.type === 'open') {
      if (event.name === 'table:table' && ++depth === 1) table = []
      else if (event.name === 'table:table-row' && depth === 1) row = []
      else if (isCell(event.name) && depth === 1) cell = []
      else if (event.name === 'text:list') lists++
      else if (event.name === 'text:h') paragraph = { text: '', level: Math.min(repeatCount(event.attributes['text:outline-level']), 6) }
      else if (event.name === 'text:p') paragraph = { text: '', level: openHeadingLevel(event.attributes['text:style-name'], parents) }
      continue
    }
    if (event.type !== 'close') continue
    if (isParagraph(event.name) && paragraph) {
      const text = paragraph.text.trim()
      if (cell) cell.push(text)
      else if (text !== '') {
        const lines = text.split('\n').map(plain)
        const indent = '  '.repeat(Math.max(0, lists - 1))
        if (paragraph.level) blocks.push(`${'#'.repeat(paragraph.level)} ${lines.join(' ')}`)
        else if (lists > 0) blocks.push(`${indent}- ${lines.join(`  \n${indent}  `)}`)
        else blocks.push(lines.join('  \n'))
      }
      paragraph = undefined
    } else if (event.name === 'text:list') lists = Math.max(0, lists - 1)
    else if (isCell(event.name) && depth === 1 && cell && row) {
      row.push(cell.filter(Boolean).join(' '))
      cell = undefined
    } else if (event.name === 'table:table-row' && depth === 1 && row) {
      table.push(row)
      row = undefined
    } else if (event.name === 'table:table' && --depth === 0 && table.length > 0) blocks.push(markdownTable(table))
  }
  return { kind: 'document', markdown: blocks.join('\n\n'), cut: blocks.length >= BLOCK_LIMIT }
}

/** A cell's value as stored, for a cell that shows no text of its own. */
function storedValue(attributes: Record<string, string>): string {
  const flag = attributes['office:boolean-value']
  if (flag !== undefined) return flag === 'true' ? 'TRUE' : 'FALSE'
  return attributes['office:string-value'] ?? attributes['office:value'] ?? attributes['office:date-value'] ?? attributes['office:time-value'] ?? ''
}

/**
 * An OpenDocument spreadsheet's sheets, each as rows of its cells as the sheet shows them. Empty rows and cells count
 * only once something follows them: a sheet's empty end is written as thousands of them.
 */
export async function readOpenSpreadsheet(archive: Archive): Promise<OfficePreview> {
  const { events } = openDocumentBody(await openDocumentContent(archive, 'spreadsheet'), PASSED_OVER)
  const sheets: { name: string; rows: string[][]; cut: boolean }[] = []
  let sheet: { name: string; rows: string[][]; cut: boolean; emptyRows: number } | undefined
  let row: { cells: string[]; repeated: number; emptyCells: number } | undefined
  let cell: { paragraphs: string[]; stored: string; repeated: number } | undefined
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
        sheet = { name: event.attributes['table:name'] ?? `Sheet ${sheets.length + 1}`, rows: [], cut: false, emptyRows: 0 }
      } else if (event.name === 'table:table-row' && sheet) {
        row = { cells: [], repeated: repeatCount(event.attributes['table:number-rows-repeated']), emptyCells: 0 }
      } else if (isCell(event.name) && row) {
        cell = { paragraphs: [], stored: storedValue(event.attributes), repeated: repeatCount(event.attributes['table:number-columns-repeated']) }
      } else if (event.name === 'text:p' && cell) paragraph = ''
      continue
    }
    if (event.type !== 'close') continue
    if (event.name === 'text:p' && cell && paragraph !== undefined) {
      cell.paragraphs.push(paragraph.trim())
      paragraph = undefined
    } else if (isCell(event.name) && cell && row && sheet) {
      // What the sheet shows, its paragraphs; else the value stored.
      const text = cell.paragraphs.length > 0 ? cell.paragraphs.join(' ') : cell.stored
      if (text === '') row.emptyCells += cell.repeated
      else {
        const wanted = row.cells.length + row.emptyCells + cell.repeated
        while (row.cells.length < COLUMN_LIMIT && row.emptyCells > 0) {
          row.cells.push('')
          row.emptyCells--
        }
        for (let copy = 0; copy < cell.repeated && row.cells.length < COLUMN_LIMIT; copy++) row.cells.push(text)
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
        for (let copy = 0; copy < row.repeated && sheet.rows.length < ROW_LIMIT; copy++) sheet.rows.push([...row.cells])
        sheet.emptyRows = 0
        if (wanted > ROW_LIMIT) sheet.cut = true
      }
      row = undefined
    } else if (event.name === 'table:table' && sheet) {
      sheets.push({ name: sheet.name, rows: sheet.rows, cut: sheet.cut })
      sheet = undefined
    }
  }
  return { kind: 'workbook', sheets }
}

const isShape = (name: string) => name === 'draw:frame' || name === 'draw:custom-shape'

/** An OpenDocument presentation's slides, in order: each one's title, from its title frame, and the lines of its other text. */
export async function readOpenPresentation(archive: Archive): Promise<OfficePreview> {
  const { events } = openDocumentBody(await openDocumentContent(archive, 'presentation'), SLIDE_PASSED_OVER)
  const slides: { title: string; lines: string[] }[] = []
  let cut = false
  let slide: { title: string; lines: string[] } | undefined
  let shape: { title: boolean; paragraphs: string[] } | undefined
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
        slide = { title: '', lines: [] }
      } else if (isShape(event.name) && slide && ++shapes === 1) shape = { title: event.attributes['presentation:class'] === 'title', paragraphs: [] }
      else if (isParagraph(event.name) && slide) paragraph = ''
      continue
    }
    if (event.type !== 'close') continue
    if (isParagraph(event.name) && paragraph !== undefined && slide) {
      const text = paragraph.trim()
      if (text !== '') (shape ? shape.paragraphs : slide.lines).push(text)
      paragraph = undefined
    } else if (isShape(event.name) && slide && shapes > 0 && --shapes === 0 && shape) {
      if (shape.title && slide.title === '') slide.title = shape.paragraphs.join(' ')
      else slide.lines.push(...shape.paragraphs)
      shape = undefined
    } else if (event.name === 'draw:page' && slide) {
      slides.push(slide)
      slide = undefined
    }
  }
  return { kind: 'presentation', slides, cut }
}

/** An Office file read for its preview, by its extension. */
export async function readOffice(extension: string, bytes: Uint8Array): Promise<OfficePreview> {
  // The older formats are compound files, not archives.
  if (extension === 'doc') return readWord97(bytes)
  if (extension === 'xls') return readExcel97(bytes)
  if (extension === 'ppt') return readPowerPoint97(bytes)
  const archive = openArchive(bytes)
  switch (extension) {
    case 'docx':
      return readDocument(archive)
    case 'xlsx':
      return readWorkbook(archive)
    case 'pptx':
      return readPresentation(archive)
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
