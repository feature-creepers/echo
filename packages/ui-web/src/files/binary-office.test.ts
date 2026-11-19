import { describe, expect, it } from 'vitest'
import { readOlderExcel, readOlderPowerPoint, readOlderSheets, readOlderWord, rkNumber } from './binary-office.ts'
import { openCompound } from './compound.ts'
import type { DocumentTable } from './document-look.ts'
import { readOffice } from './office.ts'
import type { OfficePreview } from './office-text.ts'

/** Little-endian bytes written in order, with places to fill in once known; big-endian, as a Mac of its time wrote them, when asked. */
class Bytes {
  private readonly values: number[] = []
  private readonly bigEndian: boolean
  constructor(bigEndian = false) {
    this.bigEndian = bigEndian
  }
  get length() {
    return this.values.length
  }
  u8(value: number) {
    this.values.push(value & 0xff)
    return this
  }
  u16(value: number) {
    return this.bigEndian ? this.u8(value >> 8).u8(value) : this.u8(value).u8(value >> 8)
  }
  u32(value: number) {
    return this.bigEndian ? this.u16(value >>> 16).u16(value & 0xffff) : this.u16(value & 0xffff).u16(value >>> 16)
  }
  f64(value: number) {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, true)
    for (let index = 0; index < 8; index++) this.u8(view.getUint8(index))
    return this
  }
  raw(bytes: Uint8Array | readonly number[]) {
    for (const byte of bytes) this.u8(byte)
    return this
  }
  wide(text: string) {
    for (let index = 0; index < text.length; index++) this.u16(text.charCodeAt(index))
    return this
  }
  narrow(text: string) {
    for (let index = 0; index < text.length; index++) this.u8(text.charCodeAt(index))
    return this
  }
  zeros(count: number) {
    for (let index = 0; index < count; index++) this.u8(0)
    return this
  }
  padTo(size: number) {
    return this.zeros(Math.max(0, size - this.length))
  }
  set32(at: number, value: number) {
    for (let index = 0; index < 4; index++) this.values[at + index] = (value >>> (index * 8)) & 0xff
  }
  done() {
    return new Uint8Array(this.values)
  }
}

const END = 0xfffffffe
const FREE = 0xffffffff

/** The streams of a compound file, and its storages, each holding streams and storages of its own. */
interface Tree {
  [name: string]: Uint8Array | Tree
}

/**
 * A compound file of 512-byte sectors holding the streams and storages given: streams under 4,096 bytes in the mini
 * stream, as Office writes them, the others in sectors of their own. Enough of the format for a reader.
 */
