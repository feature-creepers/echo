/**
 * The equations of Equation Editor 3 and MathType, objects of another app inside a Word, PowerPoint or Excel file, as
 * linear text (docs/SPEC.md, section 9.7), written as `office-math.ts` writes Word's own: a fraction as a/b, powers and
 * indices in superscript and subscript characters where Unicode has them, roots, sums and integrals with their limits,
 * brackets, matrices. The object keeps its equation in its `Equation Native` stream, a header then MTEF, Design
 * Science's format of records, version 3 for Equation Editor and 5 for MathType 4 and later, read as its published
 * specification describes them. An equation that cannot be read is none: its picture is shown instead.
 */

import type { Compound } from './compound.ts'
import { grouped, script } from './office-math.ts'

/** What an equation is made of: lines of characters and templates, piles of lines and matrices of cells. */
type Item =
  | { kind: 'line'; items: Item[] }
  | { kind: 'char'; text: string; typeface: number }
  | { kind: 'template'; selector: number; variation: number; parts: Item[] }
  | { kind: 'pile'; lines: Item[] }
  | { kind: 'matrix'; columns: number; cells: Item[] }
  | { kind: 'embellishment'; mark: number }

/** The deepest an equation's records are read, the most records read and the longest text written: past them, it is damaged. */
const DEPTH_LIMIT = 64
const RECORD_LIMIT = 100_000
const TEXT_LIMIT = 10_000

class Damaged extends Error {}
const damaged = (): never => {
  throw new Damaged('The equation is damaged.')
}

/** The marks of MTEF's embellishments, by their code: a combining mark over or under a character, or a prime after it. */
const EMBELLISHMENTS: Record<number, string> = {
  2: '̇',
  3: '̈',
  4: '⃛',
  5: '′',
  6: '″',
  7: '‵',
  8: '̃',
  9: '̂',
  10: '̸',
  11: '⃗',
  12: '⃖',
  13: '⃡',
  14: '⃑',
  15: '⃐',
  16: '̵',
  17: '̅',
  18: '‴',
  19: '̑',
  20: '̆',
  21: '⃫',
  22: '̸',
  23: '⃥',
  24: '⃜',
  25: '̣',
  26: '̤',
  27: '⃨',
  29: '̲',
  30: '̰',
  31: '̯',
  32: '̮',
  33: '⃯',
  34: '⃮',
  35: '͍',
  36: '⃬',
  37: '⃭'
}

/**
 * The characters MathType keeps in its own private range (MTCode) that Unicode has: operators, letterlike symbols and
 * integrals. Its spaces are spaces; any other of its own characters has no character to stand for it, and is left out.
 */
