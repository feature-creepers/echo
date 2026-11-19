import { describe, expect, it } from 'vitest'
import { reader } from './binary-records.ts'
import type { DocumentBlock, DocumentParagraph, DocumentTable } from './document-look.ts'
import { type OlderWordFile, readOlderWordLook, type WordFigures, type WordPart } from './older-word-look.ts'

/** Little-endian bytes written in order. */
class Bytes {
  readonly values: number[] = []
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
  raw(bytes: readonly number[]) {
    for (const byte of bytes) this.u8(byte)
    return this
  }
  wide(text: string) {
    for (let index = 0; index < text.length; index++) this.u16(text.charCodeAt(index))
    return this
  }
  zeros(count: number) {
    for (let index = 0; index < count; index++) this.u8(0)
    return this
  }
  padTo(size: number) {
    return this.zeros(Math.max(0, size - this.length))
  }
}

/** A property as Word writes it: its code, then its operand. */
const property = (code: number, ...operand: number[]) => [code & 0xff, code >> 8, ...operand]
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]

/** A paragraph of the text: its characters and mark, its style and properties, and runs of characters with their own from its start. */
interface Paragraph {
  text: string
  style?: number
  paragraph?: number[]
  runs?: { length: number; character: number[] }[]
}

interface WordOptions {
  paragraphs: Paragraph[]
  /** The stories' lengths: the text, its footnotes, headers, macros, comments, endnotes. */
  lengths?: number[]
  styles?: number[]
  fonts?: string[]
  lists?: { lists: number[]; overrides: number[] }
  sections?: { end: number; properties: number[] }[]
  headers?: number[]
  footnotes?: { references: number[]; texts: number[] }
  endnotes?: { references: number[]; texts: number[] }
  settings?: number[]
  figures?: Partial<WordFigures>
}

/** Pages of runs (`FKP`) of 512 bytes: where each run starts and ends, and its properties, from the end of the page down. */
function runPages(runs: { start: number; end: number; properties: number[] | undefined }[], paragraphs: boolean): Uint8Array[] {
  const pages: Uint8Array[] = []
  for (let first = 0; first < runs.length; first += 8) {
    const chunk = runs.slice(first, first + 8)
    const page = new Uint8Array(512)
    const view = new DataView(page.buffer)
    chunk.forEach((run, index) => {
      view.setUint32(index * 4, run.start, true)
    })
    view.setUint32(chunk.length * 4, chunk.at(-1)?.end ?? 0, true)
    let free = 511
    chunk.forEach((run, index) => {
      const at = (chunk.length + 1) * 4 + index * (paragraphs ? 13 : 1)
      if (!run.properties) return
      // A paragraph's properties are counted in pairs of bytes less one; a run's of characters, in bytes.
      const size = paragraphs ? run.properties.length + ((run.properties.length + 1) % 2) : run.properties.length
      free -= size + 1
      free -= free % 2
      page[free] = paragraphs ? (size + 1) / 2 : size
      page.set(run.properties, free + 1)
      page[at] = free / 2
    })
    page[511] = chunk.length
    pages.push(page)
  }
  return pages
}

const TEXT_AT = 1024

