/**
 * The pixels of a metafile's bitmap that show (docs/SPEC.md, section 9.7). Windows draws some bitmaps so that part of
 * them leaves the picture under them as it was: through a raster operation that changes nothing where the bitmap holds
 * one colour (a mask laid down with OR, then the picture with AND, as Office keeps a picture with transparent parts),
 * without a colour it is told to leave out, or blended by the opacity each pixel keeps. SVG draws a bitmap whole, so
 * the pixels that show become a mask, a grey bitmap white where the picture shows, which the bitmap is drawn through.
 */
import { type Bitmap, Reader } from './metafile-canvas.ts'

/** What leaves a pixel out: one colour, or the opacity a 32-bit bitmap keeps in each pixel's fourth byte. */
export type Transparency = { kind: 'colour'; red: number; green: number; blue: number } | { kind: 'alpha' }

/** A bitmap as it is drawn: whole, through a mask, or not at all when none of it shows. */
export type Shown = { picture: Bitmap; mask?: Bitmap | undefined } | 'nothing'

/** The most pixels a bitmap is read for: past them, it is drawn whole as before. */
export const PIXEL_LIMIT = 4_194_304

const BLACK: Transparency = { kind: 'colour', red: 0, green: 0, blue: 0 }
const WHITE: Transparency = { kind: 'colour', red: 255, green: 255, blue: 255 }

/**
 * The colour a raster operation leaves the picture under it unchanged for: black for OR and XOR (`SRCPAINT`,
 * `SRCINVERT`), white for AND and for OR of the inverse (`SRCAND`, `MERGEPAINT`). Other operations draw the bitmap whole.
 */
export function transparencyOf(operation: number): Transparency | undefined {
  if (operation === 0x00ee0086 || operation === 0x00660046) return BLACK
  if (operation === 0x008800c6 || operation === 0x00bb0226) return WHITE
  return undefined
}

/** The colour a `COLORREF` names, red in its low byte, left out. */
export const colourLeftOut = (value: number): Transparency => ({ kind: 'colour', red: value & 0xff, green: (value >>> 8) & 0xff, blue: (value >>> 16) & 0xff })

/**
 * A bitmap drawn with what leaves its pixels out: whole when every pixel shows, through a mask when some do, nothing
 * when none does. A bitmap that cannot be read pixel by pixel (compressed, too large, damaged) is none: it is drawn
 * whole. With an opacity per pixel, the colours Windows keeps multiplied by it are divided back, and a bitmap whose
 * every pixel has none is drawn whole, as Windows' own programs read such a bitmap as one that keeps no opacity.
 */
export function throughMask(picture: Bitmap, transparency: Transparency): Shown | undefined {
  const pixels = pixelsOf(picture)
  if (!pixels) return undefined
  const { width, height, rgba } = pixels
  const count = width * height
  const opacity = new Uint8Array(count)
  if (transparency.kind === 'alpha') {
    if (pixels.bits !== 32) return { picture }
    for (let index = 0; index < count; index++) opacity[index] = rgba[index * 4 + 3] as number
  } else {
    const { red, green, blue } = transparency
    for (let index = 0; index < count; index++) {
      const at = index * 4
      opacity[index] = rgba[at] === red && rgba[at + 1] === green && rgba[at + 2] === blue ? 0 : 255
    }
  }
  let whole = 0
  let none = 0
  for (const value of opacity) {
    if (value === 255) whole += 1
    else if (value === 0) none += 1
  }
  const partly = whole + none < count
  if (whole === count) return { picture }
  if (none === count) return transparency.kind === 'alpha' ? { picture } : 'nothing'
  const mask = partly
    ? written(width, height, 8, GREYS, (row, line) => line.set(opacity.subarray(row * width, (row + 1) * width)))
    : written(width, height, 1, [0x000000, 0xffffff], (row, line) => {
        for (let column = 0; column < width; column++)
          if (opacity[row * width + column]) line[column >> 3] = (line[column >> 3] as number) | (0x80 >> (column & 7))
      })
  if (transparency.kind === 'colour') return { picture, mask }
  // Windows keeps a blended bitmap's colours multiplied by their opacity: they are divided back, so the mask alone fades them.
  const colours = written(width, height, 24, [], (row, line) => {
    for (let column = 0; column < width; column++) {
      const at = (row * width + column) * 4
      const alpha = rgba[at + 3] as number
      const plain = (value: number) => (alpha === 0 ? 0 : Math.min(255, Math.round((value * 255) / alpha)))
      line[column * 3] = plain(rgba[at + 2] as number)
      line[column * 3 + 1] = plain(rgba[at + 1] as number)
      line[column * 3 + 2] = plain(rgba[at] as number)
    }
  })
  return { picture: { ...colours, upward: picture.upward }, mask }
}

const GREYS = Array.from({ length: 256 }, (_, grey) => grey * 0x010101)

/** A bitmap's pixels from the top row down, four bytes each (red, green, blue, and its fourth byte), and its depth. */
interface Pixels {
  width: number
  height: number
  bits: number
  rgba: Uint8Array
}

