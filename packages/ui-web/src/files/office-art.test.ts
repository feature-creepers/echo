import { describe, expect, it } from 'vitest'
import { ART, ArtFigures, artRecords, artShapes, bitmapFile, blipBytes, blipMetafile, storedPictures, twipPixels } from './office-art.ts'
import { FIGURE_LIMIT } from './office-figures.ts'

/** Little-endian bytes, as OfficeArt writes them. */
const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]
const wide = (text: string) => [...text].flatMap((char) => u16(char.charCodeAt(0)))

/** An OfficeArt record: its instance, its type and what it holds. */
const atom = (type: number, body: readonly number[], instance = 0) => [...u16(instance << 4), ...u16(type), ...u32(body.length), ...body]
const container = (type: number, children: readonly (readonly number[])[], instance = 0) => {
  const body = children.flat()
  return [...u16((instance << 4) | 0x0f), ...u16(type), ...u32(body.length), ...body]
}
const read = (bytes: readonly number[]) => {
  const whole = new Uint8Array(bytes)
  const [first] = artRecords(whole)
  if (!first) throw new Error('No record.')
  return { whole, first }
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 4, 5]
const identifier = (count: number) => new Array(16 * count).fill(7)
/** A picture of the store: its identifiers, a tag, then its bytes. */
const blip = (type: number, instance: number, bytes: readonly number[], identifiers = 1) => atom(type, [...identifier(identifiers), 0xff, ...bytes], instance)
/** An entry of the store for a picture: its kinds, identifier, size and place, then the picture itself when it keeps it. */
const entry = (kept: readonly number[], delay = 0) =>
  atom(ART.entry, [6, 6, ...identifier(1), 0, 0, ...u32(kept.length), ...u32(1), ...u32(delay), 0, 0, 0, 0, ...kept], 6)

