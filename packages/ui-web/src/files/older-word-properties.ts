/**
 * The properties of a Word document's runs and paragraphs as each older version keeps them (docs/SPEC.md, section 9.7),
 * written as Word 97 writes its own, so that one reader shows the look of every version (`older-word-look.ts`) and
 * another its text (`binary-office.ts`).
 *
 * Word 97 to 2003 name each property (`sprm`) by a code of two bytes that says how long its operand is. Word 6 and 95
 * name it by one byte, its operand's size known by the code; Word 2 by codes of its own, most of them Word 6's less 25
 * or 36, a few with a shorter operand, and it keeps a run's characters as the first bytes of their whole description
 * (`CHP`) rather than as a list. Their borders take two bytes where Word 97's take four, so their tables' cells take
 * ten where Word 97's take twenty, and their automatic numbers keep their text in 8 bits: each is widened as it is
 * written. Word 1 writes its properties as Word 2 does, but for four it counts in their first bytes.
 */

import { type Reader, reader } from './binary-records.ts'

/** The version of Word whose records a document is written in: 97 for Word 97 to 2003, 6 for Word 6 and 95, then 2 and 1. */
export type WordVersion = 97 | 6 | 2 | 1

/**
 * A list of properties as Word 97 writes them and the bytes it is in; with Word 6's level of automatic numbering
 * (`nLvlAnm`: 1 to 9 an outline's levels, 10 a numbered paragraph, 11 a bulleted one), which Word 97 keeps no property
 * for.
 */
export interface Properties {
  bytes: Reader
  at: number
  end: number
  numbering?: number | undefined
}

// Sizes

/**
 * How many bytes a property of Word 6 and 95 takes with its one-byte code: most a fixed size by their code, some
 * counting their operand in their first byte, a table's definition in its first two, tab stops past 255 in their own
 * way.
 */
export function sixPropertySize(word: Reader, at: number): number {
  const code = word.u8(at)
  if (TWO_BYTE_OPERANDS.has(code)) return 3
  if (code === 188 || code === 190) return 2 + word.u16(at + 1)
  if (COUNTED_OPERANDS.has(code)) return 2 + word.u8(at + 1)
  if (FOUR_BYTE_OPERANDS.has(code)) return 5
  if (code === 23) return tabsSize(word, at)
  if (code === 68 || code === 193 || code === 199) return 6
  if (code === 73 || code === 95 || code === 136 || code === 137) return 4
  if (code === 120 || code === 187) return 13
  return 2
}

/** Tab stops changed, past 255 of them, list what they take away and add, each counted. */
function tabsSize(word: Reader, at: number): number {
  const size = word.u8(at + 1)
  if (size !== 255) return 2 + size
  const removed = word.u8(at + 2)
  return 2 + 2 + removed * 4 + word.u8(at + 3 + removed * 4) * 3
}

const TWO_BYTE_OPERANDS = new Set([
  2, 16, 17, 18, 19, 21, 22, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 69, 72, 80, 93, 96, 97, 99, 101, 105, 106, 107,
  109, 110, 121, 122, 123, 124, 140, 141, 144, 145, 148, 149, 154, 155, 156, 157, 160, 161, 164, 165, 166, 167, 168, 169, 170, 171, 182, 183, 184, 189, 195,
  197, 198
])
const COUNTED_OPERANDS = new Set([3, 12, 15, 81, 103, 108, 133, 191])
const FOUR_BYTE_OPERANDS = new Set([20, 70, 74, 192, 194, 196, 200])

/**
 * How many bytes a property of Word 2 takes with its one-byte code, as Word 6's do with sizes of their own: most one
 * byte of operand, some two, some counting their operand in their first byte, a table's definition in its first two,
 * tab stops as Word 6 changes them.
 */
export function twoPropertySize(word: Reader, at: number): number {
  const code = word.u8(at)
  if (code === 23) return tabsSize(word, at)
  if (code === 152 || code === 154) return 2 + word.u16(at + 1)
  if (TWO_COUNTED_OPERANDS.has(code)) return 2 + word.u8(at + 1)
  // The properties of no operand: the one passed over, the ruler, plain characters.
  if (code === 0 || code === 52 || code === 58) return 1
  return TWO_SIZES.get(code) ?? (TWO_TWO_BYTE_OPERANDS.has(code) ? 3 : 2)
}

