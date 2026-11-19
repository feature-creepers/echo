/**
 * A worksheet embedded in a document as an object of Excel, shown as its sheet rather than its picture (docs/SPEC.md,
 * section 9.7). Excel draws such an object as the block of cells it was sized to (`oleSize`, `OLESIZE`), of the sheet
 * that was active when it was saved, at its full size, without the letters and numbers that head columns and rows:
 * that block is cut from the sheet as the workbook's reader read it.
 */

import type { CellAnchor, CellPoint, OfficeFigure, SheetFigure, SheetPicture } from './office-text.ts'
import type { SheetLook } from './sheet-look.ts'

/** A block of cells, from its first row and column to its last, counted from 0. */
export interface CellArea {
  top: number
  left: number
  bottom: number
  right: number
}

/** The most rows and columns an object's block shows: a picture in a document, not the workbook. */
const AREA_ROWS = 200
const AREA_COLUMNS = 40

/** The width of a column and the height of a row a sheet's look does not reach, in points. */
const COLUMN_WIDTH = 48
const ROW_HEIGHT = 15

/** The most cells a place is counted across: a sheet's own limits, so a damaged anchor costs nothing. */
const COLUMN_REACH = 16_384
const ROW_REACH = 1_048_576

/** How far from a sheet's corner a column or row starts, in points, from the sizes its look gives. */
function distance(sizes: readonly number[], index: number, usual: number): number {
  let total = 0
  for (let at = 0; at < Math.min(index, sizes.length); at++) total += sizes[at] ?? usual
  return total + Math.max(0, index - sizes.length) * usual
}

/** Where a place in a sheet's cells is, in points from the sheet's corner; none past the sheet's limits. */
function pointOf(point: CellPoint, look: Pick<SheetLook, 'columns' | 'rows'>): { x: number; y: number } | undefined {
  const { row, column } = point
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= ROW_REACH || column >= COLUMN_REACH) return undefined
  const width = look.columns[column] ?? COLUMN_WIDTH
  const height = look.rows[row] ?? ROW_HEIGHT
  const x = point.shares ? Math.min(Math.max(point.x, 0), 1) * width : point.x
  const y = point.shares ? Math.min(Math.max(point.y, 0), 1) * height : point.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x: distance(look.columns, column, COLUMN_WIDTH) + x, y: distance(look.rows, row, ROW_HEIGHT) + y }
}

/**
 * Where an anchor puts a figure on a sheet whose look gives its columns' widths and rows' heights, in points from the
 * sheet's corner: from its first place to its second, or at its size; none when it says too little.
 */
export function anchorBox(
  anchor: CellAnchor,
  look: Pick<SheetLook, 'columns' | 'rows'>
): { left: number; top: number; width: number; height: number } | undefined {
  const start = anchor.from ? pointOf(anchor.from, look) : anchor.left !== undefined && anchor.top !== undefined ? { x: anchor.left, y: anchor.top } : undefined
  if (!start) return undefined
  const end = anchor.to && pointOf(anchor.to, look)
  const width = end ? end.x - start.x : anchor.width
  const height = end ? end.y - start.y : anchor.height
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0) || !Number.isFinite(width + height)) return undefined
  return { left: start.x, top: start.y, width, height }
}

/** A column's number from its letters: "A" is 0, "AB" is 27. */
const columnNumber = (letters: string) => [...letters.toUpperCase()].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0) - 1

/** A block of cells as Excel writes one, `A1:D5`, a single cell, or with `$` signs; none for anything else. */
export function cellArea(reference: string | undefined): CellArea | undefined {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/i.exec((reference ?? '').trim())
  if (!match) return undefined
  const first = { row: Number(match[2]) - 1, column: columnNumber(match[1] as string) }
  const last = match[3] === undefined ? first : { row: Number(match[4]) - 1, column: columnNumber(match[3]) }
  if (first.row < 0 || last.row < 0) return undefined
  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.column, last.column),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.column, last.column)
  }
}

/**
 * The cells a sheet holds, from its first to the last that shows something or that a picture over it reaches, when the
 * workbook names no block.
 */
function usedArea(rows: readonly (readonly string[])[], anchors: readonly (CellAnchor | undefined)[]): CellArea | undefined {
  let bottom = -1
  let right = -1
  const reach = (row: number, column: number) => {
    bottom = Math.max(bottom, Math.min(row, REACH_ROWS - 1))
    right = Math.max(right, Math.min(column, REACH_COLUMNS - 1))
  }
  rows.forEach((row, index) => {
    row.forEach((text, column) => {
      if (text.trim() !== '') reach(index, column)
    })
  })
  for (const anchor of anchors) for (const point of [anchor?.from, anchor?.to]) if (point && point.row >= 0 && point.column >= 0) reach(point.row, point.column)
  return bottom < 0 || right < 0 ? undefined : { top: 0, left: 0, bottom, right }
}