/** A Word 97 document's parts, its text in one piece of 16-bit characters, each part where `part` says. */
function wordFile(options: WordOptions): OlderWordFile {
  const text = options.paragraphs.map((one) => one.text).join('')
  const word = new Bytes().padTo(TEXT_AT).wide(text)
  const fc = (place: number) => TEXT_AT + place * 2
  let place = 0
  const paragraphRuns: { start: number; end: number; properties: number[] | undefined }[] = []
  const characterRuns: { start: number; end: number; properties: number[] | undefined }[] = []
  for (const paragraph of options.paragraphs) {
    const start = place
    paragraphRuns.push({ start: fc(start), end: fc(start + paragraph.text.length), properties: [...u16(paragraph.style ?? 0), ...(paragraph.paragraph ?? [])] })
    let at = start
    for (const run of paragraph.runs ?? []) {
      characterRuns.push({ start: fc(at), end: fc(at + run.length), properties: run.character })
      at += run.length
    }
    if (at < start + paragraph.text.length) characterRuns.push({ start: fc(at), end: fc(start + paragraph.text.length), properties: undefined })
    place += paragraph.text.length
  }
  const paragraphPages = runPages(paragraphRuns, true)
  const characterPages = runPages(characterRuns, false)
  word.padTo(Math.ceil(word.length / 512) * 512)
  const firstParagraphPage = word.length / 512
  for (const page of paragraphPages) word.raw([...page])
  const firstCharacterPage = word.length / 512
  for (const page of characterPages) word.raw([...page])
  // Each section's properties after the pages, their length first.
  const sections = (options.sections ?? []).map(({ properties }) => {
    const at = word.length
    word.u16(properties.length).raw(properties)
    return at
  })

  const table = new Bytes()
  const parts = new Map<WordPart, { at: number; size: number }>()
  const add = (name: WordPart, bytes: readonly number[]) => {
    parts.set(name, { at: table.length, size: bytes.length })
    table.raw(bytes)
  }
  if (options.styles) add('styles', options.styles)
  if (options.fonts) {
    const fonts = new Bytes().u16(options.fonts.length).u16(0)
    for (const name of options.fonts)
      fonts
        .u8(39 + (name.length + 1) * 2)
        .zeros(39)
        .wide(name)
        .u16(0)
    add('fonts', fonts.values)
  }
  if (options.lists) {
    add('lists', options.lists.lists)
    add('listOverrides', options.lists.overrides)
  }
  if (options.sections) {
    const plc = new Bytes().u32(0)
    for (const { end } of options.sections) plc.u32(end)
    for (const at of sections) plc.u16(0).u32(at).u16(0).u32(0)
    add('sections', plc.values)
  }
  if (options.headers) add('headers', options.headers.flatMap(u32))
  const notes = (references: WordPart, texts: WordPart, found: { references: number[]; texts: number[] } | undefined) => {
    if (!found) return
    add(references, [...[...found.references, 0].flatMap(u32), ...found.references.flatMap(() => u16(1))])
    add(texts, found.texts.flatMap(u32))
  }
  notes('footnoteReferences', 'footnoteTexts', options.footnotes)
  notes('endnoteReferences', 'endnoteTexts', options.endnotes)
  if (options.settings) add('settings', options.settings)

  return {
    version: 97,
    word: reader(new Uint8Array(word.values)),
    table: reader(new Uint8Array(table.values)),
    data: undefined,
    part: (name) => parts.get(name) ?? { at: 0, size: 0 },
    runPages: {
      characters: characterPages.map((_, index) => firstCharacterPage + index),
      paragraphs: paragraphPages.map((_, index) => firstParagraphPage + index)
    },
    codePage: 1252,
    lengths: options.lengths ?? [text.length],
    pieces: [{ start: 0, end: text.length, at: TEXT_AT, narrow: false }],
    figures: {
      inline: () => undefined,
      object: () => undefined,
      floating: () => undefined,
      anchor: () => undefined,
      rule: () => undefined,
      size: () => undefined,
      ...options.figures
    },
    limit: 4_000_000
  }
}

/** A style sheet: its default font, then each style, its kind, the style it comes from, and its paragraph and character properties. */
function styleSheet(font: number, styles: { builtIn: number; kind: number; base: number; paragraph?: number[]; character?: number[] }[]): number[] {
  const bytes = new Bytes().u16(18).u16(styles.length).u16(10).zeros(8).u16(font).zeros(4)
  for (const style of styles) {
    const body = new Bytes()
      .u16(style.builtIn)
      .u16(style.kind | (style.base << 4))
      .u16(style.kind === 1 ? 2 : 1)
      .zeros(4)
      .u16(0)
      .u16(0)
    const upx = (content: number[]) => {
      body.u16(content.length).raw(content)
      if (content.length % 2) body.u8(0)
    }
    if (style.kind === 1) upx([...u16(0), ...(style.paragraph ?? [])])
    upx(style.character ?? [])
    bytes.u16(body.length).raw(body.values)
  }
  return bytes.values
}

/** A list's level: its first number, format, text (each character below 9 a level's number), what follows it, and its properties. */
function level(
  start: number,
  format: number,
  text: string,
  options: { follow?: number; paragraph?: number[]; character?: number[]; align?: number } = {}
): number[] {
  const paragraph = options.paragraph ?? []
  const character = options.character ?? []
  return new Bytes()
    .u32(start)
    .u8(format)
    .u8(options.align ?? 0)
    .zeros(9)
    .u8(options.follow ?? 0)
    .zeros(8)
    .u8(character.length)
    .u8(paragraph.length)
    .zeros(2)
    .raw(paragraph)
    .raw(character)
    .u16(text.length)
    .wide(text).values
}

/** Lists, each its identifier and its levels, and the overrides paragraphs name, each its list and the levels it starts again. */
function listTables(lists: { id: number; levels: number[][] }[], overrides: { list: number; starts?: [level: number, start: number][] }[]) {
  const all = new Bytes().u16(lists.length)
  for (const list of lists) {
    all.u32(list.id).u32(0)
    for (let index = 0; index < 9; index++) all.u16(0xfff)
    all.u8(list.levels.length === 1 ? 1 : 0).u8(0)
  }
  const levels = lists.flatMap((list) => list.levels.flat())
  const named = new Bytes().u32(overrides.length)
  for (const override of overrides)
    named
      .u32(override.list)
      .zeros(8)
      .u8(override.starts?.length ?? 0)
      .zeros(3)
  for (const override of overrides) {
    named.u32(0xffffffff)
    for (const [which, start] of override.starts ?? []) named.u32(start).u32(which | 0x10)
  }
  return { lists: [...all.values, ...levels], overrides: named.values }
}

const blocksOf = (file: OlderWordFile) => readOlderWordLook(file).look.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks))
const paragraphAt = (blocks: DocumentBlock[], index: number) => blocks[index] as DocumentParagraph