function compound(streams: Tree): Uint8Array {
  const sectors: Uint8Array[] = []
  const fat: number[] = []
  const chain = (data: Uint8Array): number => {
    if (data.length === 0) return END
    const first = sectors.length
    const count = Math.ceil(data.length / 512)
    for (let index = 0; index < count; index++) {
      const sector = new Uint8Array(512)
      sector.set(data.subarray(index * 512, (index + 1) * 512))
      sectors.push(sector)
      fat.push(index < count - 1 ? first + index + 1 : END)
    }
    return first
  }
  const mini = new Bytes()
  const miniFat: number[] = []
  const store = (data: Uint8Array) => {
    if (data.length >= 4096) return { start: chain(data), size: data.length }
    const first = miniFat.length
    const count = Math.ceil(data.length / 64)
    for (let index = 0; index < count; index++) miniFat.push(index < count - 1 ? first + index + 1 : END)
    mini.raw(data).padTo(miniFat.length * 64)
    return { start: count === 0 ? END : first, size: data.length }
  }
  // Each level's entries are siblings to the right of one another, a storage's own after them; the root is entry 0.
  const entries: { name: string; type: number; right: number; child: number; start: number; size: number }[] = []
  const place = (tree: Tree): number => {
    const named = Object.entries(tree)
    const first = entries.length + 1
    for (const [name] of named) entries.push({ name, type: 2, right: FREE, child: FREE, start: END, size: 0 })
    named.forEach(([name, value], index) => {
      const right = index + 1 < named.length ? first + index + 1 : FREE
      entries[first + index - 1] =
        value instanceof Uint8Array ? { name, type: 2, right, child: FREE, ...store(value) } : { name, type: 1, right, child: place(value), start: 0, size: 0 }
    })
    return named.length > 0 ? first : FREE
  }
  const top = place(streams)
  const miniData = mini.done()
  const rootStart = chain(miniData)
  const miniFatBytes = new Bytes()
  for (const value of miniFat) miniFatBytes.u32(value)
  const miniFatStart = miniFat.length === 0 ? END : chain(miniFatBytes.padTo(Math.ceil(miniFatBytes.length / 512) * 512).done())
  const directory = new Bytes()
  const entry = (name: string, type: number, right: number, child: number, start: number, size: number) => {
    const at = directory.length
    directory
      .wide(name)
      .u16(0)
      .padTo(at + 64)
    directory
      .u16((name.length + 1) * 2)
      .u8(type)
      .u8(1)
      .u32(FREE)
      .u32(right)
      .u32(child)
      .zeros(36)
      .u32(start)
      .u32(size)
      .u32(0)
  }
  entry('Root Entry', 5, FREE, top, rootStart, miniData.length)
  for (const { name, type, right, child, start, size } of entries) entry(name, type, right, child, start, size)
  const directoryStart = chain(directory.padTo(Math.ceil(directory.length / 512) * 512).done())
  // The table of sectors covers itself too.
  let fatSectors = 1
  while (fatSectors * 128 < sectors.length + fatSectors) fatSectors++
  const firstFat = sectors.length
  for (let index = 0; index < fatSectors; index++) fat.push(0xfffffffd)
  const table = new Bytes()
  for (let index = 0; index < fatSectors * 128; index++) table.u32(fat[index] ?? FREE)
  const tableBytes = table.done()
  for (let index = 0; index < fatSectors; index++) sectors.push(tableBytes.subarray(index * 512, (index + 1) * 512))

  const header = new Bytes()
    .raw([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    .zeros(16)
    .u16(0x3e)
    .u16(3)
    .u16(0xfffe)
    .u16(9)
    .u16(6)
    .zeros(10)
    .u32(fatSectors)
    .u32(directoryStart)
    .u32(0)
    .u32(4096)
    .u32(miniFatStart)
    .u32(miniFat.length === 0 ? 0 : Math.ceil(miniFat.length / 128))
    .u32(END)
    .u32(0)
  for (let index = 0; index < 109; index++) header.u32(index < fatSectors ? firstFat + index : FREE)
  const file = new Uint8Array(512 * (sectors.length + 1))
  file.set(header.done())
  sectors.forEach((sector, index) => {
    file.set(sector, 512 * (index + 1))
  })
  return file
}

describe('a compound file', () => {
  it('gives its streams by name whatever their capitals, small and large ones alike', () => {
    const large = new Uint8Array(5000).map((_, index) => index % 251)
    const file = openCompound(compound({ Small: new Uint8Array([1, 2, 3]), Large: large, Empty: new Uint8Array() }))
    expect(file.stream('small')).toEqual(new Uint8Array([1, 2, 3]))
    expect(file.stream('LARGE')).toEqual(large)
    expect(file.stream('Empty')).toEqual(new Uint8Array())
    expect(file.stream('Missing')).toBeUndefined()
  })

  it('gives the streams of its storages, and the storages within them', () => {
    const large = new Uint8Array(5000).map((_, index) => index % 13)
    const file = openCompound(compound({ Top: new Uint8Array([9]), ObjectPool: { _12: { Workbook: large, Small: new Uint8Array([4]) }, Empty: {} } }))
    expect(file.storage('objectpool')?.storage('_12')?.stream('WORKBOOK')).toEqual(large)
    expect(file.storage('ObjectPool')?.storage('_12')?.stream('Small')).toEqual(new Uint8Array([4]))
    expect(file.storage('ObjectPool')?.storage('Empty')?.stream('Small')).toBeUndefined()
    expect(file.storage('ObjectPool')?.stream('_12')).toBeUndefined()
    expect(file.storage('Top')).toBeUndefined()
    expect(file.storage('Missing')).toBeUndefined()
    expect(file.stream('Top')).toEqual(new Uint8Array([9]))
  })

  it('says a file is not one, or is damaged, in a sentence', () => {
    expect(() => openCompound(new Uint8Array(1024))).toThrow('not a file of the older Office formats')
    const file = compound({ Small: new Uint8Array([1, 2, 3]) })
    // A file cut short, its table of sectors past its end.
    const short = file.slice(0, 512 * 2)
    expect(() => openCompound(short)).toThrow('damaged')
  })
})

/** A preview without the look of its document or its sheets, which `older-word-look.test.ts` and `older-sheet-look.test.ts` check. */
function textual(preview: OfficePreview): OfficePreview {
  if (preview.kind === 'workbook') return { ...preview, sheets: preview.sheets.map(({ look: _look, ...sheet }) => sheet) }
  if (preview.kind !== 'document') return preview
  const { look: _look, ...rest } = preview
  return rest
}

/** A Word paragraph's properties as they are written: its style, then each property's code and operand. */
function formatting(style: number, properties: [code: number, operand: number[]][] = []): number[] {
  const bytes = new Bytes().u16(style)
  for (const [code, operand] of properties) bytes.u16(code).raw(operand)
  return [...bytes.done()]
}
const IN_TABLE: [number, number[]] = [0x2416, [1]]
const ROW_END: [number, number[]] = [0x2417, [1]]

/** Where a picture floating over a Word document's text is kept in its main stream, past its pages. */
const BLIP_AT = 5 * 512

/** What a Word document holds for its pictures: its runs of characters, its `Data` stream, its floating shapes. */
interface WordPictures {
  runs: { start: number; end: number; properties: Uint8Array }[]
  data: Uint8Array
  anchors: { character: number; shape: number; corners: [number, number, number, number] }[]
  drawings: Uint8Array
  blip: Uint8Array
  objects?: Tree
}

/**
 * A Word 97 document of paragraphs, each with its formatting: its text in a UTF-16 piece, but the last paragraph's,
 * which is in an 8-bit piece, as Word writes text it can. A style sheet names style 1 a heading. Its pictures, when
 * given, are in a page of character runs after the paragraphs', its `Data` stream and its table stream.
 */
function wordDocument(paragraphs: { text: string; format: number[] }[], encrypted = false, pictures?: WordPictures): Uint8Array {
  const TEXT_AT = 1024
  const PAGE = 3
  const wideText = paragraphs
    .slice(0, -1)
    .map((one) => one.text)
    .join('')
  const narrowText = paragraphs.at(-1)?.text ?? ''
  const narrowAt = TEXT_AT + wideText.length * 2

  const word = new Bytes()
    .u16(0xa5ec)
    .u16(0xc1)
    .zeros(6)
    .u16(0x0200 | (encrypted ? 0x0100 : 0))
  word.padTo(32).u16(14).zeros(28).u16(22)
  const longs = word.length
  word.zeros(88)
  word.set32(longs + 12, wideText.length + narrowText.length)
  const pairsAt = word.length + 2
  word.u16(93).zeros(93 * 8)
  word.padTo(TEXT_AT).wide(wideText).narrow(narrowText)

  // The page of paragraph runs: where each paragraph is in the file, and its formatting.
  word.padTo(PAGE * 512)
  const page = new Uint8Array(512)
  const pageView = new DataView(page.buffer)
  let fc = TEXT_AT
  const bounds = paragraphs.map((one, index) => {
    const start = fc
    fc += one.text.length * (index === paragraphs.length - 1 ? 1 : 2)
    return [start, fc] as const
  })
  pageView.setUint32(0, bounds[0]?.[0] ?? TEXT_AT, true)
  bounds.forEach(([, end], index) => {
    pageView.setUint32((index + 1) * 4, end, true)
  })
  let free = 510
  paragraphs.forEach((one, index) => {
    const length = one.format.length % 2 === 1 ? one.format.length : one.format.length + 1
    free -= length + 1
    free -= free % 2
    page[free] = (length + 1) / 2
    page.set(one.format, free + 1)
    page[(paragraphs.length + 1) * 4 + index * 13] = free / 2
  })
  page[511] = paragraphs.length
  word.raw(page)
  if (pictures) {
    // The page of character runs: where each starts, then the place of its properties, each a size and its codes.
    const runs = new Uint8Array(512)
    const runsView = new DataView(runs.buffer)
    const { runs: given } = pictures
    given.forEach((run, index) => {
      runsView.setUint32(index * 4, run.start, true)
    })
    runsView.setUint32(given.length * 4, given.at(-1)?.end ?? TEXT_AT, true)
    let end = 510
    given.forEach((run, index) => {
      if (run.properties.length === 0) return
      end -= run.properties.length + 1
      end -= end % 2
      runs[end] = run.properties.length
      runs.set(run.properties, end + 1)
      runs[(given.length + 1) * 4 + index] = end / 2
    })
    runs[511] = given.length
    word.raw(runs)
    word.padTo(BLIP_AT).raw(pictures.blip)
  }

  const table = new Bytes()
  const clx = table.length
  const pieces = narrowText === '' ? 1 : 2
  table.u8(2).u32(4 * (pieces + 1) + 8 * pieces)
  table.u32(0).u32(wideText.length)
  if (pieces === 2) table.u32(wideText.length + narrowText.length)
  table.u16(0).u32(TEXT_AT).u16(0)
  if (pieces === 2)
    table
      .u16(0)
      .u32((narrowAt * 2) | 0x40000000)
      .u16(0)
  const clxSize = table.length - clx
  const styles = table.length
  table.u16(4).u16(2).u16(2)
  // Style 0, "Normal", and style 1, "heading 1", known by its built-in number.
  table.u16(2).u16(0)
  table.u16(2).u16(1)
  const stylesSize = table.length - styles
  const papx = table.length
  table
    .u32(bounds[0]?.[0] ?? TEXT_AT)
    .u32(bounds.at(-1)?.[1] ?? TEXT_AT)
    .u32(PAGE)
  const papxSize = table.length - papx
  const chpx = table.length
  const spa = table.length + 12
  const drawingsAt = spa + 4 * ((pictures?.anchors.length ?? 0) + 1) + 26 * (pictures?.anchors.length ?? 0)
  if (pictures) {
    table
      .u32(pictures.runs[0]?.start ?? TEXT_AT)
      .u32(pictures.runs.at(-1)?.end ?? TEXT_AT)
      .u32(PAGE + 1)
    for (const anchor of pictures.anchors) table.u32(anchor.character)
    table.u32(fc)
    for (const { shape, corners } of pictures.anchors) {
      table.u32(shape)
      for (const corner of corners) table.u32(corner)
      table.u16(0).u32(0)
    }
    table.raw(pictures.drawings)
  }

  const document = word.done()
  const pair = (index: number, at: number, size: number) => {
    const view = new DataView(document.buffer)
    view.setUint32(pairsAt + index * 8, at, true)
    view.setUint32(pairsAt + index * 8 + 4, size, true)
  }
  pair(1, styles, stylesSize)
  pair(13, papx, papxSize)
  pair(33, clx, clxSize)
  if (!pictures) return compound({ WordDocument: document, '1Table': table.done() })
  pair(12, chpx, 12)
  pair(40, spa, drawingsAt - spa)
  pair(50, drawingsAt, pictures.drawings.length)
  return compound({ WordDocument: document, '1Table': table.done(), Data: pictures.data, ...(pictures.objects ? { ObjectPool: pictures.objects } : {}) })
}

/**
 * The stream of a chart of Microsoft Graph: its sheet of data in Excel 2's records, the categories along its first
 * row and each series along a row after it, then the chart's records, a bar chart of two series named in text.
 */
function graphStream(): Uint8Array {
  const label = (row: number, column: number, text: string) => record(0x0004, new Bytes().u16(row).u16(column).zeros(3).u8(text.length).u8(0).narrow(text))
  const number = (row: number, column: number, value: number) => record(0x0003, new Bytes().u16(row).u16(column).zeros(3).f64(value))
  const series = (name: string) => [
    record(0x1003, new Bytes().zeros(12)),
    record(0x1033, new Uint8Array()),
    record(0x100d, new Bytes().u16(0).u8(name.length).u8(0).narrow(name)),
    record(0x1034, new Uint8Array())
  ]
  const parts = [
    record(0x0809, new Bytes().u16(0x0680).u16(0x0005).zeros(12)),
    record(0x000a, new Uint8Array()),
    record(0x0809, new Bytes().u16(0x0680).u16(0x8000).zeros(12)),
    label(0, 1, 'Q1'),
    label(0, 2, 'Q2'),
    label(1, 0, 'East'),
    number(1, 1, 20.4),
    number(1, 2, 27.4),
    label(2, 0, 'West'),
    number(2, 1, 30.6),
    number(2, 2, 38.6),
    record(0x1017, new Bytes().zeros(6)),
    ...series('East'),
    ...series('West'),
    record(0x000a, new Uint8Array())
  ]
  const all = new Bytes()
  for (const part of parts) all.raw(part)
  return all.done()
}

/** The chart `graphStream` draws. */
const GRAPH_CHART = {
  kind: 'chart',
  title: '',
  chart: 'bar',
  series: [
    {
      name: 'East',
      points: [
        { x: 'Q1', y: 20.4 },
        { x: 'Q2', y: 27.4 }
      ]
    },
    {
      name: 'West',
      points: [
        { x: 'Q1', y: 30.6 },
        { x: 'Q2', y: 38.6 }
      ]
    }
  ]
}

/** A picture of the store, as OfficeArt keeps one: an identifier, a tag, then its bytes. */
const blipOf = (type: number, instance: number, bytes: readonly number[]) => atom(type, new Bytes().zeros(16).u8(0xff).raw(bytes), instance)
/** An entry of the store for a picture, which it keeps, or whose place it gives in another stream. */
const storeEntry = (kept: Uint8Array, delay = 0) =>
  atom(0xf007, new Bytes().u8(6).u8(6).zeros(16).u16(0).u32(kept.length).u32(1).u32(delay).zeros(4).raw(kept), 6)
/** A shape of a drawing: its identifier and flags, then the picture it shows and its description, and its anchor. */
function artShape(id: number, flags: number, picture?: number, description?: string, anchor?: Bytes): Uint8Array {
  const properties = new Bytes()
  const words = description === undefined ? undefined : new Bytes().wide(`${description}\0`).done()
  if (picture !== undefined) properties.u16(0x4104).u32(picture)
  if (words) properties.u16(0x8381).u32(words.length).raw(words)
  const count = (picture === undefined ? 0 : 1) + (words ? 1 : 0)
  return container(0xf004, [
    atom(0xf00a, new Bytes().u32(id).u32(flags), 75),
    ...(count > 0 ? [atom(0xf00b, properties, count)] : []),
    ...(anchor ? [atom(0xf010, anchor)] : [])
  ])
}
/** A drawing of shapes, in their group, after the group's own shape. */
const artDrawing = (...shapes: Uint8Array[]) => container(0xf002, [atom(0xf008, new Bytes().zeros(8)), container(0xf003, [artShape(1024, 0x05), ...shapes])])
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]

/**
 * The `Equation Native` stream of an object of Equation Editor 3 holding x²: its header of 28 bytes, then MTEF 3's
 * records, a line holding x and a template of a power after it.
 */
const EQUATION = (() => {
  const mtef = [3, 1, 1, 3, 10, 10, 0x01, 0x02, 0x83, 0x78, 0, 0x03, 15, 0, 0, 0x11, 0x01, 0x02, 0x88, 0x32, 0, 0, 0, 0, 0]
  return new Bytes().u16(28).u32(0x20000).u16(0).u32(mtef.length).zeros(16).raw(mtef).done()
})()

/** A ZIP archive of the parts given, stored as they are: enough of the format for a reader. */
function storedZip(parts: Record<string, string | Uint8Array>): Uint8Array {
  const local = new Bytes()
  const central = new Bytes()
  const named = Object.entries(parts)
  for (const [name, content] of named) {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const offset = local.length
    local.u32(0x04034b50).zeros(14).u32(data.length).u32(data.length).u16(name.length).u16(0).narrow(name).raw(data)
    central.u32(0x02014b50).zeros(16).u32(data.length).u32(data.length).u16(name.length).zeros(12).u32(offset).narrow(name)
  }
  const directory = central.done()
  return new Bytes()
    .raw(local.done())
    .raw(directory)
    .u32(0x06054b50)
    .zeros(4)
    .u16(named.length)
    .u16(named.length)
    .u32(directory.length)
    .u32(local.length)
    .u16(0)
    .done()
}

describe('an object of another app in a document or a presentation', () => {
  const object = compound({ 'Equation Native': EQUATION })

  it('writes a document’s as linear text in its place, and as its picture’s words in its look', async () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">Area: </w:t></w:r><w:r><w:object><v:shape style="width:20pt;height:12pt"><v:imagedata r:id="rId1" o:title=""/></v:shape>' +
      '<o:OLEObject Type="Embed" ProgID="Equation.3" r:id="rId2"/></w:object></w:r><w:r><w:t xml:space="preserve"> here</w:t></w:r></w:p>'
    const file = storedZip({
      'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="media/image1.png"/><Relationship Id="rId2" Target="embeddings/oleObject1.bin"/></Relationships>',
      'word/media/image1.png': new Uint8Array(PNG),
      'word/embeddings/oleObject1.bin': object
    })
    const preview = await readOffice('docx', file)
    expect(preview).toMatchObject({ markdown: 'Area: x² here' })
    const spans = preview.kind === 'document' ? preview.look?.pages[0]?.bands[0]?.blocks[0] : undefined
    expect(spans).toMatchObject({ spans: [{ text: 'Area: ' }, { placed: { alt: 'x²' } }, { text: ' here' }] })
  })

  it('shows a worksheet of Excel held in a document as its sheet: the block its object shows, of the sheet it was left on', async () => {
    const cellsOf = (...cells: [string, string][]) => cells.map(([at, text]) => `<c r="${at}" t="inlineStr"><is><t>${text}</t></is></c>`).join('')
    const workbook = storedZip({
      'xl/workbook.xml':
        '<workbook><bookViews><workbookView activeTab="1"/></bookViews><sheets><sheet name="Notes" r:id="rId1"/><sheet name="Costs" r:id="rId2"/></sheets><oleSize ref="B1:C2"/></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${cellsOf(['A1', 'Draft'])}</row></sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml': `<worksheet><sheetData><row r="1">${cellsOf(['A1', 'Item'], ['B1', 'Q1'], ['C1', 'Q2'], ['D1', 'Note'])}</row><row r="2">${cellsOf(['A2', 'Tea'], ['B2', '10'], ['C2', '12'])}</row><row r="3">${cellsOf(['B3', 'Left out'])}</row></sheetData></worksheet>`
    })
    const body =
      '<w:p><w:r><w:object><v:shape style="width:75pt;height:30pt"><v:imagedata r:id="rId1" o:title=""/></v:shape>' +
      '<o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" r:id="rId2"/></w:object></w:r></w:p>'
    const file = storedZip({
      'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="media/image1.png"/><Relationship Id="rId2" Target="embeddings/Microsoft_Excel_Worksheet.xlsx"/></Relationships>',
      'word/media/image1.png': new Uint8Array(PNG),
      'word/embeddings/Microsoft_Excel_Worksheet.xlsx': workbook
    })
    const preview = await readOffice('docx', file)
    expect(preview).toMatchObject({
      markdown: '![](figure:0)',
      figures: [
        {
          kind: 'sheet',
          name: 'Costs',
          rows: [
            ['Q1', 'Q2'],
            ['10', '12']
          ],
          look: { headings: false }
        }
      ]
    })
    // In its look, in the place of its picture, at the size its picture is given.
    const opening = preview.kind === 'document' ? preview.look?.pages[0]?.bands[0]?.blocks[0] : undefined
    expect(opening).toMatchObject({ spans: [{ placed: { figure: 0, width: 75, height: 30 } }] })
  })

  it('shows a worksheet of Excel 97 held in a Word 97 document as its sheet, and its picture when it holds pictures', async () => {
    const text = '\x13 EMBED Excel.Sheet.8 \x14\x01\x15\r'
    const separator = 1024 + text.indexOf('\x14') * 2
    const shape = artShape(1026, 0x0a00, 1)
    const entry = storeEntry(blipOf(0xf01e, 0x6e0, PNG))
    const data = new Bytes()
      .u32(68 + shape.length + entry.length)
      .u16(68)
      .u16(0x64)
      .padTo(68)
      .raw(shape)
      .raw(entry)
      .done()
    const object = new Bytes().u16(0x080a).u8(1).u16(0x0855).u8(1).u16(0x6a03).u32(79).done()
    const picture = new Bytes().u16(0x6a03).u32(0).u16(0x0855).u8(1).done()
    const document = (book: Uint8Array) =>
      wordDocument(
        [
          { text, format: formatting(0) },
          { text: 'End\r', format: formatting(0) }
        ],
        false,
        {
          runs: [
            { start: 1024, end: separator, properties: new Uint8Array() },
            { start: separator, end: separator + 2, properties: object },
            { start: separator + 2, end: separator + 4, properties: picture }
          ],
          data,
          anchors: [],
          drawings: new Uint8Array(),
          blip: new Uint8Array(),
          objects: { _79: { Workbook: openCompound(book).stream('Workbook') as Uint8Array } }
        }
      )
    const read = await readOffice('doc', document(workbook()))
    // Without a block named, the cells it uses.
    const rows = [
      ['Item', '', 'Paid'],
      ['Hôtel', '42.5', 'TRUE'],
      ['', '', ''],
      ['1.2', '7', '-3'],
      ['', '', ''],
      ['ok', '162.5', '#DIV/0!']
    ]
    expect(read).toMatchObject({ markdown: '![](figure:0)\n\nEnd', figures: [{ kind: 'sheet', name: 'Budget', rows }] })
    const pictured = await readOffice('doc', document(picturedWorkbook()))
    expect(pictured).toMatchObject({ figures: [{ kind: 'picture', type: 'image/png' }] })
  })

  it('shows a document of Word held in a document by its text, quoted after its paragraph, the text its picture’s words', async () => {
    const held = storedZip({
      'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>Minutes</w:t></w:r></w:p><w:p><w:r><w:t>All agreed.</w:t></w:r></w:p></w:body></w:document>`
    })
    const body =
      '<w:p><w:r><w:t xml:space="preserve">See: </w:t></w:r><w:r><w:object><v:shape style="width:75pt;height:30pt"><v:imagedata r:id="rId1" o:title=""/></v:shape>' +
      '<o:OLEObject Type="Embed" ProgID="Word.Document.12" r:id="rId2"/></w:object></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p>'
    const file = storedZip({
      'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="media/image1.png"/><Relationship Id="rId2" Target="embeddings/Microsoft_Word_Document.docx"/></Relationships>',
      'word/media/image1.png': new Uint8Array(PNG),
      'word/embeddings/Microsoft_Word_Document.docx': held
    })
    const preview = await readOffice('docx', file)
    expect(preview).toMatchObject({ markdown: 'See:\n\n> Minutes\n>\n> All agreed.\n\nAfter' })
    const opening = preview.kind === 'document' ? preview.look?.pages[0]?.bands[0]?.blocks[0] : undefined
    expect(opening).toMatchObject({ spans: [{ text: 'See: ' }, { placed: { alt: 'Minutes All agreed.' } }] })
  })

  it('shows a document of Word 97 held in a Word 97 document or a presentation by its text', async () => {
    // The document held: a Word 97 document's streams, kept as a storage of the other, its program named.
    const inner = openCompound(
      wordDocument([
        { text: 'Minutes\r', format: formatting(0) },
        { text: 'All agreed.\r', format: formatting(0) }
      ])
    )
    const named = new Bytes().zeros(28).u32(16).narrow('Word.Document.8').u8(0).done()
    const storage = {
      WordDocument: inner.stream('WordDocument') as Uint8Array,
      '1Table': (inner.stream('1Table') ?? inner.stream('0Table')) as Uint8Array,
      '\x01CompObj': named
    }
    const text = 'Notes \x13 EMBED Word.Document.8 \x14\x01\x15\r'
    const separator = 1024 + text.indexOf('\x14') * 2
    const shape = artShape(1026, 0x0a00, 1)
    const entry = storeEntry(blipOf(0xf01e, 0x6e0, PNG))
    const data = new Bytes()
      .u32(68 + shape.length + entry.length)
      .u16(68)
      .u16(0x64)
      .padTo(68)
      .raw(shape)
      .raw(entry)
      .done()
    const object = new Bytes().u16(0x080a).u8(1).u16(0x0855).u8(1).u16(0x6a03).u32(80).done()
    const picture = new Bytes().u16(0x6a03).u32(0).u16(0x0855).u8(1).done()
    const file = wordDocument(
      [
        { text, format: formatting(0) },
        { text: 'End\r', format: formatting(0) }
      ],
      false,
      {
        runs: [
          { start: 1024, end: separator, properties: new Uint8Array() },
          { start: separator, end: separator + 2, properties: object },
          { start: separator + 2, end: separator + 4, properties: picture }
        ],
        data,
        anchors: [],
        drawings: new Uint8Array(),
        blip: new Uint8Array(),
        objects: { _80: storage }
      }
    )
    expect(await readOffice('doc', file)).toMatchObject({ markdown: 'Notes\n\n> Minutes\n>\n> All agreed.\n\nEnd' })
    const read = await readOffice('ppt', presentation(false, false, await packedObject(compound(storage))))
    expect(read.kind === 'presentation' ? read.slides[1]?.lines : undefined).toEqual(['Minutes', 'All agreed.'])
  })

  it('writes a slide’s as a line of its text, a document’s text as lines, and leaves another object to its picture', async () => {
    const frame = (id: string, program: string) =>
      `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="Object" r:id="${id}" progId="${program}"><p:embed/></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`
    const file = storedZip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': `<p:sld><p:cSld><p:spTree>${frame('rId2', 'Equation.DSMT4')}${frame('rId3', 'Excel.Sheet.8')}${frame('rId4', 'Word.Document.12')}</p:spTree></p:cSld></p:sld>`,
      'ppt/slides/_rels/slide1.xml.rels':
        '<Relationships><Relationship Id="rId2" Target="../embeddings/oleObject1.bin"/><Relationship Id="rId3" Target="../embeddings/oleObject2.bin"/><Relationship Id="rId4" Target="../embeddings/Document.docx"/></Relationships>',
      'ppt/embeddings/oleObject1.bin': object,
      'ppt/embeddings/oleObject2.bin': object,
      'ppt/embeddings/Document.docx': storedZip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Agenda</w:t></w:r></w:p></w:body></w:document>' })
    })
    // A document held is the lines of its text.
    expect(await readOffice('pptx', file)).toMatchObject({ slides: [{ title: '', lines: ['x²', 'Agenda'] }] })
  })
})
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]