const PRIVATE_CHARACTERS: Record<number, string> = {
  59649: '⩲',
  59650: '⩱',
  59651: '⨦',
  59652: '⨤',
  59656: '⪜',
  59657: '⪛',
  59658: '⋾',
  59659: '⊇',
  59660: '⊆',
  59666: '⋷',
  59667: '⪚',
  59668: '⫈',
  59669: '⫇',
  59670: '⪾',
  59671: '⪽',
  59672: '⩦',
  59673: '⨫',
  59674: '⨬',
  59679: '⩬',
  59680: '⩏',
  59681: '⩎',
  59682: '⋚',
  59684: '⩪',
  59685: '⩫',
  59686: '⪋',
  59687: '⪌',
  59688: '≲',
  59689: '≳',
  59690: '⫍',
  59691: '⫎',
  59692: '⩧',
  59693: '⋛',
  59694: '|',
  59695: 'ǁ',
  59696: '⫼',
  59698: '≲',
  59699: '≳',
  59702: '⪡',
  59703: '⪢',
  59706: '⪷',
  59707: '⪸',
  59712: '⪳',
  59713: '⪴',
  59720: '⫤',
  59721: '∾',
  59722: '⊣',
  59723: '⩵',
  59724: '⩶',
  59725: '⧴',
  59726: '≡',
  59728: '⧏',
  59729: '⧐',
  59732: '⊃',
  59735: '⫊',
  59736: '⫉',
  59737: '⪐',
  59738: '⪏',
  59740: '⩓',
  59741: '⩔',
  59742: '⩣',
  59743: '⩢',
  59746: '⩰',
  59750: '⩸',
  59755: '⫷',
  59756: '⫸',
  59757: '≏',
  59758: '⪤',
  59759: '⩙',
  59760: '⫖',
  59761: '⫕',
  59762: '⫔',
  59763: '⫓',
  59769: '⫴',
  59771: '⫨',
  59772: '⫣',
  59773: '⫥',
  59774: '⫩',
  59775: '⫤',
  59776: '⦡',
  59777: '⫽',
  59778: '⦜',
  59780: '⦶',
  59781: '⨸',
  59786: '⫡',
  59787: '⦞',
  59788: '⦠',
  59789: '⦠',
  59790: '⥾',
  59791: '⦁',
  59792: '⧋',
  59794: '⨳',
  59796: '⧥',
  59797: '⩩',
  59798: '⫰',
  59800: '☾',
  59801: '☺',
  59813: '⬡',
  59814: '⨤',
  59815: '⨦',
  60673: '⅁',
  60675: 'ϝ',
  60676: 'ⅆ',
  60677: 'ⅇ',
  60678: 'ⅈ',
  60679: 'ⅉ',
  60680: 'ⅅ',
  61312: '∲',
  61313: '⨖',
  61314: '⨏'
}

/** A character of MTCode, a superset of Unicode, as text: its spaces as a space, the zero-width one as nothing. */
function characterText(code: number): string {
  const known = PRIVATE_CHARACTERS[code]
  if (known !== undefined) return known
  // MathType's spaces, of every width, two ranges alike.
  if ((code >= 0xef00 && code <= 0xef08) || (code >= 0xeb00 && code <= 0xeb08)) return code === 0xef01 || code === 0xeb01 || code === 0xef00 ? '' : ' '
  // Its script capitals and small letters, written as the letters they are.
  if (code >= 0xf000 && code <= 0xf019) return String.fromCharCode(0x41 + code - 0xf000)
  if (code >= 0xf01a && code <= 0xf033) return String.fromCharCode(0x61 + code - 0xf01a)
  if (code < 0x20 || (code >= 0xe000 && code <= 0xf8ff) || (code >= 0xd800 && code <= 0xdfff)) return ''
  return String.fromCharCode(code)
}

/**
 * The records of MTEF after its header, as items: version 3 packs a record's options in its tag's high half, version 5
 * writes them in a byte of their own after its type. Every read is checked against the end, and nesting and counts are
 * held to limits, so a damaged equation fails rather than reading past its end or looping.
 */
