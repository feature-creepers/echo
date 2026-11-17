import { crc32, deflateSync } from 'node:zlib'

/** A colour with its opacity, each from 0 to 255. */
export type Rgba = readonly [number, number, number, number]

/**
 * The app's mark for the tray, drawn as pixels: a ring around a glowing core, as the assistant appears in
 * the window. Drawn rather than shipped as a picture, so it is sharp at each size a system asks for and
 * takes the colours given (a template in black for macOS, which tints it itself).
 */
export function trayIcon(size: number, ring: Rgba, core: Rgba): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  const centre = size / 2
  const outer = size * 0.46
  const thickness = Math.max(1.2, size * 0.09)
  const dot = size * 0.2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The distance from the centre of the pixel, with a pixel of soft edge so the shapes are not jagged.
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      const inRing = clamp(thickness / 2 - Math.abs(distance - (outer - thickness / 2)) + 0.5)
      const inCore = clamp(dot - distance + 0.5)
      const [r, g, b, a] = inCore >= inRing ? core : ring
      const coverage = Math.max(inRing, inCore)
      const at = (y * size + x) * 4
      pixels[at] = r
      pixels[at + 1] = g
      pixels[at + 2] = b
      pixels[at + 3] = Math.round(a * coverage)
    }
  }
  return png(size, size, pixels)
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Pixels in red, green, blue and opacity, one byte each, as a PNG file. */
export function png(width: number, height: number, rgba: Buffer): Buffer {
  // Each row starts with the byte that says it is not filtered.
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
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
