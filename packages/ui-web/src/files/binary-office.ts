/**
 * The older Office formats read in the window itself, with no service and no library (docs/SPEC.md, section 9.7):
 * Word 97 to 2003's documents (.doc), Excel's workbooks (.xls) and PowerPoint's presentations (.ppt). Each is a
 * compound file (`compound.ts`) whose streams hold the binary records each app wrote, read for what a preview shows,
 * as the newer formats are: a document as Markdown, a workbook's sheets as tables, the text of each slide.
 *
 * Every offset read is checked against its stream, so a damaged file fails with a sentence rather than reading past
 * its end. A file protected with a password says so.
 */

import { openCompound } from './compound.ts'
import {
  BLOCK_LIMIT,
  COLUMN_LIMIT,
  joinBlocks,
  markdownTable,
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

/** The heading level of each style a document defines: the built-in headings and title, or a style named as one. */
function headingStyles(table: Reader, at: number, size: number): Map<number, number> {
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
      if (base > 0 && named + 2 <= place + 2 + length) {
        const characters = Math.min(table.u16(named), (place + 2 + length - named - 2) >> 1)
        name = utf16(table.bytes(named + 2, characters * 2)).toLowerCase()
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

/** A Word 97 to 2003 document as Markdown: its headings, paragraphs, list items and tables, in order. */
export function readWord97(bytes: Uint8Array): OfficePreview {
  const file = openCompound(bytes)
  const stream = file.stream('WordDocument')
  if (!stream) throw new Error('This is not a Word document.')
  const word = reader(stream)
  // Word 6 and 95 wrote a header of their own, which this does not read.
  if (word.length < 160 || word.u16(0) !== 0xa5ec || word.u16(2) < 0xc1) throw new Error('It is a document of Word 95 or older, which is not read here.')
  const flags = word.u16(0x0a)
  if (flags & 0x0100) throw new Error(PROTECTED)
  const tableStream = file.stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!tableStream) damaged()
  const table = reader(tableStream as Uint8Array)

  // The file's header: a fixed part, then counts of 16-bit and 32-bit values, then where things are in the table.
  const shorts = word.u16(32)
  const longsAt = 34 + shorts * 2
  const longs = word.u16(longsAt)
  const textLength = Math.min(word.u32(longsAt + 2 + 3 * 4), CHARACTER_LIMIT)
  const pairsAt = longsAt + 2 + longs * 4
  const pairCount = word.u16(pairsAt)
  if (pairCount < 34) damaged()
  const pair = (index: number) => ({ at: word.u32(pairsAt + 2 + index * 8), size: word.u32(pairsAt + 6 + index * 8) })
  const styles = pair(1)
  const formats = pair(13)
  const complex = pair(33)

  // The text is in pieces, each where the file keeps it: in 8-bit characters, or in UTF-16.
  const pieces: { start: number; end: number; at: number; narrow: boolean }[] = []
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
      const narrow = (raw & 0x40000000) !== 0
      const offset = raw & 0x3fffffff
      pieces.push({ start: table.u32(list + index * 4), end: table.u32(list + (index + 1) * 4), at: narrow ? offset / 2 : offset, narrow })
    }
    break
  }
  if (pieces.length === 0) damaged()

  // Each paragraph's format is found by where its mark is in the file, in pages of runs of 512 bytes.
  const runs: { start: number; end: number; at?: number; size?: number; format?: ParagraphFormat }[] = []
  const pages = formats.size >= 4 ? Math.floor((formats.size - 4) / 8) : 0
  for (let index = 0; index < pages; index++) {
    const page = (table.u32(formats.at + (pages + 1) * 4 + index * 4) & 0x3fffff) * 512
    if (page + 512 > word.length) continue
    const count = word.u8(page + 511)
    for (let run = 0; run < count; run++) {
      const offset = word.u8(page + (count + 1) * 4 + run * 13) * 2
      const found: (typeof runs)[number] = { start: word.u32(page + run * 4), end: word.u32(page + (run + 1) * 4) }
      if (offset > 0) {
        const length = word.u8(page + offset)
        found.at = length === 0 ? page + offset + 2 : page + offset + 1
        found.size = length === 0 ? word.u8(page + offset + 1) * 2 : length * 2 - 1
      }
      runs.push(found)
    }
  }
  runs.sort((one, other) => one.start - other.start)
  const formatAt = (place: number): ParagraphFormat | undefined => {
    let low = 0
    let high = runs.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const run = runs[middle] as (typeof runs)[number]
      if (place < run.start) high = middle - 1
      else if (place >= run.end) low = middle + 1
      else {
        if (!run.format)
          run.format =
            run.at === undefined || run.size === undefined
              ? { style: 0, inTable: false, rowEnd: false, list: false, level: 0 }
              : paragraphFormat(word, run.at, run.size)
        return run.format
      }
    }
    return undefined
  }
  const headings = headingStyles(table, styles.at, styles.size)

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

  // Fields hold their code, then what they show: only what they show is text.
  const fields: boolean[] = []
  let read = 0
  const narrow = new TextDecoder('windows-1252')
  for (const piece of [...pieces].sort((one, other) => one.start - other.start)) {
    if (blocks.length >= BLOCK_LIMIT || read >= textLength) break
    const count = Math.min(piece.end, textLength) - piece.start
    if (count <= 0) continue
    const width = piece.narrow ? 1 : 2
    const text = piece.narrow ? narrow.decode(word.bytes(piece.at, count)) : utf16(word.bytes(piece.at, count * 2))
    read += count
    for (let index = 0; index < text.length && blocks.length < BLOCK_LIMIT; index++) {
      const char = text[index] as string
      const code = char.charCodeAt(0)
      if (code === 0x13) fields.push(true)
      else if (code === 0x14) {
        if (fields.length > 0) fields[fields.length - 1] = false
      } else if (code === 0x15) fields.pop()
      else if (fields.includes(true)) continue
      else if (code === 0x0d || code === 0x0c) endParagraph('\r', piece.at + index * width)
      else if (code === 0x07) endParagraph('\x07', piece.at + index * width)
      else if (code === 0x0b) paragraph += '\n'
      else if (code === 0x1e) paragraph += '-'
      else if (code === 0x09 || code >= 0x20) paragraph += char
    }
  }
  if (paragraph.trim() !== '') endParagraph('\r', undefined)
  flushTable()
  return { kind: 'document', markdown: joinBlocks(blocks), figures: [], cut: blocks.length >= BLOCK_LIMIT || read >= CHARACTER_LIMIT }
}

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
const number = (value: number) => String(value)
const flag = (value: number, error: boolean) => (error ? (ERRORS[value] ?? '#N/A') : value ? 'TRUE' : 'FALSE')

