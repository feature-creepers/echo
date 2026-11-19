import { describe, expect, it } from 'vitest'
import { type ChartContext, type ChartRecord, chartFormula, readGraphChart, readOlderChart } from './binary-chart.ts'
import { type CellValue, cellRange } from './office-figures.ts'

const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const f64 = (value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return [...bytes]
}
const narrow = (text: string) => [...text].map((char) => char.charCodeAt(0))
const wide = (text: string) => [...text].flatMap((char) => u16(char.charCodeAt(0)))
const record = (type: number, body: readonly number[] = []): ChartRecord => ({ type, body: new Uint8Array(body) })

const BEGIN = record(0x1033)
const END = record(0x1034)
/** A text of a chart, in 8-bit characters or in UTF-16. */
const seriesText = (text: string, inWide = false) => record(0x100d, [0, 0, text.length, ...(inWide ? [1, ...wide(text)] : [0, ...narrow(text)])])
/** A formula of a series naming a block of a sheet by its reference: its name (0), values (1) or categories (2). */
const area = (part: number, reference: number, rows: [number, number], columns: [number, number]) => {
  const tokens = [0x3b, ...u16(reference), ...u16(rows[0]), ...u16(rows[1]), ...u16(columns[0] | 0xc000), ...u16(columns[1] | 0xc000)]
  return record(0x1051, [part, 2, 0, 0, 0, 0, ...u16(tokens.length), ...tokens])
}
const literal = (part: number) => record(0x1051, [part, 1, 0, 0, 0, 0, 0, 0])
/** A value a chart kept: its point, its series, its cell's style, and its number or text. */
const number = (point: number, series: number, value: number, style = 0) => record(0x0203, [...u16(point), ...u16(series), ...u16(style), ...f64(value)])
const label = (point: number, series: number, text: string, inWide = false) =>
  record(0x0204, [...u16(point), ...u16(series), 0, 0, ...u16(text.length), ...(inWide ? [1, ...wide(text)] : [0, ...narrow(text)])])
const kept = (what: number) => record(0x1065, u16(what))

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes)
const context = (cells?: ChartContext['cells']): ChartContext => ({
  five: false,
  eight: latin1,
  number: (value, style) => (style === 7 ? `day ${value}` : String(value)),
  sheetName: (reference) => ['Data', "It's"][reference],
  cells
})

describe('a formula of an Excel 97 chart', () => {
  const block = (token: number, reference: number, ...values: number[]) => new Uint8Array([token, ...u16(reference), ...values.flatMap(u16)])
  it.each<[string, Uint8Array, string | undefined]>([
    ['a block of a sheet', block(0x3b, 0, 1, 4, 1, 1), "'Data'!$B$2:$B$5"],
    ['a block, its columns marked relative', block(0x5b, 0, 0, 0, 0xc000, 0xc002), "'Data'!$A$1:$C$1"],
    ['a cell', block(0x3a, 0, 0, 27), "'Data'!$AB$1"],
    ['a cell of a sheet whose name holds a quote', block(0x7a, 1, 2, 0), "'It''s'!$A$3"],
    ['a sheet it does not know', block(0x3b, 5, 0, 0, 0, 0), undefined],
    ['another token', block(0x24, 0, 0, 0), undefined],
    ['too few bytes', new Uint8Array([0x3b, 0, 0]), undefined]
  ])('reads %s', (_, tokens, formula) => {
    expect(chartFormula(tokens, context())).toBe(formula)
  })

  it('reads none of Excel 5 and 95’s formulas, written otherwise', () => {
    expect(chartFormula(block(0x3b, 0, 1, 4, 1, 1), { ...context(), five: true })).toBeUndefined()
  })
})

