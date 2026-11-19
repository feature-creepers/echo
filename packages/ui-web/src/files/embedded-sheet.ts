/**
 * A worksheet embedded in a document as an object of Excel, shown as its sheet rather than its picture (docs/SPEC.md,
 * section 9.7). Excel draws such an object as the block of cells it was sized to (`oleSize`, `OLESIZE`), of the sheet
 * that was active when it was saved, at its full size, without the letters and numbers that head columns and rows:
 * that block is cut from the sheet as the workbook's reader read it.
 */

import type { SheetFigure } from './office-text.ts'
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

/** The cells a sheet holds, from its first to the last that shows something, when the workbook names no block. */
function usedArea(rows: readonly (readonly string[])[]): CellArea | undefined {
  let bottom = -1
  let right = -1
  rows.forEach((row, index) => {
    row.forEach((text, column) => {
      if (text.trim() === '') return
      bottom = Math.max(bottom, index)
      right = Math.max(right, column)
    })
  })
  return bottom < 0 ? undefined : { top: 0, left: 0, bottom, right }
}

/**
 * A sheet's block of cells as an object of it shows them: its rows and their look cut to the block, merged cells within
 * it kept, those it cuts held to it, and no headings. None for a sheet that shows nothing there.
 */
export function sheetFigure(sheet: { name: string; rows: string[][]; look: SheetLook }, area: CellArea | undefined, alt = ''): SheetFigure | undefined {
  const block = area ?? usedArea(sheet.rows)
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
    heights.push(look.rows[row] ?? 15)
  }
  const widths = Array.from({ length: right - left + 1 }, (_, index) => look.columns[left + index] ?? 48)
  const merges = look.merges.flatMap((merge) => {
    const first = { row: Math.max(merge.row, top), column: Math.max(merge.column, left) }
    const last = { row: Math.min(merge.row + merge.rows - 1, bottom), column: Math.min(merge.column + merge.columns - 1, right) }
    if (first.row > last.row || first.column > last.column) return []
    return [{ row: first.row - top, column: first.column - left, rows: last.row - first.row + 1, columns: last.column - first.column + 1 }]
  })
  if (!rows.some((row) => row.some((text) => text !== '')) && !cells.some((row) => row.some((cell) => cell !== undefined))) return undefined
  return {
    kind: 'sheet',
    name: sheet.name,
    rows,
    look: { ...look, columns: widths, rows: heights, cells, merges, headings: false, zoom: 1 },
    alt
  }
}
