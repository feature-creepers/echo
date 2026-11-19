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

/**
 * A compound file of 512-byte sectors holding the streams given at its top: those under 4,096 bytes in the mini
 * stream, as Office writes them, the others in sectors of their own. Enough of the format for a reader.
 */
function compound(streams: Record<string, Uint8Array>): Uint8Array {
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
  const entries = Object.entries(streams).map(([name, data]) => {
    if (data.length >= 4096) return { name, start: chain(data), size: data.length }
    const first = miniFat.length
    const count = Math.ceil(data.length / 64)
    for (let index = 0; index < count; index++) miniFat.push(index < count - 1 ? first + index + 1 : END)
    mini.raw(data).padTo(miniFat.length * 64)
    return { name, start: count === 0 ? END : first, size: data.length }
  })
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
  entry('Root Entry', 5, FREE, entries.length > 0 ? 1 : FREE, rootStart, miniData.length)
  entries.forEach(({ name, start, size }, index) => {
    entry(name, 2, index + 2 <= entries.length ? index + 2 : FREE, FREE, start, size)
  })
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

/**
 * A Word 97 document of paragraphs, each with its formatting: its text in a UTF-16 piece, but the last paragraph's,
 * which is in an 8-bit piece, as Word writes text it can. A style sheet names style 1 a heading.
 */
function wordDocument(paragraphs: { text: string; format: number[] }[], encrypted = false): Uint8Array {
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

  const document = word.done()
  const pair = (index: number, at: number, size: number) => {
    const view = new DataView(document.buffer)
    view.setUint32(pairsAt + index * 8, at, true)
    view.setUint32(pairsAt + index * 8 + 4, size, true)
  }
  pair(1, styles, stylesSize)
  pair(13, papx, papxSize)
  pair(33, clx, clxSize)
  return compound({ WordDocument: document, '1Table': table.done() })
}

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

  it('says when it is protected with a password, or is of Word 2 or older', () => {
    expect(() => readOlderWord(sixDocument(paragraphs, { encrypted: true }))).toThrow('protected with a password')
    expect(() => readOlderWord(new Uint8Array([0x9b, 0xa5, 0x21, 0x00, ...new Array(600).fill(0)]))).toThrow('Word 2 or older')
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

/** A workbook of one sheet, its strings split over a record that continues them, and a chart sheet left out. */
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
  const chartName = new Bytes().u8(5).u8(0).narrow('Chart')
  const globals = (sheetAt: number) => [
    bof(),
    ...(protectedWith ? [record(0x002f, new Bytes().u16(0).u16(0))] : []),
    record(0x0085, new Bytes().u32(sheetAt).u8(0).u8(0).raw(sheetName.done())),
    record(0x0085, new Bytes().u32(0).u8(0).u8(2).raw(chartName.done())),
    record(0x00fc, strings),
    record(0x003c, continued),
    EOF
  ]
  const length = globals(0).reduce((sum, one) => sum + one.length, 0)
  const all = new Bytes()
  for (const part of [...globals(length), ...sheet]) all.raw(part)
  return compound({ Workbook: all.done() })
}

describe('an Excel 97 workbook', () => {
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

  it('says when it is protected with a password, or is of Excel 4 or older', () => {
    expect(() => readOlderExcel(workbook(true))).toThrow('protected with a password')
    expect(() => readOlderExcel(new Uint8Array([0x09, 0x04, 0x06, 0x00, 0x00, 0x00, 0x10, 0x00, ...new Array(600).fill(0)]))).toThrow('Excel 4 or older')
    const four = new Bytes().raw(record(0x0809, new Bytes().u16(0x0400).u16(0x0010).zeros(4))).done()
    expect(() => readOlderExcel(compound({ Book: four }))).toThrow('Excel 4 or older')
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
function presentation(encrypted = false): Uint8Array {
  const slideOne = container(0x03ee, [atom(0x03ef, new Bytes().zeros(24))])
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
  const document = container(0x03e8, [atom(0x03e9, new Bytes().zeros(40)), list, notes])
  const stream = new Bytes()
  const at = { document: stream.length }
  stream.raw(document)
  const one = stream.length
  stream.raw(slideOne)
  const two = stream.length
  stream.raw(slideTwo)
  const directory = stream.length
  stream.raw(
    atom(
      0x1772,
      new Bytes()
        .u32((3 << 20) | 1)
        .u32(one)
        .u32(two)
        .u32(at.document)
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
  return compound({ 'PowerPoint Document': stream.done(), 'Current User': user })
}

describe('a PowerPoint 97 presentation', () => {
  it('reads each slide in the order of its list: its title, its placeholders’ lines, then its own text boxes', () => {
    expect(readOlderPowerPoint(presentation())).toEqual({
      kind: 'presentation',
      slides: [
        { title: 'Plan', lines: ['Train at 9', 'Museum then dinner', 'A note of its own'], figures: [] },
        { title: 'Welcome', lines: [], figures: [] }
      ],
      cut: false
    })
  })

  it('says when it is protected with a password, or is not one', async () => {
    expect(() => readOlderPowerPoint(presentation(true))).toThrow('protected with a password')
    expect(() => readOlderPowerPoint(compound({ Other: new Uint8Array(8) }))).toThrow('not a PowerPoint presentation')
    expect((await readOffice('ppt', presentation())).kind).toBe('presentation')
  })
})
