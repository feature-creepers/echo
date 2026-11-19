import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CellLook, SheetLook } from './sheet-look.ts'
import { columnLetters, SheetView } from './sheet-view.tsx'

const cell = (more: Partial<CellLook> = {}): CellLook => ({ text: {}, borders: {}, align: 'left', vertical: 'bottom', wrap: false, indent: 0, ...more })

const sheet = (more: Partial<SheetLook>): SheetLook => ({
  columns: [48, 48, 48],
  rows: [15, 15],
  cells: [],
  looks: [],
  merges: [],
  grid: true,
  headings: true,
  zoom: 1,
  text: { font: 'Calibri', size: 11 },
  ...more
})

describe('a sheet shown as it looks', () => {
  it.each<[number, string]>([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [701, 'ZZ'],
    [702, 'AAA']
  ])('heads column %i with %s', (index, letters) => {
    expect(columnLetters(index)).toBe(letters)
  })

  it('heads its rows and columns, leaves hidden ones out, and draws its grid between cells with no fill', () => {
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({ columns: [48, 0, 60], rows: [15, 0, 20], cells: [[0, 0, 1]], looks: [cell(), cell({ fill: '#ffff00' })] })}
        rows={[['a', 'secret', 'b'], ['gone'], ['c']]}
      />
    )
    expect(html).toContain('>A</th>')
    expect(html).not.toContain('>B</th>')
    expect(html).toContain('>C</th>')
    expect(html).not.toContain('secret')
    expect(html).not.toContain('gone')
    expect(html).toContain('>3</th>')
    expect(html).toContain('width:108pt')
    expect(html).toContain('background-color:#ffff00')
    expect(html).toContain('border-right:0.75pt solid #d9d9d9')
  })

  it('runs text on over the empty cells beside it up to the next that holds something, and merges cells into one', () => {
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({
          columns: [48, 48, 48, 48],
          cells: [
            [0, 0, 0, 0],
            [1, 0, 0, 0]
          ],
          looks: [cell(), cell({ align: 'center', vertical: 'middle', text: { bold: true, color: '#c00000' } })],
          merges: [{ row: 1, column: 0, rows: 1, columns: 3 }],
          headings: false,
          grid: false
        })}
        rows={[
          ['A long note', '', '', 'Next'],
          ['Merged', '', '', '']
        ]}
      />
    )
    expect(html).toContain('width:144pt')
    expect(html).toContain('colSpan="3"')
    expect(html).toContain('color:#c00000;font-weight:700')
    expect(html).toContain('text-align:center')
    expect(html).not.toContain('#d9d9d9')
    expect(html).not.toContain('<th')
  })
})
