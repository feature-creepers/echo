import { describe, expect, it } from 'vitest'
import { reader, wordProperties } from './binary-records.ts'
import {
  characterRun,
  formattedRuns,
  onePropertySize,
  paragraphRun,
  runAt,
  sixPropertySize,
  twoCharacters,
  twoPropertySize,
  type WordVersion,
  wordProperties97
} from './older-word-properties.ts'

const decode = (bytes: Uint8Array) => new TextDecoder('windows-1251').decode(bytes)

/** A list of properties as Word 97 writes them, each its code and operand in hexadecimal bytes. */
function listed(found: { bytes: ReturnType<typeof reader>; at: number; end: number }): string[] {
  return [...wordProperties(found.bytes, found.at, found.end)].map(
    ({ code, at, size }) => `${code.toString(16)}:${[...found.bytes.bytes(at, size)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`
  )
}

describe('the sizes of the older versions’ properties', () => {
  it.each([
    ['a paragraph’s alignment, one byte', [5, 1], 2],
    ['an indent, two bytes', [17, 0x40, 0x01], 3],
    ['line spacing, four bytes', [20, 0xf0, 0, 1, 0], 5],
    ['tab stops, counted in their first byte', [15, 4, 0, 1, 0x40, 0x01], 6],
    ['a table’s definition, counted in two bytes', [190, 3, 0, 1, 2, 3], 5],
    ['a picture’s place, five bytes', [68, 1, 2, 3, 4, 5], 6],
    ['a table’s borders, twelve bytes', [187, ...new Array(12).fill(0)], 13],
    ['tab stops past 255, what they take away and add each counted', [23, 255, 1, 0, 0, 0, 0, 1, 0, 0, 0], 11]
  ])('Word 6 and 95: %s', (_, bytes, size) => {
    expect(sixPropertySize(reader(Uint8Array.from(bytes)), 0)).toBe(size)
  })

  it.each([
    ['the property passed over, of no operand', [0], 1],
    ['the ruler, of no operand', [52], 1],
    ['an indent, two bytes', [17, 0x40, 0x01], 3],
    ['line spacing, three bytes', [70, 1, 2, 3], 4],
    ['a picture’s place and scale, thirteen bytes', [95, ...new Array(13).fill(0)], 14],
    ['a table’s definition, counted in two bytes', [152, 2, 0, 1, 2], 4],
    ['a number’s description, counted in one byte', [3, 2, 1, 1], 4],
    ['an alignment, one byte', [5, 1], 2]
  ])('Word 2: %s', (_, bytes, size) => {
    expect(twoPropertySize(reader(Uint8Array.from(bytes)), 0)).toBe(size)
  })

  it.each([
    ['a number’s description, counted in one byte', [12, 2, 7, 7], 4],
    ['whole characters, counted in one byte', [57, 1, 0], 3],
    ['a picture’s scale, counted in one byte', [95, 2, 0, 0], 4],
    ['a table’s definition, counted in two bytes and one more', [152, 1, 0, 9, 9], 4],
    ['an indent, as Word 2’s', [17, 0x40, 0x01], 3]
  ])('Word 1: %s', (_, bytes, size) => {
    expect(onePropertySize(reader(Uint8Array.from(bytes)), 0)).toBe(size)
  })
})