function readRecords(bytes: Uint8Array, start: number, five: boolean): Item[] {
  let at = start
  let records = 0
  const byte = () => (at < bytes.length ? (bytes[at++] as number) : damaged())
  const u16 = () => byte() | (byte() << 8)
  // Version 5's unsigned values: one byte below 255, else 255 then two bytes.
  const unsigned = () => {
    const first = byte()
    return first < 255 ? first : u16()
  }
  const text = () => {
    let read = ''
    for (let character = byte(); character !== 0; character = byte()) if (read.length < 256) read += String.fromCharCode(character)
    return read
  }
  // A nudge: two bytes, each offset by 128, or two of 128 then two 16-bit values.
  const nudge = (options: number) => {
    if (!(options & 0x08)) return
    const across = byte()
    const down = byte()
    if (across === 128 && down === 128) at += 4
    if (at > bytes.length) damaged()
  }
  // A ruler of tab stops, after a line or a pile that says one follows: its record's type, then its stops.
  const ruler = () => {
    const next = bytes[at] ?? damaged()
    if ((five ? next : next & 0x0f) === 7) at++
    const stops = byte()
    at += stops * 3
    if (at > bytes.length) damaged()
  }
  // A size: an explicit size in points, a size and a large change of it, or a size and a small change.
  const size = () => {
    const first = byte()
    if (first === 101) u16()
    else if (first === 100) {
      byte()
      u16()
    } else byte()
  }
  // Version 5's preferences, after their options: two arrays of dimensions, each a count then nibbles ending a
  // dimension at 15, then styles.
  const preferences = () => {
    for (let array = 0; array < 2; array++) {
      const count = byte()
      let nibble = 0
      const next = () => {
        const value = nibble % 2 === 0 ? (bytes[at] ?? damaged()) >> 4 : byte() & 0x0f
        nibble++
        return value
      }
      for (let dimension = 0; dimension < count; dimension++) {
        next()
        let digits = 0
        while (next() !== 0x0f) if (++digits > 64) damaged()
      }
      if (nibble % 2 === 1) at++
      if (at > bytes.length) damaged()
    }
    const styles = byte()
    for (let style = 0; style < styles; style++) if (unsigned() !== 0) byte()
  }

  const list = (depth: number): Item[] => {
    if (depth > DEPTH_LIMIT) damaged()
    const items: Item[] = []
    for (;;) {
      const item = record(depth)
      if (item === null) return items
      if (item) items.push(item)
    }
  }

  /** The next record: an item of the equation, nothing for one that only sets how it looks, or null at an end. */
  const record = (depth: number): Item | undefined | null => {
    if (++records > RECORD_LIMIT) damaged()
    const tag = byte()
    const type = five ? tag : tag & 0x0f
    if (type === 0) return null
    const options = five ? ([1, 2, 3, 4, 5, 6, 16, 18].includes(type) ? byte() : 0) : tag >> 4
    switch (type) {
      case 1: {
        nudge(options)
        if (options & 0x04) u16()
        if (options & 0x02) ruler()
        // A line that is only a placeholder holds nothing, and has no end of its own.
        return { kind: 'line', items: options & 0x01 ? [] : list(depth + 1) }
      }
      case 2: {
        nudge(options)
        const typeface = byte() - 128
        // Version 5 may write a character by its place in its font alone, which says nothing of what it is.
        const code = five && options & 0x20 ? undefined : u16()
        if (five && options & 0x04) byte()
        else if (five && options & 0x10) u16()
        const embellished = five ? options & 0x01 : options & 0x02
        const marks = embellished ? list(depth + 1) : []
        let written = code === undefined ? '' : characterText(code)
        for (const mark of marks)
          if (mark.kind === 'embellishment' && written !== '') {
            const sign = EMBELLISHMENTS[mark.mark] ?? ''
            written = mark.mark === 7 ? sign + written : written + sign
          }
        return { kind: 'char', text: written, typeface }
      }
      case 3: {
        nudge(options)
        const selector = byte()
        let variation = byte()
        if (five && variation & 0x80) variation = (variation & 0x7f) | (byte() << 8)
        byte()
        return { kind: 'template', selector, variation, parts: list(depth + 1) }
      }
      case 4: {
        nudge(options)
        byte()
        byte()
        if (options & 0x02) ruler()
        return { kind: 'pile', lines: list(depth + 1) }
      }
      case 5: {
        nudge(options)
        byte()
        byte()
        byte()
        const rows = byte()
        const columns = byte()
        // Each partition line between rows and columns takes two bits, rounded to a byte for each.
        at += Math.ceil((rows + 1) / 4) + Math.ceil((columns + 1) / 4)
        const cells = list(depth + 1)
        return { kind: 'matrix', columns: Math.max(1, columns), cells }
      }
      case 6: {
        nudge(options)
        const mark = byte()
        // Equation Editor writes a byte after each embellishment, which its files all hold at zero.
        if (!five) byte()
        return { kind: 'embellishment', mark }
      }
      case 7:
        at--
        ruler()
        return undefined
      case 8:
        // Version 3's font, by its typeface, style and name; version 5's style of a font defined before.
        if (five) {
          unsigned()
          byte()
        } else {
          byte()
          byte()
          text()
        }
        return undefined
      case 9:
        size()
        return undefined
      case 10:
      case 11:
      case 12:
      case 13:
      case 14:
        return undefined
    }
    if (!five) damaged()
    switch (type) {
      case 15:
        unsigned()
        return undefined
      case 16:
        at += options & 0x01 ? 8 : 6
        if (options & 0x04) text()
        if (at > bytes.length) damaged()
        return undefined
      case 17:
        unsigned()
        text()
        return undefined
      case 18:
        preferences()
        return undefined
      case 19:
        text()
        return undefined
    }
    // Records of later versions say how long they are, so a reader of this one passes over them.
    if (type < 100) damaged()
    const length = unsigned()
    at += length
    if (at > bytes.length) damaged()
    return undefined
  }

  return list(0)
}

