import { describe, expect, it } from 'vitest'
import { numberColor } from './number-format.ts'
import { readSheetLook, readWorkbookStyles, readWorkbookTheme, type SheetLayout, workbookColor } from './sheet-look.ts'
import { xmlTree } from './xml.ts'

const THEME = `<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`

const STYLES = `<styleSheet>
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%;[Red]-0.0%"/></numFmts>
<fonts>
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><scheme val="minor"/></font>
<font><b/><sz val="14"/><color rgb="FFC00000"/><name val="Arial"/></font>
<font><i/><u val="double"/><strike/><sz val="9"/><color indexed="12"/><name val="Georgia"/><vertAlign val="superscript"/></font>
</fonts>
<fills>
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="mediumGray"><fgColor rgb="FF000000"/><bgColor rgb="FFFFFFFF"/></patternFill></fill>
</fills>
<borders>
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="medium"><color theme="5"/></right><top style="dashed"><color auto="1"/></top><bottom style="double"/></border>
</borders>
<cellXfs>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0"><alignment horizontal="left" indent="2" vertical="top"/></xf>
</cellXfs>
</styleSheet>`

const styles = () => readWorkbookStyles(STYLES, readWorkbookTheme(THEME))

describe('a workbook as it looks', () => {
  it('reads its fonts, fills and borders in their colours: given, of the theme tinted, of the palette', () => {
    const read = styles()
    expect(read.text).toEqual({
      font: 'Calibri',
      size: 11,
      color: '#000000',
      bold: undefined,
      italic: undefined,
      underline: undefined,
      struck: undefined,
      position: undefined
    })
    const [plain, heading, note] = read.cells
    expect(plain?.fill).toBeUndefined()
    expect(heading).toMatchObject({
      text: { font: 'Arial', size: 14, color: '#c00000', bold: true },
      fill: '#dae3f3',
      align: 'center',
      vertical: 'center',
      wrap: true,
      borders: {
        left: { width: 0.75, style: 'solid', color: '#000000' },
        right: { width: 1.5, style: 'solid', color: '#ed7d31' },
        top: { width: 0.75, style: 'dashed', color: '#000000' },
        bottom: { width: 2.25, style: 'double', color: '#000000' }
      }
    })
    expect(note).toMatchObject({
      text: { font: 'Georgia', size: 9, color: '#0000ff', italic: true, underline: 'double', struck: true, position: 'super' },
      fill: '#808080',
      indent: 2
    })
  })

  it.each<[string, string | undefined]>([
    ['<color rgb="FF4472C4"/>', '#4472c4'],
    ['<color theme="0"/>', '#ffffff'],
    ['<color theme="1"/>', '#000000'],
    ['<color theme="4" tint="-0.249977111117893"/>', '#2f5597'],
    ['<color indexed="10"/>', '#ff0000'],
    ['<color indexed="64"/>', undefined],
    ['<color auto="1"/>', undefined]
  ])('reads the colour %s as %s', (xml, color) => {
    expect(workbookColor(xmlTree(xml).children[0], styles().colors)).toBe(color)
  })

  it.each<[number, string, string | undefined]>([
    [-0.5, '0.0%;[Red]-0.0%', '#ff0000'],
    [0.5, '0.0%;[Red]-0.0%', undefined],
    [3, '[Blue]0;[Red]-0', '#0000ff'],
    [-3, '#,##0;[Color10]-#,##0', '#008000'],
    [1, '"[Red]"0', undefined],
    [Number.NaN, '[Red]0', undefined]
  ])('writes %d in the colour its format %s names', (value, code, color) => {
    expect(numberColor(value, code, (index) => (index === 17 ? '#008000' : undefined))).toBe(color)
  })

  it('lays a sheet out: its columns, rows, merged cells, grid, headings and zoom, and where each cell sits by what it holds', () => {
    const layout: SheetLayout = {
      styles: [
        [1, undefined, 0],
        [0, 2],
        [0, 0, 0]
      ],
      kinds: [
        ['text', 'empty', 'number'],
        ['number', 'number'],
        ['logical', 'error', 'text']
      ],
      heights: [{ height: 24, hidden: false }, undefined, { hidden: true }],
      numberColors: [[], [undefined, '#ff0000']]
    }
    const look = readSheetLook(
      `<worksheet><sheetViews><sheetView showGridLines="0" zoomScale="85"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="14.77734375" customWidth="1"/><col min="2" max="2" width="0" hidden="1"/></cols>
<mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="Z9:Z12"/></mergeCells></worksheet>`,
      layout,
      styles(),
      { rows: 3, columns: 3 }
    )
    // 14 characters of a 7-pixel digit and their padding are 103 pixels; the default 8.43, 64.
    expect(look.columns).toEqual([77.25, 0, 48])
    expect(look.rows).toEqual([24, 15, 0])
    expect(look.merges).toEqual([{ row: 0, column: 0, rows: 1, columns: 2 }])
    expect(look).toMatchObject({ grid: false, headings: true, zoom: 0.85 })
    const at = (row: number, column: number) => look.looks[look.cells[row]?.[column] ?? -1]
    expect(at(0, 0)).toMatchObject({ align: 'center', vertical: 'middle', wrap: true, fill: '#dae3f3' })
    expect(at(0, 2)?.align).toBe('right')
    expect(at(1, 1)).toMatchObject({ align: 'left', vertical: 'top', indent: 31.5, text: { color: '#ff0000' } })
    expect([at(2, 0)?.align, at(2, 1)?.align, at(2, 2)?.align]).toEqual(['center', 'center', 'left'])
    // Cells set alike share one look.
    expect(look.cells[2]?.[0]).toBe(look.cells[2]?.[1])
  })

  it('takes a sheet’s default column width when it gives one, and holds widths, heights and zoom within Excel’s', () => {
    const layout: SheetLayout = { styles: [], kinds: [], heights: [{ height: 5000, hidden: false }], numberColors: [] }
    const look = readSheetLook(
      '<worksheet><sheetViews><sheetView zoomScale="9000"/></sheetViews><sheetFormatPr defaultColWidth="20" defaultRowHeight="-3"/><cols><col min="2" max="99999" width="1e9"/></cols></worksheet>',
      layout,
      styles(),
      { rows: 2, columns: 3 }
    )
    expect(look.columns).toEqual([105, 1338.75, 1338.75])
    expect(look.rows).toEqual([409, 14.96])
    expect(look.zoom).toBe(1)
  })
})