describe('the older versions’ properties written as Word 97’s', () => {
  it.each([
    ['a paragraph’s style', [2, 3, 0], ['4600:03 00']],
    ['its alignment, indents and spacing', [5, 1, 17, 0x40, 0x01, 21, 0x78, 0, 20, 0xf0, 0, 1, 0], ['2403:01', '840f:40 01', 'a413:78 00', '6412:f0 00 01 00']],
    ['its tab stops', [15, 4, 0, 1, 0x40, 0x01, 2], ['c60d:04 00 01 40 01']],
    ['a border of Word 6, its width in quarters of three points and its space', [38, 0x09, 0x08], ['6424:06 01 00 01']],
    ['a dotted border of Word 6', [40, 0x0e, 0x00], ['6426:06 06 00 00']],
    ['a border of Word 2, its two lines’ widths', [30, 0x41, 0x00], ['6424:06 03 00 00']],
    [
      'a cell’s characters: bold, font, size, colour, underline and position',
      [85, 1, 93, 2, 0, 99, 24, 0, 98, 6, 94, 1, 104, 1],
      ['835:01', '4a4f:02 00', '4a43:18 00', '2a42:06', '2a3e:01', '2a48:01']
    ],
    ['a symbol, counted, its font then its character', [74, 3, 1, 0, 0xb7], ['6a09:01 00 b7 00']],
    [
      'a section’s page, margins, columns and vertical alignment',
      [164, 0xd0, 0x2f, 166, 0x08, 0x07, 144, 1, 0, 159, 1],
      ['b01f:d0 2f', 'b021:08 07', '500b:01 00', '301a:01']
    ],
    ['a table row’s gap, height and alignment', [184, 0x6c, 0, 189, 0x2c, 0xfe, 182, 1, 0], ['9602:6c 00', '9407:2c fe', '5400:01 00']]
  ])('Word 6: %s', (_, bytes, expected) => {
    expect(listed(wordProperties97(6, reader(Uint8Array.from(bytes)), 0, bytes.length, decode))).toEqual(expected)
  })

  it('widens a table row’s cells, their borders from two bytes to four', () => {
    // Its length less one, two cells, their three edges, then each cell's merges and four borders.
    const bytes = [190, 1 + 1 + 6 + 20, 0, 2, 0, 0, 0x40, 0x01, 0x80, 0x02, 1, 0, 0x09, 0, 0, 0, 0, 0, 0, 0, ...new Array(10).fill(0)]
    const [written] = listed(wordProperties97(6, reader(Uint8Array.from(bytes)), 0, bytes.length, decode))
    const cells = [2, 0, 0, 0x40, 0x01, 0x80, 0x02]
    const first = [1, 0, 0, 0, 6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const second = new Array(20).fill(0)
    const body = [...cells, ...first, ...second]
    expect(written).toBe(`d608:${[body.length + 1, 0, ...body].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`)
  })

  it('keeps an automatic number’s level beside the properties, and writes its description’s text in 16 bits', () => {
    const description = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, ...new Array(8).fill(0), 0xcf, 0x2e, ...new Array(30).fill(0)]
    const bytes = [13, 10, 12, description.length, ...description]
    const found = wordProperties97(6, reader(Uint8Array.from(bytes)), 0, bytes.length, decode)
    expect(found.numbering).toBe(10)
    const [written] = listed(found)
    // The text "П." in Cyrillic, widened.
    const start = `c63e:54 ${description
      .slice(0, 20)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(' ')} 1f 04 2e 00`
    expect(written?.slice(0, start.length)).toBe(start)
  })

  it.each([
    ['a paragraph’s indent and alignment, as Word 6’s', [17, 0x40, 0x01, 5, 2], ['840f:40 01', '2403:02']],
    ['a section’s page width, its code 25 below Word 6’s', [139, 0xd0, 0x2f], ['b01f:d0 2f']],
    ['a table row’s gap, its code 36 below Word 6’s', [148, 0x6c, 0], ['9602:6c 00']],
    ['the ruler and the property passed over, which say nothing', [52, 0, 5, 1], ['2403:01']]
  ])('Word 2: %s', (_, bytes, expected) => {
    expect(listed(wordProperties97(2, reader(Uint8Array.from(bytes)), 0, bytes.length, decode))).toEqual(expected)
  })

  it('ends a list at a property that runs past it', () => {
    const bytes = [5, 1, 17, 0x40]
    expect(listed(wordProperties97(6, reader(Uint8Array.from(bytes)), 0, bytes.length, decode))).toEqual(['2403:01'])
  })

  it.each([
    ['bold and italic, turned from their style’s', [0x03, 0, 0], ['835:81', '836:81']],
    ['struck, special and an object', [0, 0x0e, 0], ['837:81', '855:01', '856:01']],
    [
      'its font, size, colour and underline where it says it sets them',
      [0, 0, 0x0f, 0, 3, 0, 24, 0, 0, 0x26],
      ['4a4f:03 00', '4a43:18 00', '2a42:06', '2a3e:01']
    ],
    ['nothing it does not set', [0, 0, 0, 0, 3, 0, 24], []]
  ])('Word 2’s characters: %s', (_, bytes, expected) => {
    expect(listed(twoCharacters(reader(Uint8Array.from(bytes)), 0, bytes.length))).toEqual(expected)
  })
})

