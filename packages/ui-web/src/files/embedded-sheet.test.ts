import { describe, expect, it } from 'vitest'
import { anchorBox, cellArea, heldExtent, sheetFigure } from './embedded-sheet.ts'
import type { CellAnchor, PictureFigure } from './office-text.ts'
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

  it.each<[string, CellAnchor, ReturnType<typeof anchorBox>]>([
    [
      'from a cell to another, in points into each',
      { from: { row: 1, column: 1, x: 5, y: 2 }, to: { row: 2, column: 3, x: 10, y: 4 } },
      { left: 45, top: 17, width: 115, height: 18 }
    ],
    ['from a cell at a size', { from: { row: 0, column: 2, x: 0, y: 0 }, width: 30, height: 20 }, { left: 90, top: 0, width: 30, height: 20 }],
    [
      'in shares of its cells, as Excel 97 measures',
      { from: { row: 0, column: 0, x: 0.5, y: 0.5, shares: true }, to: { row: 1, column: 1, x: 0.5, y: 1, shares: true } },
      { left: 20, top: 7.5, width: 45, height: 23.5 }
    ],
    [
      'past the cells the look reaches, in their usual size',
      { from: { row: 4, column: 5, x: 0, y: 0 }, width: 10, height: 10 },
      { left: 268, top: 63, width: 10, height: 10 }
    ],
    ['from the sheet’s corner', { left: 12, top: 30, width: 50, height: 40 }, { left: 12, top: 30, width: 50, height: 40 }],
    ['to a place before its start', { from: { row: 2, column: 2, x: 0, y: 0 }, to: { row: 1, column: 1, x: 0, y: 0 } }, undefined],
    ['past a sheet’s last row', { from: { row: 2_000_000, column: 0, x: 0, y: 0 }, width: 10, height: 10 }, undefined],
    ['with no size', { from: { row: 0, column: 0, x: 0, y: 0 } }, undefined]
  ])('places a picture anchored %s', (_, anchor, expected) => {
    expect(anchorBox(anchor, look())).toEqual(expected)
  })

  it.each([
    ['its cells alone', { rows: 3, columns: 4 }, undefined, [], { rows: 3, columns: 4 }],
    ['the block its object shows', { rows: 3, columns: 4 }, { top: 0, left: 0, bottom: 5, right: 6 }, [], { rows: 6, columns: 7 }],
    [
      'the places of its pictures',
      { rows: 3, columns: 4 },
      undefined,
      [{ from: { row: 1, column: 1, x: 0, y: 0 }, to: { row: 9, column: 2, x: 0, y: 0 } }],
      { rows: 10, columns: 4 }
    ],
    ['no further than a block shows', { rows: 3, columns: 4 }, { top: 0, left: 0, bottom: 1_000_000, right: 20_000 }, [], { rows: 1000, columns: 256 }]
  ])('reaches as far as %s', (_, extent, area, anchors, expected) => {
    expect(heldExtent(extent, area, anchors)).toEqual(expected)
  })

  it('places the pictures a block holds over its cells, from its corner, leaving out those outside it', () => {
    const picture = (alt: string): PictureFigure => ({ kind: 'picture', type: 'image/png', bytes: new Uint8Array([1]), alt })
    const figure = sheetFigure({ name: 'Costs', rows, look: look() }, { top: 1, left: 1, bottom: 2, right: 3 }, '', [
      { figure: picture('inside'), anchor: { from: { row: 1, column: 2, x: 5, y: 0 }, width: 20, height: 10 } },
      { figure: picture('across its edge'), anchor: { from: { row: 0, column: 0, x: 0, y: 0 }, to: { row: 1, column: 2, x: 0, y: 8 } } },
      { figure: picture('outside'), anchor: { from: { row: 0, column: 0, x: 0, y: 0 }, width: 30, height: 10 } }
    ])
    expect(figure?.pictures?.map(({ figure: shown, ...place }) => ({ alt: shown.alt, ...place }))).toEqual([
      { alt: 'inside', left: 55, top: 0, width: 20, height: 10 },
      { alt: 'across its edge', left: -40, top: -15, width: 90, height: 23 }
    ])
  })

  it('shows no more than a document can hold of a block, rows and columns past it left out', () => {
    const figure = sheetFigure({ name: 'Large', rows, look: look() }, { top: 0, left: 0, bottom: 100_000, right: 500 })
    expect(figure?.rows.length).toBe(200)
    expect(figure?.look.columns.length).toBe(40)
  })
})