const TWO_COUNTED_OPERANDS = new Set([3, 15, 57, 78, 155])
const TWO_TWO_BYTE_OPERANDS = new Set([
  16, 17, 18, 19, 20, 21, 22, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 68, 71, 72, 82, 83, 96, 97, 98, 99, 115, 116,
  119, 120, 123, 124, 129, 130, 131, 132, 135, 136, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 153, 159, 161, 162
])
const TWO_SIZES = new Map([
  [70, 4],
  [95, 14],
  [157, 6],
  [163, 6],
  [158, 5],
  [160, 5],
  [164, 5]
])

/**
 * How many bytes a property of Word 1 takes: as Word 2's, but for those Word 1 counts in their first byte (numbering,
 * whole characters, a picture's scale) and its table's definition, counted in two.
 */
export function onePropertySize(word: Reader, at: number): number {
  const code = word.u8(at)
  if (code === 12 || code === 57 || code === 95) return 2 + word.u8(at + 1)
  if (code === 152) return 3 + word.u16(at + 1)
  return twoPropertySize(word, at)
}

/** The code Word 6 gives a property of Word 2 and 1: the same for a paragraph's, 25 more for most others, 36 more for a table's. */
function sixCode(code: number): number {
  if (code <= 52) return code
  if (code >= 53 && code <= 55) return code + 12
  if ((code >= 57 && code <= 78) || (code >= 112 && code <= 145)) return code + 25
  if (code >= 146 && code <= 164) return code + 36
  return 0
}

// Writing

/** Bytes written in order, little-endian. */
class Written {
  readonly values: number[] = []
  property(code: number, ...operand: number[]) {
    this.values.push(code & 0xff, code >> 8, ...operand.map((value) => value & 0xff))
  }
}
const short = (value: number) => [value & 0xff, (value >> 8) & 0xff]

/**
 * A border of Word 6 and 95 (`BRC`, two bytes: its line's width in quarters of three points or 6 for dots and 7 for
 * dashes, its kind, its shadow, its colour by number, its distance from the text) as Word 97's (`BRC80`, four bytes).
 */
function sixBorder(value: number): number[] {
  const width = value & 7
  const kind = (value >> 3) & 3
  if (kind === 0 && width === 0) return [0, 0, 0, 0]
  const type = width === 6 ? 6 : width === 7 ? 7 : kind === 0 ? 1 : kind
  const eighths = width >= 6 || width === 0 ? 6 : width * 6
  return [eighths, type, (value >> 6) & 0x1f, ((value >> 11) & 0x1f) | ((value >> 5) & 1 ? 0x20 : 0)]
}

/** A border of Word 1 and 2 (`BRC10`: the widths of up to two lines and the space between them) as Word 97's. */
function tenBorder(value: number): number[] {
  const second = value & 7
  const first = (value >> 6) & 7
  if (first === 0 && second === 0) return [0, 0, 0, 0]
  return [Math.max(first, second) * 6, first > 0 && second > 0 ? 3 : 1, 0, (value >> 9) & 0x1f]
}

/** The size of Word 6's description of an automatic number (`ANLD`): its level's look, then 32 bytes of text. */
const ANLD_SIZE = 52

/**
 * A property of Word 6 and 95, by its code and where its operand is, written as Word 97's: the same property where
 * Word 97 has it, its operand widened where Word 97's is wider; nothing for one no look shows.
 */
