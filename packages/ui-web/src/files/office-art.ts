/**
 * The pictures of the older Office formats (docs/SPEC.md, section 9.7). Word, Excel and PowerPoint 97 to 2003 keep
 * them as OfficeArt records: a store of pictures (BLIPs) for the whole file, each listed by an entry of its own (an
 * `FBSE`), and shapes that name an entry by its place (`pib`). A picture is shown from its own bytes when the window
 * shows its format: PNG, JPEG, GIF, or a device-independent bitmap given the header of a file. A metafile (EMF, WMF)
 * is drawn as SVG (`metafile.ts`), once unpacked when the file keeps it packed by zlib, as Office does. A PICT or a
 * TIFF says it is a picture its app shows.
 *
 * Every record read is checked against the bytes that hold it, so a damaged drawing shows fewer pictures rather than
 * failing the preview.
 */

import { unpack } from './archive.ts'
import { drawMetafile, type MetafileHint, shownSize } from './metafile.ts'
import { emuPixels, FIGURE_LIMIT, PICTURE_BYTES_LIMIT, pictureType } from './office-figures.ts'
import type { ObjectRead, OfficeChart, OfficeFigure } from './office-text.ts'

/** A record of OfficeArt: its type, its instance, whether it holds other records, and where its content is. */
export interface ArtRecord {
  type: number
  instance: number
  container: boolean
  at: number
  size: number
}

/** The record types read here. */
export const ART = {
  drawingGroup: 0xf000,
  store: 0xf001,
  drawing: 0xf002,
  group: 0xf003,
  shape: 0xf004,
  entry: 0xf007,
  shapeHeader: 0xf00a,
  properties: 0xf00b,
  secondProperties: 0xf121,
  thirdProperties: 0xf122,
  clientAnchor: 0xf010,
  clientData: 0xf011
} as const

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/**
 * The records directly inside a stretch of bytes. A container that runs past the end holds what is there; any other
 * record that does ends the list.
 */
export function* artRecords(bytes: Uint8Array, from = 0, end = bytes.length): Generator<ArtRecord> {
  const data = view(bytes)
  const last = Math.min(end, bytes.length)
  for (let at = from; at >= 0 && at + 8 <= last; ) {
    const head = data.getUint16(at, true)
    const container = (head & 0x0f) === 0x0f
    let size = data.getUint32(at + 4, true)
    if (at + 8 + size > last) {
      if (!container) return
      size = last - at - 8
    }
    yield { type: data.getUint16(at + 2, true), instance: head >> 4, container, at: at + 8, size }
    at += 8 + size
  }
}

/** The first record of a type directly inside another; none when there is none. */
export const childOf = (bytes: Uint8Array, parent: ArtRecord, type: number): ArtRecord | undefined => {
  for (const record of artRecords(bytes, parent.at, parent.at + parent.size)) if (record.type === type) return record
  return undefined
}

/** The instance of each kind of bitmap a BLIP holds, one more when it keeps a second identifier. */
const BITMAPS: Record<number, number> = { 61469: 0x46a, 61482: 0x6e2, 61470: 0x6e0, 61471: 0x7a8, 61481: 0x6e4 }
const DIB = 0xf01f

/**
 * The bytes of a picture of the store (a BLIP record) as a file of its format: what follows its identifiers and its
 * tag, a device-independent bitmap given the header of a file. None for a metafile (EMF, WMF, PICT), whose bytes
 * the window does not show, nor for a record that is no picture.
 */
export function blipBytes(bytes: Uint8Array, record: ArtRecord): Uint8Array | undefined {
  const base = BITMAPS[record.type]
  if (base === undefined) return undefined
  const skip = 16 + (record.instance === base + 1 ? 16 : 0) + 1
  if (skip >= record.size || record.at + record.size > bytes.length) return undefined
  const data = bytes.subarray(record.at + skip, record.at + record.size)
  return record.type === DIB ? bitmapFile(data) : data
}

/** A device-independent bitmap with the header of a file before it, as a `.bmp` file is: where its pixels start. */
export function bitmapFile(bitmap: Uint8Array): Uint8Array | undefined {
  if (bitmap.length < 40) return undefined
  const data = view(bitmap)
  const headerSize = data.getUint32(0, true)
  if (headerSize < 12 || headerSize > bitmap.length) return undefined
  // A core header of 12 bytes has 3-byte colours; the others, 4-byte ones, and three masks after a 40-byte header.
  const core = headerSize === 12
  const bits = core ? data.getUint16(10, true) : data.getUint16(14, true)
  const compression = core ? 0 : data.getUint32(16, true)
  const used = core ? 0 : data.getUint32(32, true)
  const colours = used > 0 ? used : bits <= 8 ? 1 << bits : 0
  const masks = headerSize === 40 && (compression === 3 || compression === 6) ? (compression === 3 ? 12 : 16) : 0
  const pixels = 14 + headerSize + masks + colours * (core ? 3 : 4)
  const file = new Uint8Array(14 + bitmap.length)
  const head = view(file)
  head.setUint16(0, 0x4d42, true)
  head.setUint32(2, file.length, true)
  head.setUint32(10, Math.min(pixels, file.length), true)
  file.set(bitmap, 14)
  return file
}