/** An Excel 97 to 2003 workbook's sheets, each as rows of its cells' values as stored. */
export function readExcel97(bytes: Uint8Array): OfficePreview {
  const file = openCompound(bytes)
  const stream = file.stream('Workbook')
  if (!stream) throw new Error(file.stream('Book') ? 'It is a workbook of Excel 95 or older, which is not read here.' : 'This is not an Excel workbook.')
  const book = reader(stream)
  if (book.u16(0) !== 0x0809 || book.u16(4) !== 0x0600) throw new Error('It is a workbook of Excel 95 or older, which is not read here.')

  const strings: string[] = []
  const sheets: { name: string; at: number }[] = []
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
    if (shared && record.type === 0x003c) {
      shared.push(book.bytes(record.at, record.size))
      continue
    }
    readShared()
    if (record.type === 0x002f) throw new Error(PROTECTED)
    if (record.type === 0x00fc) shared = [book.bytes(record.at, record.size)]
    else if (record.type === 0x0085 && book.u8(record.at + 5) === 0) {
      // A worksheet: where its records start, and its name. Charts and macros are left out.
      const length = book.u8(record.at + 6)
      const wide = (book.u8(record.at + 7) & 0x01) !== 0
      const name = wide ? utf16(book.bytes(record.at + 8, length * 2)) : latin1(book.bytes(record.at + 8, length))
      sheets.push({ name, at: book.u32(record.at) })
    } else if (record.type === 0x000a) break
  }
  readShared()

  return {
    kind: 'workbook',
    sheets: sheets.slice(0, SHEET_LIMIT).map(({ name, at }) => ({ name, ...sheetRows(book, at, strings), figures: [] }))
  }
}

