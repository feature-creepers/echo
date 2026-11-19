/**
 * The charts of Excel 5 to 2003 workbooks (docs/SPEC.md, section 9.7), from the records of a chart's own part of the
 * workbook: an embedded chart's, which follows the object that places it on its sheet, or a chart sheet's. Each
 * series keeps the formulas naming its cells, and the values it drew when the file was saved, its categories as their
 * cells' formats show them; a series that kept none is read from the cells its formulas name. Drawn as the Chart block
 * draws, as the newer formats' charts are.
 */

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
  return drawnChart(title, kind ?? 'bar', series, context.cells)
}
