/**
 * Reading the older Office formats' binary records (docs/SPEC.md, section 9.7): numbers, each read checked against its
 * end, so a damaged file fails with a sentence rather than reading past it; and the properties Word 97 to
 * 2003 writes (`sprm`s), each a code that says how long its operand is.
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
