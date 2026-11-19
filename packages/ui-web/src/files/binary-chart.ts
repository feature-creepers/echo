/**
 * The charts of Excel 5 to 2003 workbooks (docs/SPEC.md, section 9.7), from the records of a chart's own part of the
 * workbook: an embedded chart's, which follows the object that places it on its sheet, or a chart sheet's. Each
 * series keeps the formulas naming its cells, and the values it drew when the file was saved, its categories as their
 * cells' formats show them; a series that kept none is read from the cells its formulas name. Drawn as the Chart block
 * draws, as the newer formats' charts are.
 */

import { generalNumber } from './number-format.ts'
import { type CellRange, chartKind, drawnChart, type SeriesRead } from './office-figures.ts'
import type { OfficeChart } from './office-text.ts'

/** A record of a chart: its type and what it holds. */
export interface ChartRecord {
  type: number
  body: Uint8Array
}

/** What a chart needs of its workbook to read its text, its numbers and its cells. */
export interface ChartContext {
  /** Whether the workbook is of Excel 5 or 95, whose text is in 8-bit characters and whose formulas are written otherwise. */
  five: boolean
  /** Text of 8-bit characters as the workbook writes it. */
  eight: (bytes: Uint8Array) => string
  /** A number as the format of a style shows it. */
  number: (value: number, style: number) => string
  /** The name of a sheet a formula names by its reference (`EXTERNSHEET`), when it is one of the workbook's own. */
  sheetName?: (reference: number) => string | undefined
  /** The cells of the workbook's sheets. */
  cells?: CellRange | undefined
}