describe('a Word 97 document', () => {
  it('reads its headings, paragraphs, fields, lists and tables, from both kinds of piece', async () => {
    const file = wordDocument([
      { text: 'Trip to Lyon\r', format: formatting(1) },
      { text: 'We leave on Friday, \x13 PAGE \\* MERGEFORMAT \x141\x15 café\x0bat 9.\r', format: formatting(0) },
      {
        text: 'Coat\r',
        format: formatting(0, [
          [0x460b, [1, 0]],
          [0x260a, [1]]
        ])
      },
      { text: 'Day\x07', format: formatting(0, [IN_TABLE]) },
      { text: 'Plan\x07', format: formatting(0, [IN_TABLE]) },
      { text: '\x07', format: formatting(0, [IN_TABLE, ROW_END]) },
      { text: 'Friday\x07', format: formatting(0, [IN_TABLE]) },
      { text: '\x07', format: formatting(0, [IN_TABLE]) },
      { text: '\x07', format: formatting(0, [IN_TABLE, ROW_END]) },
      { text: 'The end, \xe9t\xe9 \x93here\x94.\r', format: formatting(0) }
    ])
    const preview = await readOlderWord(file)
    expect(textual(preview)).toEqual({
      kind: 'document',
      markdown: [
        '# Trip to Lyon',
        'We leave on Friday, 1 café  \nat 9.',
        '  - Coat',
        '| Day | Plan |\n| --- | --- |\n| Friday |  |',
        'The end, été “here”.'
      ].join('\n\n'),
      figures: [],
      cut: false
    })
    // Its look, read from the same records: a heading, a page's number for its field, a table of two rows.
    const blocks = preview.kind === 'document' ? preview.look?.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks)) : undefined
    expect(blocks?.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'paragraph', 'table', 'paragraph'])
    expect(blocks?.[0]).toMatchObject({ heading: 1, spans: [{ text: 'Trip to Lyon' }] })
    expect(blocks?.[1]).toMatchObject({ spans: [{ text: 'We leave on Friday, ' }, { field: 'page' }, { text: ' café' }, { break: true }, { text: 'at 9.' }] })
    expect((blocks?.[3] as DocumentTable | undefined)?.rows.map((row) => row.cells.length)).toEqual([2, 2])
    expect(blocks?.[4]).toMatchObject({ spans: [{ text: 'The end, été “here”.' }] })
  })

  it('shows its pictures where they are: in the text, floating over it, and an embedded chart as one its app draws', async () => {
    const first = 'Our cat \x01 and a view \x08.\r'
    const last = '\x13 EMBED MSGraph.Chart.8 \x14\x01\x15\r'
    const inText = 1024 + first.indexOf('\x01') * 2
    const narrowAt = 1024 + first.length * 2
    const chart = narrowAt + last.indexOf('\x01')
    // In the text: its header, of 1,440 by 720 twentieths of a point at 100% and 50%, then its shape and its entry.
    const shape = artShape(1026, 0x0a00, 7, 'A cat')
    const entry = storeEntry(blipOf(0xf01e, 0x6e0, PNG))
    const data = new Bytes()
      .u32(68 + shape.length + entry.length)
      .u16(68)
      .u16(0x64)
      .padTo(0x1c)
      .u16(1440)
      .u16(720)
      .u16(1000)
      .u16(500)
      .padTo(68)
      .raw(shape)
      .raw(entry)
      .done()
    const drawings = new Bytes()
      .raw(container(0xf000, [atom(0xf006, new Bytes().zeros(16)), container(0xf001, [storeEntry(new Uint8Array(), BLIP_AT)])]))
      .u8(0)
      .raw(artDrawing(artShape(1025, 0x0a00, 1)))
      .done()
    const picture = new Bytes().u16(0x6a03).u32(0).u16(0x0855).u8(1).done()
    const object = new Bytes().u16(0x080a).u8(1).u16(0x0855).u8(1).u16(0x6a03).u32(1234).done()
    const file = wordDocument(
      [
        { text: first, format: formatting(0) },
        { text: last, format: formatting(0) }
      ],
      false,
      {
        runs: [
          { start: 1024, end: inText, properties: new Uint8Array() },
          { start: inText, end: inText + 2, properties: picture },
          { start: inText + 2, end: chart, properties: new Uint8Array() },
          { start: chart, end: chart + 1, properties: object }
        ],
        data,
        anchors: [{ character: first.indexOf('\x08'), shape: 1025, corners: [0, 0, 2880, 1440] }],
        drawings,
        blip: blipOf(0xf01d, 0x46a, JPEG)
      }
    )
    const preview = await readOlderWord(file)
    expect(textual(preview)).toEqual({
      kind: 'document',
      markdown: 'Our cat ![A cat](figure:0) and a view ![](figure:1).\n\n![](figure:2)',
      figures: [
        { kind: 'picture', type: 'image/png', bytes: new Uint8Array(PNG), alt: 'A cat', width: 96, height: 24 },
        { kind: 'picture', type: 'image/jpeg', bytes: new Uint8Array(JPEG), alt: '', width: 192, height: 96 },
        { kind: 'unshown', alt: '', what: 'chart' }
      ],
      cut: false
    })
    // In its look, the same figures: one in its line at its size in points, one floating at the side its anchor is nearer.
    const opening = preview.kind === 'document' ? preview.look?.pages[0]?.bands[0]?.blocks[0] : undefined
    expect(opening).toMatchObject({
      spans: [
        { text: 'Our cat ' },
        { placed: { figure: 0, width: 72, height: 18 } },
        { text: ' and a view ' },
        { placed: { figure: 1, width: 144, height: 72, float: 'left' } },
        { text: '.' }
      ]
    })
  })

  it('draws an embedded chart from its object’s storage when its picture is a metafile the window does not show', async () => {
    const text = '\x13 EMBED MSGraph.Chart.8 \x14\x01\x15\r'
    const separator = 1024 + text.indexOf('\x14') * 2
    const shape = artShape(1026, 0x0a00, 1)
    const entry = storeEntry(atom(0xf01a, new Bytes().zeros(60), 0x3d4))
    const data = new Bytes()
      .u32(68 + shape.length + entry.length)
      .u16(68)
      .u16(0x64)
      .padTo(68)
      .raw(shape)
      .raw(entry)
      .done()
    const object = new Bytes().u16(0x080a).u8(1).u16(0x0855).u8(1).u16(0x6a03).u32(77).done()
    const picture = new Bytes().u16(0x6a03).u32(0).u16(0x0855).u8(1).done()
    const file = wordDocument(
      [
        { text, format: formatting(0) },
        { text: 'End\r', format: formatting(0) }
      ],
      false,
      {
        runs: [
          { start: 1024, end: separator, properties: new Uint8Array() },
          { start: separator, end: separator + 2, properties: object },
          { start: separator + 2, end: separator + 4, properties: picture }
        ],
        data,
        anchors: [],
        drawings: new Uint8Array(),
        blip: new Uint8Array(),
        objects: { _77: { Workbook: graphStream() } }
      }
    )
    expect(textual(await readOlderWord(file))).toEqual({ kind: 'document', markdown: '![](figure:0)\n\nEnd', figures: [GRAPH_CHART], cut: false })
  })

  it('writes an equation of Equation Editor as linear text in its place, and as its picture’s words in its look', async () => {
    const text = 'Area: \x13 EMBED Equation.3 \x14\x01\x15 here\r'
    const separator = 1024 + text.indexOf('\x14') * 2
    const shape = artShape(1026, 0x0a00, 1)
    const entry = storeEntry(blipOf(0xf01e, 0x6e0, PNG))
    const data = new Bytes()
      .u32(68 + shape.length + entry.length)
      .u16(68)
      .u16(0x64)
      .padTo(68)
      .raw(shape)
      .raw(entry)
      .done()
    const object = new Bytes().u16(0x080a).u8(1).u16(0x0855).u8(1).u16(0x6a03).u32(78).done()
    const picture = new Bytes().u16(0x6a03).u32(0).u16(0x0855).u8(1).done()
    const file = wordDocument(
      [
        { text, format: formatting(0) },
        { text: 'End\r', format: formatting(0) }
      ],
      false,
      {
        runs: [
          { start: 1024, end: separator, properties: new Uint8Array() },
          { start: separator, end: separator + 2, properties: object },
          { start: separator + 2, end: separator + 4, properties: picture }
        ],
        data,
        anchors: [],
        drawings: new Uint8Array(),
        blip: new Uint8Array(),
        objects: { _78: { 'Equation Native': EQUATION } }
      }
    )
    const preview = await readOlderWord(file)
    expect(textual(preview)).toMatchObject({ markdown: 'Area: x² here\n\nEnd' })
    const opening = preview.kind === 'document' ? preview.look?.pages[0]?.bands[0]?.blocks[0] : undefined
    expect(opening).toMatchObject({ spans: [{ text: 'Area: ' }, { placed: { figure: 0, alt: 'x²' } }, { text: ' here' }] })
  })

  it('says when it is protected with a password, or is not one', async () => {
    await expect(readOlderWord(wordDocument([{ text: 'Secret\r', format: formatting(0) }], true))).rejects.toThrow('protected with a password')
    await expect(readOlderWord(compound({ Other: new Uint8Array(8) }))).rejects.toThrow('not a Word document')
    await expect(readOffice('doc', new Uint8Array(10))).rejects.toThrow('not a file of the older Office formats')
  })

  it('says a newer Word, Excel or PowerPoint file is protected, as one is kept encrypted in a compound file', async () => {
    const encrypted = compound({ EncryptionInfo: new Uint8Array(8), EncryptedPackage: new Uint8Array(16) })
    for (const extension of ['docx', 'xlsx', 'pptx']) await expect(readOffice(extension, encrypted)).rejects.toThrow('protected with a password')
    await expect(readOffice('docx', compound({ Other: new Uint8Array(8) }))).rejects.toThrow('not a ZIP archive')
  })
})

