/**
 * Reading the older Office formats' binary records (docs/SPEC.md, section 9.7): numbers, each read checked against its
 * end, so a damaged file fails with a sentence rather than reading past it; and the properties Word 97 to
 * 2003 writes (`sprm`s), each a code that says how long its operand is; and the code pages their 8-bit text is in.
 */

export const damaged = (): never => {
  throw new Error('The file is damaged: its text could not be read.')
}

/**
 * Numbers from bytes, each read checked against their end: little-endian, as Windows writes them, unless a file was
 * written on a Mac of its time, whose numbers are big-endian (`littleEndian` false).
 */
export function reader(bytes: Uint8Array, littleEndian = true) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const within = (at: number, size: number) => at >= 0 && at + size <= bytes.length
  return {
    length: bytes.length,
    u8: (at: number) => (within(at, 1) ? data.getUint8(at) : damaged()),
    u16: (at: number) => (within(at, 2) ? data.getUint16(at, littleEndian) : damaged()),
    i16: (at: number) => (within(at, 2) ? data.getInt16(at, littleEndian) : damaged()),
    u32: (at: number) => (within(at, 4) ? data.getUint32(at, littleEndian) : damaged()),
    i32: (at: number) => (within(at, 4) ? data.getInt32(at, littleEndian) : damaged()),
    f64: (at: number) => (within(at, 8) ? data.getFloat64(at, littleEndian) : damaged()),
    bytes: (at: number, size: number) => (within(at, size) ? bytes.subarray(at, at + size) : damaged())
  }
}
export type Reader = ReturnType<typeof reader>

/** How many bytes a Word 97 property's operand takes, from the property's code, or from its operand when it says. */
export function operandSize(property: number, word: Reader, at: number): number {
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

/** A Word 97 property: its code, and where its operand is and how long. */
export interface WordProperty {
  code: number
  at: number
  size: number
}

/** The properties of a list of them (`grpprl`), in order; one that runs past the list's end ends it. */
export function* wordProperties(bytes: Reader, from: number, end: number): Generator<WordProperty> {
  let place = from
  while (place + 2 <= end) {
    const code = bytes.u16(place)
    place += 2
    const size = operandSize(code, bytes, place)
    if (place + size > end) return
    yield { code, at: place, size }
    place += size
  }
}

/** The code page of a language's 8-bit text, as Windows wrote it, by the language's identifier. */
export function languageCodePage(language: number): number {
  const primary = language & 0x3ff
  if (primary === 0x1a) return language === 0x0c1a ? 1251 : 1250
  if (primary === 0x04) return language === 0x0804 || language === 0x1004 ? 936 : 950
  return LANGUAGE_CODE_PAGES[primary] ?? 1252
}

const LANGUAGE_CODE_PAGES: Record<number, number> = {
  2: 1251,
  25: 1251,
  34: 1251,
  35: 1251,
  47: 1251,
  63: 1251,
  5: 1250,
  14: 1250,
  21: 1250,
  24: 1250,
  27: 1250,
  28: 1250,
  36: 1250,
  8: 1253,
  31: 1254,
  13: 1255,
  1: 1256,
  32: 1256,
  41: 1256,
  37: 1257,
  38: 1257,
  39: 1257,
  42: 1258,
  30: 874,
  17: 932,
  18: 949
}

/** A decoder of 8-bit text in a Windows code page; Western European for one the window does not know. */
export function codePageDecoder(codePage: number): TextDecoder {
  const label =
    codePage >= 1250 && codePage <= 1258
      ? `windows-${codePage}`
      : // Excel 2 to 4 name the Mac's and Windows' own code pages 32768 and 32769.
        (
          {
            874: 'windows-874',
            932: 'shift_jis',
            936: 'gbk',
            949: 'euc-kr',
            950: 'big5',
            10000: 'macintosh',
            1200: 'utf-16le',
            32768: 'macintosh',
            32769: 'windows-1252',
            65001: 'utf-8'
          } as Record<number, string>
        )[codePage]
  try {
    return new TextDecoder(label ?? 'windows-1252')
  } catch {
    return new TextDecoder('windows-1252')
  }
}

/** Whether a byte starts a character of two in a code page of two-byte characters (Japanese, Chinese, Korean). */
export function leadsTwoBytes(codePage: number, byte: number): boolean {
  if (codePage === 932) return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc)
  return (codePage === 936 || codePage === 949 || codePage === 950) && byte >= 0x81 && byte <= 0xfe
}