/** The instance of each kind of metafile a BLIP holds, one more when it keeps a second identifier: EMF, WMF, PICT. */
const METAFILES: Record<number, number> = { 61466: 0x3d4, 61467: 0x216, 61468: 0x542 }
const PICT = 0xf01c

/** The most bytes a metafile unpacks to. */
const METAFILE_LIMIT = 64 * 1024 * 1024

/**
 * A metafile as a BLIP keeps it: its bytes, packed by zlib or not, its size unpacked, and what its header says of the
 * box of its units and its size, for a WMF, which keeps neither.
 */
export interface KeptMetafile {
  bytes: Uint8Array
  packed: boolean
  size: number
  hint: MetafileHint
}

/** The metafile a BLIP holds, after its identifiers and a header of 34 bytes; none for a PICT, or any other record. */
export function blipMetafile(bytes: Uint8Array, record: ArtRecord): KeptMetafile | undefined {
  const base = METAFILES[record.type]
  if (base === undefined || record.type === PICT || record.at + record.size > bytes.length) return undefined
  const header = record.at + 16 + (record.instance === base + 1 ? 16 : 0)
  if (header + 34 > record.at + record.size) return undefined
  const data = view(bytes)
  const size = data.getUint32(header, true)
  const kept = Math.min(data.getUint32(header + 28, true), record.at + record.size - header - 34)
  const bounds = {
    left: data.getInt32(header + 4, true),
    top: data.getInt32(header + 8, true),
    right: data.getInt32(header + 12, true),
    bottom: data.getInt32(header + 16, true)
  }
  const width = emuPixels(String(data.getUint32(header + 20, true)))
  const height = emuPixels(String(data.getUint32(header + 24, true)))
  return {
    bytes: bytes.subarray(header + 34, header + 34 + kept),
    packed: data.getUint8(header + 32) === 0,
    size,
    hint: { bounds, width, height }
  }
}

/**
 * A picture of the store as it is found: its bytes as a file the window shows, or a metafile to draw; neither when it
 * is of another format.
 */
export interface StoredPicture {
  bytes?: Uint8Array | undefined
  metafile?: KeptMetafile | undefined
}

/** A picture of a BLIP: its bytes when the window shows them, else the metafile it holds. */
const blipPicture = (bytes: Uint8Array, record: ArtRecord): StoredPicture => ({ bytes: blipBytes(bytes, record), metafile: blipMetafile(bytes, record) })

/**
 * The pictures of a file's store (a `BStoreContainer`), by their place from 1, as shapes name them: each entry's
 * picture, kept within the entry, or at the place the entry gives in `delayed` (PowerPoint's `Pictures` stream,
 * Word's main stream).
 */
export function storedPictures(bytes: Uint8Array, store: ArtRecord | undefined, delayed?: Uint8Array): (place: number) => StoredPicture | undefined {
  const entries: (ArtRecord | undefined)[] = []
  if (store) for (const record of artRecords(bytes, store.at, store.at + store.size)) entries.push(record.type === ART.entry ? record : undefined)
  return (place) => {
    const entry = entries[place - 1]
    if (!entry || entry.size < 36) return undefined
    const data = view(bytes)
    const named = data.getUint8(entry.at + 33)
    const kept = entry.at + 36 + named
    if (kept + 8 <= entry.at + entry.size) {
      const [blip] = artRecords(bytes, kept, entry.at + entry.size)
      return blip ? blipPicture(bytes, blip) : undefined
    }
    const offset = data.getUint32(entry.at + 28, true)
    if (!delayed || offset === 0xffffffff) return undefined
    const [blip] = artRecords(delayed, offset)
    return blip ? blipPicture(delayed, blip) : undefined
  }
}

/**
 * A shape of a drawing, as a preview needs it: its identifier, the picture it shows, its words, its anchor, and what
 * its app keeps of it (its client data: in PowerPoint, the object of another app it shows).
 */