/** "Привет" (hello) and "мир" (world) in Windows' Cyrillic code page, as Word 6 wrote Russian. */
const HELLO = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]
const WORLD = [0xec, 0xe8, 0xf0]

/**
 * A Word 6 or 95 document of paragraphs, each its bytes and its formatting with one-byte property codes, all in one
 * stream: its text whole from where the header says, or in a piece when saved quickly. A style sheet names style 1 a
 * heading, with 8-bit names.
 */
function sixDocument(
  paragraphs: { bytes: number[]; format: number[] }[],
  options: { quick?: boolean; encrypted?: boolean; language?: number } = {}
): Uint8Array {
  const TEXT_AT = 1024
  const PAGE = 3
  const text = paragraphs.flatMap((one) => one.bytes)
  const word = new Bytes()
    .u16(0xa5dc)
    .u16(0x65)
    .u16(0)
    .u16(options.language ?? 0x0419)
    .u16(0)
    .u16((options.quick ? 0x0004 : 0) | (options.encrypted ? 0x0100 : 0))
  word.padTo(0x200)
  word.padTo(TEXT_AT).raw(text)
  word.padTo(PAGE * 512)
  const page = new Uint8Array(512)
  const pageView = new DataView(page.buffer)
  let fc = TEXT_AT
  pageView.setUint32(0, fc, true)
  paragraphs.forEach((one, index) => {
    fc += one.bytes.length
    pageView.setUint32((index + 1) * 4, fc, true)
  })
  let free = 510
  paragraphs.forEach((one, index) => {
    const length = one.format.length % 2 === 1 ? one.format.length : one.format.length + 1
    free -= length + 1
    free -= free % 2
    page[free] = (length + 1) / 2
    page.set(one.format, free + 1)
    page[(paragraphs.length + 1) * 4 + index * 7] = free / 2
  })
  page[511] = paragraphs.length
  word.raw(page)
  const styles = word.length
  // Style 0, "Normal", and style 1, its built-in number a heading's, named in 8 bits.
  word.u16(4).u16(2).u16(2)
  word.u16(2).u16(0)
  word.u16(10).u16(1).u8(7).narrow('Heading')
  const stylesSize = word.length - styles
  const papx = word.length
  word.u32(TEXT_AT).u32(fc).u16(PAGE)
  const papxSize = word.length - papx
  const clx = word.length
  if (options.quick)
    word
      .u8(1)
      .u16(2)
      .u16(0)
      .u8(2)
      .u32(4 * 2 + 8)
      .u32(0)
      .u32(text.length)
      .u16(0)
      .u32(TEXT_AT)
      .u16(0)
  const clxSize = word.length - clx
  const document = word.done()
  const view = new DataView(document.buffer)
  view.setUint32(0x18, TEXT_AT, true)
  view.setUint32(0x34, text.length, true)
  view.setUint32(0x60, styles, true)
  view.setUint32(0x64, stylesSize, true)
  view.setUint32(0xc0, papx, true)
  view.setUint32(0xc4, papxSize, true)
  view.setUint32(0x160, clx, true)
  view.setUint32(0x164, clxSize, true)
  view.setUint16(0x190, 1, true)
  return compound({ WordDocument: document })
}

/** A paragraph's properties in Word 6: its style, then one-byte codes and their operands. */
const sixFormatting = (style: number, ...properties: number[][]) => [style & 0xff, style >> 8, ...properties.flat()]

describe('a Word 6 or 95 document', () => {
  const paragraphs = [
    { bytes: [...HELLO, 0x0d], format: sixFormatting(1) },
    { bytes: [...HELLO, 0x20, ...WORLD, 0x0b, 0x31, 0x0d], format: sixFormatting(0, [5, 1], [17, 0x40, 0x01]) },
    { bytes: [...WORLD, 0x0d], format: sixFormatting(0, [13, 10]) },
    { bytes: [0x41, 0x07], format: sixFormatting(0, [24, 1]) },
    { bytes: [0x42, 0x07], format: sixFormatting(0, [24, 1]) },
    { bytes: [0x07], format: sixFormatting(0, [24, 1], [25, 1]) },
    { bytes: [0x45, 0x6e, 0x64, 0x0d], format: sixFormatting(0) }
  ]
  const expected = ['# Привет', 'Привет мир  \n1', '- мир', '| A | B |\n| --- | --- |', 'End'].join('\n\n')

  it('reads its text in the code page of its language, its headings, lists and tables, saved whole or quickly', async () => {
    for (const quick of [false, true])
      expect(textual(await readOlderWord(sixDocument(paragraphs, { quick })))).toEqual({ kind: 'document', markdown: expected, figures: [], cut: false })
  })

  it('says when it is protected with a password', async () => {
    await expect(readOlderWord(sixDocument(paragraphs, { encrypted: true }))).rejects.toThrow('protected with a password')
  })
})

/**
 * A Word 2 document of paragraphs, written straight into the file: its header, its text whole or in a piece when saved
 * quickly, a page of paragraph formats, and a style sheet of one built-in style and two of the document's own, the
 * second named "Title".
 */
function twoDocument(paragraphs: { bytes: number[]; format: number[] }[], options: { quick?: boolean; encrypted?: boolean; one?: boolean } = {}): Uint8Array {
  const TEXT_AT = 0x200
  const PAGE = 2
  const text = paragraphs.flatMap((one) => one.bytes)
  // Word 1 wrote its documents as Word 2 did, its quick save's pieces and its count of pages at places of their own.
  const word = new Bytes()
    .u16(options.one ? 0xa59b : 0xa5db)
    .u16(options.one ? 33 : 45)
    .u16(0)
    .u16(0x0409)
    .u16(0)
    .u16((options.quick ? 0x0004 : 0) | (options.encrypted ? 0x0100 : 0))
  word.padTo(TEXT_AT).raw(text)
  word.padTo(PAGE * 512)
  const page = new Uint8Array(512)
  const pageView = new DataView(page.buffer)
  let fc = TEXT_AT
  pageView.setUint32(0, fc, true)
  paragraphs.forEach((one, index) => {
    fc += one.bytes.length
    pageView.setUint32((index + 1) * 4, fc, true)
  })
  let free = 510
  paragraphs.forEach((one, index) => {
    const length = one.format.length % 2 === 1 ? one.format.length : one.format.length + 1
    free -= length + 1
    free -= free % 2
    page[free] = (length + 1) / 2
    page.set(one.format, free + 1)
    page[(paragraphs.length + 1) * 4 + index] = free / 2
  })
  page[511] = paragraphs.length
  word.raw(page)
  // One built-in style, so the document's own are codes 0 and 1; the names, then empty properties and the styles' links.
  const styles = word.length
  word
    .u16(1)
    .u16(2 + 1 + 1 + 1 + 5)
    .u8(0xff)
    .u8(0)
    .u8(5)
    .narrow('Title')
  word.u16(2).u16(2).u16(0)
  const stylesSize = word.length - styles
  const papx = word.length
  word.u32(TEXT_AT).u32(fc).u16(PAGE)
  const papxSize = word.length - papx
  const clx = word.length
  if (options.quick)
    word
      .u8(1)
      .u16(2)
      .u16(0)
      .u8(2)
      .u16(4 * 2 + 8)
      .u32(0)
      .u32(text.length)
      .u16(0)
      .u32(TEXT_AT)
      .u16(0)
  const clxSize = word.length - clx
  const document = word.done()
  const view = new DataView(document.buffer)
  view.setUint32(0x18, TEXT_AT, true)
  view.setUint32(0x34, text.length, true)
  view.setUint32(0x5e, styles, true)
  view.setUint16(0x62, stylesSize, true)
  view.setUint32(0xa6, papx, true)
  view.setUint16(0xaa, papxSize, true)
  view.setUint32(options.one ? 0x112 : 0x11e, clx, true)
  view.setUint16(options.one ? 0x116 : 0x122, clxSize, true)
  view.setUint16(options.one ? 0x190 : 0x144, 1, true)
  return document
}

/** A paragraph's properties in Word 2: its style's code, six bytes of its lines' heights, then one-byte codes and their operands. */
const twoFormatting = (style: number, ...properties: number[][]) => [style, 0, 0, 0, 0, 0, 0, ...properties.flat()]

const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0))

describe('a Word 2 document', () => {
  const paragraphs = [
    { bytes: [...ascii('Trip'), 0x0d], format: twoFormatting(253) },
    { bytes: [...ascii('Caf'), 0xe9, 0x0d], format: twoFormatting(0) },
    { bytes: [...ascii('Coat'), 0x0d], format: twoFormatting(0, [17, 0x40, 0x01], [70, 0, 0, 0], [3, 2, 0, 0], [20, 0xf0, 0x00], [58], [13, 10]) },
    { bytes: [0x41, 0x07], format: twoFormatting(0, [24, 1]) },
    { bytes: [0x42, 0x07], format: twoFormatting(0, [24, 1]) },
    { bytes: [0x07], format: twoFormatting(0, [24, 1], [25, 1]) },
    { bytes: [...ascii('Plan'), 0x0d], format: twoFormatting(1) },
    { bytes: [...ascii('End'), 0x0d], format: twoFormatting(0) }
  ]
  const expected = ['## Trip', 'Café', '- Coat', '| A | B |\n| --- | --- |', '# Plan', 'End'].join('\n\n')

  it('reads its headings, built in or named, its lists and tables, saved whole or quickly', async () => {
    for (const quick of [false, true])
      expect(textual(await readOlderWord(twoDocument(paragraphs, { quick })))).toEqual({ kind: 'document', markdown: expected, figures: [], cut: false })
  })

  it('reads a document of Word 1 the same way, the properties Word 1 counts in their first byte read so', async () => {
    const one = paragraphs.map((paragraph, index) =>
      index === 2 ? { ...paragraph, format: twoFormatting(0, [12, 2, 7, 7], [57, 1, 0], [13, 10]) } : paragraph
    )
    for (const quick of [false, true])
      expect(await readOlderWord(twoDocument(one, { quick, one: true }))).toEqual({ kind: 'document', markdown: expected, figures: [], cut: false })
  })

  it('says when it is protected with a password, or cut short', async () => {
    await expect(readOlderWord(twoDocument(paragraphs, { encrypted: true }))).rejects.toThrow('protected with a password')
    await expect(readOlderWord(twoDocument(paragraphs).subarray(0, 0x100))).rejects.toThrow('damaged')
    await expect(readOlderWord(twoDocument(paragraphs, { one: true }).subarray(0, 0x180))).rejects.toThrow('damaged')
  })
})

/** An Excel record: its type, its length and what it holds. */
const record = (type: number, body: Bytes | Uint8Array) => {
  const bytes = body instanceof Bytes ? body.done() : body
  return new Bytes().u16(type).u16(bytes.length).raw(bytes).done()
}
const cell = (row: number, column: number) => new Bytes().u16(row).u16(column).u16(15)
const bof = () => record(0x0809, new Bytes().u16(0x0600).u16(0x0005).zeros(12))
const EOF = record(0x000a, new Uint8Array())

/** A workbook of one sheet, its strings split over a record that continues them, and a sheet of macros left out. */
function workbook(protectedWith = false): Uint8Array {
  // "Hôtel" starts in the table's record in 8-bit characters and goes on in the next in 16-bit ones.
  const strings = new Bytes().u32(3).u32(3).u16(4).u8(0).narrow('Item').u16(5).u8(0).narrow('H\xf4')
  const continued = new Bytes().u8(1).wide('tel').u16(4).u8(0x08).u16(1).narrow('Paid').u16(0).u16(0)
  const sheet = [
    bof(),
    record(0x00fd, cell(0, 0).u32(0)),
    record(0x00fd, cell(0, 2).u32(2)),
    record(0x00fd, cell(1, 0).u32(1)),
    record(0x0203, cell(1, 1).f64(42.5)),
    record(0x0205, cell(1, 2).u8(1).u8(0)),
    // 1.2 written as 120 hundredths; 7 as a 30-bit integer.
    record(0x027e, cell(3, 0).u32((120 << 2) | 0x03)),
    record(
      0x00bd,
      new Bytes()
        .u16(3)
        .u16(1)
        .u16(15)
        .u32((7 << 2) | 0x02)
        .u16(15)
        .u32((-3 << 2) | 0x02)
        .u16(2)
    ),
    record(0x0006, cell(5, 0).u8(0).zeros(5).u16(0xffff).zeros(6)),
    record(0x0207, new Bytes().u16(2).u8(0).narrow('ok')),
    record(0x0006, cell(5, 1).f64(162.5).zeros(6)),
    record(0x0006, cell(5, 2).u8(2).u8(0).u8(0x07).zeros(3).u16(0xffff).zeros(6)),
    EOF
  ]
  const sheetName = new Bytes().u8(6).u8(0).narrow('Budget')
  const macroName = new Bytes().u8(6).u8(0).narrow('Macros')
  const globals = (sheetAt: number) => [
    bof(),
    ...(protectedWith ? [record(0x002f, new Bytes().u16(0).u16(0))] : []),
    record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())),
    record(0x0085, new Bytes().u32(0).u8(0).u8(1).raw(macroName.done())),
    record(0x00fc, strings),
    record(0x003c, continued),
    EOF
  ]
  const length = globals(0).reduce((sum, one) => sum + one.length, 0)
  const all = new Bytes()
  for (const part of [...globals(length), ...sheet]) all.raw(part)
  return compound({ Workbook: all.done() })
}

