import { describe, expect, it } from 'vitest'
import type { ConditionRule } from './conditional-formats.ts'
import { readBlock, readSheetConditions } from './sheet-conditions.ts'
import { readWorkbookStyles } from './sheet-look.ts'

const styles = readWorkbookStyles(
  '<styleSheet><fonts><font><sz val="11"/></font></fonts><cellXfs><xf/></cellXfs><dxfs><dxf><font><i/><color rgb="FF006100"/></font></dxf></dxfs></styleSheet>',
  { theme: [], fonts: { major: '', minor: '' } }
)

/** The rule of a sheet's one condition, written as Excel writes it. */
const ruleOf = (rule: string) =>
  readSheetConditions(`<worksheet><conditionalFormatting sqref="B2:C9">${rule}</conditionalFormatting></worksheet>`, styles, 'Sheet1')[0]?.rule

describe('an Excel sheet’s conditional formats', () => {
  it.each<[string, ReturnType<typeof readBlock>]>([
    ['A1', { row: 0, column: 0, rows: 1, columns: 1 }],
    ['$B$2:$D$10', { row: 1, column: 1, rows: 9, columns: 3 }],
    ['D10:B2', { row: 1, column: 1, rows: 9, columns: 3 }],
    ['AA100', { row: 99, column: 26, rows: 1, columns: 1 }],
    ['A0', undefined],
    ['Sheet1!A1', undefined]
  ])('reads the cells %s', (text, block) => {
    expect(readBlock(text)).toEqual(block)
  })

  it.each<[string, Partial<ConditionRule>]>([
    ['<cfRule type="top10" dxfId="0" priority="1" rank="3" bottom="1"/>', { kind: 'rank', count: 3, bottom: true, percent: false }],
    ['<cfRule type="top10" dxfId="0" priority="1" percent="1" rank="10"/>', { kind: 'rank', count: 10, bottom: false, percent: true }],
    [
      '<cfRule type="aboveAverage" dxfId="0" priority="1" aboveAverage="0" equalAverage="1" stdDev="2"/>',
      { kind: 'average', above: false, equal: true, deviations: 2 }
    ],
    ['<cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="late"/>', { kind: 'text', test: 'contains', text: 'late' }],
    ['<cfRule type="endsWith" dxfId="0" priority="1" operator="endsWith" text=".pdf"/>', { kind: 'text', test: 'endsWith', text: '.pdf' }],
    ['<cfRule type="containsBlanks" dxfId="0" priority="1"/>', { kind: 'blank', blank: true }],
    ['<cfRule type="notContainsErrors" dxfId="0" priority="1"/>', { kind: 'error', error: false }],
    ['<cfRule type="uniqueValues" dxfId="0" priority="1"/>', { kind: 'repeated', unique: true }],
    ['<cfRule type="timePeriod" dxfId="0" priority="1" timePeriod="last7Days"/>', { kind: 'date', period: 'last7Days' }],
    [
      '<cfRule type="cellIs" dxfId="0" priority="1" operator="notBetween"><formula>1</formula><formula>$A$1</formula></cfRule>',
      { kind: 'compare', operator: 'notBetween' }
    ],
    [
      '<cfRule type="iconSet" priority="1"><iconSet iconSet="4Rating" reverse="1"><cfvo type="percent" val="0"/><cfvo type="num" val="2"/>' +
        '<cfvo type="percentile" val="50" gte="0"/><cfvo type="formula" val="$A$1"/></iconSet></cfRule>',
      { kind: 'icons', set: '4Rating', reverse: true, shown: true }
    ]
  ])('reads %s', (rule, read) => {
    expect(ruleOf(rule)).toMatchObject(read)
  })

  it('takes what a rule sets from the workbook’s differential formats, and leaves out what it cannot read', () => {
    expect(ruleOf('<cfRule type="expression" dxfId="0" priority="1"><formula>$B2&gt;0</formula></cfRule>')).toMatchObject({
      kind: 'formula',
      look: { text: { italic: true, color: '#006100' } }
    })
    expect(ruleOf('<cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>Data!$A$1</formula></cfRule>')).toBeUndefined()
    expect(ruleOf('<cfRule type="cellIs" dxfId="0" priority="1" operator="between"><formula>1</formula></cfRule>')).toBeUndefined()
    expect(ruleOf('<cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><color rgb="FFFF0000"/></colorScale></cfRule>')).toBeUndefined()
    expect(ruleOf('<cfRule type="mystery" priority="1"/>')).toBeUndefined()
    const [condition] = readSheetConditions(
      '<worksheet><conditionalFormatting sqref="C3:D4 A1"><cfRule type="containsBlanks" priority="7" stopIfTrue="1"/></conditionalFormatting></worksheet>',
      styles,
      'Sheet1'
    )
    expect(condition).toMatchObject({ anchor: { row: 2, column: 2 }, priority: 7, stop: true, rule: { look: {} } })
    expect(condition?.blocks).toHaveLength(2)
  })
})
