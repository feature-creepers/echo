import { describe, expect, it } from 'vitest'
import { dataStyles, openNumberColor, readOpenSheetLook, readSheetViews } from './open-sheet-look.ts'
import { StyleBook } from './open-styles.ts'
import { childAt, xmlTree } from './xml.ts'

const STYLES = `<office:document-styles><office:styles>
<style:default-style style:family="table-cell"><style:text-properties style:font-name="Liberation Sans" fo:font-size="10pt"/></style:default-style>
<style:style style:name="Default" style:family="table-cell"/>
<number:percentage-style style:name="N37P0"><number:number/></number:percentage-style>
<number:percentage-style style:name="N37"><style:text-properties fo:color="#FF0000"/><number:number/><style:map style:condition="value()&gt;=0" style:apply-style-name="N37P0"/></number:percentage-style>
</office:styles></office:document-styles>`

const CONTENT = `<office:document-content><office:automatic-styles>
<style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="2cm"/></style:style>
<style:style style:name="co2" style:family="table-column"><style:table-column-properties style:column-width="1in"/></style:style>
<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="0.5in"/></style:style>
<style:style style:name="head" style:family="table-cell" style:parent-style-name="Default"><style:table-cell-properties fo:background-color="#156082" fo:border="thin solid #000000" style:vertical-align="middle" fo:wrap-option="wrap" style:text-align-source="fix"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-weight="bold" fo:color="#ffffff"/></style:style>
<style:style style:name="pct" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N37"/>
<style:style style:name="indented" style:family="table-cell" style:parent-style-name="Default"><style:paragraph-properties fo:text-align="start" fo:margin-left="0.25in"/></style:style>
<style:style style:name="up" style:family="table-cell" style:parent-style-name="Default"><style:table-cell-properties style:rotation-angle="270"/></style:style>
<style:style style:name="stacked" style:family="table-cell" style:parent-style-name="Default"><style:table-cell-properties style:direction="ttb"/></style:style>
</office:automatic-styles><office:body><office:spreadsheet>
<table:table table:name="Sales">
<table:table-column table:style-name="co1" table:default-cell-style-name="indented"/>
<table:table-column table:style-name="co2" table:number-columns-repeated="2" table:default-cell-style-name="pct"/>
<table:table-column table:style-name="co2" table:visibility="collapse"/>
<table:table-column table:style-name="co2" table:number-columns-repeated="16380"/>
<table:table-row table:style-name="ro1"><table:table-cell table:style-name="head" table:number-columns-spanned="2" office:value-type="string"><text:p>City</text:p></table:table-cell><table:covered-table-cell/><table:table-cell table:number-columns-repeated="3"/></table:table-row>
<table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="string"><text:p>Lyon</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="-0.03"><text:p>-3%</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0.5"><text:p>50%</text:p></table:table-cell><table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell table:style-name="up" office:value-type="string"><text:p>Up</text:p></table:table-cell><table:table-cell table:style-name="stacked" office:value-type="string"><text:p>Ab</text:p></table:table-cell></table:table-row>
<table:table-row table:visibility="collapse" table:number-rows-repeated="1048570"><table:table-cell/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`

const SETTINGS = `<office:document-settings><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>
<config:config-item config:name="ShowGrid" config:type="boolean">true</config:config-item><config:config-item config:name="ZoomValue" config:type="int">100</config:config-item>
<config:config-item-map-named config:name="Tables"><config:config-item-map-entry config:name="Sales"><config:config-item config:name="ShowGrid" config:type="boolean">false</config:config-item><config:config-item config:name="ZoomValue" config:type="int">75</config:config-item></config:config-item-map-entry></config:config-item-map-named>
</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>`

describe('an OpenDocument spreadsheet as it looks', () => {
  const content = childAt(xmlTree(CONTENT), 'office:document-content')
  const styles = childAt(xmlTree(STYLES), 'office:document-styles')
  const book = new StyleBook(childAt(content, 'office:automatic-styles'), undefined, childAt(styles, 'office:styles'))
  const numbers = dataStyles([content, styles])
  const table = childAt(content, 'office:body', 'office:spreadsheet', 'table:table')

  it('reads each sheet’s view from the settings, the sheet’s own over the document’s', () => {
    const views = readSheetViews(SETTINGS)
    expect(views('Sales')).toEqual({ grid: false, headings: true, zoom: 0.75 })
    expect(views('Other')).toEqual({ grid: true, headings: true, zoom: 1 })
    expect(readSheetViews(undefined)('Any')).toEqual({ grid: true, headings: true, zoom: 1 })
  })

  it.each<[number, string | undefined]>([
    [-0.03, '#ff0000'],
    [0.5, undefined],
    [0, undefined]
  ])('writes %d in the colour its number style’s maps give it', (value, color) => {
    expect(openNumberColor(numbers.get('N37'), value, numbers)).toBe(color)
  })

  it('lays a sheet out: its columns, rows, merged cells, and each cell in its own style, its row’s or its column’s', () => {
    if (!table) throw new Error('No table.')
    const look = readOpenSheetLook(
      table,
      { rows: 3, columns: 4 },
      book,
      new Map([['Liberation Sans', 'Liberation Sans']]),
      {
        grid: false,
        headings: true,
        zoom: 0.75
      },
      { numbers }
    )
    expect(look.columns.map(Math.round)).toEqual([57, 72, 72, 0])
    expect(look.rows).toEqual([36, 12.8, 12.8])
    expect(look.merges).toEqual([{ row: 0, column: 0, rows: 1, columns: 2 }])
    expect(look).toMatchObject({ grid: false, zoom: 0.75, text: { font: 'Liberation Sans', size: 10 } })
    const at = (row: number, column: number) => look.looks[look.cells[row]?.[column] ?? -1]
    expect(at(0, 0)).toMatchObject({
      fill: '#156082',
      align: 'center',
      vertical: 'middle',
      wrap: true,
      text: { bold: true, color: '#ffffff' },
      borders: { top: { width: 0.75, style: 'solid', color: '#000000' } }
    })
    // A column's default style, its own alignment, and numbers in their style's colour.
    expect(at(1, 0)).toMatchObject({ align: 'left', indent: 18 })
    expect(at(1, 1)).toMatchObject({ align: 'right', text: { color: '#ff0000' } })
    expect(at(1, 2)?.text.color).toBeUndefined()
    expect(at(2, 3)?.align).toBe('right')
    expect(at(0, 0)?.rotation).toBeUndefined()
  })

  it('turns a cell’s text by its angle, down for one past the half turn, or stacks its letters', () => {
    if (!table) throw new Error('No table.')
    const look = readOpenSheetLook(table, { rows: 4, columns: 2 }, book, new Map(), { grid: true, headings: true, zoom: 1 }, { numbers })
    const at = (row: number, column: number) => look.looks[look.cells[row]?.[column] ?? -1]
    expect([at(3, 0)?.rotation, at(3, 1)?.rotation]).toEqual([-90, 'stacked'])
  })
})
