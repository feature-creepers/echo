/**
 * A sheet of an OpenDocument spreadsheet as it looks (docs/SPEC.md, section 9.7), read into `sheet-look.ts`: its
 * columns' widths and its rows' heights, those collapsed left out, each cell in its style, its row's or its column's
 * (`open-styles.ts`), with its font, background, borders, alignment, indent and wrapping, its merged cells, and the grid,
 * headings and zoom its settings give it.
 */

import { cellValue, serialNow, withConditions } from './conditional-formats.ts'
import { colorOf, type TextLook } from './document-look.ts'
import { bordersOf, definedLook, points, textLook } from './open-look.ts'
import { readOpenConditions } from './open-sheet-conditions.ts'
import type { Properties, StyleBook } from './open-styles.ts'
import { type FormulaValue, serialOf } from './sheet-formula.ts'
import { type CellKind, type CellLook, generalAlign, type MergedCells, type SheetLook } from './sheet-look.ts'
import { childAt, childrenNamed, type XmlNode, xmlTree } from './xml.ts'

/** How many alike a column, a row or a cell stands for, held to what is shown. */
const repeated = (value: string | undefined, room: number) => Math.min(Math.max(Math.floor(Number(value) || 1), 1), Math.max(room, 0))

/** The elements of a kind in a table, those in its groups and headers in their place. */
function* members(node: XmlNode, name: string, groups: readonly string[]): Generator<XmlNode> {
  for (const child of node.children) {
    if (child.name === name) yield child
    else if (groups.includes(child.name)) yield* members(child, name, groups)
  }
}

const COLUMN_GROUPS = ['table:table-columns', 'table:table-header-columns', 'table:table-column-group']
const ROW_GROUPS = ['table:table-rows', 'table:table-header-rows', 'table:table-row-group']

const KINDS: Record<string, CellKind> = {
  float: 'number',
  percentage: 'number',
  currency: 'number',
  date: 'number',
  time: 'number',
  boolean: 'logical',
  string: 'text'
}

/** What a spreadsheet's settings say of a sheet's view: whether it shows its grid and its headings, and its zoom. */
export interface SheetView {
  grid: boolean
  headings: boolean
  zoom: number
}

/** The view of each sheet by its name, from a spreadsheet's `settings.xml`: the document's own, each sheet's over it. */
export function readSheetViews(xml: string | undefined): (sheet: string) => SheetView {
  const root = xmlTree(xml ?? '')
  const items = (holder: XmlNode | undefined) => {
    const found = new Map<string, string>()
    for (const item of childrenNamed(holder, 'config:config-item'))
      found.set(item.attributes['config:name'] ?? '', item.children.map((one) => one.text).join(''))
    return found
  }
  const settings = childAt(root, 'office:document-settings', 'office:settings')
  const view = childrenNamed(settings, 'config:config-item-set').find((set) => set.attributes['config:name'] === 'ooo:view-settings')
  const first = childAt(childAt(view, 'config:config-item-map-indexed'), 'config:config-item-map-entry')
  const common = items(first)
  const sheets = childAt(first, 'config:config-item-map-named')
  return (sheet) => {
    const own = items(childrenNamed(sheets, 'config:config-item-map-entry').find((entry) => entry.attributes['config:name'] === sheet))
    const read = (name: string) => own.get(name) ?? common.get(name)
    const zoom = Number(read('ZoomValue'))
    return {
      grid: read('ShowGrid') !== 'false',
      headings: read('HasColumnRowHeaders') !== 'false',
      zoom: Number.isFinite(zoom) && zoom >= 10 && zoom <= 400 ? zoom / 100 : 1
    }
  }
}

/** The number styles of a spreadsheet's parts, by their names. */
export function dataStyles(roots: readonly (XmlNode | undefined)[]): Map<string, XmlNode> {
  const found = new Map<string, XmlNode>()
  for (const root of roots)
    for (const holder of [childAt(root, 'office:styles'), childAt(root, 'office:automatic-styles')])
      for (const style of holder?.children ?? [])
        if (/^number:[a-z-]+-style$/.test(style.name) && style.attributes['style:name']) found.set(style.attributes['style:name'], style)
  return found
}

