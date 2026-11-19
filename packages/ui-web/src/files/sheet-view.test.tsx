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
  it('draws the pictures a held sheet holds over its cells, scaled with them and cut at its edge', () => {
    const figure = { kind: 'picture', type: 'image/png', bytes: new Uint8Array([1]), alt: 'Logo' } as const
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({ headings: false, zoom: 0.5 })}
        rows={[['a']]}
        pictures={[{ figure, left: 10, top: 5, width: 60, height: 20 }]}
        urls={new Map([[figure, 'blob:logo']])}
      />
    )
    expect(html).toContain('<img src="blob:logo" alt="Logo" style="position:absolute;left:10pt;top:5pt;width:60pt;height:20pt;max-width:none"/>')
    expect(html).toContain('zoom:0.5;position:relative;width:fit-content;overflow:hidden')
  })

  it('turns text in its cell: a quarter as a line running down, read from the bottom when it turns counterclockwise, stacked letters upright, any other angle about its start', () => {
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({
          columns: [48, 48, 48, 48],
          rows: [40],
          cells: [[0, 1, 2, 3]],
          looks: [cell({ rotation: 90 }), cell({ rotation: -90 }), cell({ rotation: 'stacked' }), cell({ rotation: 45 })]
        })}
        rows={[['Up', 'Down', 'Ab', 'Rising', 'Spills']]}
      />
    )
    expect(html).toContain('writing-mode:vertical-rl;transform:rotate(180deg)">Up<')
    expect(html).toContain('writing-mode:vertical-rl">Down<')
    expect(html).toContain('writing-mode:vertical-rl;text-orientation:upright">Ab<')
    expect(html).toContain('bottom:0;transform-origin:left bottom;transform:rotate(-45deg)">Rising<')
  })

  it('draws a cell’s data bar under its text, back from its axis for a negative one, and its icon at its left, its value hidden where it says so', () => {
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({
          rows: [15],
          cells: [[0, 0, 0]],
          looks: [cell()],
          marks: [
            [
              { bar: { start: 0, end: 0.5, color: '#638ec6', gradient: true } },
              { bar: { start: 0.25, end: 0.5, color: '#ff0000', gradient: false, axis: 0.5, border: '#c00000' }, hidden: true },
              { icon: { set: '3Arrows', index: 2 } }
            ]
          ]
        })}
        rows={[['50', '-10', '100']]}
      />
    )
    expect(html).toContain('left:0%;width:50%')
    expect(html).toContain('linear-gradient(to right, #638ec6, color-mix(in srgb, #638ec6 12%, #ffffff))')
    expect(html).toContain('background:#ff0000;border:0.75pt solid #c00000')
    expect(html).toContain('left:50%;top:0;bottom:0;border-left:0.75pt dashed #000000')
    expect(html).toContain('>50</div>')
    expect(html).not.toContain('-10')
    expect(html).toMatch(/<svg viewBox="0 0 16 16" width="11pt" height="11pt"[^>]*><polygon points="8,1 14.5,8[^"]*" fill="#3fa34d"/)
    // The text of a cell with an icon starts after it.
    expect(html).toContain('padding:0 1.5pt 0 14pt')
  })

  it.each([
    ['3Arrows', 3],
    ['4Rating', 4],
    ['5Quarters', 5],
    ['5Boxes', 5],
    ['3Stars', 3],
    ['3Symbols', 3],
    ['3Flags', 3],
    ['3ColorSmilies', 3]
  ])('draws each of the %s icons, and nothing past them', (set, count) => {
    const html = (index: number) =>
      renderToStaticMarkup(<SheetView look={sheet({ rows: [15], cells: [[0]], looks: [cell()], marks: [[{ icon: { set, index } }]] })} rows={[['1']]} />)
    for (let index = 0; index < count; index++) expect(html(index)).toContain('<svg')
    expect(html(count)).not.toContain('<svg')
  })

  it('writes each stretch of a cell’s text in its own font, the lines under its text left to the stretches', () => {
    const html = renderToStaticMarkup(
      <SheetView
        look={sheet({
          cells: [[0]],
          looks: [cell({ text: { underline: 'solid', bold: true } })],
          runs: [
            [
              [
                { start: 0, text: { bold: false } },
                { start: 6, text: { font: 'Georgia', color: '#c00000', bold: true, underline: 'solid' } },
                { start: 9, text: { bold: false } }
              ]
            ]
          ]
        })}
        rows={[['Total due now']]}
      />
    )
    expect(html).toContain('<span style="font-weight:400;font-style:normal;display:inline">Total </span>')
    expect(html).toMatch(/<span style="[^"]*font-family:&#x27;Georgia&#x27;[^"]*color:#c00000[^"]*text-decoration-line:underline[^"]*">due<\/span>/)
    expect(html).toContain('<span style="font-weight:400;font-style:normal;display:inline"> now</span>')
    expect(html).not.toMatch(/<div style="[^"]*text-decoration-line:underline/)
  })

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
