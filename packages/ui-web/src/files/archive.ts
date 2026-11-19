/**
 * ZIP archives, as the newer Office formats are (docs/SPEC.md, section 9.7): their directory read, and each part
 * unpacked with the window's own decompression when asked for, never past a limit.
 */

import { xmlEvents } from './xml.ts'

/** The most a part of an archive is unpacked to: a preview never needs more, and a crafted archive stops there. */
const PART_LIMIT = 32 * 1024 * 1024

/** The parts of a ZIP archive by name, each unpacked when asked for. */
export type Archive = Map<string, () => Promise<Uint8Array>>

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Read a ZIP archive's directory. Throws when it is not one. */
export function openArchive(bytes: Uint8Array): Archive {
  const data = view(bytes)
  // The end of the directory is in the last 64 KB and 22 bytes: a comment may follow it.
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (data.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('This is not a ZIP archive.')
  const count = data.getUint16(end + 10, true)
  let at = data.getUint32(end + 16, true)
  const parts: Archive = new Map()
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || data.getUint32(at, true) !== 0x02014b50) throw new Error('The archive is damaged.')
    const method = data.getUint16(at + 10, true)
    const packed = data.getUint32(at + 20, true)
    const size = data.getUint32(at + 24, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const local = data.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
    parts.set(name, async () => {
      if (local + 30 > bytes.length || data.getUint32(local, true) !== 0x04034b50) throw new Error('The archive is damaged.')
      const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true)
      const stored = bytes.subarray(start, start + packed)
      if (method === 0) return stored
      if (method !== 8) throw new Error('The archive is packed in a way that is not read here.')
      if (size > PART_LIMIT) throw new Error('A part of the file is too large to show.')
      return unpack(stored)
    })
  }
  return parts
}

/**
 * Unpack deflated bytes with the window's own decompression, stopping past the limit: bare, as an archive keeps them,
 * or behind zlib's header, as PowerPoint keeps an object. PowerPoint may leave out the end of its stream: when the
 * size unpacked is known, a stream that stops once it is reached is whole.
 */
export async function unpack(packed: Uint8Array, format: 'deflate-raw' | 'deflate' = 'deflate-raw', size?: number): Promise<Uint8Array> {
  const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(format))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    let read: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>
    try {
      read = await reader.read()
    } catch (error) {
      if (size === undefined || total < size) throw error
      break
    }
    const { done, value } = read
    if (done) break
    total += value.byteLength
    if (total > PART_LIMIT) {
      await reader.cancel()
      throw new Error('A part of the file is too large to show.')
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    whole.set(chunk, offset)
    offset += chunk.byteLength
  }
  return whole
}

/** The names of each archive's parts in small letters, made when first asked for. */
const folded = new WeakMap<Archive, Map<string, string>>()

/**
 * A part of an archive by its name, as the Office formats name them: whatever its capitals, since a part named
 * `Sheet1.xml` may have its relationships in `_rels/sheet1.xml.rels`.
 */
export function partOf(archive: Archive, name: string): (() => Promise<Uint8Array>) | undefined {
  const exact = archive.get(name)
  if (exact) return exact
  let names = folded.get(archive)
  if (!names) {
    names = new Map([...archive.keys()].map((one) => [one.toLowerCase(), one]))
    folded.set(archive, names)
  }
  const found = names.get(name.toLowerCase())
  return found === undefined ? undefined : archive.get(found)
}

export const textOf = async (archive: Archive, name: string): Promise<string | undefined> => {
  const part = partOf(archive, name)
  return part ? new TextDecoder().decode(await part()) : undefined
}

/** Where the relationships of a part point, by their identifiers, as paths in the archive; an address outside it as it is written. */
export async function relationships(archive: Archive, part: string): Promise<Map<string, string>> {
  const folder = part.slice(0, part.lastIndexOf('/') + 1)
  const xml = await textOf(archive, `${folder}_rels/${part.slice(folder.length)}.rels`)
  const found = new Map<string, string>()
  for (const event of xmlEvents(xml ?? '')) {
    if (event.type !== 'open' || event.name !== 'Relationship') continue
    const { Id: id, Target: target, TargetMode: mode } = event.attributes
    if (id && target) found.set(id, mode === 'External' ? target : resolvePart(folder, target))
  }
  return found
}

/** A target of a relationship as a path in the archive: from the archive's top when it starts with "/", else from the part's folder. */
export function resolvePart(folder: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : folder + target).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.' && part !== '') resolved.push(part)
  }
  return resolved.join('/')
}