/**
 * The colour a number style writes a value in: the style a map whose condition the value meets applies (as
 * `value()>=0` hands positive numbers to a style of their own), else the style's own text colour.
 */
export function openNumberColor(style: XmlNode | undefined, value: number, styles: ReadonlyMap<string, XmlNode>, depth = 0): string | undefined {
  if (!style || depth > 4 || !Number.isFinite(value)) return undefined
  for (const map of childrenNamed(style, 'style:map')) {
    const condition = /value\(\)\s*(>=|<=|!=|<>|=|>|<)\s*(-?\d*\.?\d+)/.exec(map.attributes['style:condition'] ?? '')
    if (!condition) continue
    const limit = Number(condition[2])
    const holds = {
      '>=': value >= limit,
      '<=': value <= limit,
      '!=': value !== limit,
      '<>': value !== limit,
      '=': value === limit,
      '>': value > limit,
      '<': value < limit
    }[condition[1] as string]
    if (holds) return openNumberColor(styles.get(map.attributes['style:apply-style-name'] ?? ''), value, styles, depth + 1)
  }
  return colorOf(childAt(style, 'style:text-properties')?.attributes['fo:color']?.replace(/^#/, ''))
}

const ALIGNS: Record<string, CellLook['align']> = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' }

/**
 * A stretch of a cell's text as an OpenDocument spreadsheet writes it, from its first character: in the styles of the
 * spans it is within, outermost first, over its cell's; none for the text outside them.
 */
export interface OpenRun {
  start: number
  styles: readonly string[]
}

/** What else a sheet's look is read with: its number styles, the stretches of its cells' text, its name and its cells' text as shown. */
export interface OpenSheetParts {
  numbers?: ReadonlyMap<string, XmlNode> | undefined
  /** The stretches of its cells' text in spans of their own, by row and column. */
  stretches?: readonly ((readonly OpenRun[] | undefined)[] | undefined)[] | undefined
  /** Its name, which its conditions' formulas may name it by, and its cells' text, which they test. */
  name?: string | undefined
  shown?: readonly (readonly string[])[] | undefined
}

/** A date or a time as OpenDocument writes it (`2026-11-19T18:00:00`, `PT18H00M00S`), as a spreadsheet counts days from 1899-12-30. */
export function openSerial(date: string | undefined, time: string | undefined): number | undefined {
  const day = /^(-?\d{4,})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d(?:\.\d+)?))?)?/.exec(date ?? '')
  if (day) {
    const [hours, minutes, seconds] = [day[4], day[5], day[6]].map((part) => Number(part ?? 0)) as [number, number, number]
    const whole = serialOf(Number(day[1]), Number(day[2]), Number(day[3]), false)
    return whole + (hours * 3600 + minutes * 60 + seconds) / 86_400
  }
  const span = /^-?PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(time ?? '')
  if (!span) return undefined
  return (Number(span[1] ?? 0) * 3600 + Number(span[2] ?? 0) * 60 + Number(span[3] ?? 0)) / 86_400
}

/**
 * A sheet's look, at the size its text was read at, from its table and the spreadsheet's styles and fonts, with the
 * stretches of its cells' text in spans of their own and its conditional formats worked out over it.
 */
