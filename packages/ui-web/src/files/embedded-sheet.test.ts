import { describe, expect, it } from 'vitest'
import { cellArea, sheetFigure } from './embedded-sheet.ts'
import type { SheetLook } from './sheet-look.ts'

/** A sheet's look of three rows and four columns, its cells' looks by their place, a block of cells merged. */
const look = (): SheetLook => ({
  columns: [40, 50, 60, 70],
  rows: [15, 16, 17],
  cells: [
    [0, 1, 1, 1],
    [0, 0, 1, undefined],
    [undefined, undefined, 0, 0]
  ],
  looks: [],
  merges: [
    { row: 0, column: 1, rows: 2, columns: 2 },
    { row: 2, column: 2, rows: 1, columns: 2 }
  ],
  grid: true,
  headings: true,
  zoom: 1,
  text: {}
})
const rows = [
  ['Item', 'Q1', '', 'Q3'],
  ['Tea', '10', '12', ''],
  ['', '', 'Total', '']
]

describe('a worksheet held as an object', () => {
  it.each([
    ['A1:D5', { top: 0, left: 0, bottom: 4, right: 3 }],
    ['$B$2:$C$3', { top: 1, left: 1, bottom: 2, right: 2 }],
    ['C3', { top: 2, left: 2, bottom: 2, right: 2 }],
    ['D5:A1', { top: 0, left: 0, bottom: 4, right: 3 }],
    ['AA10:AB12', { top: 9, left: 26, bottom: 11, right: 27 }],
    ['', undefined],
    ['A0', undefined],
    ['Sheet1!A1', undefined]
  ])('reads the block of cells %s', (reference, expected) => {
    expect(cellArea(reference)).toEqual(expected)
  })

  it('shows the block its object was sized to, cut from the sheet, merged cells held to it and without headings', () => {
    const figure = sheetFigure({ name: 'Costs', rows, look: look() }, { top: 1, left: 1, bottom: 2, right: 3 })
    expect(figure).toMatchObject({
      kind: 'sheet',
      name: 'Costs',
      rows: [
        ['10', '12', ''],
        ['', 'Total', '']
      ],
      look: {
        columns: [50, 60, 70],
        rows: [16, 17],
        cells: [
          [0, 1, undefined],
          [undefined, 0, 0]
        ],
        merges: [
          { row: 0, column: 0, rows: 1, columns: 2 },
          { row: 1, column: 1, rows: 1, columns: 2 }
        ],
        grid: true,
        headings: false
      }
    })
  })

  it('shows the cells used when the workbook names no block, and nothing for a block that holds nothing', () => {
    expect(sheetFigure({ name: 'Costs', rows, look: look() }, undefined)?.rows).toEqual(rows)
    expect(sheetFigure({ name: 'Empty', rows: [], look: look() }, undefined)).toBeUndefined()
    expect(sheetFigure({ name: 'Costs', rows, look: { ...look(), cells: [] } }, { top: 20, left: 20, bottom: 21, right: 21 })).toBeUndefined()
  })

  it('shows no more than a document can hold of a block, rows and columns past it left out', () => {
    const figure = sheetFigure({ name: 'Large', rows, look: look() }, { top: 0, left: 0, bottom: 100_000, right: 500 })
    expect(figure?.rows.length).toBe(200)
    expect(figure?.look.columns.length).toBe(40)
  })
})
