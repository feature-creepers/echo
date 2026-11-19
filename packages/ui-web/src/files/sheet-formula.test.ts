import { describe, expect, it } from 'vitest'
import { dayOf, evaluateFormula, type FormulaContext, type FormulaValue, readFormula, readFormulaTokens, serialOf } from './sheet-formula.ts'

/** A sheet of three rows: numbers, text and a blank, a truth and an error. */
const SHEET: FormulaValue[][] = [
  [5, 'Apple', null, true],
  [12, 'banana', 7, { error: '#DIV/0!' }],
  [-3, 'Cherry pie', 20, false]
]

const context = (at = { row: 0, column: 0 }, anchor = { row: 0, column: 0 }): FormulaContext => ({
  value: (row, column) => SHEET[row]?.[column] ?? null,
  rows: SHEET.length,
  columns: 4,
  at,
  anchor,
  now: serialOf(2026, 11, 19, false) + 0.5,
  date1904: false
})

const worked = (text: string, at = { row: 0, column: 0 }, anchor = { row: 0, column: 0 }) => {
  const formula = readFormula(text, 'Sheet1')
  if (!formula) throw new Error(`"${text}" is not read.`)
  return evaluateFormula(formula, context(at, anchor))
}

describe('a conditional format’s formula', () => {
  it.each<[string, FormulaValue]>([
    ['1+2*3', 7],
    ['-2^2', 4],
    ['(1+2)*3', 9],
    ['50%', 0.5],
    ['2^3^2', 64],
    ['"a"&"b"&1', 'ab1'],
    ['A1>4', true],
    ['$A$2=12', true],
    ['B1="APPLE"', true],
    ['B1<>"apple"', false],
    ['A1<"text"', true],
    ['C1=0', true],
    ['C1=""', true],
    ['D1=TRUE', true],
    ['A1/0', { error: '#DIV/0!' }],
    ['D2+1', { error: '#DIV/0!' }],
    ['B1+1', { error: '#VALUE!' }],
    ['"3"+1', 4],
    ['MOD(ROW(),2)=1', true],
    ['MOD(-3,2)', 1],
    ['AND(A1>0,A2>10)', true],
    ['OR(A1<0,A3<0)', true],
    ['NOT(ISBLANK(C1))', false],
    ['ISNUMBER(A1)', true],
    ['ISTEXT(A1)', false],
    ['ISERROR(D2)', true],
    ['ISNA(NA())', true],
    ['IF(A1>3,"big","small")', 'big'],
    ['IFERROR(D2,0)', 0],
    ['SUM(A1:A3)', 14],
    ['SUM(A:A)', 14],
    ['AVERAGE(A1:A3,C2)', 5.25],
    ['MAX(A1:C3)', 20],
    ['COUNT(A1:D3)', 5],
    ['COUNTA(A1:D3)', 11],
    ['COUNTBLANK(C1:C3)', 1],
    ['COUNTIF(A1:A3,">0")', 2],
    ['COUNTIF(B1:B3,"b*")', 1],
    ['COUNTIF(B1:B3,"apple")', 1],
    ['COUNTIF($A$1:$A$3,A1)>1', false],
    ['LEN(B3)', 10],
    ['LEFT(B3,6)', 'Cherry'],
    ['RIGHT(B3)', 'e'],
    ['MID(B3,8,3)', 'pie'],
    ['UPPER(B2)', 'BANANA'],
    ['TRIM("  a   b ")', 'a b'],
    ['SEARCH("PIE",B3)', 8],
    ['FIND("PIE",B3)', { error: '#VALUE!' }],
    ['NOT(ISERROR(SEARCH("an",B2)))', true],
    ['EXACT("a","A")', false],
    ['ROUND(2.345,2)', 2.35],
    ['INT(-1.5)', -2],
    ['TODAY()', serialOf(2026, 11, 19, false)],
    ['WEEKDAY(TODAY())', 5],
    ['YEAR(DATE(2026,2,30))', 2026],
    ['MONTH(DATE(2026,2,30))', 3],
    ['_xlfn.ISFORMULA(A1)', { error: '#NAME?' }],
    ['of:=[.A1]>4', true],
    ['SUM([.A1:.A3];[.C2])', 21],
    ['[$Sheet1.$B$1]="Apple"', true],
    ['Sheet1!A1+1', 6],
    ["'Sheet1'!A1+1", 6]
  ])('works out %s', (text, value) => {
    expect(worked(text)).toEqual(value)
  })

  it('moves the cells it names with the cell it is worked out for, those fixed staying where they are', () => {
    expect(worked('$A1+B$1', { row: 1, column: 0 })).toEqual({ error: '#VALUE!' })
    expect(worked('A1', { row: 2, column: 2 })).toBe(20)
    expect(worked('A2', { row: 2, column: 2 }, { row: 1, column: 0 })).toBe(20)
    expect(worked('$A2', { row: 2, column: 2 }, { row: 1, column: 0 })).toBe(-3)
    expect(worked('A$2', { row: 2, column: 2 }, { row: 1, column: 0 })).toBe(7)
    // A cell before the first row is empty, as Excel's references wrap round to the far end of the sheet.
    expect(worked('A1', { row: 0, column: 0 }, { row: 1, column: 0 })).toBeNull()
    expect(worked('$A:$A=5', { row: 0, column: 3 })).toBe(true)
    expect(worked('A:A=5', { row: 0, column: 3 })).toBe(false)
  })

  it.each([['Sheet2!A1'], ['[$Other.A1]'], ['A1:'], ['SUM(A1'], ['"open'], ['1 2'], ['A1 @ 2'], ['MyName+1'], ['{1,2}']])(
    'does not read %s, which names what is not here',
    (text) => {
      const formula = readFormula(text, 'Sheet1')
      expect(formula === undefined || evaluateFormula(formula, context()) instanceof Object).toBe(true)
    }
  )

  it('reads a formula of Excel 97 from its tokens, its references of a cell’s place from the cell it is written for', () => {
    const bytes = (...parts: number[]) => new Uint8Array(parts)
    const u16 = (value: number) => [value & 0xff, value >> 8]
    // A2>10, as a reference of a cell (`PtgRef`, relative row and column) compared with an integer.
    expect(evaluateFormula(readFormulaTokens(bytes(0x44, ...u16(1), ...u16(0xc000), 0x1e, ...u16(10), 0x0d), { row: 0, column: 0 }) ?? fail(), context())).toBe(
      true
    )
    // MOD(ROW(),2)=0, ROW with no operand (`PtgFuncVar`) and MOD of two (`PtgFunc`).
    const banding = readFormulaTokens(bytes(0x42, 0, ...u16(8), 0x1e, ...u16(2), 0x41, ...u16(39), 0x1e, ...u16(0), 0x0b), { row: 0, column: 0 })
    expect(evaluateFormula(banding ?? fail(), context({ row: 1, column: 0 }))).toBe(true)
    // The cell one row up from the one worked out for (`PtgRefN`), and a string of 16-bit characters.
    const above = readFormulaTokens(bytes(0x4c, ...u16(0xffff), ...u16(0xc000), 0x17, 5, 1, ...[...'Apple'].flatMap((one) => u16(one.charCodeAt(0))), 0x0b), {
      row: 2,
      column: 1
    })
    expect(evaluateFormula(above ?? fail(), context({ row: 1, column: 1 }, { row: 2, column: 1 }))).toBe(true)
    // SUM(A1:A3) as a sum of one operand (`PtgAttr`), and a number in full.
    const sum = readFormulaTokens(bytes(0x25, ...u16(0), ...u16(2), ...u16(0), ...u16(0), 0x19, 0x10, 0, 0, 0x1f, 0, 0, 0, 0, 0, 0, 0x2c, 0x40, 0x0b), {
      row: 0,
      column: 0
    })
    expect(evaluateFormula(sum ?? fail(), context())).toBe(true)
    // Another sheet's cell (`PtgRef3d`), and tokens cut short, are not read.
    expect(readFormulaTokens(bytes(0x3a, 0, 0, 0, 0, 0, 0), { row: 0, column: 0 })).toBeUndefined()
    expect(readFormulaTokens(bytes(0x1f, 0, 0), { row: 0, column: 0 })).toBeUndefined()
    expect(readFormulaTokens(bytes(0x1e, 1, 0, 0x1e, 2, 0), { row: 0, column: 0 })).toBeUndefined()
  })

  it.each<[number, number, number, boolean]>([
    [1900, 1, 1, false],
    [1900, 2, 28, false],
    [1900, 3, 1, false],
    [2026, 11, 19, false],
    [1904, 1, 1, true],
    [2026, 11, 19, true]
  ])('counts %i-%i-%i as a day of the workbook and back', (year, month, day, date1904) => {
    const serial = serialOf(year, month, day, date1904)
    expect(dayOf(serial, date1904)).toMatchObject({ year, month, day })
  })

  it('counts the days as Excel does, its 29 February 1900 included', () => {
    expect(serialOf(1900, 1, 1, false)).toBe(1)
    expect(serialOf(1900, 3, 1, false)).toBe(61)
    expect(dayOf(60, false)).toMatchObject({ year: 1900, month: 2, day: 29 })
    expect(serialOf(2026, 11, 19, false)).toBe(46345)
    expect(serialOf(2026, 11, 19, true)).toBe(46345 - 1462)
  })
})

function fail(): never {
  throw new Error('Not read.')
}