describe('the look of a Word 97 document', () => {
  it('sets each paragraph and run in its style, its character style and its own properties', () => {
    const file = wordFile({
      fonts: ['Times New Roman', 'Arial'],
      styles: styleSheet(0, [
        { builtIn: 0, kind: 1, base: 0xfff, character: property(0x4a43, 24, 0) },
        {
          builtIn: 1,
          kind: 1,
          base: 0,
          paragraph: property(0xa414, ...u16(240)),
          character: [...property(0x0835, 1), ...property(0x4a4f, 1, 0), ...property(0x4a43, 32, 0)]
        },
        { builtIn: 87, kind: 2, base: 0xfff, character: property(0x0835, 1) }
      ]),
      paragraphs: [
        { text: 'Title\r', style: 1 },
        {
          text: 'Plain bold red\r',
          paragraph: [
            ...property(0x2403, 1),
            ...property(0x840f, ...u16(720)),
            ...property(0x8411, ...u16(-360)),
            ...property(0xa413, ...u16(120)),
            ...property(0x6412, ...u16(-300), ...u16(0)),
            ...property(0x442d, ...u16(7 << 5)),
            ...property(0x6426, 8, 1, 6, 0),
            ...property(0xc60d, 5, 0, 1, ...u16(4320), 2 | (1 << 3))
          ],
          runs: [
            { length: 6, character: [] },
            { length: 4, character: property(0x4a30, 2, 0) },
            { length: 1, character: [] },
            {
              length: 3,
              character: [
                ...property(0x6870, 0xff, 0, 0, 0),
                ...property(0x2a3e, 3),
                ...property(0x0837, 1),
                ...property(0x2a0c, 7),
                ...property(0x2a48, 1),
                ...property(0x083b, 1),
                ...property(0x8840, ...u16(40)),
                ...property(0x0836, 0x81)
              ]
            }
          ]
        },
        { text: 'Go \x13 HYPERLINK "https://example.com" \x14there\x15 or \x13 PAGE \x141\x15.\r', runs: [] },
        { text: 'Gone\r', runs: [{ length: 5, character: property(0x083c, 1) }] }
      ]
    })
    const { look } = readOlderWordLook(file)
    const blocks = look.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks))
    expect(look.text).toEqual({ font: 'Times New Roman', size: 12 })
    expect(blocks).toHaveLength(3)
    expect(paragraphAt(blocks, 0)).toEqual({
      kind: 'paragraph',
      look: { before: 0, after: 12 },
      spans: [{ text: 'Title', look: { font: 'Arial', size: 16, bold: true } }],
      mark: { font: 'Arial', size: 16, bold: true },
      heading: 1
    })
    const plain = { font: 'Times New Roman', size: 12 }
    expect(paragraphAt(blocks, 1)).toEqual({
      kind: 'paragraph',
      look: {
        align: 'center',
        start: 36,
        firstLine: -18,
        before: 6,
        after: 0,
        line: { rule: 'exact', value: 15 },
        shading: '#ffff00',
        borders: { bottom: { width: 1, style: 'solid', color: '#ff0000' } },
        tabs: [{ position: 216, align: 'right', leader: 'dot' }]
      },
      spans: [
        { text: 'Plain ', look: plain },
        { text: 'bold', look: { ...plain, bold: true } },
        { text: ' ', look: plain },
        {
          text: 'red',
          look: {
            ...plain,
            color: '#ff0000',
            italic: true,
            underline: 'double',
            struck: true,
            highlight: '#ffff00',
            position: 'super',
            caps: 'all',
            spacing: 2
          }
        }
      ],
      mark: plain
    })
    // A field's code is not shown: a link's result links, a page's number stands for its result.
    expect(paragraphAt(blocks, 2).spans).toEqual([
      { text: 'Go ', look: plain },
      { text: 'there', look: plain, link: 'https://example.com' },
      { text: ' or ', look: plain },
      { field: 'page', look: plain },
      { text: '.', look: plain }
    ])
  })

  it('numbers and bullets lists as their levels say, counting on, starting deeper levels again, and where an override starts them', () => {
    const decimal = (at: number) =>
      level(1, 0, `${String.fromCharCode(at)}.`, { paragraph: [...property(0x840f, ...u16(720 * (at + 1))), ...property(0x8411, ...u16(-360))] })
    const lists = listTables(
      [
        {
          id: 7,
          levels: [
            decimal(0),
            level(1, 4, '\u0000.\u0001)', { paragraph: [...property(0x840f, ...u16(1440)), ...property(0x8411, ...u16(-360))] }),
            ...[2, 3, 4, 5, 6, 7, 8].map(decimal)
          ]
        },
        { id: 9, levels: [level(1, 23, '', { follow: 1, character: property(0x4a4f, 1, 0) })] }
      ],
      [{ list: 7 }, { list: 9 }, { list: 7, starts: [[0, 5]] }]
    )
    const item = (text: string, list: number, at: number): Paragraph => ({
      text: `${text}\r`,
      paragraph: [...property(0x460b, ...u16(list)), ...property(0x260a, at)]
    })
    const blocks = blocksOf(
      wordFile({
        fonts: ['Times New Roman', 'Symbol'],
        lists,
        paragraphs: [item('One', 1, 0), item('Two', 1, 0), item('Two a', 1, 1), item('Two b', 1, 1), item('Three', 1, 0), item('Dot', 2, 0), item('Five', 3, 0)]
      })
    )
    expect(blocks.map((block) => (block as DocumentParagraph).marker?.text)).toEqual(['1.', '2.', '2.a)', '2.b)', '3.', '• ', '5.'])
    expect(paragraphAt(blocks, 0).look).toMatchObject({ start: 36, firstLine: -18 })
    expect(paragraphAt(blocks, 2).look).toMatchObject({ start: 72, firstLine: -18 })
    // A bullet of a font of symbols as the character it stands for, followed by a space rather than a tab.
    expect(paragraphAt(blocks, 5).marker).toEqual({ text: '• ', look: { size: 10 }, tab: false })
  })

  it('builds tables from their rows: columns at the cells’ edges, merged cells, row heights, borders, shading and padding', () => {
    const single = [8, 1, 1, 0]
    const cell = (flags: number, borders: number[][]) => [...u16(flags), ...u16(0), ...borders.flat(), ...new Array<number>(16 - borders.flat().length).fill(0)]
    const definition = (edges: number[], cells: number[][]) => {
      const body = [edges.length - 1, ...edges.flatMap(u16), ...cells.flat()]
      return property(0xd608, ...u16(body.length + 1), ...body)
    }
    const inTable = property(0x2416, 1)
    const rowEnd = (...properties: number[][]) => ({ text: '\x07', paragraph: [...inTable, ...property(0x2417, 1), ...properties.flat()] })
    const blocks = blocksOf(
      wordFile({
        paragraphs: [
          { text: 'A\x07', paragraph: inTable },
          { text: 'B\x07', paragraph: inTable },
          rowEnd(
            property(0x9602, ...u16(108)),
            property(0x9407, ...u16(-400)),
            definition([-108, 2772, 5652], [cell(0, [single, single, single, single]), cell(0x60, [single, single, single, single])]),
            property(0xd612, 20, ...u32(0xff000000), ...u32(0x00cccccc), ...u16(0), ...u32(0xff000000), ...u32(0xff000000), ...u16(0))
          ),
          { text: 'C\x07', paragraph: inTable },
          { text: '\x07', paragraph: inTable },
          { text: '\x07', paragraph: inTable },
          rowEnd(property(0x9602, ...u16(108)), definition([-108, 1440, 2772, 5652], [cell(0, []), cell(0, []), cell(0x20, [])])),
          { text: 'After\r' }
        ]
      })
    )
    const line = { width: 1, style: 'solid', color: '#000000' }
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      kind: 'table',
      columns: [77.4, 66.6, 144],
      indent: -5.4,
      rows: [
        {
          height: { value: 20, exact: true },
          cells: [
            {
              columns: 2,
              rows: 1,
              shading: '#cccccc',
              borders: { top: line, left: line, bottom: line, right: line },
              insets: { left: 5.4, right: 5.4 },
              blocks: [{ kind: 'paragraph', look: { before: 0, after: 0 }, spans: [{ text: 'A', look: { size: 10 } }], mark: { size: 10 } }]
            },
            {
              columns: 1,
              rows: 2,
              borders: { top: line, left: line, bottom: line, right: line },
              insets: { left: 5.4, right: 5.4 },
              blocks: [{ kind: 'paragraph', look: { before: 0, after: 0 }, spans: [{ text: 'B', look: { size: 10 } }], mark: { size: 10 } }]
            }
          ]
        },
        {
          cells: [
            expect.objectContaining({ columns: 1, rows: 1, blocks: [expect.objectContaining({ spans: [{ text: 'C', look: { size: 10 } }] })] }),
            expect.objectContaining({ columns: 1, rows: 1, blocks: [expect.objectContaining({ spans: [] })] })
          ]
        }
      ]
    })
    expect(paragraphAt(blocks, 1).spans).toEqual([{ text: 'After', look: { size: 10 } }])
  })

  it('reads a table nested in a cell as a table of its own in that cell', () => {
    const outer = property(0x2416, 1)
    const inner = [...property(0x2416, 1), ...property(0x6649, ...u32(2)), ...property(0x244b, 1)]
    const blocks = blocksOf(
      wordFile({
        paragraphs: [
          { text: 'Out\r', paragraph: outer },
          { text: '1\r', paragraph: inner },
          { text: '2\r', paragraph: inner },
          { text: '\r', paragraph: [...inner, ...property(0x244c, 1)] },
          { text: 'Tail\x07', paragraph: outer },
          { text: '\x07', paragraph: [...outer, ...property(0x2417, 1)] }
        ]
      })
    )
    const table = blocks[0] as DocumentTable
    const content = table.rows[0]?.cells[0]?.blocks ?? []
    expect(content.map((block) => block.kind)).toEqual(['paragraph', 'table', 'paragraph'])
    expect((content[1] as DocumentTable).rows[0]?.cells.map((cell) => (cell.blocks[0] as DocumentParagraph).spans)).toEqual([
      [{ text: '1', look: { size: 10 } }],
      [{ text: '2', look: { size: 10 } }]
    ])
  })

  it('lays out pages by sections, breaks and columns, with their headers and footers and their pages’ numbers', () => {
    const main = ['First\r', 'Break\x0cafter\r', 'Ends\x0c', 'Second\r']
    const length = main.join('').length
    // The headers' story: the odd pages' header, their footer, then the first page's header.
    const headers = ['Odd\r', 'Page \x13 PAGE \x141\x15\r', 'First page\r']
    const sectionOne = [...property(0xb01f, ...u16(11906)), ...property(0xb020, ...u16(16838)), ...property(0xb021, ...u16(1134)), ...property(0x300a, 1)]
    const sectionTwo = [...property(0x3009, 0), ...property(0x500b, ...u16(1)), ...property(0x900c, ...u16(720))]
    const { look } = readOlderWordLook(
      wordFile({
        paragraphs: [...main, ...headers].map((text) => ({ text })),
        lengths: [length, 0, headers.join('').length],
        sections: [
          { end: 'First\rBreak\x0cafter\rEnds\x0c'.length, properties: sectionOne },
          { end: length, properties: sectionTwo }
        ],
        // Where each story starts: the separators of notes, then each section's even and odd headers and footers, and its first page's.
        headers: [0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 20, 31, 31, 31, 31, 31, 31, 31, 31]
      })
    )
    const texts = (blocks: DocumentBlock[]) =>
      blocks.map((block) => (block as DocumentParagraph).spans.map((span) => ('text' in span ? span.text : '#')).join(''))
    expect(look.pages.map((page) => page.bands.map((band) => [band.columns, texts(band.blocks)]))).toEqual([
      [[1, ['First', 'Break']]],
      [
        [1, ['after', 'Ends']],
        [2, ['Second']]
      ]
    ])
    expect(look.pages.map((page) => [page.number, page.width, page.margins.left, texts(page.header), texts(page.footer)])).toEqual([
      ['1', 595.3, 56.7, ['First page'], []],
      ['2', 595.3, 56.7, ['Odd'], ['Page #']]
    ])
  })

  it('keeps footnotes for their page’s foot and endnotes for the end, each counted in its own format', () => {
    const special = property(0x0855, 1)
    const settings = new Bytes()
      .u16(0)
      .u16(1 << 2)
      .padTo(0x34)
      .u16(1 << 2)
      .u16(2 << 6).values
    const { look } = readOlderWordLook(
      wordFile({
        paragraphs: [
          {
            text: 'Text\x02 and\x02.\r',
            runs: [
              { length: 4, character: [] },
              { length: 1, character: special },
              { length: 4, character: [] },
              { length: 1, character: special }
            ]
          },
          { text: '\x02 Foot\r', runs: [{ length: 1, character: special }] },
          { text: '\x02 End\r', runs: [{ length: 1, character: special }] }
        ],
        lengths: [12, 7, 0, 0, 0, 6],
        footnotes: { references: [4], texts: [0, 7, 8] },
        endnotes: { references: [9], texts: [0, 6, 7] },
        settings
      })
    )
    const page = look.pages[0]
    expect((page?.bands[0]?.blocks[0] as DocumentParagraph | undefined)?.spans).toEqual([
      { text: 'Text', look: { size: 10 } },
      { note: 1, look: { size: 10 }, label: '1' },
      { text: ' and', look: { size: 10 } },
      { note: 1, look: { size: 10 }, label: 'i' },
      { text: '.', look: { size: 10 } }
    ])
    const note = (blocks: DocumentBlock[] | undefined) => (blocks?.[0] as DocumentParagraph | undefined)?.spans
    expect(page?.notes.map((one) => [one.mark, note(one.blocks)])).toEqual([
      [
        1,
        [
          { note: 1, look: { size: 10 }, label: '1' },
          { text: ' Foot', look: { size: 10 } }
        ]
      ]
    ])
    expect(note(look.endNotes[0]?.blocks)).toEqual([
      { note: 1, look: { size: 10 }, label: 'i' },
      { text: ' End', look: { size: 10 } }
    ])
  })

  it('places pictures in their line at their size, floating ones at their side, and draws a rule across the text', () => {
    const special = property(0x0855, 1)
    const blocks = blocksOf(
      wordFile({
        paragraphs: [
          {
            text: 'A \x01 b \x08\r',
            runs: [
              { length: 2, character: [] },
              { length: 1, character: special },
              { length: 3, character: [] },
              { length: 1, character: special }
            ]
          },
          { text: '\x01\r', runs: [{ length: 1, character: special }] }
        ],
        figures: {
          inline: (place) => (place === TEXT_AT + 4 ? 0 : undefined),
          size: () => ({ width: 72, height: 36 }),
          floating: (character) => (character === 6 ? 1 : undefined),
          anchor: () => ({ left: 300, top: 10, width: 100, height: 50, across: 'margin', down: 'paragraph', wrap: 2 }),
          rule: (place) => (place === TEXT_AT + 16 ? { share: 500, height: 1.5, color: '#aca899' } : undefined)
        }
      })
    )
    expect(paragraphAt(blocks, 0).spans).toEqual([
      { text: 'A ', look: { size: 10 } },
      { placed: { figure: 0, alt: '', width: 72, height: 36 } },
      { text: ' b ', look: { size: 10 } },
      { placed: { figure: 1, alt: '', width: 100, height: 50, float: 'right' } }
    ])
    expect(paragraphAt(blocks, 1).spans).toEqual([
      { box: { width: 216, height: 1.5, fill: '#aca899', insets: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [] } }
    ])
  })

  it('says a document whose parts run past their stream is damaged', () => {
    const file = wordFile({ paragraphs: [{ text: 'Text\r' }] })
    expect(() => readOlderWordLook({ ...file, part: (name) => (name === 'styles' ? { at: 10_000, size: 40 } : file.part(name)) })).toThrow('damaged')
  })
})

