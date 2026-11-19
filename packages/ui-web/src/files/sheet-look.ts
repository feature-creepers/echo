/**
 * A sheet as it looks (docs/SPEC.md, section 9.7): its columns' widths and its rows' heights, each cell in its font,
 * fill, borders and alignment, its merged cells, and whether it shows its grid and its headings. Each format reads its
 * own records into this (Excel 2007 and later here), and `sheet-view.tsx` shows it. Every length is in points.
 */

import { type BorderLook, colorOf, type Sides, type TextLook } from './document-look.ts'
import { css, fromHex, fromLightness, toLightness } from './slide-svg.ts'
import { childAt, childrenNamed, type XmlNode, xmlTree } from './xml.ts'

/** How a cell is set: its text's look, its fill, its borders, how its content sits and whether it wraps. */
export interface CellLook {
  text: TextLook
  fill?: string | undefined
  borders: Sides<BorderLook>
  align: 'left' | 'center' | 'right' | 'justify'
  vertical: 'top' | 'middle' | 'bottom'
  wrap: boolean
  indent: number
  /** How far its text is turned, in degrees counterclockwise, or its letters stacked one under another. */
  rotation?: Rotation | undefined
}

/** A cell's text turned, in degrees counterclockwise from -180 to 180, or its letters stacked one under another. */
export type Rotation = number | 'stacked'

/**
 * A rotation as Excel writes it (`textRotation`, a style's byte of rotation): 1 to 90 degrees counterclockwise, 91 to
 * 180 for 1 to 90 clockwise, and 255 for letters stacked one under another; none for 0 or anything else.
 */
export function excelRotation(value: number): Rotation | undefined {
  if (value === 255) return 'stacked'
  if (value >= 1 && value <= 90) return value
  return value > 90 && value <= 180 ? 90 - value : undefined
}

/** A block of cells merged into one, from its first. */
export interface MergedCells {
  row: number
  column: number
  rows: number
  columns: number
}

/**
 * A sheet's look: each column's width and each row's height (none for one hidden), the look of each cell by its place
 * in `looks`, its merged cells, whether it shows its grid and its headings, how much it is zoomed, and its default text.
 */
export interface SheetLook {
  columns: number[]
  rows: number[]
  cells: (number | undefined)[][]
  looks: CellLook[]
  merges: MergedCells[]
  grid: boolean
  headings: boolean
  zoom: number
  text: TextLook
}

/** What a cell holds, which sets where it sits when its style says nothing: numbers to the right, text to the left, the rest centred. */
export type CellKind = 'number' | 'text' | 'logical' | 'error' | 'empty'

// Colours

/** The 64 colours of Excel's palette, by their index, before a workbook changes them. */
export const PALETTE = [
  '000000',
  'ffffff',
  'ff0000',
  '00ff00',
  '0000ff',
  'ffff00',
  'ff00ff',
  '00ffff',
  '000000',
  'ffffff',
  'ff0000',
  '00ff00',
  '0000ff',
  'ffff00',
  'ff00ff',
  '00ffff',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'c0c0c0',
  '808080',
  '9999ff',
  '993366',
  'ffffcc',
  'ccffff',
  '660066',
  'ff8080',
  '0066cc',
  'ccccff',
  '000080',
  'ff00ff',
  'ffff00',
  '00ffff',
  '800080',
  '800000',
  '008080',
  '0000ff',
  '00ccff',
  'ccffff',
  'ccffcc',
  'ffff99',
  '99ccff',
  'ff99cc',
  'cc99ff',
  'ffcc99',
  '3366ff',
  '33cccc',
  '99cc00',
  'ffcc00',
  'ff9900',
  'ff6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333'
]

/** The theme's colours in the order Excel numbers them: its light and dark swapped, then its accents and links. */
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

/** A workbook's colours: its theme's and its palette. */
export interface WorkbookColors {
  theme: string[]
  palette: string[]
  /** The theme's fonts, for a font that names them. */
  fonts: { major: string; minor: string }
}

export function readWorkbookTheme(xml: string | undefined): Pick<WorkbookColors, 'theme' | 'fonts'> {
  const elements = childAt(xmlTree(xml ?? ''), 'a:theme', 'a:themeElements')
  const scheme = childAt(elements, 'a:clrScheme')
  const theme = THEME_ORDER.map((name) => {
    const given = childAt(scheme, `a:${name}`)?.children.find((child) => child.name === 'a:srgbClr' || child.name === 'a:sysClr')
    return colorOf(given?.name === 'a:sysClr' ? given.attributes.lastClr : given?.attributes.val) ?? '#000000'
  })
  const font = (kind: string) => childAt(elements, 'a:fontScheme', kind, 'a:latin')?.attributes.typeface ?? ''
  return { theme, fonts: { major: font('a:majorFont'), minor: font('a:minorFont') } }
}