/** The pixels of a `.bmp` a metafile's bitmap became, when it keeps them as they are (no compression but masks). */
export function pixelsOf(picture: Bitmap): Pixels | undefined {
  if (picture.type !== 'image/bmp') return undefined
  const file = new Reader(picture.bytes)
  const headerSize = file.u32(14)
  if (headerSize < 12) return undefined
  const core = headerSize === 12
  const width = core ? file.u16(18) : file.i32(18)
  const signedHeight = core ? file.i16(20) : file.i32(22)
  const height = Math.abs(signedHeight)
  const bits = core ? file.u16(24) : file.u16(28)
  const compression = core ? 0 : file.u32(30)
  if (width <= 0 || height <= 0 || width * height > PIXEL_LIMIT) return undefined
  if (![1, 4, 8, 16, 24, 32].includes(bits) || ![0, 3, 6].includes(compression)) return undefined
  // Masks follow a header of 40 bytes, and sit at the same place inside a longer one.
  const masked = compression !== 0
  const masksSize = masked && headerSize === 40 ? (compression === 3 ? 12 : 16) : 0
  const [red, green, blue] = masked ? [file.u32(54), file.u32(58), file.u32(62)] : bits === 16 ? [0x7c00, 0x03e0, 0x001f] : [0xff0000, 0x00ff00, 0x0000ff]
  const alphaMask = masked && (compression === 6 || headerSize >= 56) ? file.u32(66) : 0xff000000
  const used = core ? 0 : file.u32(46)
  const entries = bits <= 8 ? Math.min(used > 0 ? used : 1 << bits, 256) : 0
  const entrySize = core ? 3 : 4
  const paletteAt = 14 + headerSize + masksSize
  const start = file.u32(10)
  const stride = Math.floor((width * bits + 31) / 32) * 4
  if (!file.has(paletteAt, entries * entrySize) || !file.has(start, stride * height)) return undefined
  // The palette's colours, red, green and blue, three bytes an entry; an index past its end is black.
  const palette = new Uint8Array(256 * 3)
  for (let index = 0; index < entries; index++) {
    const at = paletteAt + index * entrySize
    palette.set([file.u8(at + 2), file.u8(at + 1), file.u8(at)], index * 3)
  }
  const shifts = [red, green, blue, alphaMask].map(shiftOf)
  const rgba = new Uint8Array(width * height * 4)
  const bytes = picture.bytes
  const plain32 = bits === 32 && !masked
  for (let row = 0; row < height; row++) {
    const line = start + (signedHeight > 0 ? height - 1 - row : row) * stride
    for (let column = 0, at = row * width * 4; column < width; column++, at += 4) {
      if (bits <= 8) {
        const bit = column * bits
        const entry = (((bytes[line + (bit >> 3)] as number) >> (8 - bits - (bit & 7))) & ((1 << bits) - 1)) * 3
        rgba[at] = palette[entry] as number
        rgba[at + 1] = palette[entry + 1] as number
        rgba[at + 2] = palette[entry + 2] as number
        rgba[at + 3] = 255
      } else if (bits === 24 || plain32) {
        const place = line + column * (bits >> 3)
        rgba[at] = bytes[place + 2] as number
        rgba[at + 1] = bytes[place + 1] as number
        rgba[at + 2] = bytes[place] as number
        rgba[at + 3] = plain32 ? (bytes[place + 3] as number) : 255
      } else {
        const place = line + column * (bits >> 3)
        const low = (bytes[place] as number) | ((bytes[place + 1] as number) << 8)
        const value = bits === 16 ? low : (low | ((bytes[place + 2] as number) << 16) | ((bytes[place + 3] as number) << 24)) >>> 0
        rgba[at] = channel(value, red, shifts[0] as number)
        rgba[at + 1] = channel(value, green, shifts[1] as number)
        rgba[at + 2] = channel(value, blue, shifts[2] as number)
        rgba[at + 3] = bits === 32 ? channel(value, alphaMask, shifts[3] as number) : 255
      }
    }
  }
  return { width, height, bits, rgba }
}

/** Where a mask's lowest bit is. */
function shiftOf(mask: number): number {
  let shift = 0
  while (shift < 32 && ((mask >>> shift) & 1) === 0) shift += 1
  return shift
}

/** A channel of a pixel by its mask, scaled to a byte. */
function channel(value: number, mask: number, shift: number): number {
  const most = mask >>> shift
  return most === 0 ? 0 : Math.round((((value & mask) >>> shift) * 255) / most)
}

/** A `.bmp` written from the top row down: its depth, its palette (red in the high byte), and each row filled. */
function written(width: number, height: number, bits: number, palette: number[], fill: (row: number, line: Uint8Array) => void): Bitmap {
  const stride = Math.floor((width * bits + 31) / 32) * 4
  const start = 14 + 40 + palette.length * 4
  const bytes = new Uint8Array(start + stride * height)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, start, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, bits, true)
  view.setUint32(46, palette.length, true)
  palette.forEach((value, index) => {
    bytes.set([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, 0], 54 + index * 4)
  })
  for (let row = 0; row < height; row++) fill(row, bytes.subarray(start + row * stride, start + (row + 1) * stride))
  return { type: 'image/bmp', bytes, width, height, upward: false }
}