/** A paragraph of Word 6 or 2: its 8-bit characters, its style and one-byte properties, and runs of characters from its start. */
interface OlderParagraph {
  bytes: number[]
  style?: number
  paragraph?: number[]
  runs?: { length: number; character: number[] }[]
}

interface OlderOptions {
  paragraphs: OlderParagraph[]
  lengths?: number[]
  codePage?: number
  styles?: number[]
  fonts?: { name: string; set: number }[]
  sections?: { end: number; properties: number[] }[]
  headers?: number[]
  settings?: number[]
}

/** A page of runs as Word 6 and 2 write it: a paragraph's entries seven bytes or one, its properties counted in words. */
function olderRunPage(runs: { start: number; end: number; properties: number[] | undefined }[], entry: number, counted: boolean): number[] {
  const page = new Uint8Array(512)
  const view = new DataView(page.buffer)
  runs.forEach((run, index) => {
    view.setUint32(index * 4, run.start, true)
    view.setUint32((index + 1) * 4, run.end, true)
  })
  let free = 511
  runs.forEach((run, index) => {
    if (!run.properties) return
    const size = counted ? run.properties.length + (run.properties.length % 2) : run.properties.length
    free -= size + 1
    free -= free % 2
    page[free] = counted ? size / 2 : size
    page.set(run.properties, free + 1)
    page[(runs.length + 1) * 4 + index * entry] = free / 2
  })
  page[511] = runs.length
  return [...page]
}