/** A colour lightened or darkened by a tint from -1 to 1, as Excel does, through its lightness. */
export function tinted(color: string, tint: number): string {
  const paint = fromHex(color.slice(1))
  if (!paint || !Number.isFinite(tint) || tint === 0) return color
  const [hue, saturation, lightness] = toLightness(paint)
  const changed = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint
  return css(fromLightness(hue, saturation, Math.min(1, Math.max(0, changed)), 1))
}

/** The colour an element gives (`rgb`, `theme` with its `tint`, `indexed`); `auto` and the system's colours give none. */
export function workbookColor(node: XmlNode | undefined, colors: WorkbookColors): string | undefined {
  if (!node) return undefined
  const { rgb, theme, indexed, tint } = node.attributes
  let color: string | undefined
  if (rgb !== undefined) color = colorOf(rgb.length === 8 ? rgb.slice(2) : rgb)
  else if (theme !== undefined) color = colors.theme[Number(theme)]
  else if (indexed !== undefined) color = paletteColor(Number(indexed), colors)
  return color && tint !== undefined ? tinted(color, Number(tint)) : color
}

/** A colour of the palette by its index; 64 and 65 are the system's text and background, which give none. */
export const paletteColor = (index: number, colors: Pick<WorkbookColors, 'palette'>): string | undefined => {
  const found = colors.palette[index]
  return found === undefined ? undefined : `#${found}`
}

// Styles

const BORDER_STYLES: Record<string, BorderLook['style']> = {
  dashed: 'dashed',
  mediumDashed: 'dashed',
  dashDot: 'dashed',
  mediumDashDot: 'dashed',
  dashDotDot: 'dashed',
  mediumDashDotDot: 'dashed',
  slantDashDot: 'dashed',
  dotted: 'dotted',
  hair: 'dotted',
  double: 'double'
}

function borderOf(node: XmlNode | undefined, colors: WorkbookColors): BorderLook | undefined {
  const style = node?.attributes.style
  if (!node || style === undefined || style === 'none') return undefined
  const width = style === 'thick' || style === 'double' ? 2.25 : /^medium/.test(style) ? 1.5 : 0.75
  return { width, style: BORDER_STYLES[style] ?? 'solid', color: workbookColor(childAt(node, 'color'), colors) ?? '#000000' }
}

/** The share of the front colour a pattern shows, for a fill drawn as its two colours mixed. */
const PATTERN_SHARES: Record<string, number> = { darkGray: 0.75, mediumGray: 0.5, lightGray: 0.25, gray125: 0.125, gray0625: 0.0625 }

function fillOf(node: XmlNode | undefined, colors: WorkbookColors): string | undefined {
  const pattern = childAt(node, 'patternFill')
  if (pattern) {
    const kind = pattern.attributes.patternType ?? (childAt(pattern, 'fgColor') ? 'solid' : 'none')
    if (kind === 'none') return undefined
    const front = workbookColor(childAt(pattern, 'fgColor'), colors) ?? '#000000'
    if (kind === 'solid') return front
    const back = workbookColor(childAt(pattern, 'bgColor'), colors) ?? '#ffffff'
    const one = fromHex(front.slice(1))
    const other = fromHex(back.slice(1))
    if (!one || !other) return front
    const share = PATTERN_SHARES[kind] ?? 0.5
    const mix = (a: number, b: number) => a * share + b * (1 - share)
    return css({ red: mix(one.red, other.red), green: mix(one.green, other.green), blue: mix(one.blue, other.blue), opacity: 1 })
  }
  // A gradient is shown as its first colour.
  return workbookColor(childAt(childAt(node, 'gradientFill'), 'stop', 'color'), colors)
}

function fontOf(node: XmlNode | undefined, colors: WorkbookColors): TextLook {
  const attribute = (name: string) => childAt(node, name)?.attributes.val
  const on = (name: string) => {
    const found = childAt(node, name)
    return found ? !['0', 'false'].includes(found.attributes.val ?? '1') : undefined
  }
  const scheme = attribute('scheme')
  const size = Number(attribute('sz'))
  const underline = childAt(node, 'u') ? (attribute('u') ?? 'single') : undefined
  const position = attribute('vertAlign')
  return {
    font: scheme === 'major' ? colors.fonts.major || attribute('name') : scheme === 'minor' ? colors.fonts.minor || attribute('name') : attribute('name'),
    size: Number.isFinite(size) && size > 0 ? Math.min(size, 409) : undefined,
    color: workbookColor(childAt(node, 'color'), colors),
    bold: on('b'),
    italic: on('i'),
    underline: underline === undefined || underline === 'none' ? undefined : /double/.test(underline) ? 'double' : 'solid',
    struck: on('strike'),
    position: position === 'superscript' ? 'super' : position === 'subscript' ? 'sub' : undefined
  }
}

