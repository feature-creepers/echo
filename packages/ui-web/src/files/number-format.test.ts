import { describe, expect, it } from 'vitest'
import { builtInFormat, formatNumber, generalNumber } from './number-format.ts'

const en = { locale: 'en-US' }

describe('a number as General shows it', () => {
  it.each<[number, string]>([
    [0, '0'],
    [42.5, '42.5'],
    [8.200000000000001, '8.2'],
    [1589036664.03, '1589036664'],
    [-3, '-3'],
    [123456789012, '1.23457E+11'],
    [0.0000000001, '1E-10'],
    [1 / 3, '0.3333333333']
  ])('%d as %s', (value, shown) => {
    expect(generalNumber(value)).toBe(shown)
  })
})

describe('a number as its format shows it', () => {
  it.each<[string, string, number, string]>([
    ['General', 'General', 42.5, '42.5'],
    ['an empty format', '', 7, '7'],
    ['whole', '0', 2.5, '3'],
    ['two decimals', '0.00', 2.34567, '2.35'],
    ['thousands', '#,##0', 1234567.8, '1,234,568'],
    ['thousands and decimals', '#,##0.00', -1234.5, '-1,234.50'],
    ['optional decimals', '0.##', 3.1, '3.1'],
    ['optional decimals of a whole number', '0.##', 3, '3'],
    ['no integer digit asked for', '#.00', 0.5, '.50'],
    ['leading zeros', '00000', 42, '00042'],
    ['a percentage', '0%', 0.256, '26%'],
    ['a percentage with decimals', '0.00%', 0.12345, '12.35%'],
    ['scientific', '0.00E+00', 12345, '1.23E+04'],
    ['scientific, small', '0.00E+00', 0.000123, '1.23E-04'],
    ['engineering', '##0.0E+0', 12345, '12.3E+3'],
    ['thousands scaled away', '#,##0,"K"', 1234567, '1,235K'],
    ['millions scaled away', '0.0,,"M"', 2500000, '2.5M'],
    ['a currency in quotes', '"$"#,##0.00', 1234.5, '$1,234.50'],
    ['a currency sign with its language', '#,##0.00 [$€-407]', 1234.5, '1,234.50 €'],
    ['a space the width of a parenthesis', '#,##0_);(#,##0)', 12, '12 '],
    ['a negative section', '#,##0_);(#,##0)', -12, '(12)'],
    ['a red negative section, its colour left out', '0.00;[Red]-0.00', -1.5, '-1.50'],
    ['a zero section', '0;-0;"nothing"', 0, 'nothing'],
    ['an empty zero section', '0;-0;;@', 0, ''],
    ['escaped and quoted text', '0\\ "items"', 3, '3 items'],
    ['a fill left out', '* #,##0', 5, '5'],
    ['digits spread among their literals', '000-00-0000', 123456789, '123-45-6789'],
    ['a fraction', '# ?/?', 1.5, '1 1/2'],
    ['a fraction of two digits', '# ??/??', 1.2345, '1 19/81'],
    ['a fraction, its smallest denominator', '?/??', 0.5, '1/2'],
    ['a fraction alone', '?/?', 0.75, '3/4'],
    ['a fraction in eighths', '# ?/8', 2.3, '2 2/8'],
    ['a whole number as a fraction', '# ?/?', 4, '4'],
    ['text alone', '@', 12.5, '12.5'],
    ['a minus sign kept only for a number not zero', '0', -0.2, '0']
  ])('%s: %s for %d is %s', (_, code, value, shown) => {
    expect(formatNumber(value, code, en)).toBe(shown)
  })

  it.each<[string, string, number, string]>([
    ['a date', 'dd/mm/yyyy', 45234, '04/11/2023'],
    ['a date with month names', 'd mmmm yyyy', 45234, '4 November 2023'],
    ['a short month and a weekday', 'ddd d mmm yy', 45234, 'Sat 4 Nov 23'],
    ['a month initial', 'mmmmm', 45234, 'N'],
    ['an ISO date and time', 'yyyy-mm-dd hh:mm:ss', 45234.75, '2023-11-04 18:00:00'],
    ['minutes after hours, not months', 'h:mm', 0.5208333333, '12:30'],
    ['minutes before seconds', 'mm:ss', 0.000706018518, '01:01'],
    ['twelve hours', 'h:mm AM/PM', 0.75, '6:00 PM'],
    ['twelve hours at midnight', 'h:mm A/P', 0, '12:00 A'],
    ['hours past a day', '[h]:mm:ss', 1.5, '36:00:00'],
    ['a tenth of a second', 'mm:ss.0', 0.00001736111, '00:01.5'],
    ['the first of March 1900, after its leap day that never was', 'yyyy-mm-dd', 61, '1900-03-01'],
    ['the first of January 1900', 'yyyy-mm-dd', 1, '1900-01-01'],
    ['a time a hair short of a second', 'hh:mm:ss', 0.999999999, '00:00:00']
  ])('%s: %s for %d is %s', (_, code, value, shown) => {
    expect(formatNumber(value, code, en)).toBe(shown)
  })

  it('counts from 1904 when the workbook does', () => {
    expect(formatNumber(0, 'yyyy-mm-dd', { ...en, date1904: true })).toBe('1904-01-01')
  })

  it('writes a short date in the language given, for the formats Excel numbers', () => {
    expect(formatNumber(45234, builtInFormat(14), en)).toBe('11/4/23')
    expect(formatNumber(45234, builtInFormat(14), { locale: 'fr-FR' })).toBe('04/11/2023')
    expect(formatNumber(45234, builtInFormat(15), en)).toBe('4-Nov-23')
    expect(formatNumber(0.256, builtInFormat(9), en)).toBe('26%')
    expect(formatNumber(5, builtInFormat(200), en)).toBe('5')
    expect(formatNumber(99_999_999, builtInFormat(14), en)).toBe('99999999')
    expect(formatNumber(-1, 'dd/mm/yyyy', en)).toBe('-1')
  })
})
