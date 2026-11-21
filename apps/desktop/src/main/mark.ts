import { crc32, deflateSync } from 'node:zlib'

/**
 * The app's mark, drawn as pixels: the assistant's eye as the window draws it small, a ring, the plane its
 * composition is known by, and the pupil. It is drawn rather than shipped as pictures, so it is sharp at each size a
 * system asks for, takes the colours it is given (the tray follows the assistant's accent and state), and has one
 * source for the tray, the window and the packages' icons.
 */

/** A colour with its opacity, each from 0 to 255. */
export type Rgba = readonly [number, number, number, number]

/** A colour written as #rrggbb, with an opacity from 0 to 255. */
export const rgba = (hex: string, alpha = 255): Rgba => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
  alpha
]

/** How an eye is composed, as the design values name it. */
type Composition = 'sight' | 'orbit'

/** What one layer paints at a point: its colour, and how much of the pixel it covers, from 0 to 1. */
type Layer = (x: number, y: number) => readonly [colour: Rgba, coverage: number]

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Layers painted over each other, at the centre of each pixel, into red, green, blue and opacity bytes. A
 * shape's edge covers part of a pixel, so the shapes are smooth at any size without drawing larger first.
 */
function paint(size: number, layers: Layer[]): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0]
      for (const layer of layers) {
        const [[lr, lg, lb, la], coverage] = layer(x + 0.5, y + 0.5)
        const over = (la / 255) * coverage
        if (over <= 0) continue
        const alpha = over + a * (1 - over)
        r = (lr * over + r * a * (1 - over)) / alpha
        g = (lg * over + g * a * (1 - over)) / alpha
        b = (lb * over + b * a * (1 - over)) / alpha
        a = alpha
      }
      const at = (y * size + x) * 4
      pixels[at] = Math.round(r)
      pixels[at + 1] = Math.round(g)
      pixels[at + 2] = Math.round(b)
      pixels[at + 3] = Math.round(a * 255)
    }
  }
  return pixels
}

/** How much of a pixel a circle's outline covers: its outer radius and thickness in pixels, at least a pixel thick. */
function outline(size: number, outer: number, thickness: number, x: number, y: number): number {
  const width = Math.max(1.2, thickness)
  return clamp(width / 2 - Math.abs(Math.hypot(x - size / 2, y - size / 2) - (outer - width / 2)) + 0.5)
}

/** A filled circle around the centre, its radius a share of the size. */
const disc =
  (size: number, radius: number, colour: Rgba): Layer =>
  (x, y) => [colour, clamp(radius * size - Math.hypot(x - size / 2, y - size / 2) + 0.5)]

/** A circle's outline around the centre: its outer radius and thickness as shares of the size. */
const ring =
  (size: number, outer: number, thickness: number, colour: Rgba): Layer =>
  (x, y) => [colour, outline(size, outer * size, thickness * size, x, y)]

/** The right half of a circle's outline: the orbit's arc, which runs round half the eye when it is small. */
const halfRing =
  (size: number, outer: number, thickness: number, colour: Rgba): Layer =>
  (x, y) => [colour, outline(size, outer * size, thickness * size, x, y) * clamp(x - size / 2 + 0.5)]

/** A triangle with its right angle at the centre and its sides going up and to the right, as far as `reach`: the sight's hand. */
const hand =
  (size: number, reach: number, colour: Rgba): Layer =>
  (x, y) => {
    const right = x - size / 2
    const up = size / 2 - y
    return [colour, clamp(Math.min(right, up, (reach * size - right - up) / Math.SQRT2) + 0.5)]
  }

/** A filled square around the centre, its side a share of the size. */
const square =
  (size: number, side: number, colour: Rgba): Layer =>
  (x, y) => [colour, clamp((side * size) / 2 - Math.max(Math.abs(x - size / 2), Math.abs(y - size / 2)) + 0.5)]

/** A square's outline around the centre, a pixel wide: the hairline that holds a dark tile on a dark desktop. */
const frame =
  (size: number, side: number, colour: Rgba): Layer =>
  (x, y) => {
    const from = Math.max(Math.abs(x - size / 2), Math.abs(y - size / 2))
    const half = (side * size) / 2
    return [colour, clamp(half - from + 0.5) * clamp(from - (half - 1) + 0.5)]
  }

/**
 * The eye as a mark, `scale` of the picture across: its ring, its pupil, and what its composition is known by, drawn
 * large so it reads at sixteen pixels. The sight's hand lies in front of the pupil; the orbit's arc runs round the
 * right half of the ring, thicker than it.
 */