export interface ArtShape {
  id: number
  picture?: number | undefined
  alt: string
  /** A rule across the text, as Word writes HTML's: its share of the text's width in thousandths, its height in points and its colour. */
  rule?: { share: number; height: number; color: string | undefined } | undefined
  anchor?: ArtRecord | undefined
  client?: ArtRecord | undefined
}

/**
 * The properties read of a shape: the picture it shows (`pib`), and its description, its words for those who cannot see
 * it; for a rule, its fill, its share of the width and its height, and the flags that say it is one.
 */
const PICTURE = 0x0104
const DESCRIPTION = 0x0381
const FILL_COLOR = 0x0181
const RULE_SHARE = 0x0393
const RULE_HEIGHT = 0x0395
const GROUP_FLAGS = 0x03bf
/** A rule across the text (`fHorizRule`), and the bit that says the flag is set at all. */
const HORIZONTAL_RULE = 1 << 11
const HORIZONTAL_RULE_SET = 1 << 27

/** A shape's properties (an `OPT` record): their simple values, and their complex ones (text) in order after them. */
function shapeProperties(bytes: Uint8Array, record: ArtRecord): Map<number, number | string> {
  const data = view(bytes)
  const found = new Map<number, number | string>()
  const count = Math.min(record.instance, Math.floor(record.size / 6))
  let complex = record.at + count * 6
  const end = record.at + record.size
  for (let index = 0; index < count; index++) {
    const at = record.at + index * 6
    const id = data.getUint16(at, true)
    const value = data.getUint32(at + 2, true)
    const property = id & 0x3fff
    if ((id & 0x8000) === 0) found.set(property, value)
    else {
      const length = Math.min(value, Math.max(0, end - complex))
      if (property === DESCRIPTION)
        found.set(property, new TextDecoder('utf-16le').decode(bytes.subarray(complex, complex + length - (length % 2))).replace(/\0+$/, ''))
      complex += length
    }
  }
  return found
}

/** One shape (an `SpContainer`): its header's identifier, its properties and its anchor; none for the background. */
export function artShape(bytes: Uint8Array, container: ArtRecord): ArtShape | undefined {
  const data = view(bytes)
  const shape: ArtShape = { id: 0, alt: '' }
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (record.type === ART.shapeHeader && record.size >= 8) {
      shape.id = data.getUint32(record.at, true)
      // A slide's background and a deleted shape show nothing here.
      if (data.getUint32(record.at + 4, true) & 0x0408) return undefined
    } else if (record.type === ART.properties || record.type === ART.secondProperties || record.type === ART.thirdProperties) {
      const properties = shapeProperties(bytes, record)
      const picture = properties.get(PICTURE)
      if (typeof picture === 'number' && picture > 0) shape.picture = picture
      const words = properties.get(DESCRIPTION)
      if (typeof words === 'string') shape.alt ||= words.trim()
      const flags = properties.get(GROUP_FLAGS)
      if (typeof flags === 'number' && flags & HORIZONTAL_RULE && flags & HORIZONTAL_RULE_SET) {
        const share = properties.get(RULE_SHARE)
        const height = properties.get(RULE_HEIGHT)
        const fill = properties.get(FILL_COLOR)
        // Colours are red, green and blue from the low byte up; one with a high byte set names a scheme's, read as none.
        const color =
          typeof fill === 'number' && fill >>> 24 === 0
            ? `#${[0, 8, 16].map((shift) => ((fill >> shift) & 0xff).toString(16).padStart(2, '0')).join('')}`
            : undefined
        shape.rule = {
          share: typeof share === 'number' && share > 0 && share <= 1000 ? share : 1000,
          height: typeof height === 'number' && height > 0 ? Math.min(height / 20, 72) : 1.5,
          color
        }
      }
    } else if (record.type === ART.clientAnchor) shape.anchor = record
    else if (record.type === ART.clientData) shape.client = record
  }
  return shape
}

/** The shapes of a drawing (a `DgContainer`) or of a group within it, in order, a group's own shapes in its place. */
export function artShapes(bytes: Uint8Array, container: ArtRecord, depth = 0): ArtShape[] {
  const shapes: ArtShape[] = []
  for (const record of artRecords(bytes, container.at, container.at + container.size)) {
    if (record.type === ART.shape) {
      const shape = artShape(bytes, record)
      if (shape) shapes.push(shape)
    } else if (record.type === ART.group && depth < 16) shapes.push(...artShapes(bytes, record, depth + 1))
  }
  return shapes
}

/**
 * The figures of an older file as they are found: the same picture at the same size is one figure, and past the
 * limits a figure is left out, as for the newer formats. A metafile kept packed is drawn once the file is read
 * (`drawPacked`), the reading itself waiting for nothing: until then its figure says it is a picture its app shows.
 */