function writeSix(written: Written, code: number, source: Reader, at: number, size: number, decode: (bytes: Uint8Array) => string): number | undefined {
  const byte = () => source.u8(at)
  const word = () => (size >= 2 ? source.u16(at) : source.u8(at))
  const all = () => [...source.bytes(at, size)]
  switch (code) {
    case 2:
      written.property(0x4600, ...short(word()))
      return
    case 12: {
      // Word 97 keeps the same description, its text in 16 bits.
      if (size < 1 + ANLD_SIZE || byte() < ANLD_SIZE) return
      const text = [...decode(source.bytes(at + 1 + 20, 32))].slice(0, 32)
      const wide = [...text.flatMap((character) => short(character.charCodeAt(0))), ...new Array<number>(64 - text.length * 2).fill(0)]
      written.property(0xc63e, 84, ...source.bytes(at + 1, 20), ...wide)
      return
    }
    case 13:
      return byte()
    case 15:
      written.property(0xc60d, ...all())
      return
    case 20:
      written.property(0x6412, ...(size >= 4 ? all() : [...short(word()), 0, 0]))
      return
    case 23:
      written.property(0xc615, ...all())
      return
    case 68:
      if (size >= 5) written.property(0x6a03, ...source.bytes(at + 1, 4))
      return
    case 74:
      // A symbol: its font, then its character in that font.
      if (size >= 4) written.property(0x6a09, source.u8(at + 1), source.u8(at + 2), source.u8(at + 3), 0)
      return
    case 83:
      written.property(0x2a33, 0)
      return
    case 95:
      if (byte() > 0) written.property(0x4a43, byte(), 0)
      return
    case 99:
      written.property(0x4a43, ...short(word()))
      return
    case 105:
      if (size >= 3) written.property(0x4a43, ...short(source.u16(at + 1)))
      return
    case 187:
      if (size >= 12) written.property(0xd605, 24, ...Array.from({ length: 6 }, (_, index) => sixBorder(source.u16(at + index * 2))).flat())
      return
    case 190:
      writeTable(written, source, at, size)
      return
    case 193:
      if (size >= 5) written.property(0xd620, 7, source.u8(at), source.u8(at + 1), source.u8(at + 2), ...sixBorder(source.u16(at + 3)))
      return
  }
  if (code >= 30 && code <= 35) written.property(BORDER_CODES[code - 30] as number, ...tenBorder(word()))
  else if (code >= 38 && code <= 43) written.property(BORDER_CODES[code - 38] as number, ...sixBorder(word()))
  else {
    const same = SAME_PROPERTIES.get(code)
    if (same === undefined || size < 1) return undefined
    // Word 97's code says how long its operand is: one byte, two (a shorter one widened), or as many as Word 6 wrote.
    const kind = (same >> 13) & 7
    if (kind === 0 || kind === 1) written.property(same, byte())
    else if (kind === 2 || kind === 4 || kind === 5) written.property(same, ...short(word()))
    else written.property(same, ...all())
  }
  return undefined
}

/** Word 97's paragraph borders, top, left, bottom, right, between paragraphs and the bar beside them. */
const BORDER_CODES = [0x6424, 0x6425, 0x6426, 0x6427, 0x6428, 0x6629]

/**
 * Word 6's properties Word 97 writes the same, by the code it gives them: one byte of operand, or two where Word 97's
 * code says so, which Word 2's of one byte are widened to.
 */
const SAME_PROPERTIES = new Map([
  [5, 0x2403],
  [7, 0x2405],
  [8, 0x2406],
  [9, 0x2407],
  [16, 0x840e],
  [17, 0x840f],
  [19, 0x8411],
  [21, 0xa413],
  [22, 0xa414],
  [24, 0x2416],
  [25, 0x2417],
  [26, 0x8418],
  [27, 0x8419],
  [28, 0x841a],
  [29, 0x261b],
  [37, 0x2423],
  [45, 0x442b],
  [46, 0x442c],
  [47, 0x442d],
  [48, 0x842e],
  [49, 0x842f],
  [51, 0x2431],
  [65, 0x0800],
  [66, 0x0801],
  [67, 0x0802],
  [71, 0x0806],
  [75, 0x080a],
  [80, 0x4a30],
  [85, 0x0835],
  [86, 0x0836],
  [87, 0x0837],
  [88, 0x0838],
  [89, 0x0839],
  [90, 0x083a],
  [91, 0x083b],
  [92, 0x083c],
  [93, 0x4a4f],
  [94, 0x2a3e],
  [96, 0x8840],
  [98, 0x2a42],
  [104, 0x2a48],
  [117, 0x0855],
  [118, 0x0856],
  [142, 0x3009],
  [143, 0x300a],
  [144, 0x500b],
  [145, 0x900c],
  [147, 0x300e],
  [150, 0x3011],
  [153, 0x3014],
  [156, 0xb017],
  [157, 0xb018],
  [159, 0x301a],
  [161, 0x501c],
  [162, 0x301d],
  [164, 0xb01f],
  [165, 0xb020],
  [166, 0xb021],
  [167, 0xb022],
  [168, 0x9023],
  [169, 0x9024],
  [170, 0xb025],
  [182, 0x5400],
  [184, 0x9602],
  [185, 0x3403],
  [186, 0x3404],
  [189, 0x9407],
  [191, 0xd609],
  [197, 0x5624],
  [198, 0x5625],
  [200, 0x7627]
])