/** The fences of version 3's templates of brackets, by selector: both sides, as drawn when their characters are left out. */
const FENCES_THREE: Record<number, [string, string]> = {
  0: ['⟨', '⟩'],
  1: ['(', ')'],
  2: ['{', '}'],
  3: ['[', ']'],
  4: ['|', '|'],
  5: ['‖', '‖'],
  6: ['⌊', '⌋'],
  7: ['⌈', '⌉'],
  8: ['[', '['],
  9: [']', ']'],
  10: [']', '['],
  11: ['[', ')'],
  12: ['(', ']']
}

const FENCES_FIVE: Record<number, [string, string]> = {
  0: ['⟨', '⟩'],
  1: ['(', ')'],
  2: ['{', '}'],
  3: ['[', ']'],
  4: ['|', '|'],
  5: ['‖', '‖'],
  6: ['⌊', '⌋'],
  7: ['⌈', '⌉'],
  8: ['⟦', '⟧']
}

/** What a template is, whatever the version that numbers it: how its parts are written, and its sign when it has one. */
type Shape =
  | { class: 'fence'; left: string; right: string; sides: 'both' | 'left' | 'right' }
  | { class: 'root' }
  | { class: 'fraction' }
  | { class: 'mark'; mark: string }
  | { class: 'arrow'; arrow: string; labels: ('top' | 'bottom')[] }
  | { class: 'operator'; sign: string }
  | { class: 'limit' }
  | { class: 'brace'; brace: string; top: boolean }
  | { class: 'division' }
  | { class: 'script'; sub: boolean; sup: boolean }
  | { class: 'dirac'; left: boolean; right: boolean }
  | { class: 'plain' }

const sidesOf = (variation: number): 'both' | 'left' | 'right' => (variation === 1 ? 'left' : variation === 2 ? 'right' : 'both')

/** Version 3's templates, numbered as Equation Editor numbers them. */
function shapeThree(selector: number, variation: number): Shape {
  const fence = FENCES_THREE[selector]
  if (fence) return { class: 'fence', left: fence[0], right: fence[1], sides: selector <= 5 ? sidesOf(variation) : 'both' }
  switch (selector) {
    case 13:
      return { class: 'root' }
    case 14:
    case 41:
      return { class: 'fraction' }
    case 15:
    case 44:
      return { class: 'script', sub: variation !== 0, sup: variation !== 1 }
    case 16:
      return { class: 'mark', mark: variation === 1 ? '̳' : '̲' }
    case 17:
      return { class: 'mark', mark: variation === 1 ? '̿' : '̅' }
    case 18:
    case 19:
    case 20:
      return { class: 'arrow', arrow: ['←', '→', '↔'][selector - 18] as string, labels: [variation === 1 ? 'bottom' : 'top'] }
    case 21:
    case 24:
      return { class: 'operator', sign: (selector === 21 && variation >= 3) || (selector === 24 && variation === 2) ? '∮' : '∫' }
    case 22:
    case 25:
      return { class: 'operator', sign: '∬' }
    case 23:
    case 26:
      return { class: 'operator', sign: '∭' }
    case 27:
    case 28:
      return { class: 'brace', brace: selector === 27 ? '⏞' : '⏟', top: selector === 27 }
    case 29:
    case 30:
      return { class: 'operator', sign: '∑' }
    case 31:
    case 32:
      return { class: 'operator', sign: '∏' }
    case 33:
    case 34:
      return { class: 'operator', sign: '∐' }
    case 35:
    case 36:
      return { class: 'operator', sign: '⋃' }
    case 37:
    case 38:
      return { class: 'operator', sign: '⋂' }
    case 39:
      return { class: 'limit' }
    case 40:
      return { class: 'division' }
    case 42:
    case 43:
      return { class: 'operator', sign: '' }
    case 45:
      return { class: 'dirac', left: variation !== 2, right: variation !== 1 }
    case 46:
      return { class: 'mark', mark: ['⃮', '⃯', '͍'][variation] ?? '⃯' }
    case 47:
      return { class: 'mark', mark: ['⃖', '⃗', '⃡'][variation] ?? '⃗' }
    case 48:
      return { class: 'mark', mark: '̑' }
  }
  return { class: 'plain' }
}