export class ArtFigures {
  readonly list: OfficeFigure[] = []
  private bytes = 0
  private readonly found = new Map<string, number>()
  private readonly packed: { place: number; metafile: KeptMetafile; alt: string; size: { width?: number | undefined; height?: number | undefined } }[] = []
  private readonly held: { place: number; read: () => Promise<ObjectRead | undefined> }[] = []

  /** A picture's figure, by its place in the list: shown from its bytes, drawn from its metafile, or said to be one its app shows. */
  picture(
    key: string,
    picture: StoredPicture | undefined,
    alt: string,
    size: { width?: number | undefined; height?: number | undefined } = {}
  ): number | undefined {
    const known = JSON.stringify([key, alt, size.width, size.height])
    const place = this.found.get(known)
    if (place !== undefined) return place
    if (this.list.length >= FIGURE_LIMIT) return undefined
    const bytes = picture?.bytes
    const type = bytes && pictureType(bytes)
    const metafile = picture?.metafile
    if (bytes && type && this.bytes + bytes.length <= PICTURE_BYTES_LIMIT) {
      this.bytes += bytes.length
      this.list.push({ kind: 'picture', type, bytes, alt, width: size.width, height: size.height })
    } else if (metafile && !metafile.packed) this.list.push(this.drawn(metafile.bytes, metafile.hint, alt, size))
    else {
      if (metafile) this.packed.push({ place: this.list.length, metafile, alt, size })
      this.list.push({ kind: 'unshown', alt, what: 'picture' })
    }
    this.found.set(known, this.list.length - 1)
    return this.list.length - 1
  }

  /** A metafile drawn as an SVG picture at the size given, else its own; or said to be one its app shows. */
  private drawn(bytes: Uint8Array, hint: MetafileHint, alt: string, size: { width?: number | undefined; height?: number | undefined }): OfficeFigure {
    const drawn = drawMetafile(bytes, hint)
    if (!drawn || this.bytes + drawn.svg.length > PICTURE_BYTES_LIMIT) return { kind: 'unshown', alt, what: 'picture' }
    this.bytes += drawn.svg.length
    return {
      kind: 'picture',
      type: 'image/svg+xml',
      bytes: drawn.svg,
      alt,
      ...shownSize(size, drawn)
    }
  }

  /**
   * A figure that gives way, once the file is read, to what `read` makes of the object it pictures (a worksheet as its
   * sheet), when it makes something.
   */
  later(place: number, read: () => Promise<ObjectRead | undefined>): void {
    this.held.push({ place, read })
  }

  /** The metafiles kept packed, unpacked and drawn in their figures' places, and the objects read in theirs. */
  async drawPacked(): Promise<void> {
    for (const { place, metafile, alt, size } of this.packed.splice(0)) {
      if (metafile.size > METAFILE_LIMIT) continue
      try {
        const bytes = await unpack(metafile.bytes, 'deflate', metafile.size)
        this.list[place] = this.drawn(bytes, metafile.hint, alt, size)
      } catch {
        // A metafile that cannot be unpacked is a picture its app shows.
      }
    }
    // The objects are read last, as their pictures may be metafiles drawn just now.
    for (const { place, read } of this.held.splice(0)) {
      const figure = await read().catch(() => undefined)
      const before = this.list[place]
      if (figure && figure.kind !== 'text' && before)
        this.list[place] = figure.kind === 'sheet' && figure.alt === '' && 'alt' in before ? { ...figure, alt: before.alt } : figure
    }
  }

  /** A chart's figure, by its place in the list: drawn from what was read of it, or said to be one its app draws. */
  chart(read: OfficeChart | undefined): number | undefined {
    if (this.list.length >= FIGURE_LIMIT) return undefined
    this.list.push(read ? { kind: 'chart', ...read } : { kind: 'unshown', alt: '', what: 'chart' })
    return this.list.length - 1
  }

  /** A figure the file holds but does not keep in a form read here: an embedded chart or object, by its place. */
  unshown(alt: string, what: 'picture' | 'chart'): number | undefined {
    if (this.list.length >= FIGURE_LIMIT) return undefined
    this.list.push({ kind: 'unshown', alt, what })
    return this.list.length - 1
  }

  /** The figures at these places of the list. */
  at(places: readonly number[]): OfficeFigure[] {
    return places.flatMap((place) => this.list[place] ?? [])
  }
}

/** A length in twentieths of a point, as Word and Excel measure, in the window's pixels: 1,440 to the inch, 96 pixels to it. */
export const twipPixels = (value: number): number | undefined => (Number.isFinite(value) && value > 0 ? Math.round(value / 15) : undefined)