/** The rows of a sheet, from its records: its cells in their columns, empty ones kept so the columns line up. */
function sheetRows(book: Reader, from: number, strings: readonly string[]): { rows: string[][]; cut: boolean } {
  const rows: string[][] = []
  let cut = false
  const put = (row: number, column: number, value: string) => {
    if (row >= ROW_LIMIT || column >= COLUMN_LIMIT) {
      cut = true
      return
    }
    while (rows.length <= row) rows.push([])
    const cells = rows[row] as string[]
    while (cells.length < column) cells.push('')
    cells[column] = value
  }
  let depth = 0
  // A formula's text result follows it in a record of its own.
  let waiting: { row: number; column: number } | undefined
  for (const { type, at, size } of records(book, from)) {
    if (type === 0x0809) depth++
    else if (type === 0x000a && --depth <= 0) break
    // A chart inside a sheet has records of its own, between its own beginning and end.
    if (depth !== 1) continue
    const row = () => book.u16(at)
    const column = () => book.u16(at + 2)
    if (type === 0x00fd) put(row(), column(), strings[book.u32(at + 6)] ?? '')
    else if (type === 0x0203) put(row(), column(), number(book.f64(at + 6)))
    else if (type === 0x027e) put(row(), column(), number(rkNumber(book.u32(at + 6))))
    else if (type === 0x00bd) {
      const first = column()
      for (let index = 0; index < Math.floor((size - 6) / 6); index++) put(row(), first + index, number(rkNumber(book.u32(at + 6 + index * 6))))
    } else if (type === 0x0205) put(row(), column(), flag(book.u8(at + 6), book.u8(at + 7) !== 0))
    else if (type === 0x0204 || type === 0x0207) {
      const start = type === 0x0204 ? at + 6 : at
      const length = book.u16(start)
      const wide = (book.u8(start + 2) & 0x01) !== 0
      const text = wide ? utf16(book.bytes(start + 3, length * 2)) : latin1(book.bytes(start + 3, length))
      if (type === 0x0204) put(row(), column(), text)
      else if (waiting) put(waiting.row, waiting.column, text)
      waiting = undefined
    } else if (type === 0x0006) {
      waiting = undefined
      // A formula's last result: a number, or marked by its last two bytes as text, a boolean, an error or nothing.
      if (book.u16(at + 12) !== 0xffff) put(row(), column(), number(book.f64(at + 6)))
      else {
        const kind = book.u8(at + 6)
        if (kind === 0) waiting = { row: row(), column: column() }
        else if (kind === 1 || kind === 2) put(row(), column(), flag(book.u8(at + 8), kind === 2))
      }
    }
  }
  while (rows.length > 0 && (rows.at(-1)?.every((value) => value === '') ?? false)) rows.pop()
  return { rows, cut }
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

/** A PowerPoint 97 to 2003 presentation's slides, in order: each one's title and the lines of its other text. */
export function readPowerPoint97(bytes: Uint8Array): OfficePreview {
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

  const slides = found.map(({ texts, persisted }) => {
    // Text boxes of its own, beyond its placeholders, are in the slide's drawing.
    const at = places.get(persisted)
    const drawn = at === undefined ? undefined : recordAt(stream, at)
    const all = drawn?.type === 0x03ee ? [...texts, ...drawingTexts(stream, drawn)] : texts
    const slide = { title: '', lines: [] as string[], figures: [] }
    for (const text of all) {
      if (text.title && slide.title === '') slide.title = text.lines.join(' ')
      else slide.lines.push(...text.lines.filter((line) => !slide.lines.includes(line)))
    }
    return slide
  })
  return { kind: 'presentation', slides, cut }
}