export function readOpenSheetLook(
  table: XmlNode,
  size: { rows: number; columns: number },
  book: StyleBook,
  fonts: ReadonlyMap<string, string>,
  view: SheetView,
  parts: OpenSheetParts = {}
): SheetLook {
  const { numbers = new Map(), stretches = [], name = '', shown = [] } = parts
  const usualText = textLook(book.properties('table-cell', 'Default', 'text', false), fonts)
  const text = { font: usualText.font, size: usualText.size, color: usualText.color }
  const columns: number[] = []
  const columnStyles: (string | undefined)[] = []
  for (const column of members(table, 'table:table-column', COLUMN_GROUPS)) {
    const count = repeated(column.attributes['table:number-columns-repeated'], size.columns - columns.length)
    const hidden = column.attributes['table:visibility'] !== undefined && column.attributes['table:visibility'] !== 'visible'
    const width = points(book.properties('table-column', column.attributes['table:style-name'], 'table-column', false)['style:column-width']) ?? 64
    for (let at = 0; at < count; at++) {
      columns.push(hidden ? 0 : Math.min(width, 1500))
      columnStyles.push(column.attributes['table:default-cell-style-name'])
    }
  }
  while (columns.length < size.columns) {
    columns.push(64)
    columnStyles.push(undefined)
  }

  const rows: number[] = []
  const styles: (string | undefined)[][] = []
  const kinds: CellKind[][] = []
  const values: (number | undefined)[][] = []
  // Each cell's value as its conditions test it: a date or a time as its serial number.
  const held: FormulaValue[][] = []
  const merges: MergedCells[] = []
  for (const row of members(table, 'table:table-row', ROW_GROUPS)) {
    if (rows.length >= size.rows) break
    const count = repeated(row.attributes['table:number-rows-repeated'], size.rows - rows.length)
    const hidden = row.attributes['table:visibility'] !== undefined && row.attributes['table:visibility'] !== 'visible'
    const height = points(book.properties('table-row', row.attributes['table:style-name'], 'table-row', false)['style:row-height'])
    const rowStyle = row.attributes['table:default-cell-style-name']
    const rowStyles: (string | undefined)[] = []
    const rowKinds: CellKind[] = []
    const rowValues: (number | undefined)[] = []
    const rowHeld: FormulaValue[] = []
    for (const cell of row.children) {
      if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue
      const times = repeated(cell.attributes['table:number-columns-repeated'], size.columns - rowStyles.length)
      const kind: CellKind = KINDS[cell.attributes['office:value-type'] ?? ''] ?? (childAt(cell, 'text:p') ? 'text' : 'empty')
      for (let at = 0; at < times; at++) {
        const column = rowStyles.length
        rowStyles.push(cell.attributes['table:style-name'] ?? rowStyle ?? columnStyles[column])
        rowKinds.push(kind)
        rowValues.push(kind === 'number' && cell.attributes['office:value'] !== undefined ? Number(cell.attributes['office:value']) : undefined)
        const shownText = shown[rows.length]?.[column]
        rowHeld.push(
          kind === 'logical'
            ? cell.attributes['office:boolean-value'] === 'true'
            : cellValue(
                kind,
                shownText,
                kind === 'number' ? (rowValues.at(-1) ?? openSerial(cell.attributes['office:date-value'], cell.attributes['office:time-value'])) : undefined
              )
        )
        const across = Number(cell.attributes['table:number-columns-spanned']) || 1
        const down = Number(cell.attributes['table:number-rows-spanned']) || 1
        if (cell.name === 'table:table-cell' && (across > 1 || down > 1))
          for (let copy = 0; copy < count; copy++)
            merges.push({
              row: rows.length + copy,
              column,
              rows: Math.max(1, Math.min(down, size.rows - rows.length - copy)),
              columns: Math.max(1, Math.min(across, size.columns - column))
            })
      }
    }
    for (let copy = 0; copy < count; copy++) {
      rows.push(hidden ? 0 : Math.min(height ?? 12.8, 409))
      styles.push(rowStyles)
      kinds.push(rowKinds)
      values.push(rowValues)
      held.push(rowHeld)
    }
  }
  while (rows.length < size.rows) {
    rows.push(12.8)
    styles.push([])
    kinds.push([])
  }

  const looks: CellLook[] = []
  const known = new Map<string, number>()
  const cells = rows.map((_, row) =>
    columns.map((_, column) => {
      const name = styles[row]?.[column] ?? columnStyles[column] ?? 'Default'
      const kind = kinds[row]?.[column] ?? 'empty'
      const look = cellLook(
        book.properties('table-cell', name, 'table-cell', false),
        book.properties('table-cell', name, 'paragraph', false),
        book.properties('table-cell', name, 'text', false),
        kind,
        fonts
      )
      // A number in the colour its number style gives it.
      const value = values[row]?.[column]
      if (value !== undefined) {
        const data = book
          .chain('table-cell', name, false)
          .reverse()
          .find((one) => one.attributes['style:data-style-name'])?.attributes['style:data-style-name']
        const color = openNumberColor(numbers.get(data ?? ''), value, numbers)
        if (color) look.text = { ...look.text, color }
      }
      const key = JSON.stringify(look)
      let index = known.get(key)
      if (index === undefined) {
        index = looks.push(look) - 1
        known.set(key, index)
      }
      return index
    })
  )
  // Each stretch of a cell's text in what its spans set over its cell's font.
  const spanned = (name: string): TextLook => {
    const { hidden: _hidden, ...shown } = textLook(book.properties('text', name, 'text', false, false), fonts)
    return definedLook(shown)
  }
  const runs = stretches.slice(0, rows.length).map((line, row) =>
    line?.slice(0, columns.length).map((own, column) => {
      const under = looks[cells[row]?.[column] ?? -1]?.text ?? text
      return own?.map(({ start, styles }) => {
        const look: TextLook = { ...under }
        for (const name of styles) Object.assign(look, spanned(name))
        return { start, text: look }
      })
    })
  )
  const look: SheetLook = { columns, rows, cells, looks, merges, ...view, text, ...(runs.length > 0 ? { runs } : {}) }
  return withConditions(
    look,
    () =>
      readOpenConditions(table, book, fonts, name, (row, column) => styles[row]?.[column] ?? columnStyles[column], {
        rows: rows.length,
        columns: columns.length
      }),
    { value: (row, column) => held[row]?.[column] ?? null, now: serialNow(false), date1904: false }
  )
}