/** Version 5's templates, numbered as MathType 4 and later number them, their variations in bits. */
function shapeFive(selector: number, variation: number): Shape {
  const fence = FENCES_FIVE[selector]
  if (fence) return { class: 'fence', left: fence[0], right: fence[1], sides: (variation & 3) === 1 ? 'left' : (variation & 3) === 2 ? 'right' : 'both' }
  // An integral's signs are counted in its variation's low bits, its limits in the next.
  const integral = ['', '∫', '∬', '∭'][variation & 3] ?? '∫'
  switch (selector) {
    case 9: {
      const side = (bits: number) => ['(', ')', '[', ']'][bits & 3] as string
      return { class: 'fence', left: side(variation), right: side(variation >> 4), sides: 'both' }
    }
    case 10:
      return { class: 'root' }
    case 11:
      return { class: 'fraction' }
    case 12:
      return { class: 'mark', mark: variation & 1 ? '̳' : '̲' }
    case 13:
      return { class: 'mark', mark: variation & 1 ? '̿' : '̅' }
    case 14: {
      const single = (variation & 3) === 0
      const arrow = single ? ((variation & 0x30) === 0x30 ? '↔' : variation & 0x10 ? '←' : '→') : variation & 2 ? '⇌' : '⇄'
      const labels: ('top' | 'bottom')[] = []
      if (variation & 4) labels.push('top')
      if (variation & 8) labels.push('bottom')
      return { class: 'arrow', arrow, labels }
    }
    case 15: {
      const loop = variation & 0x0c
      const looped = ['', '∮', '∯', '∰'][variation & 3] ?? '∮'
      return { class: 'operator', sign: loop === 0 ? integral || '∫' : loop === 0x08 ? '∲' : loop === 0x0c ? '∳' : looped }
    }
    case 16:
      return { class: 'operator', sign: '∑' }
    case 17:
      return { class: 'operator', sign: '∏' }
    case 18:
      return { class: 'operator', sign: '∐' }
    case 19:
      return { class: 'operator', sign: '⋃' }
    case 20:
      return { class: 'operator', sign: '⋂' }
    case 21:
    case 22:
      return { class: 'operator', sign: '' }
    case 23:
      return { class: 'limit' }
    case 24:
      return { class: 'brace', brace: variation & 1 ? '⏞' : '⏟', top: Boolean(variation & 1) }
    case 25:
      return { class: 'brace', brace: variation & 1 ? '⎴' : '⎵', top: Boolean(variation & 1) }
    case 26:
      return { class: 'division' }
    case 27:
      return { class: 'script', sub: true, sup: false }
    case 28:
      return { class: 'script', sub: false, sup: true }
    case 29:
      return { class: 'script', sub: true, sup: true }
    case 30:
      return { class: 'dirac', left: Boolean(variation & 1), right: Boolean(variation & 2) }
    case 31: {
      const both = (variation & 3) === 3
      const under = Boolean(variation & 4)
      const mark = both ? (under ? '͍' : '⃡') : variation & 1 ? (under ? '⃮' : '⃖') : under ? '⃯' : '⃗'
      return { class: 'mark', mark }
    }
    case 32:
      return { class: 'mark', mark: '̃' }
    case 33:
      return { class: 'mark', mark: '̂' }
    case 34:
      return { class: 'mark', mark: '̑' }
  }
  return { class: 'plain' }
}