function eye(size: number, scale: number, composition: Composition, ink: Rgba, accent: Rgba): Layer[] {
  const outer = ring(size, 0.46 * scale, 0.07 * scale, ink)
  const pupil = disc(size, 0.1 * scale, ink)
  return composition === 'sight' ? [outer, pupil, hand(size, 0.41 * scale, accent)] : [outer, halfRing(size, 0.5 * scale, 0.19 * scale, accent), pupil]
}

/** The mark for the tray: the eye of the persona that answers, with nothing behind it. */
export function trayMark(size: number, composition: Composition, ink: Rgba, accent: Rgba): Buffer {
  return png(size, size, paint(size, eye(size, 1, composition, ink, accent)))
}

/** The icon's colours: the app's ground, its ink, the hairline of that ink, and the red-orange accent. */
export const ICON = { ground: '#0f0f0d', ink: '#ebe6da', accent: '#f0603c', edge: 0.34 } as const

/**
 * The app's icon: the eye on a square tile of the app's own black, with a hairline round it. With a `margin`, the
 * tile keeps the room macOS icons keep around them; elsewhere it fills the picture.
 */
export function appIcon(size: number, margin = false): Buffer {
  return png(size, size, appIconPixels(size, margin))
}

/** The app's icon as pixels in red, green, blue and opacity, one byte each. */
export function appIconPixels(size: number, margin = false): Buffer {
  const side = margin ? 0.8 : 1
  const ink = rgba(ICON.ink)
  // From 64 pixels there is room for the eye's inner ring too.
  const inner = size >= 64 ? [ring(size, 0.16 * side, 0.016 * side, ink)] : []
  // Under 32 pixels a line a pixel wide round the tile would read as a box: the tile goes without.
  const edge = size >= 32 ? [frame(size, side, rgba(ICON.ink, Math.round(255 * ICON.edge)))] : []
  return paint(size, [square(size, side, rgba(ICON.ground)), ...edge, ...eye(size, 0.74 * side, 'sight', ink, rgba(ICON.accent)), ...inner])
}

/** Pixels in red, green, blue and opacity, one byte each, as a PNG file. */
function png(width: number, height: number, rgbaPixels: Buffer): Buffer {
  // Each row starts with the byte that says it is not filtered.
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgbaPixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // Eight bits per channel, colour with opacity, the standard compression, filtering and no interlacing.
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, check])
}

/**
 * Square pictures of several sizes, as pixels in red, green, blue and opacity, as a Windows icon file. The
 * largest is kept as PNG, the others as bitmaps: every tool that reads icons (the installer's among them)
 * reads those, where some refuse small PNG pictures.
 */
export function ico(pictures: ReadonlyArray<{ size: number; pixels: Buffer }>): Buffer {
  const images = pictures.map(({ size, pixels }) => (size >= 256 ? png(size, size, pixels) : bitmap(size, pixels)))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pictures.length, 4)
  let offset = 6 + 16 * pictures.length
  const entries = pictures.map(({ size }, at) => {
    const entry = Buffer.alloc(16)
    // A size of 256 is written as 0.
    entry[0] = size % 256
    entry[1] = size % 256
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    const image = images[at] as Buffer
    entry.writeUInt32LE(image.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images])
}

/** A picture as an icon's bitmap: a header, the pixels from the bottom row up in blue, green, red and opacity, and an empty mask. */
function bitmap(size: number, rgbaPixels: Buffer): Buffer {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  // The height counts the mask under the picture.
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = ((size - 1 - y) * size + x) * 4
      pixels[to] = rgbaPixels[from + 2] ?? 0
      pixels[to + 1] = rgbaPixels[from + 1] ?? 0
      pixels[to + 2] = rgbaPixels[from] ?? 0
      pixels[to + 3] = rgbaPixels[from + 3] ?? 0
    }
  }
  // The mask has a bit for each pixel, its rows padded to four bytes; the opacity above is what counts.
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  return Buffer.concat([header, pixels, mask])
}

/** The kinds of picture a macOS icon file holds, by their size in pixels; PNG pictures for each. */
const ICNS_TYPES: ReadonlyArray<[type: string, size: number]> = [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024]
]

/** A macOS icon file, from a picture for each size it holds. */
export function icns(pictureOf: (size: number) => Buffer): Buffer {
  const parts = ICNS_TYPES.map(([type, size]) => {
    const data = pictureOf(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4)
  return Buffer.concat([head, ...parts])
}