/**
 * A Word 6 or Word 2 document's one stream: its 8-bit text in one piece, a page of paragraphs' runs, one of characters'
 * runs, its sections' properties, then its parts, each where `part` says.
 */
function olderFile(version: 6 | 2, options: OlderOptions): OlderWordFile {
  const text = options.paragraphs.flatMap((one) => one.bytes)
  const word = new Bytes().padTo(TEXT_AT).raw(text)
  const paragraphRuns: { start: number; end: number; properties: number[] | undefined }[] = []
  const characterRuns: { start: number; end: number; properties: number[] | undefined }[] = []
  let place = TEXT_AT
  for (const paragraph of options.paragraphs) {
    const style = paragraph.style ?? 0
    const head = version === 6 ? u16(style) : [style, 0, 0, 0, 0, 0, 0]
    paragraphRuns.push({ start: place, end: place + paragraph.bytes.length, properties: [...head, ...(paragraph.paragraph ?? [])] })
    let at = place
    for (const run of paragraph.runs ?? []) {
      characterRuns.push({ start: at, end: at + run.length, properties: run.character })
      at += run.length
    }
    if (at < place + paragraph.bytes.length) characterRuns.push({ start: at, end: place + paragraph.bytes.length, properties: undefined })
    place += paragraph.bytes.length
  }
  word.padTo(1536)
  word.raw(olderRunPage(paragraphRuns, version === 6 ? 7 : 1, true))
  word.raw(olderRunPage(characterRuns, 1, false))
  const sections = (options.sections ?? []).map(({ properties }) => {
    const at = word.length
    if (version === 6) word.u16(properties.length)
    else word.u8(properties.length)
    word.raw(properties)
    return at
  })
  const parts = new Map<WordPart, { at: number; size: number }>()
  const add = (name: WordPart, bytes: readonly number[]) => {
    parts.set(name, { at: word.length, size: bytes.length })
    word.raw(bytes)
  }
  if (options.styles) add('styles', options.styles)
  if (options.fonts) {
    const fonts = new Bytes().u16(0)
    for (const { name, set } of options.fonts)
      if (version === 6)
        fonts
          .u8(5 + name.length + 1)
          .u8(0)
          .u16(400)
          .u8(set)
          .u8(0)
          .raw(latin(name))
          .u8(0)
      else
        fonts
          .u8(2 + name.length + 1)
          .u8(0)
          .u8(set)
          .raw(latin(name))
          .u8(0)
    add('fonts', fonts.values)
  }
  if (options.sections) {
    const plc = new Bytes().u32(0)
    for (const { end } of options.sections) plc.u32(end)
    for (const at of sections) {
      plc.u16(0).u32(at)
      if (version === 6) plc.u16(0).u32(0)
    }
    add('sections', plc.values)
  }
  if (options.headers) add('headers', options.headers.flatMap(u32))
  add('settings', options.settings ?? [0, 0])
  const stream = reader(new Uint8Array(word.values))
  return {
    version,
    word: stream,
    table: stream,
    data: undefined,
    part: (name) => parts.get(name) ?? { at: 0, size: 0 },
    runPages: { characters: [4], paragraphs: [3] },
    codePage: options.codePage ?? 1252,
    lengths: options.lengths ?? [text.length],
    pieces: [{ start: 0, end: text.length, at: TEXT_AT, narrow: true }],
    figures: {
      inline: () => undefined,
      object: () => undefined,
      floating: () => undefined,
      anchor: () => undefined,
      rule: () => undefined,
      size: () => undefined
    },
    limit: 4_000_000
  }
}