/**
 * A workbook of one sheet with two pictures: its store in a drawing group continued by a second record, the sheet's
 * drawing split over its own records, an object's record between them, and one that continues them.
 */
function picturedWorkbook(): Uint8Array {
  const store = container(0xf000, [
    atom(0xf006, new Bytes().zeros(16)),
    container(0xf001, [storeEntry(blipOf(0xf01e, 0x6e0, PNG)), storeEntry(atom(0xf01a, new Bytes().zeros(50), 0x3d4))])
  ])
  const drawing = artDrawing(artShape(1025, 0x0a00, 1, 'Logo'), artShape(1026, 0x0a00, 2))
  const sheet = [
    bof(),
    record(0x00ec, drawing.subarray(0, 30)),
    record(0x005d, new Bytes().zeros(22)),
    record(0x00ec, drawing.subarray(30, 70)),
    record(0x003c, drawing.subarray(70)),
    EOF
  ]
  const sheetName = new Bytes().u8(4).u8(0).narrow('Logo')
  const globals = (sheetAt: number) => [
    bof(),
    record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())),
    record(0x00eb, store.subarray(0, 40)),
    record(0x003c, store.subarray(40)),
    EOF
  ]
  const length = globals(0).reduce((sum, one) => sum + one.length, 0)
  const all = new Bytes()
  for (const part of [...globals(length), ...sheet]) all.raw(part)
  return compound({ Workbook: all.done() })
}

/** A chart's records: its kind, then one series whose formulas name its name, values and categories in the sheet. */
function chartOf(kind: number, kept?: { value: number; category: string }): Uint8Array[] {
  const area = (part: number, rows: [number, number], column: number) => {
    const tokens = new Bytes().u8(0x3b).u16(0).u16(rows[0]).u16(rows[1]).u16(column).u16(column).done()
    return record(0x1051, new Bytes().u8(part).u8(2).zeros(4).u16(tokens.length).raw(tokens))
  }
  return [
    bof(),
    record(kind, new Bytes().zeros(6)),
    record(0x1003, new Bytes().zeros(12)),
    record(0x1033, new Uint8Array()),
    area(0, [0, 0], 1),
    area(1, [1, 2], 1),
    area(2, [1, 2], 0),
    record(0x1034, new Uint8Array()),
    ...(kept
      ? [
          record(0x1065, new Bytes().u16(1)),
          record(0x0203, cell(0, 0).f64(kept.value)),
          record(0x1065, new Bytes().u16(2)),
          record(0x0204, cell(0, 0).u16(kept.category.length).u8(0).narrow(kept.category))
        ]
      : []),
    EOF
  ]
}

/**
 * A workbook of a sheet of values with a chart on it, which kept what it drew, and a chart sheet whose chart kept
 * nothing, its formulas naming the sheet's cells through the workbook's references to its own sheets.
 */
function chartedWorkbook(): Uint8Array {
  const text = (row: number, column: number, value: string) => record(0x0204, cell(row, column).u16(value.length).u8(0).narrow(value))
  const data = [
    bof(),
    text(0, 1, 'Sales'),
    text(1, 0, 'North'),
    record(0x0203, cell(1, 1).f64(30)),
    text(2, 0, 'South'),
    record(0x0203, cell(2, 1).f64(12.5)),
    record(0x005d, new Bytes().u16(0x15).u16(0x12).u16(5).zeros(16)),
    ...chartOf(0x1018, { value: 7, category: 'Kept' }),
    EOF
  ]
  const chartSheet = chartOf(0x1017)
  const sheet = (at: number, kind: number, name: string) => record(0x0085, new Bytes().u32(at).u8(0).u8(kind).u8(name.length).u8(0).narrow(name))
  const globals = (dataAt: number, chartAt: number) => [
    bof(),
    sheet(dataAt, 0, 'Data'),
    sheet(chartAt, 2, 'Chart'),
    record(0x01ae, new Bytes().u16(2).u16(0x0401)),
    record(0x0017, new Bytes().u16(1).u16(0).u16(0).u16(0)),
    EOF
  ]
  const size = (parts: Uint8Array[]) => parts.reduce((sum, one) => sum + one.length, 0)
  const length = size(globals(0, 0))
  const all = new Bytes()
  for (const part of [...globals(length, length + size(data)), ...data, ...chartSheet]) all.raw(part)
  return compound({ Workbook: all.done() })
}

describe('an Excel 97 workbook', () => {
  it('draws a sheet’s charts from the values they kept, and a chart sheet’s from the cells its formulas name', async () => {
    const read = await readOlderExcel(chartedWorkbook())
    const sales = (points: { x: string; y: number }[]) => [{ name: 'Sales', points }]
    expect(read.kind === 'workbook' ? read.sheets.map(({ name, rows, figures }) => ({ name, rows, figures })) : undefined).toEqual([
      {
        name: 'Data',
        rows: [
          ['', 'Sales'],
          ['North', '30'],
          ['South', '12.5']
        ],
        figures: [{ kind: 'chart', title: '', chart: 'line', series: sales([{ x: 'Kept', y: 7 }]) }]
      },
      {
        name: 'Chart',
        rows: [],
        figures: [
          {
            kind: 'chart',
            title: '',
            chart: 'bar',
            series: sales([
              { x: 'North', y: 30 },
              { x: 'South', y: 12.5 }
            ])
          }
        ]
      }
    ])
  })

  it('shows the pictures each sheet’s drawing places, from the workbook’s store', async () => {
    expect(await readOlderExcel(picturedWorkbook())).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Logo',
          rows: [],
          cut: false,
          figures: [
            { kind: 'picture', type: 'image/png', bytes: new Uint8Array(PNG), alt: 'Logo', width: undefined, height: undefined },
            { kind: 'unshown', alt: '', what: 'picture' }
          ]
        }
      ]
    })
  })

  it('reads each worksheet as rows of its values as stored, its strings across the records that continue them', async () => {
    const preview = await readOlderExcel(workbook())
    expect(textual(preview)).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Budget',
          rows: [['Item', '', 'Paid'], ['Hôtel', '42.5', 'TRUE'], [], ['1.2', '7', '-3'], [], ['ok', '162.5', '#DIV/0!']],
          cut: false,
          figures: []
        }
      ]
    })
    // Its look, of as many rows and columns, a workbook with no styles giving its cells none of their own.
    const look = preview.kind === 'workbook' ? preview.sheets[0]?.look : undefined
    expect([look?.rows.length, look?.columns.length, look?.looks]).toEqual([6, 3, []])
  })

  it('keeps each cell with its number, for a chart that names it', () => {
    const [sheet] = readOlderSheets(workbook())
    expect(sheet?.name).toBe('Budget')
    expect(sheet?.cells.get('1,0')).toEqual({ text: 'Hôtel', number: undefined })
    expect(sheet?.cells.get('1,1')).toEqual({ text: '42.5', number: 42.5 })
    expect(sheet?.cells.get('3,1')).toEqual({ text: '7', number: 7 })
    expect(sheet?.cells.get('5,1')).toEqual({ text: '162.5', number: 162.5 })
    expect(sheet?.cells.get('5,0')).toEqual({ text: 'ok', number: undefined })
    expect(sheet?.cells.has('2,0')).toBe(false)
  })

  it('reads the numbers Excel packs in four bytes', () => {
    expect(rkNumber((120 << 2) | 0x03)).toBe(1.2)
    expect(rkNumber((-5 << 2) | 0x02)).toBe(-5)
    // A float's high half: 1.5 is 0x3FF80000 then nothing.
    expect(rkNumber(0x3ff80000)).toBe(1.5)
  })

  it('shows each number as the format of its style shows it, dates counted as the workbook counts them', async () => {
    const styled = (date1904: boolean) => {
      const format = new Bytes().u16(164).u16(10).u8(0).narrow('dd/mm/yyyy')
      // Styles 0 to 15 are Excel's own; 16 gives the format of its own, 17 a percentage, 18 thousands.
      const styles = Array.from({ length: 19 }, (_, index) =>
        record(
          0x00e0,
          new Bytes()
            .u16(0)
            .u16(index === 16 ? 164 : index === 17 ? 10 : index === 18 ? 3 : 0)
            .zeros(16)
        )
      )
      const sheet = [
        bof(),
        record(0x0203, new Bytes().u16(0).u16(0).u16(16).f64(45234)),
        record(
          0x027e,
          new Bytes()
            .u16(0)
            .u16(1)
            .u16(17)
            .u32((25 << 2) | 0x03)
        ),
        record(0x0203, new Bytes().u16(0).u16(2).u16(18).f64(1234567)),
        record(0x0203, new Bytes().u16(0).u16(3).u16(15).f64(8.200000000000001)),
        record(0x0006, new Bytes().u16(0).u16(4).u16(16).f64(45235).zeros(6)),
        EOF
      ]
      const sheetName = new Bytes().u8(5).u8(0).narrow('Dates')
      const globals = (sheetAt: number) => [
        bof(),
        record(0x0022, new Bytes().u16(date1904 ? 1 : 0)),
        record(0x041e, format),
        ...styles,
        record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())),
        EOF
      ]
      const length = globals(0).reduce((sum, one) => sum + one.length, 0)
      const all = new Bytes()
      for (const part of [...globals(length), ...sheet]) all.raw(part)
      return compound({ Workbook: all.done() })
    }
    const rows = async (date1904: boolean) => {
      const read = await readOlderExcel(styled(date1904), { locale: 'en-US' })
      return read.kind === 'workbook' ? read.sheets[0]?.rows : undefined
    }
    expect(await rows(false)).toEqual([['04/11/2023', '25.00%', '1,234,567', '8.2', '05/11/2023']])
    expect((await rows(true))?.[0]?.[0]).toBe('05/11/2027')
  })

  it('reads a workbook of Excel 5 and 95: its text in the workbook’s code page, plain or with runs of format, and its formats', async () => {
    const cyrillic = (...bytes: number[]) => new Uint8Array(bytes)
    const five = () => record(0x0809, new Bytes().u16(0x0500).u16(0x0005).zeros(4))
    const sheet = [
      five(),
      record(
        0x0204,
        cell(0, 0)
          .u16(6)
          .raw(cyrillic(...HELLO))
      ),
      record(
        0x00d6,
        cell(0, 1)
          .u16(3)
          .raw(cyrillic(...WORLD))
          .u8(1)
          .u8(0)
          .u8(0)
      ),
      record(0x0203, new Bytes().u16(1).u16(0).u16(16).f64(45234)),
      record(0x0006, cell(1, 1).u8(0).zeros(5).u16(0xffff).zeros(6)),
      record(0x0207, new Bytes().u16(2).narrow('ok')),
      EOF
    ]
    const styles = Array.from({ length: 17 }, (_, index) =>
      record(
        0x00e0,
        new Bytes()
          .u16(0)
          .u16(index === 16 ? 164 : 0)
          .zeros(12)
      )
    )
    const globals = (sheetAt: number) => [
      five(),
      record(0x0042, new Bytes().u16(1251)),
      record(0x041e, new Bytes().u16(164).u8(10).narrow('dd/mm/yyyy')),
      ...styles,
      record(
        0x0085,
        new Bytes()
          .u32(sheetAt)
          .u8(0)
          .u8(0)
          .u8(3)
          .raw(cyrillic(...WORLD))
      ),
      EOF
    ]
    const length = globals(0).reduce((sum, one) => sum + one.length, 0)
    const all = new Bytes()
    for (const part of [...globals(length), ...sheet]) all.raw(part)
    expect(textual(await readOlderExcel(compound({ Book: all.done() })))).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'мир',
          rows: [
            ['Привет', 'мир'],
            ['04/11/2023', 'ok']
          ],
          cut: false,
          figures: []
        }
      ]
    })
  })

  it('works out a sheet’s conditional formats, the first of a block’s that holds, in the font, borders and fill each sets', async () => {
    const font = record(0x0031, new Bytes().u16(200).u16(0).u16(0x7fff).u16(400).u16(0).u8(0).u8(0).u8(0).u8(0).u8(5).u8(0).narrow('Arial'))
    // What a condition sets: alignment, protection and borders unchanged, then a font and a fill as its flags say.
    const flags = (font: boolean) => 0x0000ffff | (1 << 17) | (1 << 19) | (1 << 20) | 0x2000_0000 | (font ? 0x0400_0000 : 0)
    const fill = (background: number) => new Bytes().u16(1 << 10).u16(0x40 | (background << 7))
    // Bold, slanted, not struck, in red; its size and lines unchanged.
    const bold = new Bytes().zeros(64).u32(0xffffffff).u32(0x02).u16(700).u16(0).u8(0).u8(0).u8(0).u8(0).u32(10).u32(0)
    bold.u32(0).u32(1).u32(1).u32(0).u32(0).u32(0xffffffff).u32(0xffffffff).u16(1)
    const greater = new Bytes().u8(0x1e).u16(10)
    const odd = new Bytes().u8(0x42).u8(0).u16(8).u8(0x1e).u16(2).u8(0x41).u16(39).u8(0x1e).u16(1).u8(0x0b)
    const conditions = [
      record(0x01b0, new Bytes().u16(2).u16(1).u16(0).u16(2).u16(0).u16(0).u16(1).u16(0).u16(2).u16(0).u16(0)),
      record(0x01b1, new Bytes().u8(1).u8(5).u16(greater.length).u16(0).u32(flags(true)).u16(0).raw(bold.done()).raw(fill(13).done()).raw(greater.done())),
      record(0x01b1, new Bytes().u8(2).u8(0).u16(odd.length).u16(0).u32(flags(false)).u16(0).raw(fill(11).done()).raw(odd.done()))
    ]
    const sheet = [bof(), ...[5, 20, 12].map((value, row) => record(0x0203, cell(row, 0).f64(value))), ...conditions, EOF]
    const sheetName = new Bytes().u8(5).u8(0).narrow('Notes')
    const globals = (sheetAt: number) => [bof(), font, record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())), EOF]
    const length = globals(0).reduce((sum, one) => sum + one.length, 0)
    const all = new Bytes()
    for (const part of [...globals(length), ...sheet]) all.raw(part)
    const preview = await readOlderExcel(compound({ Workbook: all.done() }))
    const look = preview.kind === 'workbook' ? preview.sheets[0]?.look : undefined
    const cells = look?.cells.map((row) => row.map((index) => (index === undefined ? undefined : look.looks[index])))
    expect(cells?.map((row) => row[0]?.fill)).toEqual(['#00ff00', '#ffff00', '#ffff00'])
    expect(cells?.[1]?.[0]?.text).toMatchObject({ font: 'Arial', bold: true, italic: true, struck: false, color: '#ff0000' })
    expect(cells?.[0]?.[0]?.text.bold).toBeUndefined()
  })

  it('shows a string’s runs of format in the fonts they name, the fifth font that Excel never writes skipped', async () => {
    /** A font of Excel 97: its height, its weight and its name. */
    const font = (height: number, weight: number, name: string) =>
      record(0x0031, new Bytes().u16(height).u16(0).u16(0x7fff).u16(weight).u16(0).u8(0).u8(0).u8(0).u8(0).u8(name.length).u8(0).narrow(name))
    // "Total due" shared, its last three characters in the font Excel numbers 5; "Paid late" a cell's own, from its fifth in bold.
    const strings = new Bytes().u32(1).u32(1).u16(9).u8(0x08).u16(1).narrow('Total due').u16(6).u16(5)
    const sheet = [bof(), record(0x00fd, cell(0, 0).u32(0)), record(0x00d6, cell(0, 1).u16(9).u8(0).narrow('Paid late').u16(1).u16(4).u16(1)), EOF]
    const sheetName = new Bytes().u8(5).u8(0).narrow('Notes')
    const globals = (sheetAt: number) => [
      bof(),
      font(200, 400, 'Arial'),
      font(200, 700, 'Arial'),
      font(200, 400, 'Arial'),
      font(200, 400, 'Arial'),
      font(280, 400, 'Georgia'),
      record(0x00fc, strings),
      record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())),
      EOF
    ]
    const length = globals(0).reduce((sum, one) => sum + one.length, 0)
    const all = new Bytes()
    for (const part of [...globals(length), ...sheet]) all.raw(part)
    const preview = await readOlderExcel(compound({ Workbook: all.done() }))
    if (preview.kind !== 'workbook') throw new Error('Not a workbook.')
    expect(preview.sheets[0]?.rows).toEqual([['Total due', 'Paid late']])
    const plain = { font: 'Arial', size: 10 }
    expect(preview.sheets[0]?.look?.runs?.[0]).toEqual([
      [
        { start: 0, text: plain },
        { start: 6, text: { font: 'Georgia', size: 14, bold: false, italic: false, struck: false } }
      ],
      [
        { start: 0, text: plain },
        { start: 4, text: { ...plain, bold: true, italic: false, struck: false } }
      ]
    ])
  })

  it('says when it is protected with a password, or is not a workbook it knows', async () => {
    await expect(readOlderExcel(workbook(true))).rejects.toThrow('protected with a password')
    const four = new Bytes().raw(record(0x0809, new Bytes().u16(0x0400).u16(0x0010).zeros(4))).done()
    await expect(readOlderExcel(compound({ Book: four }))).rejects.toThrow('not an Excel workbook')
  })

  it('reads a workbook’s stream written straight into a file, as some programs write one', async () => {
    const stream = openCompound(workbook()).stream('Workbook') as Uint8Array
    expect(await readOlderExcel(stream)).toEqual(await readOlderExcel(workbook()))
  })
})