function cellLook(cell: Properties, paragraph: Properties, text: Properties, kind: CellKind, fonts: ReadonlyMap<string, string>): CellLook {
  const read = textLook(text, fonts)
  const { hidden: _hidden, ...shown } = read
  const fixed = cell['style:text-align-source'] === 'fix' || (cell['style:text-align-source'] === undefined && paragraph['fo:text-align'] !== undefined)
  const turn = turned(cell)
  const general =
    turn.rotation !== undefined ? generalAlign(kind, turn.rotation) : kind === 'number' || kind === 'logical' ? 'right' : kind === 'error' ? 'center' : 'left'
  const vertical = cell['style:vertical-align']
  return {
    text: shown,
    fill: colorOf(cell['fo:background-color']?.replace(/^#/, '')),
    borders: bordersOf(cell),
    align: fixed ? (ALIGNS[paragraph['fo:text-align'] ?? ''] ?? general) : general,
    vertical: vertical === 'top' ? 'top' : vertical === 'middle' ? 'middle' : 'bottom',
    wrap: cell['fo:wrap-option'] === 'wrap',
    indent: points(paragraph['fo:margin-left']) ?? 0,
    ...turn
  }
}

/**
 * How far a cell's text is turned: its letters stacked one under another (`style:direction`), else its angle
 * counterclockwise (`style:rotation-angle`, in degrees unless it says radians or grads), from -180 to 180.
 */
function turned(cell: Properties): Pick<CellLook, 'rotation'> {
  if (cell['style:direction'] === 'ttb') return { rotation: 'stacked' }
  const found = /^\s*(-?[\d.]+)\s*(deg|rad|grad)?\s*$/.exec(cell['style:rotation-angle'] ?? '')
  const value = Number(found?.[1])
  if (!found || !Number.isFinite(value)) return {}
  const degrees = found[2] === 'rad' ? (value * 180) / Math.PI : found[2] === 'grad' ? value * 0.9 : value
  const angle = ((((degrees + 180) % 360) + 360) % 360) - 180
  return angle === 0 ? {} : { rotation: Math.round(angle * 100) / 100 }
}