/** A workbook's styles of cells, read from its styles part, each a font, a fill, borders and an alignment. */
export interface WorkbookStyles {
  colors: WorkbookColors
  /** Each style of `cellXfs`, by its place. */
  cells: {
    text: TextLook
    fill?: string | undefined
    borders: Sides<BorderLook>
    align?: string | undefined
    vertical?: string | undefined
    wrap: boolean
    indent: number
    rotation?: Rotation | undefined
  }[]
  text: TextLook
}

export function readWorkbookStyles(xml: string | undefined, theme: Pick<WorkbookColors, 'theme' | 'fonts'>): WorkbookStyles {
  const root = childAt(xmlTree(xml ?? ''), 'styleSheet')
  const custom = childrenNamed(childAt(root, 'colors', 'indexedColors'), 'rgbColor').map((one) => (one.attributes.rgb ?? 'FF000000').slice(-6).toLowerCase())
  const colors: WorkbookColors = { ...theme, palette: custom.length > 0 ? custom : PALETTE }
  const fonts = childrenNamed(childAt(root, 'fonts'), 'font').map((font) => fontOf(font, colors))
  const fills = childrenNamed(childAt(root, 'fills'), 'fill').map((fill) => fillOf(fill, colors))
  const borders = childrenNamed(childAt(root, 'borders'), 'border').map(
    (border): Sides<BorderLook> => ({
      top: borderOf(childAt(border, 'top'), colors),
      right: borderOf(childAt(border, 'right') ?? childAt(border, 'end'), colors),
      bottom: borderOf(childAt(border, 'bottom'), colors),
      left: borderOf(childAt(border, 'left') ?? childAt(border, 'start'), colors)
    })
  )
  const cells = childrenNamed(childAt(root, 'cellXfs'), 'xf').map((style) => {
    const alignment = childAt(style, 'alignment')?.attributes ?? {}
    return {
      text: fonts[Number(style.attributes.fontId ?? 0)] ?? fonts[0] ?? {},
      fill: fills[Number(style.attributes.fillId ?? 0)],
      borders: borders[Number(style.attributes.borderId ?? 0)] ?? {},
      align: alignment.horizontal,
      vertical: alignment.vertical,
      wrap: alignment.wrapText === '1' || alignment.wrapText === 'true',
      indent: Math.min(Math.max(Number(alignment.indent) || 0, 0), 250),
      rotation: excelRotation(Number(alignment.textRotation ?? 0))
    }
  })
  return { colors, cells, text: fonts[0] ?? {} }
}

/** The width of a font's widest digit in pixels, which Excel measures its columns by. */
export function digitWidth(text: TextLook): number {
  const size = text.size ?? 11
  const ratio = /arial|helvetica|verdana|tahoma|segoe/i.test(text.font ?? '') ? 0.7 : 0.64
  return Math.max(4, Math.round(size * ratio))
}

/** How a sheet part lays out its rows and cells, read as they were for its text. */
export interface SheetLayout {
  /** Each cell's style and what it holds, by row and column. */
  styles: (number | undefined)[][]
  kinds: CellKind[][]
  /** Each row's height in points when it gives one, and whether it is hidden. */
  heights: ({ height?: number | undefined; hidden: boolean } | undefined)[]
  /** The colour each cell's number format writes it in, when it names one. */
  numberColors: (string | undefined)[][]
}

const ALIGNS: Record<string, CellLook['align']> = {
  left: 'left',
  center: 'center',
  centerContinuous: 'center',
  right: 'right',
  justify: 'justify',
  distributed: 'justify',
  fill: 'left'
}

/**
 * A sheet's look: its columns' widths (`cols`), its rows' heights, each cell's style with where its content sits by
 * what it holds, its merged cells, its grid, headings and zoom (`sheetView`).
 */
