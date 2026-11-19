/**
 * A compound file, the container of the older Office formats (.doc, .xls, .ppt): a small file system inside one file,
 * its sectors chained by a table, its streams and storages (its folders) named in a directory. Read in the window,
 * with no library, for the streams a preview needs: those at its top, and those of the storages that hold another
 * app's objects. Every chain is followed at most once round, and every size is held to the file's own, so a damaged
 * or crafted file fails with a sentence rather than looping or reading past its end.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
/** A chain's end, and the marks of sectors that hold no stream. */
const END_OF_CHAIN = 0xfffffffe
const LAST_SECTOR = 0xfffffffa
const NO_ENTRY = 0xffffffff
const ENTRY_SIZE = 128
/** The most entries of a directory read: past them, a directory is not one a preview needs. */
const ENTRY_LIMIT = 65_536

export interface Compound {
  /** A stream at the top of the file, or of the storage, by its name whatever its capitals; nothing when there is none. */
  stream(name: string): Uint8Array | undefined
  /** A storage at the top of the file, or of the storage, by its name whatever its capitals; nothing when there is none. */
  storage(name: string): Compound | undefined
}

const fail = (): never => {
  throw new Error('The file is damaged: its parts could not be read.')
}

/** Opens a compound file; throws a sentence when it is not one, or is damaged. */
export function openCompound(bytes: Uint8Array): Compound {
  if (bytes.length < 512 || SIGNATURE.some((value, index) => bytes[index] !== value)) throw new Error('This is not a file of the older Office formats.')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (at: number) => (at + 4 <= bytes.length ? data.getUint32(at, true) : fail())
  const sectorShift = data.getUint16(0x1e, true)
  const miniShift = data.getUint16(0x20, true)
  if ((sectorShift !== 9 && sectorShift !== 12) || miniShift !== 6) fail()
  const sectorSize = 1 << sectorShift
  const sectors = Math.floor((bytes.length - sectorSize) / sectorSize) + 1
  const offsetOf = (sector: number) => (sector + 1) * sectorSize

  // The table of sectors is itself in sectors, which the header lists, then sectors of more such lists.
  const fatSectors: number[] = []
  const fatCount = u32(0x2c)
  for (let index = 0; index < 109 && fatSectors.length < fatCount; index++) fatSectors.push(u32(0x4c + index * 4))
  let more = u32(0x44)
  for (let hops = 0; more <= LAST_SECTOR && fatSectors.length < fatCount; hops++) {
    if (hops > sectors) fail()
    const at = offsetOf(more)
    const perSector = sectorSize / 4 - 1
    for (let index = 0; index < perSector && fatSectors.length < fatCount; index++) fatSectors.push(u32(at + index * 4))
    more = u32(at + perSector * 4)
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4))
  fatSectors.forEach((sector, index) => {
    const at = offsetOf(sector)
    if (sector > LAST_SECTOR || at + sectorSize > bytes.length) fail()
    for (let entry = 0; entry < sectorSize / 4; entry++) fat[index * (sectorSize / 4) + entry] = data.getUint32(at + entry * 4, true)
  })

  /** The sectors of a chain, in order, from its first; at most `limit` of them. */
  const chain = (first: number, table: Uint32Array, limit: number): number[] => {
    const found: number[] = []
    for (let sector = first; sector !== END_OF_CHAIN && sector !== NO_ENTRY; sector = table[sector] ?? fail()) {
      if (sector > LAST_SECTOR || found.length >= limit) fail()
      found.push(sector)
    }
    return found
  }

  /** What a chain of sectors holds, cut to `size`. */
  const read = (first: number, size: number): Uint8Array => {
    if (size > bytes.length) fail()
    const out = new Uint8Array(size)
    let written = 0
    for (const sector of chain(first, fat, sectors)) {
      if (written >= size) break
      const at = offsetOf(sector)
      const part = bytes.subarray(at, Math.min(at + sectorSize, bytes.length, at + size - written))
      out.set(part, written)
      written += part.length
    }
    if (written < size) fail()
    return out
  }

  // The directory: entries of 128 bytes in their own chain.
  const directory = read(u32(0x30), chain(u32(0x30), fat, sectors).length * sectorSize)
  const entries = Math.min(directory.length / ENTRY_SIZE, ENTRY_LIMIT)
  const entryView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
  const entry = (index: number) => {
    const at = index * ENTRY_SIZE
    const nameLength = Math.min(entryView.getUint16(at + 0x40, true), 64)
    const name = new TextDecoder('utf-16le').decode(directory.subarray(at, at + Math.max(0, nameLength - 2)))
    return {
      name,
      type: directory[at + 0x42] ?? 0,
      left: entryView.getUint32(at + 0x44, true),
      right: entryView.getUint32(at + 0x48, true),
      child: entryView.getUint32(at + 0x4c, true),
      start: entryView.getUint32(at + 0x74, true),
      // Only the low half of the size counts in files of 512-byte sectors.
      size: entryView.getUint32(at + 0x78, true)
    }
  }
  if (entries < 1) fail()
  const root = entry(0)

  // Streams smaller than the cutoff live in the mini stream, in sectors of 64 bytes chained by their own table.
  const cutoff = u32(0x38)
  const miniStream = root.start <= LAST_SECTOR ? read(root.start, root.size) : new Uint8Array()
  const miniFatSectors = chain(u32(0x3c), fat, sectors)
  const miniFat = new Uint32Array(miniFatSectors.length * (sectorSize / 4))
  miniFatSectors.forEach((sector, index) => {
    for (let at = 0; at < sectorSize / 4; at++) miniFat[index * (sectorSize / 4) + at] = u32(offsetOf(sector) + at * 4)
  })
  const readMini = (first: number, size: number): Uint8Array => {
    const out = new Uint8Array(size)
    let written = 0
    for (const sector of chain(first, miniFat, miniStream.length / 64 + 1)) {
      if (written >= size) break
      const part = miniStream.subarray(sector * 64, Math.min(sector * 64 + 64, sector * 64 + size - written))
      out.set(part, written)
      written += part.length
    }
    if (written < size) fail()
    return out
  }

  /** The streams and storages directly in a storage, from its first child: a tree walked through its siblings. */
  const listed = (child: number) => {
    const streams = new Map<string, { start: number; size: number }>()
    const storages = new Map<string, number>()
    const waiting = [child]
    const seen = new Set<number>()
    while (waiting.length > 0) {
      const index = waiting.pop() as number
      if (index === NO_ENTRY || index >= entries || seen.has(index)) continue
      seen.add(index)
      const found = entry(index)
      if (found.type === 2) streams.set(found.name.toLowerCase(), { start: found.start, size: found.size })
      else if (found.type === 1) storages.set(found.name.toLowerCase(), found.child)
      waiting.push(found.left, found.right)
    }
    return { streams, storages }
  }

  /** A storage's streams and storages, listed when first asked for. */
  const open = (child: number): Compound => {
    let inside: ReturnType<typeof listed> | undefined
    return {
      stream(name) {
        inside ??= listed(child)
        const found = inside.streams.get(name.toLowerCase())
        if (!found) return undefined
        return found.size < cutoff ? readMini(found.start, found.size) : read(found.start, found.size)
      },
      storage(name) {
        inside ??= listed(child)
        const found = inside.storages.get(name.toLowerCase())
        return found === undefined ? undefined : open(found)
      }
    }
  }
  return open(root.child)
}