/** Whether a piece of text starts with a letter or a digit, which a function's name is set apart from. */
const WORDY = /[\p{L}\p{N}]/u

/** The typeface MTEF gives the names of functions: sin, log, lim. */
const FUNCTION_TYPEFACE = 2

/** The items of an equation as linear text, each version's templates by their own numbers. */
function writer(five: boolean) {
  const line = (items: readonly Item[], depth: number): string => {
    let written = ''
    let inFunction = false
    for (const item of items) {
      const text = write(item, depth)
      // Brackets and commas may be set in it too: only its letters make a name.
      const named = item.kind === 'char' && item.typeface === FUNCTION_TYPEFACE && WORDY.test(item.text)
      // A function's name is set apart from what it applies to, unless that opens with a bracket.
      if (inFunction && !named && WORDY.test(text[0] ?? '')) written += ' '
      if (item.kind !== 'embellishment') inFunction = named
      written += text
      if (written.length > TEXT_LIMIT) damaged()
    }
    return written
  }

  // A pile of lines within the equation is bracketed, as a matrix is; the equation's own lines are not.
  const write = (item: Item, depth: number): string => {
    switch (item.kind) {
      case 'line':
        return line(item.items, depth + 1)
      case 'char':
        return item.text
      case 'pile': {
        const lines = item.lines.map((one) => write(one, depth + 1).trim())
        return depth > 1 && lines.length > 1 ? `[${lines.join('; ')}]` : lines.join('; ')
      }
      case 'matrix': {
        const rows: string[] = []
        for (let at = 0; at < item.cells.length; at += item.columns)
          rows.push(
            item.cells
              .slice(at, at + item.columns)
              .map((cell) => write(cell, depth + 1).trim())
              .join(' ')
          )
        return `[${rows.join('; ')}]`
      }
      case 'template':
        return template(item, depth)
      case 'embellishment':
        return ''
    }
  }

  const template = (item: Extract<Item, { kind: 'template' }>, depth: number): string => {
    const slots = item.parts
      .filter((part) => part.kind === 'line' || part.kind === 'pile' || part.kind === 'matrix')
      .map((slot) => write(slot, depth + 1).trim())
    // A template's own characters (its fences, its sign), each as the template draws it when it has none Unicode has.
    const signs = item.parts.filter((part): part is Extract<Item, { kind: 'char' }> => part.kind === 'char').map((part) => part.text)
    const sign = (index: number, fallback: string) => signs[index] || fallback
    const [main = '', second = '', third = ''] = slots
    const shape = five ? shapeFive(item.selector, item.variation) : shapeThree(item.selector, item.variation)
    switch (shape.class) {
      case 'fence': {
        // The fences drawn are the template's own characters, the left before the right.
        const left = shape.sides === 'right' ? '' : sign(0, shape.left)
        const right = shape.sides === 'left' ? '' : sign(shape.sides === 'right' ? 0 : 1, shape.right)
        return `${left}${main}${right}`
      }
      case 'root': {
        const sign = second === '' || second === '2' ? '√' : second === '3' ? '∛' : second === '4' ? '∜' : `${script('', second, true)}√`
        return sign + grouped(main)
      }
      case 'fraction':
        return `${grouped(main)}/${grouped(second)}`
      case 'mark':
        return main === '' ? '' : main + shape.mark
      case 'arrow': {
        // Labels over and under the arrow: both slots kept, or the one its variation says is there. A double arrow is
        // written as one character.
        const [top = '', bottom = ''] = slots.length > 1 ? slots : shape.labels[0] === 'bottom' ? ['', main] : [main, '']
        const arrow = signs.filter(Boolean).length > 1 ? shape.arrow : sign(0, shape.arrow)
        return `${arrow}${top === '' ? '' : `^${grouped(top)}`}${bottom === '' ? '' : `_${grouped(bottom)}`}`
      }
      case 'operator': {
        // A sum's or an integral's parts: what it applies to, then its lower and its upper limit, then its sign, a
        // character or a line of its own, which an integral's variation says, as many as it has.
        const drawn = shape.sign || sign(0, slots[3] ?? '')
        return `${drawn}${second === '' ? '' : `_${grouped(second)}`}${third === '' ? '' : `^${grouped(third)}`} ${main}`
      }
      case 'limit':
        return `${main}${second === '' ? '' : `_${grouped(second)}`}${third === '' ? '' : `^${grouped(third)}`} `
      case 'brace':
        return `${sign(0, shape.brace)}${grouped(main)}${second === '' ? '' : `${shape.top ? '^' : '_'}${grouped(second)}`}`
      case 'division':
        // What is divided, after the divisor the line holds before it, its quotient over it.
        return `)${grouped(main)}${second === '' ? '' : `^${grouped(second)}`}`
      case 'script': {
        // Scripts follow, or precede, the item they belong to, which is the line's own: they are written in their place.
        const sub = shape.sub ? main : ''
        const sup = shape.sup ? (shape.sub ? second : slots.length > 1 ? second : main) : ''
        return script(script('', sub, false), sup, true)
      }
      case 'dirac': {
        const [left = '', right = ''] = slots.length > 1 ? slots : shape.left ? [main, ''] : ['', main]
        return `${shape.left ? `⟨${left}` : ''}|${shape.right ? `${right}⟩` : ''}`
      }
      case 'plain':
        return main
    }
  }

  return (items: readonly Item[]) => items.map((item) => write(item, 0)).join('; ')
}

