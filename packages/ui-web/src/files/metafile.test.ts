import { describe, expect, it } from 'vitest'
import { dibBitmap, drawMetafile, metafileKind } from './metafile.ts'

const u16 = (...values: number[]) => values.flatMap((value) => [value & 0xff, (value >> 8) & 0xff])
const u32 = (...values: number[]) => values.flatMap((value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
const f32 = (...values: number[]) => values.flatMap((value) => [...new Uint8Array(new Float32Array([value]).buffer)])
const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0))
const wide = (text: string) => u16(...[...text].map((letter) => letter.charCodeAt(0)))

/** A WMF record: its size in 16-bit words, its function, then its parameters. */
const wmf = (function_: number, ...words: number[]) => [...u32(3 + words.length), ...u16(function_), ...u16(...words)]
/** A WMF record whose parameters are bytes, padded to a word. */
const wmfBytes = (function_: number, bytes: number[]) => {
  const padded = bytes.length % 2 ? [...bytes, 0] : bytes
  return [...u32(3 + padded.length / 2), ...u16(function_), ...padded]
}

/** A WMF behind its placeable header: its box, in units of which `inch` make an inch, then its records and its end. */
function windowsMetafile(box: [number, number, number, number], inch: number, ...records: number[][]): Uint8Array {
  const placeable = [...u32(0x9ac6cdd7), ...u16(0, ...box.map((value) => value & 0xffff), inch), ...u32(0), ...u16(0)]
  const body = [...records.flat(), ...wmf(0)]
  const header = [...u16(1, 9, 0x0300), ...u32(9 + body.length / 2), ...u16(4), ...u32(16), ...u16(0)]
  return new Uint8Array([...placeable, ...header, ...body])
}

/** A colour as Windows keeps it, red in its low byte, as two words. */
const colourWords = (red: number, green: number, blue: number) => [red | (green << 8), blue]

/** An EMF record: its type, its size, then what it holds. */
const emf = (type: number, ...data: number[]) => [...u32(type, 8 + data.length), ...data]

/**
 * An EMF on a device of 10 pixels to the millimetre: its header's box of 10 by 5 millimetres, 100 by 50 of the
 * device's pixels, then its records and its end.
 */
function enhancedMetafile(...records: number[][]): Uint8Array {
  const body = records.flat()
  const header = emf(
    1,
    ...u32(0, 0, 99, 49, 0, 0, 1000, 500, 0x464d4520, 0x10000, 108 + body.length + 20, records.length + 2),
    ...u16(0, 0),
    ...u32(0, 0, 0, 1000, 1000, 100, 100, 0, 0, 0, 100_000, 100_000)
  )
  return new Uint8Array([...header, ...body, ...emf(14, ...u32(0, 16, 20))])
}

const svgOf = (bytes: Uint8Array) => {
  const drawn = drawMetafile(bytes)
  return drawn && { text: new TextDecoder().decode(drawn.svg), width: Math.round(drawn.width), height: Math.round(drawn.height) }
}

const RED_FILL = 'fill="#ff0000" fill-rule="evenodd"'
const HAIRLINE = 'stroke="#000000" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"'

