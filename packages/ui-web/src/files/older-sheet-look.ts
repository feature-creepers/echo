/**
 * A sheet of an Excel workbook of 2 to 2003 as it looks (docs/SPEC.md, section 9.7), read into `sheet-look.ts` from the
 * records `binary-office.ts` keeps: the workbook's fonts (`FONT`, with `FONTCOLOR` in Excel 2), its styles of cells
 * (`XF`), each a font, a format, an alignment, borders and a fill, and its palette (`PALETTE`); each sheet's columns'
 * widths (`COLINFO`, `COLWIDTH` in Excel 2, `DEFCOLWIDTH`, `STANDARDWIDTH`), rows' heights (`ROW`,
 * `DEFAULTROWHEIGHT`), merged cells (`MERGEDCELLS`), and whether it shows its grid and headings (`WINDOW2`) and how
 * much it is zoomed (`SCL`). Each version lays these records out its own way; what they say is the same.
 */

import { openArchive, textOf } from './archive.ts'
import { type Reader, reader } from './binary-records.ts'
import type { BorderLook, TextLook } from './document-look.ts'
import {
  cellLooks,
  digitWidth,
  excelRotation,
  type MergedCells,
  PALETTE,
  type Rotation,
  readWorkbookTheme,
  type SheetLayout,
  type SheetLook,
  tinted,
  type WorkbookStyles
} from './sheet-look.ts'

/**
 * The records of a workbook's styles: its fonts, its styles of cells and its palette, as Excel 2, 3, 4, 5 or 97 wrote
 * them, and the colours in full Excel 2007 adds for older apps (`XFEXT`), some of its theme, whose package it keeps
 * (`THEME`).
 */
export interface OlderBookRecords {
  /** Excel's version, from 2 to 8, each laying out its fonts and styles its own way. */
  version: number
  fonts: Uint8Array[]
  /** Excel 2's colours of its fonts (`FONTCOLOR`), each by the place of the font it follows. */
  fontColors: (number | undefined)[]
  styles: Uint8Array[]
  /**
   * The attributes Excel 2's cells keep themselves, three bytes each, styles after those of the records when a sheet
   * has none: a font and a format, then an alignment, borders and shading.
   */
  explicit: Uint8Array[]
  palette: Uint8Array | undefined
  extended: Uint8Array[]
  theme: Uint8Array | undefined
  /** Excel 5's 8-bit text, in the workbook's code page. */
  eight: (bytes: Uint8Array) => string
}

/** The records of a sheet's layout, each as it was read. */
export interface OlderSheetRecords {
  /** Whether they are Excel 2's, whose columns, rows and window have records of their own. */
  two?: boolean | undefined
  /** The width of a column with none of its own, in characters (`DEFCOLWIDTH`), or in 256ths of one (`STANDARDWIDTH`). */
  defaultWidth?: number | undefined
  standardWidth?: number | undefined
  columns: Uint8Array[]
  /** The height of a row with none of its own, in twentieths of a point. */
  defaultHeight?: number | undefined
  rows: Uint8Array[]
  merges: Uint8Array[]
  window?: Uint8Array | undefined
  zoom?: Uint8Array | undefined
}

/** Excel's kinds of line, by their number: thin, medium, dashed, dotted, thick, double, hair, then the medium and dashed ones. */
const LINES: (Pick<BorderLook, 'width' | 'style'> | undefined)[] = [
  undefined,
  { width: 0.75, style: 'solid' },
  { width: 1.5, style: 'solid' },
  { width: 0.75, style: 'dashed' },
  { width: 0.75, style: 'dotted' },
  { width: 2.25, style: 'solid' },
  { width: 2.25, style: 'double' },
  { width: 0.75, style: 'dotted' },
  { width: 1.5, style: 'dashed' },
  { width: 0.75, style: 'dashed' },
  { width: 1.5, style: 'dashed' },
  { width: 0.75, style: 'dashed' },
  { width: 1.5, style: 'dashed' },
  { width: 1.5, style: 'dashed' }
]

/** The share of the front colour each of Excel's patterns of fill shows, past none (0) and solid (1). */
const PATTERN_SHARES: Record<number, number> = { 2: 0.5, 3: 0.75, 4: 0.25, 17: 0.125, 18: 0.0625 }