/** The kind of plot each record of a chart's type starts. */
const KINDS: Record<number, string> = {
  4119: 'bar',
  4120: 'line',
  4121: 'pie',
  4122: 'area',
  4123: 'scatter',
  4158: 'radar',
  4159: 'surface',
  4160: 'radar',
  4149: 'pie'
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** A column's letters from its number: 0 is "A", 27 is "AB". */
const columnLetters = (column: number): string => {
  let letters = ''
  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters
  return letters
}

/**
 * The cells a chart's formula names, as a formula of the newer formats writes them (`'Sheet 1'!$B$2:$B$9`): its first
 * token, a cell or a block of a sheet by its reference. None for anything else, or for Excel 5 and 95's formulas.
 */
export function chartFormula(tokens: Uint8Array, context: Pick<ChartContext, 'five' | 'sheetName'>): string | undefined {
  if (context.five || tokens.length < 7) return undefined
  const data = view(tokens)
  const token = tokens[0] as number
  const area = token === 0x3b || token === 0x5b || token === 0x7b
  const cell = token === 0x3a || token === 0x5a || token === 0x7a
  if ((!area && !cell) || (area && tokens.length < 11)) return undefined
  const name = context.sheetName?.(data.getUint16(1, true))
  if (name === undefined) return undefined
  const sheet = `'${name.replace(/'/g, "''")}'`
  const at = (row: number, column: number) => `$${columnLetters(column & 0x3fff)}$${row + 1}`
  if (cell) return `${sheet}!${at(data.getUint16(3, true), data.getUint16(5, true))}`
  return `${sheet}!${at(data.getUint16(3, true), data.getUint16(7, true))}:${at(data.getUint16(5, true), data.getUint16(9, true))}`
}

/** A chart's text record (`SERIESTEXT`): its 8-bit or UTF-16 characters, as the workbook writes them. */
function seriesText(body: Uint8Array, context: ChartContext): string {
  if (body.length < 3) return ''
  const count = body[2] as number
  if (context.five) return context.eight(body.subarray(3, 3 + count))
  const wide = ((body[3] ?? 0) & 0x01) !== 0
  return wide ? new TextDecoder('utf-16le').decode(body.subarray(4, 4 + count * 2)) : context.eight(body.subarray(4, 4 + count))
}

/** A cell's text record (`LABEL`) among a chart's kept values. */
function labelText(body: Uint8Array, context: ChartContext): string {
  if (body.length < 8) return ''
  const count = view(body).getUint16(6, true)
  if (context.five) return context.eight(body.subarray(8, 8 + count))
  const wide = ((body[8] ?? 0) & 0x01) !== 0
  return wide ? new TextDecoder('utf-16le').decode(body.subarray(9, 9 + count * 2)) : context.eight(body.subarray(9, 9 + count))
}

/**
 * A chart of Excel 5 to 2003, from its records: the kind of its first plot, its title (a text linked to the chart),
 * each series (`SERIES`) with its name, written or named by a formula, and the formulas naming its values and
 * categories (`AI`), then the values each kept, by series and point, after an index saying what they are (`SIINDEX`).
 */
export function readOlderChart(records: readonly ChartRecord[], context: ChartContext): OfficeChart | undefined {
  const { title, kind, series } = chartParts(records, context)
  return drawnChart(title, kind, series, context.cells)
}

/** What a chart's records say: its title, the kind of its first plot, and its series as they were read. */
function chartParts(records: readonly ChartRecord[], context: ChartContext): { title: string; kind: OfficeChart['chart']; series: SeriesRead[] } {
  let kind: OfficeChart['chart'] | undefined
  let title = ''
  const series: SeriesRead[] = []
  let current: SeriesRead | undefined
  let seriesDepth = 0
  let text: { depth: number; words: string; title: boolean } | undefined
  let kept: number | undefined
  let depth = 0
  for (const { type, body } of records) {
    const data = view(body)
    if (type === 0x1033) depth++
    else if (type === 0x1034) {
      depth--
      if (text && depth < text.depth) {
        if (text.title) title ||= text.words
        text = undefined
      }
      if (current && depth < seriesDepth) current = undefined
    } else if (type === 0x1003) {
      current = { name: '', labels: new Map(), values: new Map() }
      series.push(current)
      seriesDepth = depth + 1
    } else if (type === 0x1025) text = { depth: depth + 1, words: '', title: false }
    else if (type === 0x1027 && text && body.length >= 2) text.title = data.getUint16(0, true) === 1
    else if (type === 0x100d) {
      if (text) text.words = seriesText(body, context)
      else if (current) current.name ||= seriesText(body, context)
    } else if (type === 0x1051 && current && body.length >= 8 && body[1] === 2) {
      // A formula naming the series' name, its values or its categories.
      const formula = chartFormula(body.subarray(8, 8 + data.getUint16(6, true)), context)
      const part = (['name', 'values', 'labels'] as const)[body[0] as number]
      if (formula !== undefined && part !== undefined) current.formulas = { ...current.formulas, [part]: formula }
    } else if (KINDS[type] !== undefined) kind ??= chartKind(KINDS[type])
    else if (type === 0x1065 && body.length >= 2) kept = data.getUint16(0, true)
    else if ((type === 0x0203 || type === 0x0204) && kept !== undefined && body.length >= 6) {
      // A value kept: its point, its series, and its number or text, a category as its cell's format shows it.
      const [point, index, style] = [data.getUint16(0, true), data.getUint16(2, true), data.getUint16(4, true)]
      const target = series[index]
      if (!target) continue
      const number = type === 0x0203 && body.length >= 14 ? data.getFloat64(6, true) : undefined
      if (kept === 1 && number !== undefined && Number.isFinite(number)) target.values.set(point, number)
      else if (kept === 2) target.labels.set(point, number === undefined ? labelText(body, context) : context.number(number, style))
    }
  }
  return { title, kind: kind ?? 'bar', series }
}

/** The most rows and columns of a sheet of data read for a chart of Microsoft Graph. */
const GRAPH_LIMIT = 1000

/**
 * A chart of Microsoft Graph, the app Word and PowerPoint 97 to 2003 embed charts of (`MSGraph.Chart.8`). Its
 * `Workbook` stream holds the chart's records, as Excel's do, and a sheet of data of its own in records of the
 * oldest kind (Excel 2's `NUMBER` and `LABEL`): the categories along its first row and each series along a row after
 * it, named in its first column; or the same by columns, as the series' names say.
 */
export function readGraphChart(stream: Uint8Array): OfficeChart | undefined {
  const data = view(stream)
  const decoder = new TextDecoder('windows-1252')
  const records: ChartRecord[] = []
  const sheet = new Map<string, { text: string; number?: number }>()
  let rows = 0
  let columns = 0
  for (let at = 0; at + 4 <= stream.length; ) {
    const type = data.getUint16(at, true)
    const size = data.getUint16(at + 2, true)
    if (at + 4 + size > stream.length) break
    const body = stream.subarray(at + 4, at + 4 + size)
    if ((type === 0x0003 && size >= 15) || (type === 0x0004 && size >= 9)) {
      const [row, column] = [data.getUint16(at + 4, true), data.getUint16(at + 6, true)]
      if (row < GRAPH_LIMIT && column < GRAPH_LIMIT) {
        const number = type === 0x0003 ? data.getFloat64(at + 11, true) : undefined
        // Text is its length, then whether it is in UTF-16 or 8-bit characters, then its characters.
        const count = body[7] as number
        const wide = ((body[8] ?? 0) & 0x01) !== 0
        const words = () => (wide ? new TextDecoder('utf-16le').decode(body.subarray(9, 9 + count * 2)) : decoder.decode(body.subarray(9, 9 + count)))
        const text = number === undefined ? words() : generalNumber(number)
        sheet.set(`${row},${column}`, number === undefined || !Number.isFinite(number) ? { text } : { text, number })
        rows = Math.max(rows, row + 1)
        columns = Math.max(columns, column + 1)
      }
    } else records.push({ type, body })
    at += 4 + size
  }
  const { title, kind, series } = chartParts(records, { five: false, eight: (bytes) => decoder.decode(bytes), number: generalNumber })
  // The series run along the sheet's rows unless their names head its columns.
  const named = (index: number, along: boolean) => (along ? sheet.get(`0,${index + 1}`) : sheet.get(`${index + 1},0`))?.text
  const byColumns =
    series.length > 0 && series.every((one, index) => one.name === named(index, true)) && !series.every((one, index) => one.name === named(index, false))
  series.forEach((one, index) => {
    one.name ||= named(index, byColumns) ?? ''
    if (one.values.size > 0) return
    for (let point = 0; point < (byColumns ? rows : columns) - 1; point++) {
      const value = byColumns ? sheet.get(`${point + 1},${index + 1}`) : sheet.get(`${index + 1},${point + 1}`)
      const label = byColumns ? sheet.get(`${point + 1},0`) : sheet.get(`0,${point + 1}`)
      if (value?.number !== undefined) one.values.set(point, value.number)
      if (label) one.labels.set(point, label.text)
    }
  })
  return drawnChart(title, kind, series)
}