export function readSheetLook(xml: string, layout: SheetLayout, styles: WorkbookStyles, size: { rows: number; columns: number }): SheetLook {
  const root = childAt(xmlTree(xml), 'worksheet')
  const view = childAt(root, 'sheetViews', 'sheetView')?.attributes ?? {}
  const format = childAt(root, 'sheetFormatPr')?.attributes ?? {}
  const digit = digitWidth(styles.text)
  const columnPixels = (width: number) => Math.trunc(((256 * width + Math.trunc(128 / digit)) / 256) * digit)
  const defaultWidth =
    format.defaultColWidth !== undefined && Number.isFinite(Number(format.defaultColWidth))
      ? columnPixels(Number(format.defaultColWidth))
      : Math.ceil(((Number(format.baseColWidth) || 8) * digit + 5) / 8) * 8
  const columns = Array.from({ length: size.columns }, () => (defaultWidth * 3) / 4)
  for (const column of childrenNamed(childAt(root, 'cols'), 'col')) {
    const first = Math.max(1, Number(column.attributes.min) || 1)
    const last = Math.min(size.columns, Number(column.attributes.max) || first)
    const hidden = column.attributes.hidden === '1' || column.attributes.hidden === 'true'
    const width = Number(column.attributes.width)
    for (let at = first; at <= last; at++)
      columns[at - 1] = hidden
        ? 0
        : Number.isFinite(width) && width >= 0
          ? (Math.min(columnPixels(Math.min(width, 255)), 2000) * 3) / 4
          : (columns[at - 1] ?? 0)
  }
  const defaultHeight = Number(format.defaultRowHeight)
  const usual = Number.isFinite(defaultHeight) && defaultHeight > 0 ? Math.min(defaultHeight, 409) : (styles.text.size ?? 11) * 1.36
  const rows = Array.from({ length: size.rows }, (_, row) => {
    const given = layout.heights[row]
    if (given?.hidden) return 0
    const height = given?.height
    return height !== undefined && Number.isFinite(height) && height >= 0 ? Math.min(height, 409) : usual
  })

  const merges: MergedCells[] = []
  for (const merge of childrenNamed(childAt(root, 'mergeCells'), 'mergeCell')) {
    const found = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(merge.attributes.ref ?? '')
    if (!found) continue
    const [first, last] = [cellPlace(found[1] as string, found[2] as string), cellPlace(found[3] as string, found[4] as string)]
    if (first.row >= size.rows || first.column >= size.columns || last.row < first.row || last.column < first.column) continue
    merges.push({
      row: first.row,
      column: first.column,
      rows: Math.min(last.row, size.rows - 1) - first.row + 1,
      columns: Math.min(last.column, size.columns - 1) - first.column + 1
    })
  }
  const zoom = Number(view.zoomScale)
  return {
    columns,
    rows,
    ...cellLooks(layout, styles, size),
    merges,
    grid: view.showGridLines !== '0' && view.showGridLines !== 'false',
    headings: view.showRowColHeaders !== '0' && view.showRowColHeaders !== 'false',
    zoom: Number.isFinite(zoom) && zoom >= 10 && zoom <= 400 ? zoom / 100 : 1,
    text: styles.text
  }
}

/**
 * Each cell's look, from its style, where its content sits by what it holds when its style says nothing, and the
 * colour its number format writes it in; the same looks shared.
 */
export function cellLooks(layout: SheetLayout, styles: WorkbookStyles, size: { rows: number; columns: number }): Pick<SheetLook, 'cells' | 'looks'> {
  const digit = digitWidth(styles.text)
  const looks: CellLook[] = []
  const known = new Map<string, number>()
  const cells = Array.from({ length: size.rows }, (_, row) =>
    Array.from({ length: size.columns }, (_, column) => {
      const style = layout.styles[row]?.[column]
      const kind = layout.kinds[row]?.[column] ?? 'empty'
      const numberColor = layout.numberColors[row]?.[column]
      const read = styles.cells[style ?? 0] ?? styles.cells[0]
      if (!read && numberColor === undefined) return undefined
      const general = generalAlign(kind, read?.rotation)
      const look: CellLook = {
        text: numberColor === undefined ? (read?.text ?? styles.text) : { ...(read?.text ?? styles.text), color: numberColor },
        fill: read?.fill,
        borders: read?.borders ?? {},
        align: ALIGNS[read?.align ?? ''] ?? general,
        vertical: read?.vertical === 'top' ? 'top' : read?.vertical === 'center' || read?.vertical === 'distributed' ? 'middle' : 'bottom',
        wrap: read?.wrap ?? false,
        indent: ((read?.indent ?? 0) * 3 * digit * 3) / 4
      }
      if (read?.rotation !== undefined) look.rotation = read.rotation
      const key = JSON.stringify(look)
      let index = known.get(key)
      if (index === undefined) {
        index = looks.push(look) - 1
        known.set(key, index)
      }
      return index
    })
  )
  return { cells, looks }
}

/**
 * Where a cell's content sits when its style says nothing: numbers to the right, text to the left, the rest centred;
 * turned text as Excel sets it, a quarter turn counterclockwise to the right, clockwise to the left, stacked centred.
 */
export function generalAlign(kind: CellKind, rotation: Rotation | undefined): CellLook['align'] {
  if (rotation === 'stacked') return 'center'
  if (rotation === 90 || rotation === -90) return rotation > 0 ? 'right' : 'left'
  return kind === 'number' ? 'right' : kind === 'logical' || kind === 'error' ? 'center' : 'left'
}

/** A cell's row and column from its letters and number, from 0. */
function cellPlace(letters: string, digits: string): { row: number; column: number } {
  let column = 0
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64)
  return { row: Number(digits) - 1, column: column - 1 }
}