describe('OfficeArt records', () => {
  it('reads records in order, a container cut short holding what is there, any other record cut short ending the list', () => {
    const whole = new Uint8Array([...atom(0xf00a, [1, 2, 3, 4]), ...atom(0xf00b, [9, 9]).slice(0, 9)])
    expect([...artRecords(whole)].map(({ type, size }) => [type, size])).toEqual([[0xf00a, 4]])
    const cut = new Uint8Array(container(ART.drawing, [atom(0xf00a, [1, 2, 3, 4])]).slice(0, 14))
    expect([...artRecords(cut)].map(({ type, size, container: holds }) => [type, size, holds])).toEqual([[ART.drawing, 6, true]])
  })

  it.each<[string, number[], number[] | undefined]>([
    ['JPEG with one identifier', blip(0xf01d, 0x46a, JPEG), JPEG],
    ['JPEG with two', blip(0xf01d, 0x46b, JPEG, 2), JPEG],
    ['PNG', blip(0xf01e, 0x6e0, PNG), PNG],
    ['an EMF metafile, which the window does not show', atom(0xf01a, [...identifier(1), ...new Array(34).fill(0), 1, 2], 0x3d4), undefined],
    ['a WMF metafile', atom(0xf01b, [...identifier(1), ...new Array(34).fill(0)], 0x216), undefined],
    ['a picture with nothing after its identifier', atom(0xf01e, identifier(1), 0x6e0), undefined],
    ['no picture at all', atom(0xf00a, [1, 2, 3, 4]), undefined]
  ])('reads the bytes of %s', (_, record, bytes) => {
    const { whole, first } = read(record)
    const found = blipBytes(whole, first)
    expect(found === undefined ? undefined : [...found]).toEqual(bytes)
  })

  /** A bitmap's header: its size, then its width, height, planes, bits per pixel, compression, and colours used. */
  const bitmap = (bits: number, compression = 0, used = 0, headerSize = 40) =>
    new Uint8Array([
      ...u32(headerSize),
      ...u32(2),
      ...u32(2),
      ...u16(1),
      ...u16(bits),
      ...u32(compression),
      ...new Array(12).fill(0),
      ...u32(used),
      ...new Array(headerSize - 36).fill(0),
      ...new Array(1100).fill(0)
    ])
  it.each<[string, Uint8Array, number | undefined]>([
    ['8 bits, with a full palette', bitmap(8), 14 + 40 + 256 * 4],
    ['8 bits, with the colours it uses', bitmap(8, 0, 2), 14 + 40 + 2 * 4],
    ['24 bits, with no palette', bitmap(24), 14 + 40],
    ['32 bits, with three masks', bitmap(32, 3), 14 + 40 + 12],
    ['a larger header', bitmap(24, 0, 0, 108), 14 + 108],
    [
      'a core header of 12 bytes, 1 bit, with 3-byte colours',
      new Uint8Array([...u32(12), ...u16(2), ...u16(2), ...u16(1), ...u16(1), ...new Array(40).fill(0)]),
      14 + 12 + 2 * 3
    ],
    ['too little to be a bitmap', new Uint8Array(20), undefined]
  ])('gives a device-independent bitmap of %s the header of a file', (_, given, pixels) => {
    const file = bitmapFile(given)
    if (pixels === undefined) {
      expect(file).toBeUndefined()
      return
    }
    const view = new DataView((file as Uint8Array).buffer)
    expect([view.getUint8(0), view.getUint8(1)]).toEqual([0x42, 0x4d])
    expect(view.getUint32(2, true)).toBe(given.length + 14)
    expect(view.getUint32(10, true)).toBe(pixels)
    expect([...(file as Uint8Array).subarray(14)]).toEqual([...given])
  })

  it('finds each picture of the store by its place: kept in its entry, or where its entry says in another stream', () => {
    const delayed = new Uint8Array([0, 0, 0, 0, ...blip(0xf01d, 0x46a, JPEG)])
    const { whole, first } = read(
      container(ART.store, [entry(blip(0xf01e, 0x6e0, PNG)), entry([], 4), entry([], 0xffffffff), atom(0xf00a, [1, 2, 3, 4]), entry([], 999)])
    )
    const stored = storedPictures(whole, first, delayed)
    const bytesAt = (place: number) => {
      const found = stored(place)?.bytes
      return found && [...found]
    }
    expect(bytesAt(1)).toEqual(PNG)
    expect(bytesAt(2)).toEqual(JPEG)
    expect(stored(3)).toBeUndefined()
    expect(stored(4)).toBeUndefined()
    expect(stored(5)).toBeUndefined()
    expect(stored(0)).toBeUndefined()
    expect(stored(9)).toBeUndefined()
    expect(storedPictures(whole, first)(2)).toBeUndefined()
  })

  /** A shape: its identifier and flags, then its properties, a picture's place and its description. */
  const shape = (id: number, flags: number, picture?: number, description?: string) => {
    const words = description === undefined ? [] : [...wide(description), 0, 0]
    const properties = [
      ...(picture === undefined ? [] : [...u16(0x4104), ...u32(picture)]),
      ...(description === undefined ? [] : [...u16(0x8381), ...u32(words.length)])
    ]
    const count = (picture === undefined ? 0 : 1) + (description === undefined ? 0 : 1)
    return container(ART.shape, [
      atom(ART.shapeHeader, [...u32(id), ...u32(flags)], 75),
      atom(ART.properties, [...properties, ...words], count),
      atom(ART.clientAnchor, [0, 0, 0, 0])
    ])
  }

  it('reads a drawing’s shapes in order, a group’s in its place, without the background or a deleted shape', () => {
    const { whole, first } = read(
      container(ART.drawing, [
        container(ART.group, [
          shape(1024, 0x05),
          shape(1025, 0x0a00, 3, 'A cat on a mat'),
          shape(1026, 0x0c00, 1),
          shape(1027, 0x0a08, 2),
          container(ART.group, [shape(1028, 0x0003), shape(1029, 0x0a02, 4)]),
          shape(1030, 0x0a00)
        ])
      ])
    )
    expect(artShapes(whole, first).map(({ id, picture, alt }) => ({ id, picture, alt }))).toEqual([
      { id: 1024, picture: undefined, alt: '' },
      { id: 1025, picture: 3, alt: 'A cat on a mat' },
      { id: 1028, picture: undefined, alt: '' },
      { id: 1029, picture: 4, alt: '' },
      { id: 1030, picture: undefined, alt: '' }
    ])
  })

  it('keeps each picture once, says one its app shows, and stops at the limit', () => {
    const figures = new ArtFigures()
    const png = { bytes: new Uint8Array(PNG) }
    expect(figures.picture('store:1', png, 'Logo', { width: 96 })).toBe(0)
    expect(figures.picture('store:1', png, 'Logo', { width: 96 })).toBe(0)
    expect(figures.picture('store:1', png, 'Logo', { width: 48 })).toBe(1)
    expect(figures.picture('store:2', { bytes: new Uint8Array([1, 2, 3]) }, 'Odd')).toBe(2)
    expect(figures.picture('store:3', undefined, 'A drawing')).toBe(3)
    expect(figures.unshown('', 'chart')).toBe(4)
    expect(figures.at([3, 4, 9])).toEqual([
      { kind: 'unshown', alt: 'A drawing', what: 'picture' },
      { kind: 'unshown', alt: '', what: 'chart' }
    ])
    expect(figures.list[0]).toEqual({ kind: 'picture', type: 'image/png', bytes: new Uint8Array(PNG), alt: 'Logo', width: 96, height: undefined })
    expect(figures.list[2]).toEqual({ kind: 'unshown', alt: 'Odd', what: 'picture' })
    for (let index = figures.list.length; index < FIGURE_LIMIT; index++) figures.unshown('', 'picture')
    expect(figures.picture('store:9', png, 'One too many')).toBeUndefined()
    expect(figures.unshown('', 'chart')).toBeUndefined()
  })

  /** An EMF of 10 by 5 millimetres that draws one rectangle: its header of 108 bytes, the rectangle, then its end. */
  const EMF = (() => {
    const record = (type: number, ...values: number[]) => [...u32(type), ...u32(8 + values.length * 4), ...values.flatMap(u32)]
    const header = [
      ...u32(1),
      ...u32(108),
      ...[0, 0, 99, 49, 0, 0, 1000, 500, 0x464d4520, 0x10000, 0, 0].flatMap(u32),
      0,
      0,
      0,
      0,
      ...[0, 0, 0, 1000, 1000, 100, 100, 0, 0, 0, 100_000, 100_000].flatMap(u32)
    ]
    return [...header, ...record(43, 10, 10, 20, 20), ...record(14, 0, 16, 20)]
  })()
  /** A metafile of the store: its identifier, its header (its size, box, size in EMUs, size kept, packing), then its bytes. */
  const metafileBlip = (kept: readonly number[], packed: boolean) =>
    atom(
      0xf01a,
      [
        ...identifier(1),
        ...u32(EMF.length),
        ...[0, 0, 100, 50].flatMap(u32),
        ...u32(914_400),
        ...u32(457_200),
        ...u32(kept.length),
        packed ? 0 : 0xfe,
        0xfe,
        ...kept
      ],
      0x3d4
    )
  const deflated = async (bytes: readonly number[]) => {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate'))
    return [...new Uint8Array(await new Response(stream).arrayBuffer())]
  }

  it('reads a metafile of the store with what its header says of it', () => {
    const { whole, first } = read(metafileBlip(EMF, false))
    const found = blipMetafile(whole, first)
    expect(found && { ...found, bytes: [...found.bytes] }).toEqual({
      bytes: EMF,
      packed: false,
      size: EMF.length,
      hint: { bounds: { left: 0, top: 0, right: 100, bottom: 50 }, width: 96, height: 48 }
    })
    expect(blipMetafile(...(Object.values(read(blip(0xf01e, 0x6e0, PNG))) as [Uint8Array, ReturnType<typeof read>['first']]))).toBeUndefined()
  })

  it('draws a metafile as SVG at once, or one kept packed once the file is read', async () => {
    const figures = new ArtFigures()
    const plain = read(metafileBlip(EMF, false))
    const packed = read(metafileBlip(await deflated(EMF), true))
    expect(figures.picture('store:1', { metafile: blipMetafile(plain.whole, plain.first) }, 'Plan', { width: 200 })).toBe(0)
    expect(figures.picture('store:2', { metafile: blipMetafile(packed.whole, packed.first) }, 'Plan')).toBe(1)
    expect(figures.list.map((figure) => figure.kind)).toEqual(['picture', 'unshown'])
    await figures.drawPacked()
    expect(figures.list.map((figure) => (figure.kind === 'picture' ? [figure.type, figure.width, figure.height] : figure.kind))).toEqual([
      ['image/svg+xml', 200, 100],
      ['image/svg+xml', 96, 48]
    ])
    const svg = figures.list[1]?.kind === 'picture' ? new TextDecoder().decode(figures.list[1].bytes) : ''
    expect(svg).toContain('<path d="M10 10L20 10L20 20L10 20Z"')
  })

  it.each<[number, number | undefined]>([
    [1440, 96],
    [720, 48],
    [0, undefined],
    [-15, undefined],
    [Number.NaN, undefined]
  ])('reads %j twentieths of a point as %j pixels', (twips, pixels) => {
    expect(twipPixels(twips)).toBe(pixels)
  })
})