describe('a chart of Excel 97 to 2003', () => {
  it('reads its kind, its title, each series’ name and the values and categories it kept, as their formats show them', () => {
    const chart = [
      record(0x0809),
      record(0x1018),
      record(0x1003),
      BEGIN,
      literal(0),
      seriesText('Visits'),
      literal(1),
      // A label of the series' points is a text of the series, not its name nor the chart's title.
      record(0x1025),
      BEGIN,
      record(0x1027, [4, 0]),
      seriesText('A label'),
      END,
      END,
      record(0x1003),
      BEGIN,
      literal(0),
      seriesText('Été', true),
      END,
      record(0x1025),
      BEGIN,
      record(0x1027, [1, 0]),
      seriesText('Visits by month'),
      END,
      kept(1),
      number(0, 0, 1200),
      number(1, 0, 1500.5),
      number(0, 1, 3),
      label(1, 1, 'not a number'),
      kept(2),
      label(0, 0, 'May'),
      label(1, 0, 'Juin', true),
      number(0, 1, 45000, 7),
      number(1, 9, 1),
      record(0x000a)
    ]
    expect(readOlderChart(chart, context())).toEqual({
      title: 'Visits by month',
      chart: 'line',
      series: [
        {
          name: 'Visits',
          points: [
            { x: 'May', y: 1200 },
            { x: 'Juin', y: 1500.5 }
          ]
        },
        { name: 'Été', points: [{ x: 'day 45000', y: 3 }] }
      ]
    })
  })

  it('reads a series that kept no values from the cells its formulas name', () => {
    const sheet = new Map<string, CellValue>([
      ['0,1', { text: 'Sales' }],
      ['1,0', { text: 'North' }],
      ['1,1', { text: '30', number: 30 }],
      ['2,0', { text: 'South' }],
      ['2,1', { text: '12.5', number: 12.5 }]
    ])
    const chart = [record(0x1017), record(0x1003), BEGIN, area(0, 0, [0, 0], [1, 1]), area(1, 0, [1, 2], [1, 1]), area(2, 0, [1, 2], [0, 0]), END]
    const expected = {
      title: '',
      chart: 'bar',
      series: [
        {
          name: 'Sales',
          points: [
            { x: 'North', y: 30 },
            { x: 'South', y: 12.5 }
          ]
        }
      ]
    }
    expect(readOlderChart(chart, context(cellRange(new Map([['Data', sheet]]))))).toEqual(expected)
    expect(readOlderChart(chart, context())).toBeUndefined()
  })

  it('reads Excel 5 and 95’s text in the workbook’s 8-bit characters', () => {
    const chart = [record(0x101a), record(0x1003), BEGIN, record(0x100d, [0, 0, 3, ...narrow('Sum')]), END, kept(1), number(0, 0, 2)]
    expect(readOlderChart(chart, { ...context(), five: true })).toEqual({ title: '', chart: 'area', series: [{ name: 'Sum', points: [{ x: '1', y: 2 }] }] })
  })

  it('has nothing to draw with no series, or with records cut short', () => {
    expect(readOlderChart([record(0x1017), kept(1), number(0, 0, 1)], context())).toBeUndefined()
    expect(readOlderChart([record(0x1003), kept(1), record(0x0203, [0, 0, 0, 0]), record(0x1051, [1, 2]), record(0x100d, [0])], context())).toBeUndefined()
  })
})

describe('a chart of Microsoft Graph', () => {
  /** Records as a stream holds them: each one's type, its size, then what it holds. */
  const streamOf = (records: readonly ChartRecord[]) => new Uint8Array(records.flatMap(({ type, body }) => [...u16(type), ...u16(body.length), ...body]))
  /** A cell of Graph's sheet of data, in Excel 2's records: its row, its column, three bytes of format, then its value. */
  const text = (row: number, column: number, value: string) => record(0x0004, [...u16(row), ...u16(column), 0, 0, 0, value.length, 0, ...narrow(value)])
  const value = (row: number, column: number, number: number) => record(0x0003, [...u16(row), ...u16(column), 0, 0, 0, ...f64(number)])
  const named = (name: string) => [record(0x1003), BEGIN, seriesText(name), END]

  it('reads each series along a row of its sheet of data, the categories along its first', () => {
    const stream = streamOf([text(0, 1, 'Q1'), text(0, 2, 'Q2'), text(1, 0, 'East'), value(1, 1, 20.4), value(1, 2, 27.4), record(0x1018), ...named('East')])
    expect(readGraphChart(stream)).toEqual({
      title: '',
      chart: 'line',
      series: [
        {
          name: 'East',
          points: [
            { x: 'Q1', y: 20.4 },
            { x: 'Q2', y: 27.4 }
          ]
        }
      ]
    })
  })

  it('reads each series down a column when the series’ names head its columns', () => {
    const stream = streamOf([text(0, 1, 'North'), text(0, 2, 'South'), text(1, 0, 'May'), value(1, 1, 3), value(1, 2, 4), ...named('North'), ...named('South')])
    expect(readGraphChart(stream)?.series).toEqual([
      { name: 'North', points: [{ x: 'May', y: 3 }] },
      { name: 'South', points: [{ x: 'May', y: 4 }] }
    ])
  })

  it('names a series from its sheet when its records do not, and stops at a record cut short', () => {
    const stream = streamOf([text(1, 0, 'East'), value(1, 1, 5), record(0x1003), BEGIN, END])
    expect(readGraphChart(stream)?.series).toEqual([{ name: 'East', points: [{ x: '1', y: 5 }] }])
    expect(readGraphChart(stream.subarray(0, 12))).toBeUndefined()
  })
})