/** Excel's horizontal alignments by their number: general, left, centre, right, fill, justified, centred across, distributed. */
const ALIGNS = [undefined, 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed']
const VERTICALS = ['top', 'center', 'bottom', 'justify', 'distributed']

/** One colour over another by a share of it. */
function mixed(over: string, under: string, share: number): string {
  const part = (color: string, index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round(part(over, index) * share + part(under, index) * (1 - share))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/**
 * A font of Excel 2, 3 or 4: its height in twentieths of a point and its weight, slant, underline and strike as flags,
 * then in Excel 3 and 4 its colour, then its name.
 */
function readEarliestFont(bytes: Uint8Array, version: number, eight: (bytes: Uint8Array) => string, color: string | undefined): TextLook {
  const font = reader(bytes)
  const flags = font.u16(2)
  const at = version === 2 ? 4 : 6
  const name = eight(font.bytes(at + 1, Math.min(font.u8(at), bytes.length - at - 1)))
  const look: TextLook = { size: Math.min(Math.max(font.u16(0) / 20, 1), 409) }
  if (name) look.font = name
  if (color) look.color = color
  if (flags & 1) look.bold = true
  if (flags & 2) look.italic = true
  if (flags & 4) look.underline = 'solid'
  if (flags & 8) look.struck = true
  return look
}

/** A font (`FONT`): its height in twentieths of a point, slant and strike, colour, weight, position, underline, then its name. */
function readFont(bytes: Uint8Array, five: boolean, eight: (bytes: Uint8Array) => string, color: (index: number) => string | undefined): TextLook {
  const font = reader(bytes)
  const flags = font.u16(2)
  const underline = font.u8(10)
  const position = font.u16(8)
  const length = font.u8(14)
  let name = ''
  if (five) name = eight(font.bytes(15, Math.min(length, bytes.length - 15)))
  else if (font.u8(15) & 1) name = new TextDecoder('utf-16le').decode(font.bytes(16, Math.min(length * 2, bytes.length - 16)))
  else for (const byte of font.bytes(16, Math.min(length, bytes.length - 16))) name += String.fromCharCode(byte)
  const look: TextLook = { size: Math.min(Math.max(font.u16(0) / 20, 1), 409) }
  if (name) look.font = name
  const found = color(font.u16(4))
  if (found) look.color = found
  if (font.u16(6) >= 600) look.bold = true
  if (flags & 2) look.italic = true
  if (flags & 8) look.struck = true
  if (underline === 2 || underline === 0x22) look.underline = 'double'
  else if (underline !== 0) look.underline = 'solid'
  if (position === 1) look.position = 'super'
  else if (position === 2) look.position = 'sub'
  return look
}

/** A side's border: its kind of line and its colour. */
function side(kind: number, color: string | undefined): BorderLook | undefined {
  const line = LINES[kind]
  return line && { ...line, color: color ?? '#000000' }
}

/** A style of cells as it is read, before Excel's extended colours (`XFEXT`) are set over its colours by number. */
interface CellStyleRead {
  font: number
  /** Its text's colour, in full when the extended colours give it. */
  color?: string | undefined
  pattern: number
  front: string | undefined
  back: string | undefined
  /** Top, left, bottom, right: each a kind of line and its colour. */
  lines: { kind: number; color: string | undefined }[]
  align: string | undefined
  vertical: string | undefined
  wrap: boolean
  indent: number
  rotation?: Rotation | undefined
}

/**
 * Excel 4's and 5's turns of a cell's text, by their number: none, letters stacked, 90 degrees counterclockwise, and
 * 90 clockwise.
 */
const ORIENTATIONS: (Rotation | undefined)[] = [undefined, 'stacked', 90, -90]

/**
 * A style of Excel 2, given by its font and a byte of flags, as its records (`XF`) and its cells' own attributes keep
 * it: an alignment, a thin black line on each side it names, and shading, which Excel 2 draws as black dots over white.
 */
function twoStyle(font: number, flags: number): CellStyleRead {
  const line = (bit: number) => ({ kind: flags & bit ? 1 : 0, color: '#000000' })
  return {
    font,
    pattern: flags & 0x80 ? 17 : 0,
    front: '#000000',
    back: '#ffffff',
    lines: [line(0x20), line(0x08), line(0x40), line(0x10)],
    align: ALIGNS[flags & 7],
    vertical: undefined,
    wrap: false,
    indent: 0
  }
}

/**
 * A style of cells (`XF`) of Excel 3 or 4, in 12 bytes: its font and format, then its alignment and wrapping (with the
 * vertical alignment Excel 4 adds), its fill, and its borders, each colour by its number among 24.
 */
function readEarliestStyle(style: Reader, version: number, color: (index: number) => string | undefined): CellStyleRead {
  const alignment = style.u16(4)
  const fill = style.u16(6)
  const lines = style.u32(8)
  const side = (at: number) => ({ kind: (lines >>> at) & 7, color: color((lines >>> (at + 3)) & 0x1f) })
  return {
    font: style.u8(0),
    pattern: fill & 0x3f,
    front: color((fill >> 6) & 0x1f),
    back: color((fill >> 11) & 0x1f),
    lines: [side(0), side(8), side(16), side(24)],
    align: ALIGNS[alignment & 7],
    vertical: version === 4 ? VERTICALS[(alignment >> 4) & 3] : undefined,
    wrap: (alignment & 8) !== 0,
    indent: 0,
    rotation: version === 4 ? ORIENTATIONS[(alignment >> 6) & 3] : undefined
  }
}

/** A style of cells (`XF`), as Excel 97 writes it in 20 bytes and Excel 5 in 16, its parts at places of their own. */
function readCellStyle(style: Reader, five: boolean, color: (index: number) => string | undefined): CellStyleRead {
  const alignment = style.u8(6)
  // Excel 5 turns a cell's text a quarter at most, in the byte after its alignment; Excel 97 by any angle, there.
  const turn = style.u8(7)
  const read = (pattern: number, front: number, back: number, lines: [number, number][], indent: number): CellStyleRead => ({
    font: style.u16(0),
    pattern,
    front: color(front),
    back: color(back),
    lines: lines.map(([kind, at]) => ({ kind, color: color(at) })),
    align: ALIGNS[alignment & 7],
    vertical: VERTICALS[(alignment >> 4) & 7],
    wrap: (alignment & 8) !== 0,
    indent,
    rotation: five ? ORIENTATIONS[turn & 3] : excelRotation(turn)
  })
  if (five) {
    const fill = style.u32(8)
    const lines = style.u32(12)
    return read(
      (fill >> 16) & 0x3f,
      fill & 0x7f,
      (fill >> 7) & 0x7f,
      [
        [lines & 7, (lines >> 9) & 0x7f],
        [(lines >> 3) & 7, (lines >> 16) & 0x7f],
        [(fill >>> 22) & 7, (fill >>> 25) & 0x7f],
        [(lines >> 6) & 7, (lines >>> 23) & 0x7f]
      ],
      0
    )
  }
  const first = style.u32(10)
  const second = style.u32(14)
  const fill = style.u16(18)
  return read(
    (second >>> 26) & 0x3f,
    fill & 0x7f,
    (fill >> 7) & 0x7f,
    [
      [(first >> 8) & 0xf, second & 0x7f],
      [first & 0xf, (first >> 16) & 0x7f],
      [(first >> 12) & 0xf, (second >> 7) & 0x7f],
      [(first >> 4) & 0xf, (first >>> 23) & 0x7f]
    ],
    style.u8(8) & 0x0f
  )
}

/**
 * A colour in full as Excel 2007 writes it for older apps (`FullColorExt`): automatic, by its number in the palette,
 * red, green and blue, or a colour of the theme, each lightened or darkened by its tint.
 */
function fullColor(record: Reader, at: number, palette: (index: number) => string | undefined, theme: readonly string[]): string | undefined {
  const kind = record.u16(at)
  const tint = record.i16(at + 2) / 32767
  let color: string | undefined
  if (kind === 1) color = palette(record.u32(at + 4))
  else if (kind === 2)
    color = `#${[0, 1, 2]
      .map((part) =>
        record
          .u8(at + 4 + part)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`
  else if (kind === 3) color = theme[record.u32(at + 4)]
  return color && tint !== 0 ? tinted(color, tint) : color
}

/** The extended colours of a style (`XFEXT`) over those it names by number: its fill's, its borders' and its text's. */
function extendStyle(style: CellStyleRead, record: Reader, palette: (index: number) => string | undefined, theme: readonly string[]): void {
  let at = 20
  for (let count = record.u16(18); count > 0 && at + 4 <= record.length; count--) {
    const kind = record.u16(at)
    const size = record.u16(at + 2)
    if (size < 4) break
    if (size >= 12) {
      const color = fullColor(record, at + 4, palette, theme)
      // Its fill's front and back, its borders' top, bottom, left and right, its text.
      if (color && kind === 4) style.front = color
      else if (color && kind === 5) style.back = color
      else if (color && kind >= 7 && kind <= 10) {
        const line = style.lines[[0, 2, 1, 3][kind - 7] as number]
        if (line) line.color = color
      } else if (color && kind === 13) style.color = color
    }
    at += size
  }
}

/** The theme's colours, from the package of a theme (`THEME`) a workbook keeps, Excel's light and dark swapped. */
async function themeColors(theme: Uint8Array | undefined): Promise<string[]> {
  if (!theme) return []
  try {
    const xml = await textOf(openArchive(theme), 'theme/theme/theme1.xml')
    return xml ? readWorkbookTheme(xml).theme : []
  } catch {
    return []
  }
}

/** A workbook's palette: Excel's own, with the workbook's changes (`PALETTE`) from its ninth colour, each red, green and blue. */
export function readOlderPalette(bytes: Uint8Array | undefined): string[] {
  const palette = [...PALETTE]
  if (!bytes || bytes.length < 2) return palette
  const changed = reader(bytes)
  for (let index = 0; index < Math.min(changed.u16(0), 56, Math.floor((bytes.length - 2) / 4)); index++)
    palette[8 + index] = [0, 1, 2]
      .map((part) =>
        changed
          .u8(2 + index * 4 + part)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  return palette
}

/**
 * A workbook's styles as the newer formats' are read: its palette, Excel's own with the workbook's changes from its
 * ninth colour, and its theme's colours; each style of cells with its font (the fifth, which Excel never writes,
 * skipped), alignment, wrapping, indent, borders and fill, in the colours in full Excel 2007 adds for them.
 */
export async function readOlderBookStyles(records: OlderBookRecords): Promise<WorkbookStyles> {
  const { version } = records
  const palette = readOlderPalette(records.palette)
  // The system's colours give none, text in its automatic colour and a fill of none: from 64 on in Excel 5 and later,
  // from 24 in Excel 3 and 4, whose palette has 16 colours of its own, and from 8 in Excel 2, which has none.
  const system = version >= 5 ? 64 : version >= 3 ? 24 : 8
  const color = (index: number) => (index < system && palette[index] !== undefined ? `#${palette[index]}` : undefined)
  const theme = await themeColors(records.theme)
  const fonts = records.fonts.map((bytes, index) => {
    try {
      if (version >= 5) return readFont(bytes, version === 5, records.eight, color)
      const named = version === 2 ? (records.fontColors[index] ?? 0x7fff) : reader(bytes).u16(4)
      return readEarliestFont(bytes, version, records.eight, color(named))
    } catch {
      return {}
    }
  })
  const fontAt = (index: number) => fonts[index < 4 ? index : index - 1] ?? fonts[0] ?? {}
  const read = records.styles.map((bytes) => {
    try {
      const style = reader(bytes)
      if (version >= 5) return readCellStyle(style, version === 5, color)
      return version === 2 ? twoStyle(style.u8(0), style.u8(3)) : readEarliestStyle(style, version, color)
    } catch {
      return undefined
    }
  })
  // Excel 2's cells that keep their attributes themselves, each its font among the first four and its flags.
  for (const attributes of records.explicit) read.push(twoStyle((attributes[1] ?? 0) >> 6, attributes[2] ?? 0))
  for (const bytes of records.extended) {
    try {
      const record = reader(bytes)
      const style = read[record.u16(14)]
      if (style) extendStyle(style, record, color, theme)
    } catch {
      // Extended colours that cannot be read leave those by number.
    }
  }
  const cells = read.map((style) => {
    if (!style) return { text: fonts[0] ?? {}, borders: {}, wrap: false, indent: 0 }
    const text = fontAt(style.font)
    const [top, left, bottom, right] = style.lines.map((line) => side(line.kind, line.color))
    // A fill of a pattern is drawn as its two colours mixed, a solid one as its front colour.
    const fill =
      style.pattern === 0
        ? undefined
        : style.pattern === 1
          ? style.front
          : mixed(style.front ?? '#000000', style.back ?? '#ffffff', PATTERN_SHARES[style.pattern] ?? 0.5)
    return {
      text: style.color ? { ...text, color: style.color } : text,
      fill,
      borders: { top, left, bottom, right },
      align: style.align,
      vertical: style.vertical,
      wrap: style.wrap,
      indent: style.indent,
      rotation: style.rotation
    }
  })
  return {
    colors: { theme, palette, fonts: { major: '', minor: '' } },
    cells,
    text: fonts[0] ?? {},
    fonts: Array.from({ length: fonts.length + 1 }, (_, index) => fontAt(index))
  }
}

/**
 * A sheet's look: its columns' widths, each by its own record or the sheet's default, Excel's units of a character
 * turned into points by the width of the default font's digit; its rows' heights; its cells' looks; its merged cells;
 * its grid, headings and zoom.
 */
export function readOlderSheetLook(sheet: OlderSheetRecords, layout: SheetLayout, styles: WorkbookStyles, size: { rows: number; columns: number }): SheetLook {
  const digit = digitWidth(styles.text)
  const columnPixels = (width: number) => Math.trunc(((256 * width + Math.trunc(128 / digit)) / 256) * digit)
  const defaultWidth = sheet.standardWidth !== undefined ? columnPixels(sheet.standardWidth / 256) : Math.ceil(((sheet.defaultWidth ?? 8) * digit + 5) / 8) * 8
  const columns = Array.from({ length: size.columns }, () => (defaultWidth * 3) / 4)
  for (const bytes of sheet.columns) {
    if (bytes.length < (sheet.two ? 4 : 10)) continue
    const record = reader(bytes)
    // Excel 2's columns (`COLWIDTH`) are named in a byte each and cannot be hidden.
    const [first, last, width, hidden] = sheet.two
      ? [record.u8(0), record.u8(1), record.u16(2) / 256, false]
      : [record.u16(0), record.u16(2), record.u16(4) / 256, (record.u16(8) & 1) !== 0]
    for (let column = first; column <= Math.min(last, size.columns - 1); column++) columns[column] = hidden ? 0 : (Math.min(columnPixels(width), 2000) * 3) / 4
  }
  const usual = sheet.defaultHeight !== undefined && sheet.defaultHeight > 0 ? Math.min(sheet.defaultHeight / 20, 409) : (styles.text.size ?? 10) * 1.28
  const rows = Array.from({ length: size.rows }, () => usual)
  for (const bytes of sheet.rows) {
    if (bytes.length < (sheet.two ? 8 : 16)) continue
    const record = reader(bytes)
    const row = record.u16(0)
    if (row >= size.rows) continue
    // A row's height, unless it keeps the default one (its top bit), and whether it is hidden, which Excel 2 cannot say.
    const height = record.u16(6)
    rows[row] = !sheet.two && record.u16(12) & 0x20 ? 0 : height & 0x8000 ? usual : Math.min((height & 0x7fff) / 20, 409)
  }
  const merges: MergedCells[] = []
  for (const bytes of sheet.merges) {
    const record = reader(bytes)
    for (let index = 0; index < Math.min(record.u16(0), Math.floor((bytes.length - 2) / 8)); index++) {
      const at = 2 + index * 8
      const [firstRow, lastRow, firstColumn, lastColumn] = [record.u16(at), record.u16(at + 2), record.u16(at + 4), record.u16(at + 6)]
      if (firstRow >= size.rows || firstColumn >= size.columns || lastRow < firstRow || lastColumn < firstColumn) continue
      merges.push({
        row: firstRow,
        column: firstColumn,
        rows: Math.min(lastRow, size.rows - 1) - firstRow + 1,
        columns: Math.min(lastColumn, size.columns - 1) - firstColumn + 1
      })
    }
  }
  // Excel 2's window says in a byte each whether it shows the grid and the headings; the later ones, in flags.
  const window = sheet.window
  const view = !window || window.length < (sheet.two ? 3 : 2) ? 0x06 : sheet.two ? (window[1] ? 0x02 : 0) | (window[2] ? 0x04 : 0) : reader(window).u16(0)
  const scale = sheet.zoom && sheet.zoom.length >= 4 ? reader(sheet.zoom) : undefined
  const zoom = scale && scale.u16(2) > 0 ? scale.u16(0) / scale.u16(2) : 1
  return {
    columns,
    rows,
    ...cellLooks(layout, styles, size),
    merges,
    grid: (view & 0x02) !== 0,
    headings: (view & 0x04) !== 0,
    zoom: Number.isFinite(zoom) && zoom >= 0.1 && zoom <= 4 ? zoom : 1,
    text: styles.text
  }
}