/** A page of runs: where each starts and ends, then each run's entry, its first byte where its properties are in words. */
function runPage(runs: { start: number; end: number; properties: number[] | undefined; counted?: number }[], entry: number): Uint8Array {
  const page = new Uint8Array(1024)
  const view = new DataView(page.buffer, 512)
  runs.forEach((run, index) => {
    view.setUint32(index * 4, run.start, true)
    view.setUint32((index + 1) * 4, run.end, true)
  })
  let free = 511
  runs.forEach((run, index) => {
    if (!run.properties) return
    free -= run.properties.length + 1
    free -= free % 2
    page[512 + free] = run.counted ?? run.properties.length
    page.set(run.properties, 512 + free + 1)
    page[512 + (runs.length + 1) * 4 + index * entry] = free / 2
  })
  page[1023] = runs.length
  return page
}

describe('the runs of characters and paragraphs', () => {
  it.each<[string, WordVersion, number, number, number]>([
    ['Word 97 counts a paragraph’s properties in words less one', 97, 13, 2, 3],
    ['Word 6 counts them in words', 6, 7, 2, 4],
    ['Word 2 too, its runs’ entries one byte each', 2, 1, 2, 4]
  ])('%s', (_, version, entry, counted, size) => {
    const page = runPage(
      [
        { start: 0x200, end: 0x210, properties: [0, 0, 5, 1], counted },
        { start: 0x210, end: 0x220, properties: undefined }
      ],
      entry
    )
    const runs = formattedRuns(reader(page), version, [1], true)
    expect(runs.map(({ start, end, size }) => ({ start, end, size }))).toEqual([
      { start: 0x200, end: 0x210, size },
      { start: 0x210, end: 0x220, size: 0 }
    ])
  })

  it('reads a long paragraph’s properties of Word 97, counted in the byte after a zero', () => {
    const page = runPage([{ start: 0x200, end: 0x210, properties: [2, 0, 0, 5, 1], counted: 0 }], 13)
    expect(formattedRuns(reader(page), 97, [1], true)).toEqual([{ start: 0x200, end: 0x210, at: expect.any(Number), size: 4 }])
  })

  it('passes over a page past the stream’s end, and runs of characters of no properties', () => {
    const page = runPage(
      [
        { start: 0x200, end: 0x204, properties: [0x55, 0x08, 1] },
        { start: 0x204, end: 0x208, properties: undefined }
      ],
      1
    )
    expect(formattedRuns(reader(page), 97, [1, 9], false).map(({ start, size }) => ({ start, size }))).toEqual([{ start: 0x200, size: 3 }])
  })

  it.each([
    [0x1ff, undefined],
    [0x200, 0x200],
    [0x20f, 0x200],
    [0x210, 0x210],
    [0x22f, 0x220],
    [0x230, undefined]
  ])('finds the run of the place %i by halves', (place, start) => {
    const runs = [
      { start: 0x200, end: 0x210 },
      { start: 0x210, end: 0x220 },
      { start: 0x220, end: 0x230 }
    ]
    expect(runAt(runs, place)?.start).toBe(start)
  })

  it.each<[WordVersion, number[], number, string[]]>([
    [97, [3, 0, 0x03, 0x24, 1], 3, ['2403:01']],
    [6, [3, 0, 5, 1], 3, ['2403:01']],
    [2, [3, 0, 0, 0, 0, 0, 0, 5, 1], 3, ['2403:01']],
    [1, [3, 0, 0, 0, 0, 0, 0, 5, 1], 3, ['2403:01']]
  ])('reads a paragraph’s style and properties as Word %i keeps them', (version, bytes, style, expected) => {
    const found = paragraphRun(reader(Uint8Array.from(bytes)), version, { start: 0, end: 1, at: 0, size: bytes.length }, decode)
    expect(found.style).toBe(style)
    expect(listed(found.properties)).toEqual(expected)
  })

  it.each<[WordVersion, number[], string[]]>([
    [97, [0x35, 0x08, 1], ['835:01']],
    [6, [85, 1], ['835:01']],
    [2, [1, 0, 0], ['835:81']],
    [1, [1, 0, 0], []]
  ])('reads a run’s characters as Word %i keeps them', (version, bytes, expected) => {
    expect(listed(characterRun(reader(Uint8Array.from(bytes)), version, { start: 0, end: 1, at: 0, size: bytes.length }, decode))).toEqual(expected)
  })
})