/** Word 6's style sheet: its default font, then each style, its built-in number, kind, base, 8-bit name and one-byte properties. */
function sixStyleSheet(
  font: number,
  styles: { builtIn: number; kind: number; base: number; name: string; paragraph?: number[]; character?: number[] }[]
): number[] {
  const bytes = new Bytes().u16(18).u16(styles.length).u16(8).zeros(8).u16(font).zeros(4)
  for (const style of styles) {
    const body = new Bytes()
      .u16(style.builtIn)
      .u16(style.kind | (style.base << 4))
      .u16(style.kind === 1 ? 2 : 1)
      .u16(0)
      .u8(style.name.length)
      .raw(latin(style.name))
      .u8(0)
    if (body.length % 2) body.u8(0)
    const upx = (content: number[]) => {
      body.u16(content.length).raw(content)
      if (content.length % 2) body.u8(0)
    }
    if (style.kind === 1) upx([...u16(0), ...(style.paragraph ?? [])])
    upx(style.character ?? [])
    bytes.u16(body.length).raw(body.values)
  }
  return bytes.values
}

const latin = (text: string) => [...text].map((letter) => letter.charCodeAt(0))
/** "При" in Windows' Cyrillic code page. */
const CYRILLIC = [0xcf, 0xf0, 0xe8]
const textsOf = (blocks: DocumentBlock[]) => blocks.map((block) => (block as DocumentParagraph).spans.map((span) => ('text' in span ? span.text : '')).join(''))