/**
 * A table row's definition (`sprmTDefTable`): how many cells, the places of their edges, then each cell's merges and
 * borders, ten bytes each in Word 6 and twenty in Word 97, whose borders are wider.
 */
function writeTable(written: Written, source: Reader, at: number, size: number): void {
  if (size < 3) return
  const count = Math.min(source.u8(at + 2), 64)
  const edges = at + 3
  const cells = edges + (count + 1) * 2
  if (cells > at + size) return
  const stored = Math.min(count, Math.floor((at + size - cells) / 10))
  const body = [count, ...source.bytes(edges, (count + 1) * 2)]
  for (let index = 0; index < stored; index++) {
    const cell = cells + index * 10
    body.push(source.u8(cell) & 3, 0, 0, 0, ...Array.from({ length: 4 }, (_, side) => sixBorder(source.u16(cell + 2 + side * 2))).flat())
  }
  written.property(0xd608, ...short(body.length + 1), ...body)
}

/**
 * A list of properties of Word 6 and 95, or of Word 2 or 1, as Word 97 writes it, with Word 6's level of automatic
 * numbering beside it. Its 8-bit text is decoded as the document's. One that runs past the list's end ends it.
 */
export function wordProperties97(version: 6 | 2 | 1, source: Reader, from: number, end: number, decode: (bytes: Uint8Array) => string): Properties {
  const written = new Written()
  const sizeOf = version === 6 ? sixPropertySize : version === 2 ? twoPropertySize : onePropertySize
  let numbering: number | undefined
  for (let place = from; place < end; ) {
    const size = sizeOf(source, place)
    if (place + size > end) break
    const code = version === 6 ? source.u8(place) : sixCode(source.u8(place))
    // Word 2's numbering is a level of one byte, as Word 6's; its code 12 is no description of a number.
    if (code !== 0 && !(version !== 6 && code === 12)) {
      const level = writeSix(written, code, source, place + 1, size - 1, decode)
      if (level !== undefined) numbering = level
    }
    place += size
  }
  return { bytes: reader(new Uint8Array(written.values)), at: 0, end: written.values.length, numbering }
}

/**
 * A run's characters as Word 2 keeps them (the first bytes of their `CHP`) as Word 97's properties: its toggles each
 * turned the other way from its style's when set, then its font, size, colour and underline where it says it sets
 * them, and where its picture is.
 */
export function twoCharacters(source: Reader, at: number, size: number): Properties {
  const byte = (offset: number) => (offset < size ? source.u8(at + offset) : 0)
  const written = new Written()
  const toggles: [number, number, number][] = [
    [0, 0x01, 0x0835],
    [0, 0x02, 0x0836],
    [0, 0x08, 0x0838],
    [0, 0x20, 0x083a],
    [0, 0x40, 0x083b],
    [0, 0x80, 0x083c],
    [1, 0x04, 0x0837]
  ]
  for (const [offset, bit, code] of toggles) if (byte(offset) & bit) written.property(code, 0x81)
  if (byte(0) & 0x04) written.property(0x0800, 1)
  if (byte(0) & 0x10) written.property(0x0802, 1)
  if (byte(1) & 0x02) written.property(0x0855, 1)
  if (byte(1) & 0x08) written.property(0x0856, 1)
  const set = byte(2)
  if (set & 0x02 && size >= 6) written.property(0x4a4f, byte(4), byte(5))
  if (set & 0x04 && size >= 7) written.property(0x4a43, byte(6), 0)
  if (set & 0x01 && size >= 10) written.property(0x2a42, byte(9) & 0x1f)
  if (set & 0x08 && size >= 10) written.property(0x2a3e, byte(9) >> 5)
  if (size >= 24) written.property(0x6a03, byte(20), byte(21), byte(22), byte(23))
  return { bytes: reader(new Uint8Array(written.values)), at: 0, end: written.values.length }
}

