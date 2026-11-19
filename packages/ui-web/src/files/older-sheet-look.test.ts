import { describe, expect, it } from 'vitest'
import { type OlderBookRecords, readOlderBookStyles, readOlderPalette, readOlderSheetLook } from './older-sheet-look.ts'
import type { Rotation, SheetLayout } from './sheet-look.ts'

/** Little-endian bytes written in order. */
class Bytes {
  readonly values: number[] = []
  u8(value: number) {
    this.values.push(value & 0xff)
    return this
  }
  u16(value: number) {
    return this.u8(value).u8(value >> 8)
  }
  u32(value: number) {
    return this.u16(value & 0xffff).u16(value >>> 16)
  }
  raw(bytes: readonly number[]) {
    for (const byte of bytes) this.u8(byte)
    return this
  }
  done() {
    return new Uint8Array(this.values)
  }
}

/** A font of Excel 97 (`FONT`): its height in twentieths of a point, its flags, colour, weight, position, underline and name. */
function font(options: { height?: number; flags?: number; color?: number; weight?: number; position?: number; underline?: number; name: string }): Uint8Array {
  const bytes = new Bytes()
    .u16(options.height ?? 200)
    .u16(options.flags ?? 0)
    .u16(options.color ?? 0x7fff)
    .u16(options.weight ?? 400)
    .u16(options.position ?? 0)
    .u8(options.underline ?? 0)
    .u8(0)
    .u8(0)
    .u8(0)
    .u8(options.name.length)
    .u8(0)
  for (const letter of options.name) bytes.u8(letter.charCodeAt(0))
  return bytes.done()
}

/** A style of cells of Excel 97 (`XF`): its font, its alignment, indent, borders (kinds and colours) and fill. */
function style(options: {
  font?: number
  alignment?: number
  indent?: number
  lines?: { left?: [number, number]; right?: [number, number]; top?: [number, number]; bottom?: [number, number] }
  pattern?: number
  front?: number
  back?: number
}): Uint8Array {
  const { left = [0, 0], right = [0, 0], top = [0, 0], bottom = [0, 0] } = options.lines ?? {}
  return new Bytes()
    .u16(options.font ?? 0)
    .u16(0)
    .u16(0)
    .u8(options.alignment ?? 0x20)
    .u8(0)
    .u8(options.indent ?? 0)
    .u8(0)
    .u32(left[0] | (right[0] << 4) | (top[0] << 8) | (bottom[0] << 12) | (left[1] << 16) | (right[1] << 23))
    .u32(top[1] | (bottom[1] << 7) | ((options.pattern ?? 0) << 26))
    .u16((options.front ?? 64) | ((options.back ?? 65) << 7))
    .done()
}

/** Excel 2007's colours in full for a style (`XFEXT`), each its kind and red, green and blue. */
function extended(index: number, colors: [kind: number, rgb: [number, number, number]][]): Uint8Array {
  const bytes = new Bytes().u16(0x087d).u16(0).u32(0).u32(0).u16(0).u16(index).u16(0).u16(colors.length)
  for (const [kind, [red, green, blue]] of colors) bytes.u16(kind).u16(20).u16(2).u16(0).raw([red, green, blue, 0xff]).u32(0).u32(0)
  return bytes.done()
}

const records = (overrides: Partial<OlderBookRecords>): OlderBookRecords => ({
  version: 8,
  fonts: [font({ name: 'Arial' })],
  fontColors: [],
  styles: [],
  explicit: [],
  palette: undefined,
  extended: [],
  theme: undefined,
  eight: (bytes) => new TextDecoder('windows-1252').decode(bytes),
  ...overrides
})