/** Joins records into the bytes of a file. */
const fileOf = (...parts: Uint8Array[]) => new Bytes().raw(parts.flatMap((part) => [...part])).done()

describe('a workbook of Excel 2, 3 or 4', () => {
  /** A cell of Excel 2: its place, then three bytes of attributes, the second naming its format. */
  const cellTwo = (row: number, column: number, format = 0) => new Bytes().u16(row).u16(column).u8(0).u8(format).u8(0)
  /** A cell of Excel 3 and 4: its place, then its style. */
  const cellFour = (row: number, column: number, style = 0) => new Bytes().u16(row).u16(column).u16(style)
  const formatTwo = (code: string) => record(0x001e, new Bytes().u8(code.length).narrow(code))
  const formatFour = (code: string) => record(0x041e, new Bytes().u16(0).u8(code.length).narrow(code))
  const styleFour = (format: number) => record(0x0443, new Bytes().u8(0).u8(format).zeros(10))
  const beginning = (type: number, kind: number) => record(type, new Bytes().u16(0).u16(kind))

  it('reads a worksheet of Excel 2, each cell in the format it names, in the code page of the file', async () => {
    const file = fileOf(
      beginning(0x0009, 0x0010),
      record(0x0042, new Bytes().u16(32769)),
      formatTwo('General'),
      formatTwo('0.00'),
      formatTwo('0%'),
      record(0x0004, cellTwo(0, 0).u8(4).raw([0x43, 0x61, 0x66, 0xe9])),
      record(0x0003, cellTwo(0, 1, 1).f64(2.71)),
      record(0x0002, cellTwo(1, 0, 2).u16(1)),
      record(0x0005, cellTwo(1, 1).u8(1).u8(0)),
      record(0x0006, cellTwo(2, 0).u8(0).zeros(5).u16(0xffff).u8(0).u8(0)),
      record(0x0007, new Bytes().u8(2).narrow('ok')),
      record(0x0006, cellTwo(2, 1).f64(7.5).u8(0).u8(0)),
      record(0x0005, cellTwo(2, 2).u8(0x07).u8(1)),
      EOF
    )
    expect(textual(await readOlderExcel(file))).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: '',
          rows: [
            ['Café', '2.71'],
            ['100%', 'TRUE'],
            ['ok', '7.5', '#DIV/0!']
          ],
          cut: false,
          figures: []
        }
      ]
    })
  })

  it('reads each worksheet of an Excel 4 workbook after the record naming it, in its own formats or the workbook’s', async () => {
    const header = (name: number[]) => record(0x008f, new Bytes().u32(0).u8(name.length).raw(name))
    const file = fileOf(
      beginning(0x0409, 0x0100),
      record(0x0042, new Bytes().u16(1251)),
      formatFour('General'),
      formatFour('0.0'),
      styleFour(0),
      styleFour(1),
      EOF,
      // "Лист" in Windows' Cyrillic code page.
      header([0xcb, 0xe8, 0xf1, 0xf2]),
      beginning(0x0409, 0x0010),
      record(0x0204, cellFour(0, 0).u16(2).narrow('Pi')),
      record(0x0203, cellFour(0, 1, 1).f64(3.14)),
      record(0x027e, cellFour(1, 0).u32((7 << 2) | 0x02)),
      record(0x0406, cellFour(1, 1).u8(0).zeros(5).u16(0xffff).zeros(4)),
      record(0x0207, new Bytes().u16(4).narrow('done')),
      EOF,
      header([...'Macros'].map((letter) => letter.charCodeAt(0))),
      beginning(0x0409, 0x0040),
      EOF,
      header([...'Shares'].map((letter) => letter.charCodeAt(0))),
      beginning(0x0409, 0x0010),
      formatFour('General'),
      formatFour('0%'),
      styleFour(1),
      record(0x0203, cellFour(0, 0).f64(0.5)),
      EOF
    )
    expect(textual(await readOlderExcel(file))).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Лист',
          rows: [
            ['Pi', '3.1'],
            ['7', 'done']
          ],
          cut: false,
          figures: []
        },
        { name: 'Shares', rows: [['50%']], cut: false, figures: [] }
      ]
    })
  })

  it('reads a worksheet of Excel 3, and says when one is protected with a password or cut short', async () => {
    const three = (...records: Uint8Array[]) =>
      fileOf(beginning(0x0209, 0x0010), formatTwo('General'), record(0x0243, new Bytes().u8(0).u8(0).zeros(10)), ...records, EOF)
    expect(textual(await readOlderExcel(three(record(0x0204, cellFour(0, 1).u16(3).narrow('Sum')), record(0x0206, cellFour(1, 1).f64(12).zeros(4)))))).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: '',
          rows: [
            ['', 'Sum'],
            ['', '12']
          ],
          cut: false,
          figures: []
        }
      ]
    })
    await expect(readOlderExcel(three(record(0x002f, new Bytes().u16(0).u16(0))))).rejects.toThrow('protected with a password')
    await expect(readOlderExcel(three().subarray(0, 30))).rejects.toThrow('damaged')
  })

  /** A sheet's look and the look of each of its cells, by row and column. */
  const lookOf = async (file: Uint8Array) => {
    const preview = await readOlderExcel(file)
    const look = preview.kind === 'workbook' ? preview.sheets[0]?.look : undefined
    return { look, cells: look?.cells.map((row) => row.map((index) => (index === undefined ? undefined : look.looks[index]))) }
  }
  const thin = { width: 0.75, style: 'solid', color: '#000000' }

  it('draws a sheet of Excel 4 as it looks, in its fonts, styles, palette, columns, rows and window', async () => {
    /** A font of Excel 3 and 4: its height, its flags (bold, italic, underline, struck), its colour by number and its name. */
    const font = (height: number, flags: number, color: number, name: string) =>
      record(0x0231, new Bytes().u16(height).u16(flags).u16(color).u8(name.length).narrow(name))
    /** A style of Excel 4: its font, its format, a cell's, its alignment and the attributes it uses, its fill, its borders. */
    const style = (font: number, alignment: number, fill: number, lines: number) =>
      record(0x0443, new Bytes().u8(font).u8(0).u16(0x0001).u8(alignment).u8(0xf8).u16(fill).u32(lines))
    const file = fileOf(
      beginning(0x0409, 0x0010),
      formatFour('General'),
      font(200, 0, 0x7fff, 'Arial'),
      font(240, 0x01 | 0x02 | 0x04, 10, 'Times New Roman'),
      // A plain style in the system's colours, then one centred in the middle, wrapped, filled in yellow, a thin line
      // above in the window's text colour and a double one below in the palette's ninth colour, as the workbook set it.
      style(0, 0x20, 25 << 11, 24 << 3),
      style(1, 2 | 8 | (1 << 4), 1 | (13 << 6) | (25 << 11), 1 | (24 << 3) | (6 << 16) | (8 << 19)),
      record(0x0092, new Bytes().u16(1).raw([0x12, 0x34, 0x56, 0])),
      record(0x0055, new Bytes().u16(10)),
      record(
        0x007d,
        new Bytes()
          .u16(1)
          .u16(1)
          .u16(20 * 256)
          .u16(0)
          .u16(0)
          .u16(0)
      ),
      record(0x0208, new Bytes().u16(0).u16(0).u16(2).u16(600).u16(0).u16(0).u16(0x0140).u16(0)),
      record(0x023e, new Bytes().u16(0x04).u16(0).u16(0).u32(0)),
      record(0x0204, cellFour(0, 0, 1).u16(5).narrow('Title')),
      record(0x0203, cellFour(0, 1).f64(2)),
      EOF
    )
    const { look, cells } = await lookOf(file)
    // Arial's digit is seven pixels: ten characters are 80 pixels with Excel's margin, twenty are 140.
    expect([look?.columns, look?.rows, look?.grid, look?.headings]).toEqual([[60, 105], [30], false, true])
    expect(cells).toEqual([
      [
        {
          text: { font: 'Times New Roman', size: 12, bold: true, italic: true, underline: 'solid', color: '#ff0000' },
          fill: '#ffff00',
          borders: { top: thin, bottom: { width: 2.25, style: 'double', color: '#123456' } },
          align: 'center',
          vertical: 'middle',
          wrap: true,
          indent: 0
        },
        { text: { font: 'Arial', size: 10 }, borders: {}, align: 'right', vertical: 'bottom', wrap: false, indent: 0 }
      ]
    ])
  })

  /** A font of Excel 2: its height, its flags and its name; its colour, when it has one, in a record after it. */
  const fontTwo = (height: number, flags: number, name: string) => record(0x0031, new Bytes().u16(height).u16(flags).u8(name.length).narrow(name))
  /** A cell of Excel 2 with its three bytes of attributes: its style, its format and font, its alignment, borders and shading. */
  const attributed = (row: number, column: number, attributes: [number, number, number]) => new Bytes().u16(row).u16(column).raw(attributes)

  it('draws a sheet of Excel 2 with no styles of its own from the attributes its cells keep, its columns, rows and window its own', async () => {
    const file = fileOf(
      beginning(0x0009, 0x0010),
      formatTwo('General'),
      formatTwo('0.00'),
      fontTwo(200, 0, 'Arial'),
      fontTwo(200, 1, 'Arial'),
      record(0x0045, new Bytes().u16(2)),
      record(
        0x0024,
        new Bytes()
          .u8(0)
          .u8(0)
          .u16(15 * 256)
      ),
      record(0x0008, new Bytes().u16(1).u16(0).u16(2).u16(400).u16(0).u8(0).u16(0)),
      record(0x003e, new Bytes().u8(0).u8(0).u8(1).u8(0).u8(0).u16(0).u16(0).u8(1).u32(0)),
      // A name in the second font, centred, with lines above and below it, then a number in the format "0.00",
      // aligned right and shaded.
      record(
        0x0004,
        attributed(0, 0, [0, 1 << 6, 2 | 0x20 | 0x40])
          .u8(4)
          .narrow('Name')
      ),
      record(0x0003, attributed(1, 1, [0, 1, 3 | 0x80]).f64(2.5)),
      EOF
    )
    const preview = await readOlderExcel(file)
    expect(preview.kind === 'workbook' && preview.sheets[0]?.rows).toEqual([['Name'], ['', '2.50']])
    const { look, cells } = await lookOf(file)
    expect([look?.columns, look?.rows, look?.grid, look?.headings]).toEqual([[78.75, 48], [12.8, 20], false, true])
    // A cell with no attributes of its own is plain.
    const plain = { text: { font: 'Arial', size: 10 }, borders: {}, align: 'left', vertical: 'bottom', wrap: false, indent: 0 }
    expect(cells).toEqual([
      [{ ...plain, text: { font: 'Arial', size: 10, bold: true, color: '#ff0000' }, borders: { top: thin, bottom: thin }, align: 'center' }, plain],
      [plain, { ...plain, fill: '#dfdfdf', align: 'right' }]
    ])
  })

  it('draws the cells of Excel 2 in the styles they name, the 63rd and later named by the record before them', async () => {
    const file = fileOf(
      beginning(0x0009, 0x0010),
      formatTwo('General'),
      formatTwo('0%'),
      fontTwo(200, 0, 'Arial'),
      fontTwo(240, 2, 'Courier'),
      record(0x0043, new Bytes().u8(0).u8(0).u8(0).u8(0)),
      record(
        0x0043,
        new Bytes()
          .u8(1)
          .u8(0)
          .u8(1)
          .u8(1 | 0x08)
      ),
      record(0x0044, new Bytes().u16(1)),
      record(0x0002, attributed(0, 0, [63, 0, 0]).u16(1)),
      // A cell's own attributes give way to the style it names.
      record(0x0002, attributed(0, 1, [0, 1, 0x80]).u16(1)),
      EOF
    )
    const preview = await readOlderExcel(file)
    expect(preview.kind === 'workbook' && preview.sheets[0]?.rows).toEqual([['100%', '1']])
    const { cells } = await lookOf(file)
    expect(cells).toEqual([
      [
        { text: { font: 'Courier', size: 12, italic: true }, borders: { left: thin }, align: 'left', vertical: 'bottom', wrap: false, indent: 0 },
        { text: { font: 'Arial', size: 10 }, borders: {}, align: 'right', vertical: 'bottom', wrap: false, indent: 0 }
      ]
    ])
  })
})