// Runs

/** A run of characters or paragraphs with properties of their own: where it starts and ends in the file, and where they are, -1 for none. */
export interface FormattedRun {
  start: number
  end: number
  at: number
  size: number
}

/**
 * The runs of characters or paragraphs with properties of their own, from their pages of 512 bytes (`FKP`) in the main
 * stream, in order. Each run names its properties by a byte, which a paragraph's follows with what Word last measured of
 * it: twelve bytes in Word 97, six in Word 6 and 95, none in Word 2, which keeps them with the properties.
 */
export function formattedRuns(word: Reader, version: WordVersion, pages: readonly number[], paragraphs: boolean): FormattedRun[] {
  const runs: FormattedRun[] = []
  const entry = paragraphs ? (version === 97 ? 13 : version === 6 ? 7 : 1) : 1
  for (const number of pages) {
    const page = number * 512
    if (page + 512 > word.length) continue
    const count = Math.min(word.u8(page + 511), 101)
    for (let run = 0; run < count; run++) {
      const offset = word.u8(page + (count + 1) * 4 + run * entry) * 2
      const start = word.u32(page + run * 4)
      const end = word.u32(page + (run + 1) * 4)
      if (offset === 0) {
        if (paragraphs) runs.push({ start, end, at: -1, size: 0 })
        continue
      }
      const length = word.u8(page + offset)
      if (!paragraphs) runs.push({ start, end, at: page + offset + 1, size: length })
      // Word 97 counts a long paragraph's properties in the byte after a zero, and counts its count's byte among the
      // words; Word 6, 95 and 2 count the words after it, their last property often reaching the last byte.
      else if (length === 0 && version === 97) runs.push({ start, end, at: page + offset + 2, size: word.u8(page + offset + 1) * 2 })
      else runs.push({ start, end, at: page + offset + 1, size: version === 97 ? length * 2 - 1 : length * 2 })
    }
  }
  return runs.sort((one, other) => one.start - other.start)
}

/** The run a place falls in, by halves. */
export function runAt<Run extends { start: number; end: number }>(runs: readonly Run[], place: number): Run | undefined {
  let low = 0
  let high = runs.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const run = runs[middle] as Run
    if (place < run.start) high = middle - 1
    else if (place >= run.end) low = middle + 1
    else return run
  }
  return undefined
}

/**
 * Where each version keeps a paragraph's properties in its run: its style in two bytes, then its properties, in Word 97,
 * 6 and 95; its style's code in one byte and six bytes of its lines' heights before them in Word 2 and 1.
 */
export function paragraphRun(
  word: Reader,
  version: WordVersion,
  run: FormattedRun,
  decode: (bytes: Uint8Array) => string
): { style: number; properties: Properties } {
  if (run.at < 0 || run.size < 1) return { style: 0, properties: { bytes: word, at: 0, end: 0 } }
  if (version === 97) return { style: run.size >= 2 ? word.u16(run.at) : 0, properties: { bytes: word, at: run.at + 2, end: run.at + run.size } }
  if (version === 6) return { style: run.size >= 2 ? word.u16(run.at) : 0, properties: wordProperties97(6, word, run.at + 2, run.at + run.size, decode) }
  return { style: word.u8(run.at), properties: wordProperties97(version, word, run.at + 7, run.at + run.size, decode) }
}

/**
 * A run's characters' properties as Word 97's: Word 97's own, Word 6's written so, Word 2's from their description;
 * none for Word 1, whose description is its own.
 */
export function characterRun(word: Reader, version: WordVersion, run: FormattedRun, decode: (bytes: Uint8Array) => string): Properties {
  if (version === 97) return { bytes: word, at: run.at, end: run.at + run.size }
  if (version === 6) return wordProperties97(6, word, run.at, run.at + run.size, decode)
  if (version === 2) return twoCharacters(word, run.at, run.size)
  return { bytes: word, at: 0, end: 0 }
}