describe('the look of a Word 6 or 95 document', () => {
  it('sets each paragraph and run in its style and its own one-byte properties, its 8-bit text in its font’s code page', () => {
    const file = olderFile(6, {
      fonts: [
        { name: 'Times New Roman', set: 0 },
        { name: 'Arial', set: 204 },
        { name: 'Courier Cyr', set: 0 }
      ],
      styles: sixStyleSheet(0, [
        { builtIn: 0, kind: 1, base: 0xfff, name: 'Normal', character: [99, 24, 0] },
        { builtIn: 1, kind: 1, base: 0, name: 'heading 1', paragraph: [5, 1, 22, 240, 0], character: [85, 1, 99, 32, 0] }
      ]),
      paragraphs: [
        { bytes: [...latin('Title'), 0x0d], style: 1 },
        {
          bytes: [...latin('Caf'), 0xe9, 0x20, ...CYRILLIC, 0x20, ...CYRILLIC, 0x0d],
          paragraph: [17, ...u16(720), 19, ...u16(-360), 21, ...u16(120), 38, 0x09, 0x00, 15, 5, 0, 1, ...u16(4320), 2],
          runs: [
            { length: 5, character: [] },
            { length: 3, character: [93, 1, 0, 85, 1, 98, 6] },
            { length: 1, character: [] },
            { length: 3, character: [93, 2, 0, 94, 1, 104, 1] }
          ]
        }
      ]
    })
    const { look } = readOlderWordLook(file)
    const blocks = look.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks))
    expect(look.text).toEqual({ font: 'Times New Roman', size: 12 })
    expect(paragraphAt(blocks, 0)).toEqual({
      kind: 'paragraph',
      look: { align: 'center', before: 0, after: 12 },
      spans: [{ text: 'Title', look: { font: 'Times New Roman', size: 16, bold: true } }],
      mark: { font: 'Times New Roman', size: 16, bold: true },
      heading: 1
    })
    const plain = { font: 'Times New Roman', size: 12 }
    expect(paragraphAt(blocks, 1)).toEqual({
      kind: 'paragraph',
      look: {
        start: 36,
        firstLine: -18,
        before: 6,
        after: 0,
        borders: { top: { width: 0.75, style: 'solid', color: '#000000' } },
        tabs: [{ position: 216, align: 'right' }]
      },
      spans: [
        { text: 'Café ', look: plain },
        { text: 'При', look: { font: 'Arial', size: 12, bold: true, color: '#ff0000' } },
        { text: ' ', look: plain },
        { text: 'При', look: { font: 'Courier Cyr', size: 12, underline: 'solid', position: 'super' } }
      ],
      mark: plain
    })
  })

  it('lays out its sections’ pages, centred down the page where they say, with the headers each says it has', () => {
    const main = [...latin('Body'), 0x0d]
    const headers = [...latin('Odd head'), 0x0d, ...latin('Foot'), 0x0d, 0x0d]
    const section = [164, ...u16(11906), 165, ...u16(16838), 166, ...u16(1134), 168, ...u16(720), 144, 1, 0, 159, 1, 153, 0b1010]
    const { look } = readOlderWordLook(
      olderFile(6, {
        paragraphs: [{ bytes: main }, { bytes: headers }],
        lengths: [main.length, 0, headers.length],
        sections: [{ end: main.length, properties: section }],
        headers: [0, 9, 14, 15]
      })
    )
    expect(look.pages.map((page) => [page.width, page.height, page.margins.left, page.margins.top, page.vertical, page.bands[0]?.columns])).toEqual([
      [595.3, 841.9, 56.7, 36, 'middle', 2]
    ])
    expect(look.pages.map((page) => [textsOf(page.header), textsOf(page.footer)])).toEqual([[['Odd head'], ['Foot']]])
  })

  it('numbers its paragraphs as their automatic numbers say, and builds its tables from their rows', () => {
    // An automatic number's description: decimal, its text "." after the number, counted from 1.
    const description = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, ...new Array(8).fill(0), 0x2e, ...new Array(31).fill(0)]
    const numbered = [13, 10, 12, description.length, ...description]
    const cell = (border: number) => [0, 0, ...u16(border), 0, 0, ...u16(border), 0, 0]
    const row = [190, ...u16(1 + 1 + 6 + 20), 2, ...u16(0), ...u16(1440), ...u16(2880), ...cell(0x09), ...cell(0x09)]
    const blocks = blocksOf(
      olderFile(6, {
        paragraphs: [
          { bytes: [...latin('One'), 0x0d], paragraph: numbered },
          { bytes: [...latin('Two'), 0x0d], paragraph: numbered },
          { bytes: [0x41, 0x07], paragraph: [24, 1] },
          { bytes: [0x42, 0x07], paragraph: [24, 1] },
          { bytes: [0x07], paragraph: [24, 1, 25, 1, ...row] }
        ]
      })
    )
    expect(blocks.slice(0, 2).map((block) => (block as DocumentParagraph).marker?.text)).toEqual(['1. ', '2. '])
    const table = blocks[2] as DocumentTable
    expect(table.columns).toEqual([72, 72])
    expect(table.rows[0]?.cells.map((one) => [textsOf(one.blocks), one.borders.top])).toEqual([
      [['A'], { width: 0.75, style: 'solid', color: '#000000' }],
      [['B'], { width: 0.75, style: 'solid', color: '#000000' }]
    ])
  })
})