describe('a metafile', () => {
  it.each([
    ['an EMF', enhancedMetafile(), 'emf'],
    ['a WMF behind its placeable header', windowsMetafile([0, 0, 10, 10], 1440), 'wmf'],
    ['a WMF without it', new Uint8Array([...u16(1, 9, 0x0300), ...u32(12), ...u16(0), ...u32(3), ...u16(0), ...wmf(0)]), 'wmf'],
    ['a PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), undefined]
  ])('knows %s by its first bytes', (_, bytes, kind) => {
    expect(metafileKind(bytes)).toBe(kind)
  })

  it('draws a WMF’s shapes with its brush and pen, at the size its placeable header gives', () => {
    const drawn = svgOf(
      windowsMetafile(
        [0, 0, 1440, 720],
        1440,
        wmf(0x020b, 0, 0),
        wmf(0x020c, 720, 1440),
        wmf(0x02fc, 0, ...colourWords(255, 0, 0), 0),
        wmf(0x012d, 0),
        wmf(0x02fa, 5, 0, 0, 0, 0),
        wmf(0x012d, 1),
        wmf(0x041b, 360, 720, 0, 0)
      )
    )
    expect(drawn).toEqual({
      text: `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48" viewBox="0 0 1440 720" preserveAspectRatio="none" overflow="hidden"><path d="M0 0L720 0L720 360L0 360Z" ${RED_FILL} stroke="none"/></svg>`,
      width: 96,
      height: 48
    })
  })

  it('maps a WMF’s window onto its box, lines in a row as one path, polygons and ellipses', () => {
    const drawn = svgOf(
      windowsMetafile(
        [0, 0, 100, 100],
        96,
        wmf(0x020b, -50 & 0xffff, -50 & 0xffff),
        wmf(0x020c, 200, 200),
        wmf(0x0214, 0, 0),
        wmf(0x0213, 0, 100),
        wmf(0x0213, 100, 100),
        wmf(0x0324, 3, 0, 0, 100, 0, 100, 100),
        wmf(0x0418, 150, 150, -50 & 0xffff, -50 & 0xffff)
      )
    )
    expect(drawn?.text).toContain(`<path d="M25 25L75 25L75 75" fill="none" ${HAIRLINE}/>`)
    expect(drawn?.text).toContain(`<path d="M25 25L75 25L75 75Z" fill="#ffffff" fill-rule="evenodd" ${HAIRLINE}/>`)
    expect(drawn?.text).toContain('<path d="M100 50C100 77.61 77.61 100 50 100C22.39 100 0 77.61 0 50C0 22.39 22.39 0 50 0C77.61 0 100 22.39 100 50Z"')
  })

  it('writes a WMF’s text in its font, colour and alignment, its marks escaped', () => {
    const face = [...ascii('Arial'), ...new Array(27).fill(0)]
    const drawn = svgOf(
      windowsMetafile(
        [0, 0, 100, 100],
        96,
        wmfBytes(0x02fb, [...u16(-20 & 0xffff, 0, 0, 0, 700), 0, 0, 0, 0, 0, 0, 0, 0, ...face]),
        wmf(0x012d, 0),
        wmf(0x0209, ...colourWords(0, 0, 255)),
        wmf(0x012e, 24),
        wmfBytes(0x0521, [...u16(4), ...ascii('a<b&'), ...u16(50, 10)])
      )
    )
    expect(drawn?.text).toContain(
      `<text transform="translate(10 50)" x="0" y="0" font-family="'Arial', sans-serif" font-size="20" font-weight="bold" fill="#0000ff" xml:space="preserve">a&lt;b&amp;</text>`
    )
  })

  it('maps an EMF’s units to its device’s through its window, viewport and world, and draws its paths', () => {
    const drawn = svgOf(
      enhancedMetafile(
        emf(17, ...u32(8)),
        emf(9, ...u32(1000, 500)),
        emf(11, ...u32(100, 50)),
        emf(43, ...u32(100, 100, 500, 300)),
        emf(59),
        emf(27, ...u32(0, 0)),
        emf(54, ...u32(1000, 0)),
        emf(54, ...u32(1000, 500)),
        emf(61),
        emf(60),
        emf(62, ...u32(0, 0, 0, 0)),
        emf(35, ...f32(1, 0, 0, 1, 100, 0)),
        emf(43, ...u32(0, 0, 100, 100))
      )
    )
    expect(drawn?.width).toBe(38)
    expect(drawn?.text).toContain('viewBox="0 0 100 50"')
    expect(drawn?.text).toContain(`<path d="M10 10L50 10L50 30L10 30Z" fill="#ffffff" fill-rule="evenodd" ${HAIRLINE}/>`)
    expect(drawn?.text).toContain('<path d="M0 0L100 0L100 50Z" fill="#ffffff" fill-rule="evenodd" stroke="none"/>')
    expect(drawn?.text).toContain('<path d="M10 0L20 0L20 10L10 10Z"')
  })

  it('clips an EMF’s shapes to a box until the state before it comes back', () => {
    const text = svgOf(
      enhancedMetafile(emf(33), emf(30, ...u32(0, 0, 50, 50)), emf(43, ...u32(10, 10, 20, 20)), emf(34, ...u32(-1)), emf(43, ...u32(30, 30, 40, 40)))
    )?.text
    expect(text).toContain('<clipPath id="c1" clipPathUnits="userSpaceOnUse"><path d="M0 0L50 0L50 50L0 50Z" clip-rule="nonzero"/></clipPath>')
    expect(text).toContain('<g clip-path="url(#c1)"><path d="M10 10L20 10L20 20L10 20Z"')
    expect(text).toContain('</g><path d="M30 30L40 30L40 40L30 40Z"')
  })

  it('writes an EMF’s text at the advances it gives, and its bitmaps as data', () => {
    const information = [...u32(40, 1, 1), ...u16(1, 24), ...u32(0, 4, 0, 0, 0, 0)]
    const pixels = [0, 0, 255, 0]
    const stretched = emf(
      81,
      ...u32(0, 0, 0, 0, 5, 5, 0, 0, 1, 1, 80, information.length, 80 + information.length, pixels.length, 0, 0x00cc0020, 10, 10),
      ...information,
      ...pixels
    )
    const text = svgOf(
      enhancedMetafile(stretched, emf(84, ...u32(0, 0, 0, 0, 1), ...f32(1, 1), ...u32(20, 30, 2, 76, 0, 0, 0, 0, 0, 80), ...wide('ab'), ...u32(10, 20)))
    )?.text
    expect(text).toContain(
      '<svg width="10" height="10" viewBox="0 0 1 1" preserveAspectRatio="none" overflow="hidden"><image width="1" height="1" preserveAspectRatio="none" href="data:image/bmp;base64,'
    )
    expect(text).toContain('<text transform="translate(20 30)" x="0 10" y="')
    expect(text).toContain('>ab</text>')
  })

  it('draws what came before a damaged record, and nothing for a metafile that draws nothing or none at all', () => {
    const whole = enhancedMetafile(emf(43, ...u32(10, 10, 20, 20)), emf(43, ...u32(30, 30, 40, 40)))
    const cut = whole.slice(0, 108 + 24 + 10)
    expect(svgOf(cut)?.text).toContain('<path d="M10 10L20 10L20 20L10 20Z"')
    expect(svgOf(enhancedMetafile(emf(17, ...u32(8))))).toBeUndefined()
    expect(svgOf(new Uint8Array(40))).toBeUndefined()
  })
})

describe('a device-independent bitmap', () => {
  it('becomes a file of its format, whose rows go up unless its height says they go down', () => {
    const information = (height: number, compression = 0) => new Uint8Array([...u32(40, 2, height), ...u16(1, 24), ...u32(compression, 0, 0, 0, 0, 0)])
    const bitmap = dibBitmap(information(1), new Uint8Array(8))
    expect(bitmap && { ...bitmap, bytes: [...bitmap.bytes.subarray(0, 14)] }).toEqual({
      type: 'image/bmp',
      bytes: [0x42, 0x4d, ...u32(62), 0, 0, 0, 0, ...u32(54)],
      width: 2,
      height: 1,
      upward: true
    })
    expect(dibBitmap(information(-1), new Uint8Array(8))?.upward).toBe(false)
    expect(dibBitmap(information(1, 5), new Uint8Array([0x89, 0x50]))?.type).toBe('image/png')
    expect(dibBitmap(information(0), new Uint8Array(8))).toBeUndefined()
  })
})