/** A PowerPoint record: its version and instance, its type, and what it holds, or the records inside it. */
const atom = (type: number, body: Bytes | Uint8Array, instance = 0) => {
  const bytes = body instanceof Bytes ? body.done() : body
  return new Bytes()
    .u16(instance << 4)
    .u16(type)
    .u32(bytes.length)
    .raw(bytes)
    .done()
}
const container = (type: number, children: Uint8Array[], instance = 0) => {
  const inside = new Bytes()
  for (const child of children) inside.raw(child)
  return new Bytes()
    .u16((instance << 4) | 0x0f)
    .u16(type)
    .u32(inside.length)
    .raw(inside.done())
    .done()
}
const header = (type: number) => atom(0x0f9f, new Bytes().u32(type))
const chars = (text: string) => atom(0x0fa0, new Bytes().wide(text))
const bytes8 = (text: string) => atom(0x0fa8, new Bytes().narrow(text))

/**
 * A presentation of two slides whose order in the list is not the order they were written in, one with a text box
 * of its own, and notes left out; found through the edit and the directory of where each object is.
 */
function presentation(encrypted = false, pictured = false, object?: Uint8Array): Uint8Array {
  // A picture of 576 by 288 master units, a slide's eighth of an inch at 576 to the inch: 96 by 48 pixels.
  const anchor = new Bytes().u16(10).u16(20).u16(596).u16(298)
  // An object's shape shows a metafile, the second picture of the store, and names the object by its number.
  const objectShape = container(0xf004, [
    atom(0xf00a, new Bytes().u32(2051).u32(0x0a10), 75),
    atom(0xf00b, new Bytes().u16(0x4104).u32(2), 1),
    atom(0xf010, anchor),
    container(0xf011, [atom(0x0bc1, new Bytes().u32(5))])
  ])
  const slideOne = container(0x03ee, [
    atom(0x03ef, new Bytes().zeros(24)),
    ...(pictured ? [container(0x040c, [artDrawing(artShape(2049, 0x0a00, 1, 'Map', anchor), artShape(2050, 0x0e00, 1))])] : []),
    ...(object ? [container(0x040c, [artDrawing(objectShape)])] : [])
  ])
  const slideTwo = container(0x03ee, [
    container(0x040c, [container(0xf002, [container(0xf003, [container(0xf004, [container(0xf00d, [header(4), chars('A note of its own')])])])])])
  ])
  const list = container(
    0x0ff0,
    [
      atom(0x03f3, new Bytes().u32(2).zeros(16)),
      header(0),
      chars('Plan'),
      header(1),
      bytes8('Train at 9\rMuseum\x0bthen dinner'),
      atom(0x03f3, new Bytes().u32(1).zeros(16)),
      header(6),
      chars('Welcome')
    ],
    0
  )
  const notes = container(0x0ff0, [atom(0x03f3, new Bytes().u32(4).zeros(16)), header(2), chars('Speaker notes')], 2)
  const group = container(0x040b, [
    container(0xf000, [atom(0xf006, new Bytes().zeros(16)), container(0xf001, [storeEntry(new Uint8Array(), 4), storeEntry(new Uint8Array(), 0)])])
  ])
  // An object of another app: its entry in the list of objects names its storage, kept as object 4.
  const objects = container(0x0409, [container(0x0fcc, [atom(0x0fc3, new Bytes().u32(1).u32(0).u32(5).u32(14).u32(4).u32(0))])])
  const document = container(0x03e8, [atom(0x03e9, new Bytes().zeros(40)), list, notes, ...(pictured || object ? [group] : []), ...(object ? [objects] : [])])
  const stream = new Bytes()
  const at = { document: stream.length }
  stream.raw(document)
  const one = stream.length
  stream.raw(slideOne)
  const two = stream.length
  stream.raw(slideTwo)
  const storage = stream.length
  if (object) stream.raw(atom(0x1011, object, 1))
  const directory = stream.length
  stream.raw(
    atom(
      0x1772,
      new Bytes()
        .u32((4 << 20) | 1)
        .u32(one)
        .u32(two)
        .u32(at.document)
        .u32(storage)
    )
  )
  const edit = stream.length
  stream.raw(atom(0x0ff5, new Bytes().u32(0).u16(0).u8(0).u8(3).u32(0).u32(directory).u32(3).u32(4).u16(1).u16(0)))
  const user = new Bytes()
    .raw(
      atom(
        0x0ff6,
        new Bytes()
          .u32(0x14)
          .u32(encrypted ? 0xf3d1c4df : 0xe391c05f)
          .u32(edit)
          .zeros(8)
      )
    )
    .done()
  const pictures = new Bytes()
    .zeros(4)
    .raw(blipOf(0xf01e, 0x6e0, PNG))
    .raw(atom(0xf01a, new Bytes().zeros(60), 0x3d4))
    .done()
  return compound({ 'PowerPoint Document': stream.done(), 'Current User': user, ...(pictured || object ? { Pictures: pictures } : {}) })
}

/**
 * An object's storage as PowerPoint keeps it: its size, then the compound file packed by zlib, the stream's last
 * four bytes, which check it, left out as PowerPoint may leave them.
 */