/** The most rows and columns a held sheet's look reaches: past them, a block shows nothing of its cells. */
const REACH_ROWS = 1_000
const REACH_COLUMNS = 256

/**
 * How far the look of a sheet held as an object reaches, in rows and columns: its cells, the block its object shows,
 * and the places of the figures it holds, so they are measured by its own columns and rows.
 */
export function heldExtent(
  extent: { rows: number; columns: number },
  area: CellArea | undefined,
  anchors: readonly (CellAnchor | undefined)[]
): { rows: number; columns: number } {
  let rows = 0
  let columns = 0
  const reach = (row: number, column: number) => {
    if (Number.isFinite(row)) rows = Math.max(rows, row + 1)
    if (Number.isFinite(column)) columns = Math.max(columns, column + 1)
  }
  if (area) reach(area.bottom, area.right)
  for (const anchor of anchors) for (const point of [anchor?.from, anchor?.to]) if (point) reach(point.row, point.column)
  return { rows: Math.max(extent.rows, Math.min(rows, REACH_ROWS)), columns: Math.max(extent.columns, Math.min(columns, REACH_COLUMNS)) }
}

/**
 * A sheet's block of cells as an object of it shows them: its rows and their look cut to the block, merged cells within
 * it kept, those it cuts held to it, no headings, and the pictures it holds placed over them where their anchors put
 * them, those outside the block left out and those across its edge cut by it. None for a sheet that shows nothing
 * there.
 */
export function sheetFigure(
  sheet: { name: string; rows: string[][]; look: SheetLook },
  area: CellArea | undefined,
  alt = '',
  figures: readonly { figure: OfficeFigure; anchor: CellAnchor | undefined }[] = []
): SheetFigure | undefined {
  const block =
    area ??
    usedArea(
      sheet.rows,
      figures.map(({ anchor }) => anchor)
    )
  if (!block) return undefined
  const top = block.top
  const left = block.left
  const bottom = Math.min(block.bottom, top + AREA_ROWS - 1)
  const right = Math.min(block.right, left + AREA_COLUMNS - 1)
  const { look } = sheet
  const rows: string[][] = []
  const cells: (number | undefined)[][] = []
  const heights: number[] = []
  for (let row = top; row <= bottom; row++) {
    rows.push(Array.from({ length: right - left + 1 }, (_, index) => sheet.rows[row]?.[left + index] ?? ''))
    cells.push(Array.from({ length: right - left + 1 }, (_, index) => look.cells[row]?.[left + index]))
    heights.push(look.rows[row] ?? ROW_HEIGHT)
  }
  const widths = Array.from({ length: right - left + 1 }, (_, index) => look.columns[left + index] ?? COLUMN_WIDTH)
  const merges = look.merges.flatMap((merge) => {
    const first = { row: Math.max(merge.row, top), column: Math.max(merge.column, left) }
    const last = { row: Math.min(merge.row + merge.rows - 1, bottom), column: Math.min(merge.column + merge.columns - 1, right) }
    if (first.row > last.row || first.column > last.column) return []
    return [{ row: first.row - top, column: first.column - left, rows: last.row - first.row + 1, columns: last.column - first.column + 1 }]
  })
  // The pictures over the block, measured from its corner.
  const corner = { x: distance(look.columns, left, COLUMN_WIDTH), y: distance(look.rows, top, ROW_HEIGHT) }
  const size = { width: widths.reduce((sum, one) => sum + one, 0), height: heights.reduce((sum, one) => sum + one, 0) }
  const pictures: SheetPicture[] = []
  for (const { figure, anchor } of figures) {
    const box = anchor && figure.kind === 'picture' ? anchorBox(anchor, look) : undefined
    if (!box || figure.kind !== 'picture') continue
    const placed = { figure, left: box.left - corner.x, top: box.top - corner.y, width: box.width, height: box.height }
    if (placed.left < size.width && placed.top < size.height && placed.left + placed.width > 0 && placed.top + placed.height > 0) pictures.push(placed)
  }
  const shown = rows.some((row) => row.some((text) => text !== '')) || cells.some((row) => row.some((cell) => cell !== undefined)) || pictures.length > 0
  if (!shown) return undefined
  return {
    kind: 'sheet',
    name: sheet.name,
    rows,
    look: { ...look, columns: widths, rows: heights, cells, merges, headings: false, zoom: 1 },
    alt,
    ...(pictures.length > 0 ? { pictures } : {})
  }
}
