import { describe, expect, it } from 'vitest'
import { readOlderExcel, readOlderPowerPoint, readOlderSheets, readOlderWord, rkNumber } from './binary-office.ts'
import { openCompound } from './compound.ts'
import { readOffice } from './office.ts'

/** Little-endian bytes written in order, with places to fill in once known. */
class Bytes {
  private readonly values: number[] = []
  get length() {
    return this.values.length
  }
  u8(value: number) {
    this.values.push(value & 0xff)
    return this
  }
  u16(value: number) {
    return this.u8(value).u8(value >> 8)
  }
  u32(value: number) {
    return this.u16(value & 0xffff).u16(value >>> 16)
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
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]

describe('a Word 97 document', () => {
  it('reads its headings, paragraphs, fields, lists and tables, from both kinds of piece', () => {
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
    expect(readOlderWord(file)).toEqual({
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
  })

  it('shows its pictures where they are: in the text, floating over it, and an embedded chart as one its app draws', () => {
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
    expect(readOlderWord(file)).toEqual({
      kind: 'document',
      markdown: 'Our cat ![A cat](figure:0) and a view ![](figure:1).\n\n![](figure:2)',
      figures: [
        { kind: 'picture', type: 'image/png', bytes: new Uint8Array(PNG), alt: 'A cat', width: 96, height: 24 },
        { kind: 'picture', type: 'image/jpeg', bytes: new Uint8Array(JPEG), alt: '', width: 192, height: 96 },
        { kind: 'unshown', alt: '', what: 'chart' }
      ],
      cut: false
    })
  })

  it('draws an embedded chart from its object’s storage when its picture is a metafile the window does not show', () => {
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
    expect(readOlderWord(file)).toEqual({ kind: 'document', markdown: '![](figure:0)\n\nEnd', figures: [GRAPH_CHART], cut: false })
  })

  it('says when it is protected with a password, or is not one', async () => {
    expect(() => readOlderWord(wordDocument([{ text: 'Secret\r', format: formatting(0) }], true))).toThrow('protected with a password')
    expect(() => readOlderWord(compound({ Other: new Uint8Array(8) }))).toThrow('not a Word document')
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

  it('reads its text in the code page of its language, its headings, lists and tables, saved whole or quickly', () => {
    for (const quick of [false, true])
      expect(readOlderWord(sixDocument(paragraphs, { quick }))).toEqual({ kind: 'document', markdown: expected, figures: [], cut: false })
  })

  it('says when it is protected with a password', () => {
    expect(() => readOlderWord(sixDocument(paragraphs, { encrypted: true }))).toThrow('protected with a password')
  })
})

/**
 * A Word 2 document of paragraphs, written straight into the file: its header, its text whole or in a piece when saved
 * quickly, a page of paragraph formats, and a style sheet of one built-in style and two of the document's own, the
 * second named "Title".
 */
function twoDocument(paragraphs: { bytes: number[]; format: number[] }[], options: { quick?: boolean; encrypted?: boolean } = {}): Uint8Array {
  const TEXT_AT = 0x180
  const PAGE = 2
  const text = paragraphs.flatMap((one) => one.bytes)
  const word = new Bytes()
    .u16(0xa5db)
    .u16(45)
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
  view.setUint32(0x11e, clx, true)
  view.setUint16(0x122, clxSize, true)
  view.setUint16(0x144, 1, true)
  return document
}

/** A paragraph's properties in Word 2: its style's code, six bytes of its lines' heights, then one-byte codes and their operands. */
const twoFormatting = (style: number, ...properties: number[][]) => [style, 0, 0, 0, 0, 0, 0, ...properties.flat()]

const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0))

describe('a Word 2 document', () => {
  const paragraphs = [
    { bytes: [...ascii('Trip'), 0x0d], format: twoFormatting(253) },
    { bytes: [...ascii('Caf'), 0xe9, 0x0d], format: twoFormatting(0) },
    { bytes: [...ascii('Coat'), 0x0d], format: twoFormatting(0, [17, 0x40, 0x01], [70, 0, 0, 0], [3, 2, 0, 0], [13, 10]) },
    { bytes: [0x41, 0x07], format: twoFormatting(0, [24, 1]) },
    { bytes: [0x42, 0x07], format: twoFormatting(0, [24, 1]) },
    { bytes: [0x07], format: twoFormatting(0, [24, 1], [25, 1]) },
    { bytes: [...ascii('Plan'), 0x0d], format: twoFormatting(1) },
    { bytes: [...ascii('End'), 0x0d], format: twoFormatting(0) }
  ]
  const expected = ['## Trip', 'Café', '- Coat', '| A | B |\n| --- | --- |', '# Plan', 'End'].join('\n\n')

  it('reads its headings, built in or named, its lists and tables, saved whole or quickly', () => {
    for (const quick of [false, true])
      expect(readOlderWord(twoDocument(paragraphs, { quick }))).toEqual({ kind: 'document', markdown: expected, figures: [], cut: false })
  })

  it('says when it is protected with a password, cut short, or of Word 1 or older', () => {
    expect(() => readOlderWord(twoDocument(paragraphs, { encrypted: true }))).toThrow('protected with a password')
    expect(() => readOlderWord(twoDocument(paragraphs).subarray(0, 0x100))).toThrow('damaged')
    expect(() => readOlderWord(new Uint8Array([0x9b, 0xa5, 0x21, 0x00, ...new Array(600).fill(0)]))).toThrow('Word 1 or older')
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
  it('draws a sheet’s charts from the values they kept, and a chart sheet’s from the cells its formulas name', () => {
    const read = readOlderExcel(chartedWorkbook())
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

  it('shows the pictures each sheet’s drawing places, from the workbook’s store', () => {
    expect(readOlderExcel(picturedWorkbook())).toEqual({
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

  it('reads each worksheet as rows of its values as stored, its strings across the records that continue them', () => {
    expect(readOlderExcel(workbook())).toEqual({
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

  it('shows each number as the format of its style shows it, dates counted as the workbook counts them', () => {
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
    const rows = (date1904: boolean) => {
      const read = readOlderExcel(styled(date1904), { locale: 'en-US' })
      return read.kind === 'workbook' ? read.sheets[0]?.rows : undefined
    }
    expect(rows(false)).toEqual([['04/11/2023', '25.00%', '1,234,567', '8.2', '05/11/2023']])
    expect(rows(true)?.[0]?.[0]).toBe('05/11/2027')
  })

  it('reads a workbook of Excel 5 and 95: its text in the workbook’s code page, plain or with runs of format, and its formats', () => {
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
    expect(readOlderExcel(compound({ Book: all.done() }))).toEqual({
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

  it('says when it is protected with a password, or is not a workbook it knows', () => {
    expect(() => readOlderExcel(workbook(true))).toThrow('protected with a password')
    const four = new Bytes().raw(record(0x0809, new Bytes().u16(0x0400).u16(0x0010).zeros(4))).done()
    expect(() => readOlderExcel(compound({ Book: four }))).toThrow('not an Excel workbook')
  })

  it('reads a workbook’s stream written straight into a file, as some programs write one', () => {
    const stream = openCompound(workbook()).stream('Workbook') as Uint8Array
    expect(readOlderExcel(stream)).toEqual(readOlderExcel(workbook()))
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

  it('reads a worksheet of Excel 2, each cell in the format it names, in the code page of the file', () => {
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
    expect(readOlderExcel(file)).toEqual({
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

  it('reads each worksheet of an Excel 4 workbook after the record naming it, in its own formats or the workbook’s', () => {
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
    expect(readOlderExcel(file)).toEqual({
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

  it('reads a worksheet of Excel 3, and says when one is protected with a password or cut short', () => {
    const three = (...records: Uint8Array[]) =>
      fileOf(beginning(0x0209, 0x0010), formatTwo('General'), record(0x0243, new Bytes().u8(0).u8(0).zeros(10)), ...records, EOF)
    expect(readOlderExcel(three(record(0x0204, cellFour(0, 1).u16(3).narrow('Sum')), record(0x0206, cellFour(1, 1).f64(12).zeros(4))))).toEqual({
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
    expect(() => readOlderExcel(three(record(0x002f, new Bytes().u16(0).u16(0))))).toThrow('protected with a password')
    expect(() => readOlderExcel(three().subarray(0, 30))).toThrow('damaged')
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
  it('reads each slide in the order of its list: its title, its placeholders’ lines, then its own text boxes', async () => {
    expect(await readOlderPowerPoint(presentation())).toEqual({
      kind: 'presentation',
      slides: [
        { title: 'Plan', lines: ['Train at 9', 'Museum then dinner', 'A note of its own'], figures: [] },
        { title: 'Welcome', lines: [], figures: [] }
      ],
      cut: false
    })
  })

  it('shows the pictures each slide’s drawing places, from the presentation’s store, at their size', async () => {
    const read = await readOlderPowerPoint(presentation(false, true))
    expect(read.kind === 'presentation' ? read.slides.map((slide) => slide.figures) : undefined).toEqual([
      [],
      [{ kind: 'picture', type: 'image/png', bytes: new Uint8Array(PNG), alt: 'Map', width: 96, height: 48 }]
    ])
  })

  it('draws an object’s chart from its storage when its picture is a metafile the window does not show', async () => {
    const read = await readOlderPowerPoint(presentation(false, false, await packedObject(compound({ Workbook: graphStream() }))))
    expect(read.kind === 'presentation' ? read.slides.map((slide) => slide.figures) : undefined).toEqual([[], [GRAPH_CHART]])
    // An object that holds no chart shows its picture, or says its app shows it.
    const other = await readOlderPowerPoint(presentation(false, false, await packedObject(compound({ Other: new Uint8Array([1]) }))))
    expect(other.kind === 'presentation' ? other.slides[1]?.figures : undefined).toEqual([{ kind: 'unshown', alt: '', what: 'picture' }])
  })

  it('says when it is protected with a password, or is not one', async () => {
    await expect(readOlderPowerPoint(presentation(true))).rejects.toThrow('protected with a password')
    await expect(readOlderPowerPoint(compound({ Other: new Uint8Array(8) }))).rejects.toThrow('not a PowerPoint presentation')
    expect((await readOffice('ppt', presentation())).kind).toBe('presentation')
  })
})