async function packedObject(storage: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([storage as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  const packed = new Uint8Array(await new Response(stream).arrayBuffer())
  return new Bytes()
    .u32(storage.length)
    .raw(packed.subarray(0, packed.length - 4))
    .done()
}

describe('a PowerPoint 97 presentation', () => {
  it('reads each slide in the order of its list: its title, its placeholders’ lines, then its own text boxes, and draws it', async () => {
    const read = await readOlderPowerPoint(presentation())
    expect(
      read.kind === 'presentation'
        ? read.slides.map(({ drawing, ...slide }) => ({ ...slide, drawn: drawing && [drawing.alt, drawing.width, drawing.height] }))
        : undefined
    ).toEqual([
      {
        title: 'Plan',
        lines: ['Train at 9', 'Museum then dinner', 'A note of its own'],
        figures: [],
        drawn: ['Plan. Train at 9. Museum then dinner. A note of its own', 960, 720]
      },
      { title: 'Welcome', lines: [], figures: [], drawn: ['Welcome', 960, 720] }
    ])
  })

  /** The SVG each slide is drawn as. */
  const drawings = (read: Awaited<ReturnType<typeof readOlderPowerPoint>>) =>
    read.kind === 'presentation' ? read.slides.map((slide) => new TextDecoder().decode(slide.drawing?.bytes)) : []

  it('draws the pictures each slide’s drawing places, from the presentation’s store, at their anchor', async () => {
    const [, drawn] = drawings(await readOlderPowerPoint(presentation(false, true)))
    expect(drawn).toContain(
      `<g transform="translate(3.33 1.67)"><svg width="96" height="48" viewBox="0 0 100 100" preserveAspectRatio="none"><image width="100" height="100" preserveAspectRatio="none" href="data:image/png;base64,${btoa(String.fromCharCode(...PNG))}"/></svg></g>`
    )
  })

  it('draws an object’s chart from its storage when its picture is a metafile the window does not show', async () => {
    const [, drawn] = drawings(await readOlderPowerPoint(presentation(false, false, await packedObject(compound({ Workbook: graphStream() })))))
    expect(drawn).toContain('<g transform="translate(3.33 1.67)"><path d="M8 ')
    expect(drawn).toContain('>Q1</text>')
    // An object that holds no chart shows nothing of it.
    const [, other] = drawings(await readOlderPowerPoint(presentation(false, false, await packedObject(compound({ Other: new Uint8Array([1]) })))))
    expect(other).not.toContain('<g transform="translate(3.33 1.67)">')
  })

  it('writes an object’s equation of Equation Editor as a line of its slide', async () => {
    const read = await readOlderPowerPoint(presentation(false, false, await packedObject(compound({ 'Equation Native': EQUATION }))))
    expect(read.kind === 'presentation' ? read.slides.map((slide) => slide.lines) : undefined).toEqual([
      ['Train at 9', 'Museum then dinner', 'A note of its own'],
      ['x²']
    ])
  })

  it('says when it is protected with a password, or is not one', async () => {
    await expect(readOlderPowerPoint(presentation(true))).rejects.toThrow('protected with a password')
    await expect(readOlderPowerPoint(compound({ Other: new Uint8Array(8) }))).rejects.toThrow('not a PowerPoint presentation')
    expect((await readOffice('ppt', presentation())).kind).toBe('presentation')
  })
})

/** A record of PowerPoint 95: its type, its instance, its length and a fourth word, in four bytes each, then its body. */
const ninetyFiveAtom = (type: number, body: Bytes) => new Bytes().u32(type).u32(0).u32(body.length).u32(0).raw(body.done()).done()
/** A container of PowerPoint 95, its instance 0xffff, holding the records given. */
const ninetyFiveContainer = (type: number, children: Uint8Array[]) => {
  const inside = new Bytes()
  for (const child of children) inside.raw(child)
  return new Bytes().u32(type).u32(0xffff).u32(inside.length).u32(0).raw(inside.done()).done()
}

/** A shape of PowerPoint 95, a placeholder or a free one, holding a text of a kind (0 a title, 1 a body, 6 a title slide's). */
const ninetyFiveShape = (placeholder: boolean, kind: number, text: number[]) =>
  ninetyFiveContainer(placeholder ? 0x0bc2 : 0x0bc0, [
    ninetyFiveAtom(0x0bc1, new Bytes().zeros(40)),
    ninetyFiveContainer(0x0fa1, [
      ninetyFiveAtom(0x0fa0, new Bytes().zeros(16)),
      ninetyFiveContainer(0x0fa2, [
        ninetyFiveAtom(0x0fa3, new Bytes().u32(kind).zeros(32)),
        ninetyFiveContainer(0x0fe0, [
          ninetyFiveAtom(0x07ee, new Bytes().raw(text)),
          ninetyFiveContainer(0x07ec, [ninetyFiveAtom(0x07ed, new Bytes().raw(ascii('Run')))])
        ])
      ])
    ])
  ])

/** A summary naming the code page its text is in, as its only property. */
const codePageSummary = (codePage: number) =>
  new Bytes().u16(0xfffe).u16(0).u32(0).zeros(16).u32(1).zeros(16).u32(48).u32(24).u32(1).u32(1).u32(16).u16(2).u16(0).u16(codePage).u16(0).done()

/**
 * A presentation of PowerPoint 95 of two slides, the first with its notes, a placeholder of each kind and a free shape
 * whose text keeps a title's kind, the second with a group, then its masters in a list of their own; and the text it
 * keeps for searching.
 */
function ninetyFiveDeck(searched: string, options: { title?: number[]; body?: string; codePage?: number } = {}): Uint8Array {
  const shapes = (...children: Uint8Array[]) => ninetyFiveContainer(0x0bb8, children)
  const slide = (...children: Uint8Array[]) => ninetyFiveContainer(0x03ee, [ninetyFiveAtom(0x03ef, new Bytes().zeros(8)), ...children])
  const notes = ninetyFiveContainer(0x03f0, [shapes(ninetyFiveShape(true, 2, ascii('Speaker notes')))])
  const slides = ninetyFiveContainer(0x07d0, [
    slide(
      notes,
      shapes(
        ninetyFiveShape(true, 0, options.title ?? ascii('Plans')),
        ninetyFiveShape(true, 1, ascii(options.body ?? 'Train at 9\rMuseum\vthen dinner')),
        ninetyFiveShape(false, 0, ascii('Seen from the train'))
      )
    ),
    // A group keeps its shapes in a list of its own, after a record of its own.
    slide(
      shapes(
        ninetyFiveContainer(0x0bb9, [ninetyFiveAtom(0x0bba, new Bytes().zeros(8)), ninetyFiveContainer(0x07d0, [ninetyFiveShape(true, 6, ascii('Welcome'))])])
      )
    )
  ])
  const masters = ninetyFiveContainer(0x07d0, [slide(shapes(ninetyFiveShape(true, 0, ascii('Click to edit the title'))))])
  const document = ninetyFiveContainer(0x0003, [ninetyFiveContainer(0x03e8, [ninetyFiveAtom(0x03e9, new Bytes().zeros(8)), slides, masters])])
  return compound({
    'PowerPoint Document': document,
    'Current User': new Bytes().u32(4).narrow('Anne').done(),
    Text_Content: new Bytes().raw([...searched].map((letter) => letter.charCodeAt(0))).done(),
    ...(options.codePage === undefined ? {} : { '\u0005SummaryInformation': codePageSummary(options.codePage) })
  })
}

describe('a PowerPoint 95 presentation', () => {
  const searched = 'Plans\r\rTrain at 9\rMuseum\vthen dinner\r\rSeen from the train\r\rWelcome\r\r'

  it.each([
    {
      name: 'its slides in the order of their list, each with its placeholder’s title, notes and masters left out',
      deck: ninetyFiveDeck(searched),
      slides: [
        { title: 'Plans', lines: ['Train at 9', 'Museum then dinner', 'Seen from the train'], figures: [] },
        { title: 'Welcome', lines: [], figures: [] }
      ]
    },
    {
      name: 'its text in the code page its summary names',
      deck: ninetyFiveDeck(`${String.fromCharCode(...HELLO)}${searched.slice(5)}`, { title: HELLO, codePage: 1251 }),
      slides: [
        { title: 'Привет', lines: ['Train at 9', 'Museum then dinner', 'Seen from the train'], figures: [] },
        { title: 'Welcome', lines: [], figures: [] }
      ]
    },
    {
      name: 'its fields, stars in its records, with the values the text kept for searching gives them',
      deck: ninetyFiveDeck('Plans\r\r3/23/96: train at 9:15 AM\rMuseum, slide 1\r\rSeen from the train\r\rWelcome\r\r', {
        body: '*: train at *\rMuseum, slide *'
      }),
      slides: [
        { title: 'Plans', lines: ['3/23/96: train at 9:15 AM', 'Museum, slide 1', 'Seen from the train'], figures: [] },
        { title: 'Welcome', lines: [], figures: [] }
      ]
    }
  ])('reads $name', async ({ deck, slides }) => {
    expect(await readOlderPowerPoint(deck)).toEqual({ kind: 'presentation', slides, cut: false })
  })

  it.each([
    {
      name: 'in another order',
      text: 'Welcome\r\rPlans\r\rTrain at 9\rMuseum\vthen dinner\r\rSeen from the train\r\r',
      markdown: 'Welcome\n\nPlans\n\nTrain at 9  \nMuseum then dinner\n\nSeen from the train'
    },
    { name: 'with text the records do not hold', text: 'Plans\r\rTrain at 10\r\r', markdown: 'Plans\n\nTrain at 10' }
  ])('shows the text it keeps for searching when its records’ text is not that text: $name', async ({ text, markdown }) => {
    expect(await readOlderPowerPoint(ninetyFiveDeck(text))).toEqual({ kind: 'document', markdown, figures: [], cut: false })
  })

  it('shows the text it keeps for searching, each shape’s paragraphs apart, a line broken within one', async () => {
    const text = 'Plans for 1996\r\rPlans\r\rFirst \x93idea\x94\rSecond\vline\r\r'
    const file = compound({
      'PowerPoint Document': new Bytes().u32(3).u32(0xffff).u32(0).u32(0).done(),
      'Current User': new Bytes().u32(4).narrow('Anne').done(),
      Text_Content: new Bytes().raw([...text].map((letter) => letter.charCodeAt(0))).done()
    })
    expect(await readOlderPowerPoint(file)).toEqual({
      kind: 'document',
      markdown: 'Plans for 1996\n\nPlans\n\nFirst “idea”  \nSecond line',
      figures: [],
      cut: false
    })
  })
})

/** What a presentation of PowerPoint 3 or 4 is made of, in tests: its version, the computer that wrote it, and its first title's bytes. */
interface FourOptions {
  version?: number
  mac?: boolean
  title?: number[]
  infoSize?: number
}

/**
 * A presentation of PowerPoint 3 or 4 as libmwaw lays it out, in the byte order of the computer that wrote it: a head
 * naming the table of zones and the document's information, which names its root, which names the list of slides.
 * The first slide has notes, and a free text listed before its title and body; the second draws a group, holding two
 * texts listed after it, before a text listed first; the third names as its title a frame that is no longer one.
 */
function fourStream(options: FourOptions = {}): Uint8Array {
  const version = options.version ?? 4
  const mac = options.mac ?? false
  const bytes = () => new Bytes(mac)
  const zones: Uint8Array[] = [bytes().zeros(24).done()]
  const add = (zone: Bytes) => zones.push(zone.done()) - 1
  // A frame: its kind (1 a shape, 4 a group), the placeholder it is (1 a title, 2 a body), whether it has text.
  const frame = (kind: number, placeholder: number, text: boolean, group: [number, number] = [0, 0]) => {
    const head =
      version === 3
        ? bytes()
            .u8(mac ? kind << 4 : kind)
            .u8(0)
        : bytes().u16(mac ? (kind << 13) | (placeholder << 1) : kind | (placeholder << 12))
    return head
      .u8(text ? (mac ? 0x80 : 0x01) : 0)
      .zeros(21)
      .u32(group[0])
      .u32(group[1])
      .done()
  }
  const frames = (...each: Uint8Array[]) => add(bytes().raw(each.flatMap((one) => [...one])))
  const texts = (...each: number[][]) => {
    const zone = bytes().zeros(14)
    for (const text of each) {
      zone.zeros(54).u32(text.length).raw(text)
      if (text.length % 2 === 1) zone.u8(0)
      zone.u16(0x0c).u32(text.length).u16(16).u32(1).zeros(16)
      zone.u16(0x18).u32(text.length).u16(28).u32(1).zeros(28)
    }
    return add(zone)
  }
  const content = (text: number, drawn: number, title: number, body: number) =>
    add(
      bytes()
        .u32(text)
        .u32(drawn)
        .u16(0)
        .u16(0)
        .u16(1)
        .u16(title & 0xffff)
        .u16(body & 0xffff)
        .zeros(20)
    )
  const slide = (shown: number, notes = 0) =>
    add(
      bytes()
        .u32(0)
        .u32(0)
        .u32(shown)
        .u32(notes)
        .zeros(version === 3 ? 16 : 18)
    )

  const notes = content(texts(ascii('Speaker notes')), frames(frame(1, 2, true)), -1, 0)
  const first = slide(
    content(
      texts(ascii('Seen from the train'), options.title ?? ascii('Plans'), ascii('Train at 9\rMuseum\vthen dinner')),
      frames(frame(1, 0, true), frame(1, 1, true), frame(1, 2, true)),
      1,
      2
    ),
    notes
  )
  const second = slide(
    content(
      texts(ascii('Last'), ascii('Inside'), ascii('Group')),
      frames(frame(4, 0, false, [2, 3]), frame(1, 0, true), frame(1, 0, true), frame(1, 0, true)),
      -1,
      -1
    )
  )
  const third = slide(content(texts(ascii('Hybrid library')), frames(frame(1, 0, true)), 0, -1))
  const list = bytes().u16(3).u32(10).zeros(10)
  for (const each of [first, second, third]) list.zeros(12).u32(each)
  const root = add(bytes().zeros(6).u32(add(list)).u16(0).u16(3).zeros(8))
  const information = add(
    bytes()
      .zeros(34)
      .u32(root)
      .padTo(options.infoSize ?? (version === 3 ? 142 : 146))
  )

  let place = 24
  const places = zones.map((zone) => {
    const at = place
    place += zone.length
    return at
  })
  const stream = bytes()
    .u32(0x0baddeed)
    .u32(version)
    .u32(place)
    .u16(zones.length)
    .u16(4)
    .u32(place + zones.length * 8)
    .u16(0)
    .u16(information)
  for (const zone of zones) stream.raw(zone)
  for (const [index, zone] of zones.entries()) stream.u32(zone.length).u32(places[index] ?? 0)
  return stream.done()
}

describe('a presentation of PowerPoint 4 or older', () => {
  const read = (title: string, lastTitle = '') => [
    { title, lines: ['Seen from the train', 'Train at 9', 'Museum then dinner'], figures: [] },
    { title: '', lines: ['Inside', 'Group', 'Last'], figures: [] },
    { title: lastTitle, lines: lastTitle === '' ? ['Hybrid library'] : [], figures: [] }
  ]

  it.each([
    { name: 'of PowerPoint 4 from a PC, its slides in the order of their list, notes left out', file: compound({ PP40: fourStream() }), slides: read('Plans') },
    {
      name: 'of PowerPoint 4 from a Mac, in its order and its characters',
      file: compound({ PP40: fourStream({ mac: true, title: [0x43, 0x61, 0x66, 0x8e] }) }),
      slides: read('Café')
    },
    {
      name: 'of PowerPoint 4 in the code page its summary names',
      file: compound({ PP40: fourStream({ title: HELLO }), '\u0005SummaryInformation': codePageSummary(1251) }),
      slides: read('Привет')
    },
    {
      name: 'of PowerPoint 3 from a PC, as the file itself, the title its slide names',
      file: fourStream({ version: 3 }),
      slides: read('Plans', 'Hybrid library')
    },
    { name: 'of PowerPoint 3 from a Mac', file: fourStream({ version: 3, mac: true }), slides: read('Plans', 'Hybrid library') }
  ])('reads one $name', async ({ file, slides }) => {
    expect(await readOlderPowerPoint(file)).toEqual({ kind: 'presentation', slides, cut: false })
  })

  it.each([
    {
      name: 'PowerPoint 2 from a PC',
      file: new Bytes().u32(0x0baddeed).u32(2).u32(24).zeros(24).done(),
      message: 'It is a presentation of PowerPoint 2 or older, which is not read here.'
    },
    {
      name: 'PowerPoint 2 from a Mac',
      file: new Bytes(true).u32(0x0baddeed).u32(2).u32(24).zeros(24).done(),
      message: 'It is a presentation of PowerPoint 2 or older, which is not read here.'
    },
    {
      name: 'a version it does not know',
      file: new Bytes().u32(0x0baddeed).u32(9).u32(24).zeros(24).done(),
      message: 'The file is damaged: its slides could not be read.'
    },
    { name: 'damaged information', file: compound({ PP40: fourStream({ infoSize: 100 }) }), message: 'The file is damaged: its slides could not be read.' },
    {
      name: 'a stream of PowerPoint 4 without its mark',
      file: compound({ PP40: new Bytes().zeros(64).done() }),
      message: 'The file is damaged: its slides could not be read.'
    }
  ])('says plainly what it cannot read: $name', async ({ file, message }) => {
    await expect(readOlderPowerPoint(file)).rejects.toThrow(message)
  })
})