describe('the look of a Word 2 document', () => {
  it('sets its paragraphs and runs in their styles, their characters described as Word 2 describes them, in their fonts’ code pages', () => {
    // The styles' names, then each one's characters and paragraph properties, then which each comes from.
    const names = [0, 9, ...latin('heading 1')]
    const characters = [7, 0, 0, 0x06, 0, 0, 0, 24, 1, 0x01]
    const paragraphs = [0xff, 9, 1, 0, 0, 0, 0, 0, 0, 5, 1]
    const styles = new Bytes()
      .u16(0)
      .u16(names.length + 2)
      .raw(names)
      .u16(characters.length + 2)
      .raw(characters)
      .u16(paragraphs.length + 2)
      .raw(paragraphs)
      .u16(2)
      .raw([0, 222, 0, 0]).values
    const blocks = blocksOf(
      olderFile(2, {
        fonts: [
          { name: 'Tms Rmn', set: 0 },
          { name: 'Arial', set: 238 }
        ],
        styles,
        paragraphs: [
          { bytes: [...latin('Title'), 0x0d], style: 1 },
          {
            bytes: [...latin('Plain '), 0xe8, 0x0d],
            paragraph: [17, ...u16(720)],
            runs: [
              { length: 6, character: [0x02, 0, 0x02, 0, 0, 0] },
              { length: 1, character: [0, 0, 0x02, 0, 1, 0] }
            ]
          }
        ]
      })
    )
    expect(paragraphAt(blocks, 0)).toMatchObject({
      look: { align: 'center' },
      spans: [{ text: 'Title', look: { font: 'Tms Rmn', size: 12, bold: true } }],
      heading: 1
    })
    expect(paragraphAt(blocks, 1)).toMatchObject({
      look: { start: 36 },
      spans: [
        { text: 'Plain ', look: { font: 'Tms Rmn', size: 12, italic: true } },
        { text: 'č', look: { font: 'Arial', size: 12 } }
      ]
    })
  })
})