/**
 * An equation in MTEF, from its header, as linear text: none for a version not read here (MathType 3.5's version 4,
 * older ones) or an equation that cannot be read.
 */
export function mtefText(bytes: Uint8Array): string | undefined {
  try {
    const version = bytes[0]
    if (version !== 3 && version !== 5) return undefined
    let start = 5
    // Version 5 names the app that wrote it, then whether the equation is in its line.
    if (version === 5) {
      while (start < bytes.length && bytes[start] !== 0) start++
      start += 2
    }
    if (start > bytes.length) return undefined
    const text = writer(version === 5)(readRecords(bytes, start, version === 5))
      .replace(/\s+/g, ' ')
      .trim()
    return text === '' ? undefined : text
  } catch (error) {
    if (error instanceof Damaged) return undefined
    throw error
  }
}

/** An `Equation Native` stream as linear text: its header says how long it is, then its MTEF. */
export function equationNativeText(stream: Uint8Array): string | undefined {
  if (stream.length < 10) return undefined
  const data = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  const header = data.getUint16(0, true)
  const size = data.getUint32(8, true)
  const start = header >= 8 && header <= 64 ? header : 28
  if (start >= stream.length) return undefined
  return mtefText(stream.subarray(start, size > 0 && start + size <= stream.length ? start + size : stream.length))
}

/** The equation an object of Equation Editor or MathType keeps in its storage, as linear text; none for any other object. */
export function objectEquation(storage: Compound): string | undefined {
  try {
    const stream = storage.stream('Equation Native')
    return stream && equationNativeText(stream)
  } catch {
    // An object whose streams cannot be read shows its picture.
    return undefined
  }
}

/** Whether an object's program, as a Word, PowerPoint or Excel file names it, is Equation Editor or MathType. */
export const isEquationProgram = (program: string | undefined): boolean => /^Equation\.(3|DSMT\d*)$/i.test((program ?? '').trim())
