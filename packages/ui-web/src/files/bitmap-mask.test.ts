import { describe, expect, it } from 'vitest'
import { colourLeftOut, pixelsOf, type Transparency, throughMask, transparencyOf } from './bitmap-mask.ts'
import { type Bitmap, dibBitmap } from './metafile-canvas.ts'

const u16 = (...values: number[]) => values.flatMap((value) => [value & 0xff, (value >> 8) & 0xff])
const u32 = (...values: number[]) => values.flatMap((value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])

/** A bitmap of one row or more, its depth, compression and palette (blue, green, red, a byte left), then its pixels. */
function bitmapOf(width: number, height: number, bits: number, pixels: number[], palette: number[] = [], compression = 0): Bitmap {
  const information = new Uint8Array([...u32(40, width, height), ...u16(1, bits), ...u32(compression, 0, 0, 0, palette.length / 4, 0), ...palette])
  const bitmap = dibBitmap(information, new Uint8Array(pixels))
  if (!bitmap) throw new Error('not a bitmap')
  return bitmap
}

/** The rows of a mask, as the bytes of its pixels from the top row down. */
const maskRows = (mask: Bitmap | undefined) => {
  if (!mask) return undefined
  const read = pixelsOf(mask)
  return read && [...read.rgba].filter((_, index) => index % 4 === 0)
}

describe('the pixels of a bitmap that show', () => {
  it.each<[string, number, Transparency | undefined]>([
    ['OR leaves black out', 0x00ee0086, { kind: 'colour', red: 0, green: 0, blue: 0 }],
    ['XOR leaves black out', 0x00660046, { kind: 'colour', red: 0, green: 0, blue: 0 }],
    ['AND leaves white out', 0x008800c6, { kind: 'colour', red: 255, green: 255, blue: 255 }],
    ['OR of the inverse leaves white out', 0x00bb0226, { kind: 'colour', red: 255, green: 255, blue: 255 }],
    ['a copy leaves nothing out', 0x00cc0020, undefined]
  ])('%s', (_, operation, expected) => {
    expect(transparencyOf(operation)).toEqual(expected)
  })

  it('reads a colour left out with red in its low byte', () => {
    expect(colourLeftOut(0x00336699)).toEqual({ kind: 'colour', red: 0x99, green: 0x66, blue: 0x33 })
  })

  it('reads the rows of a bitmap from the top, whichever way they are kept', () => {
    // Two rows of one pixel of 24 bits, each padded to four bytes: blue, green, red.
    const upward = bitmapOf(1, 2, 24, [0, 0, 255, 0, 255, 0, 0, 0])
    expect([...(pixelsOf(upward)?.rgba ?? [])]).toEqual([0, 0, 255, 255, 255, 0, 0, 255])
    const downward = bitmapOf(1, -2, 24, [0, 0, 255, 0, 255, 0, 0, 0])
    expect([...(pixelsOf(downward)?.rgba ?? [])]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  it('leaves out the pixels of a colour through a mask of one bit, white where the bitmap shows', () => {
    const picture = bitmapOf(3, 1, 24, [0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0])
    const shown = throughMask(picture, { kind: 'colour', red: 0, green: 0, blue: 0 })
    expect(shown !== 'nothing' && shown?.picture).toBe(picture)
    expect(shown !== 'nothing' && pixelsOf(shown?.mask as Bitmap)?.bits).toBe(1)
    expect(shown !== 'nothing' && maskRows(shown?.mask)).toEqual([0, 255, 0])
  })

  it('reads a palette, and draws a bitmap whole when every pixel shows and not at all when none does', () => {
    // One bit a pixel: black then white in the palette; the row holds black, white, white.
    const palette = [0, 0, 0, 0, 255, 255, 255, 0]
    const picture = bitmapOf(3, 1, 1, [0b0110_0000, 0, 0, 0], palette)
    const white: Transparency = { kind: 'colour', red: 255, green: 255, blue: 255 }
    const shown = throughMask(picture, white)
    expect(shown !== 'nothing' && maskRows(shown?.mask)).toEqual([255, 0, 0])
    expect(throughMask(picture, { kind: 'colour', red: 1, green: 2, blue: 3 })).toEqual({ picture })
    expect(throughMask(bitmapOf(2, 1, 1, [0b1100_0000, 0, 0, 0], palette), white)).toBe('nothing')
  })

  it('fades a blended bitmap by each pixel’s opacity, its colours divided back from it', () => {
    // 32 bits a pixel, blue, green, red and opacity: a red at half, kept multiplied by it, then a green whole.
    const picture = bitmapOf(2, 1, 32, [0, 0, 128, 128, 0, 255, 0, 255])
    const shown = throughMask(picture, { kind: 'alpha' })
    if (!shown || shown === 'nothing') throw new Error('not shown')
    expect([...(pixelsOf(shown.picture)?.rgba ?? [])]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
    expect(pixelsOf(shown.mask as Bitmap)?.bits).toBe(8)
    expect(maskRows(shown.mask)).toEqual([128, 255])
  })

  it.each<[string, Bitmap]>([
    ['a bitmap whose every pixel has no opacity, as one that keeps none', bitmapOf(1, 1, 32, [1, 2, 3, 0])],
    ['a bitmap of 24 bits, which keeps no opacity', bitmapOf(1, 1, 24, [1, 2, 3, 0])]
  ])('draws whole %s', (_, picture) => {
    expect(throughMask(picture, { kind: 'alpha' })).toEqual({ picture })
  })

  it.each<[string, Bitmap]>([
    ['compressed by runs', bitmapOf(2, 1, 8, [2, 0, 0, 0], [0, 0, 0, 0], 1)],
    ['cut short', bitmapOf(4, 4, 24, [0, 0, 0])]
  ])('reads no pixels of a bitmap %s, which is drawn as it is', (_, picture) => {
    expect(throughMask(picture, { kind: 'colour', red: 0, green: 0, blue: 0 })).toBeUndefined()
  })
})