describe('the styles of an Excel 97 workbook', () => {
  it('reads each font, the fifth that Excel never writes skipped', async () => {
    const styles = await readOlderBookStyles(
      records({
        fonts: [
          font({ name: 'Arial' }),
          font({ name: 'Arial', weight: 700 }),
          font({ name: 'Arial', flags: 2 }),
          font({ name: 'Arial', flags: 8 }),
          font({ name: 'Georgia', height: 240, color: 10, underline: 2, position: 1 })
        ],
        styles: [style({}), style({ font: 5 }), style({ font: 1 })]
      })
    )
    expect(styles.text).toEqual({ font: 'Arial', size: 10 })
    expect(styles.cells.map((cell) => cell.text)).toEqual([
      { font: 'Arial', size: 10 },
      { font: 'Georgia', size: 12, color: '#ff0000', underline: 'double', position: 'super' },
      { font: 'Arial', size: 10, bold: true }
    ])
  })

  it.each([
    ['a solid fill in its front colour', { pattern: 1, front: 13 }, '#ffff00'],
    ['a pattern as its two colours mixed', { pattern: 2, front: 10, back: 9 }, '#ff8080'],
    ['no fill', { pattern: 0, front: 10 }, undefined],
    ['a system colour as none', { pattern: 1, front: 64 }, undefined]
  ])('fills a cell with %s', async (_, fill, expected) => {
    const styles = await readOlderBookStyles(records({ styles: [style(fill)] }))
    expect(styles.cells[0]?.fill).toBe(expected)
  })

  it('sets each cell’s alignment, wrapping, indent and borders, in the colours its palette and Excel 2007’s colours give', async () => {
    const palette = new Bytes().u16(1).raw([0x12, 0x34, 0x56, 0]).done()
    const styles = await readOlderBookStyles(
      records({
        palette,
        styles: [
          style({ alignment: 2 | 8 | (0 << 4), indent: 3, lines: { left: [1, 8], top: [2, 10], bottom: [6, 12], right: [4, 64] }, pattern: 1, front: 13 })
        ],
        extended: [
          extended(0, [
            [4, [0x15, 0x60, 0x82]],
            [13, [0xff, 0xff, 0xff]]
          ])
        ]
      })
    )
    expect(styles.cells[0]).toEqual({
      text: { font: 'Arial', size: 10, color: '#ffffff' },
      fill: '#156082',
      borders: {
        left: { width: 0.75, style: 'solid', color: '#123456' },
        top: { width: 1.5, style: 'solid', color: '#ff0000' },
        bottom: { width: 2.25, style: 'double', color: '#0000ff' },
        right: { width: 0.75, style: 'dotted', color: '#000000' }
      },
      align: 'center',
      vertical: 'top',
      wrap: true,
      indent: 3
    })
    expect(readOlderPalette(palette).slice(7, 10)).toEqual(['00ffff', '123456', 'ffffff'])
  })

  it.each<[string, Partial<OlderBookRecords>, number, Rotation | undefined]>([
    ['Excel 97 by any angle', {}, 45, 45],
    ['Excel 97 down', {}, 150, -60],
    ['Excel 97 stacked', {}, 255, 'stacked'],
    ['Excel 5 a quarter counterclockwise', { version: 5 }, 2, 90],
    ['Excel 5 a quarter clockwise', { version: 5 }, 3, -90],
    ['Excel 5 stacked', { version: 5 }, 1, 'stacked']
  ])('turns a cell’s text as %s', async (_, version, turn, expected) => {
    const bytes = style({})
    bytes[7] = turn
    const styles = await readOlderBookStyles(records({ ...version, styles: [bytes] }))
    expect(styles.cells[0]?.rotation).toBe(expected)
  })

  it('reads a style of Excel 5, its parts at places of their own', async () => {
    const five = new Bytes()
      .u16(0)
      .u16(0)
      .u16(0)
      .u8(3 | (2 << 4))
      .u8(0)
      .u32(13 | (65 << 7) | (1 << 16) | (1 << 22) | (10 << 25))
      .u32(2 | (5 << 3))
      .done()
    const styles = await readOlderBookStyles(
      records({
        version: 5,
        fonts: [
          new Bytes()
            .u16(200)
            .u16(0)
            .u16(0x7fff)
            .u16(400)
            .u16(0)
            .u8(0)
            .u8(0)
            .u8(0)
            .u8(0)
            .u8(5)
            .raw([...'Arial'].map((letter) => letter.charCodeAt(0)))
            .done()
        ],
        styles: [five]
      })
    )
    expect(styles.cells[0]).toMatchObject({
      fill: '#ffff00',
      align: 'right',
      vertical: 'bottom',
      borders: {
        bottom: { width: 0.75, style: 'solid', color: '#ff0000' },
        top: { width: 1.5, style: 'solid', color: '#000000' },
        left: { width: 2.25, style: 'solid' }
      }
    })
    expect(styles.text).toEqual({ font: 'Arial', size: 10 })
  })
})

describe('the look of an Excel 97 sheet', () => {
  const layout = (rows: number, columns: number): SheetLayout => ({
    styles: Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0)),
    kinds: Array.from({ length: rows }, () => Array.from({ length: columns }, () => 'text' as const)),
    heights: [],
    numberColors: []
  })

  it('sizes its columns and rows, merges its cells, and shows its grid, headings and zoom as it says', async () => {
    const styles = await readOlderBookStyles(records({ styles: [style({})] }))
    const column = (first: number, last: number, width: number, hidden = false) =>
      new Bytes()
        .u16(first)
        .u16(last)
        .u16(width)
        .u16(15)
        .u16(hidden ? 1 : 0)
        .u16(0)
        .done()
    const row = (index: number, height: number, flags = 0) => new Bytes().u16(index).u16(0).u16(3).u16(height).u16(0).u16(0).u16(flags).u16(15).done()
    const look = readOlderSheetLook(
      {
        standardWidth: 8 * 256,
        columns: [column(1, 1, 20 * 256), column(2, 2, 10 * 256, true)],
        defaultHeight: 300,
        rows: [row(0, 600), row(1, 300, 0x20), row(2, 0x8000 | 100)],
        merges: [new Bytes().u16(1).u16(0).u16(0).u16(0).u16(1).done()],
        window: new Bytes().u16(0x04).done(),
        zoom: new Bytes().u16(3).u16(4).done()
      },
      layout(3, 3),
      styles,
      { rows: 3, columns: 3 }
    )
    // Arial's digit is seven pixels: eight characters are 56 pixels, twenty are 140.
    expect(look.columns).toEqual([42, 105, 0])
    expect(look.rows).toEqual([30, 0, 15])
    expect(look.merges).toEqual([{ row: 0, column: 0, rows: 1, columns: 2 }])
    expect([look.grid, look.headings, look.zoom]).toEqual([false, true, 0.75])
    expect(look.cells).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ])
    expect(look.looks).toEqual([{ text: { font: 'Arial', size: 10 }, borders: {}, align: 'left', vertical: 'bottom', wrap: false, indent: 0 }])
  })
})
