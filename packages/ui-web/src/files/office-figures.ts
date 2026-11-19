/**
 * The pictures and charts of an Office file (docs/SPEC.md, section 9.7). A picture is shown from its own bytes when
 * the window can show its format, known from the bytes rather than the name, and a metafile (EMF, WMF) is drawn as
 * SVG (`metafile.ts`); a chart is drawn from the values its file kept when it was last saved, as the Chart block
 * draws, so neither needs its app.
 */

import { type Archive, partOf, textOf } from './archive.ts'
import { openCompound } from './compound.ts'
import { objectEquation } from './equation-editor.ts'
import { drawMetafile, shownSize } from './metafile.ts'
import { formatNumber, type NumberFormatOptions } from './number-format.ts'
import type { OfficeChart, OfficeFigure } from './office-text.ts'
import { xmlEvents } from './xml.ts'

/** The most figures a file shows, and the most bytes its pictures hold together: a preview, not the file. */
export const FIGURE_LIMIT = 200
export const PICTURE_BYTES_LIMIT = 64 * 1024 * 1024
/** A cell's value as a chart reads it: what the sheet shows, and its number when it holds one. */
export interface CellValue {
  text: string
  number?: number | undefined
}

/** The values of the cells a formula names, `Sheet1!$B$2:$B$5`, in order; none for a formula naming no cells read. */
export type CellRange = (formula: string) => CellValue[] | undefined

/**
 * The cells a chart's formulas name, found from its part and its XML, read only when a series kept no values: a
 * workbook's own sheets, or the workbook a document or a presentation keeps inside itself for a chart.
 */
export type CellSource = (chart: { part: string; xml: string }) => Promise<CellRange | undefined>

/** The most cells a chart's formula is read for. */
const RANGE_LIMIT = 1000

/** A column's number from its letters: "A" is 0, "AB" is 27. */
const columnNumber = (letters: string) => [...letters.toUpperCase()].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0) - 1

/**
 * The cells of a workbook's sheets, by sheet name, as a range a chart's formula names reads them: a cell or a block of
 * them, `'Sheet 1'!$A$2:$B$9`, its sheet's name in quotes when it has to be, row by row.
 */
export function cellRange(sheets: ReadonlyMap<string, ReadonlyMap<string, CellValue>>): CellRange {
  const folded = new Map([...sheets].map(([name, cells]) => [name.toLowerCase(), cells]))
  return (formula) => {
    const match = /^\(?(?:'((?:[^']|'')+)'|([^!'(),]+))!\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?\)?$/i.exec(formula.trim())
    if (!match) return undefined
    const name = match[1]?.replace(/''/g, "'") ?? match[2] ?? ''
    const cells = sheets.get(name) ?? folded.get(name.toLowerCase())
    if (!cells) return undefined
    const [fromColumn, fromRow] = [columnNumber(match[3] as string), Number(match[4]) - 1]
    const [toColumn, toRow] = match[5] === undefined ? [fromColumn, fromRow] : [columnNumber(match[5]), Number(match[6]) - 1]
    const values: CellValue[] = []
    for (let row = Math.min(fromRow, toRow); row <= Math.max(fromRow, toRow); row++)
      for (let column = Math.min(fromColumn, toColumn); column <= Math.max(fromColumn, toColumn); column++) {
        if (values.length >= RANGE_LIMIT) return values
        values.push(cells.get(`${row},${column}`) ?? { text: '' })
      }
    return values
  }
}

/** The most series and points a chart draws. */
const SERIES_LIMIT = 6
const POINT_LIMIT = 200

const startsWith = (bytes: Uint8Array, ...values: number[]) => values.every((value, index) => bytes[index] === value)

/** The type of a picture the window shows, from its first bytes; none for a format it does not (EMF, WMF, TIFF), which are drawn or left out. */
export function pictureType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (startsWith(bytes, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (startsWith(bytes, 0x42, 0x4d)) return 'image/bmp'
  if (startsWith(bytes, 0x52, 0x49, 0x46, 0x46) && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  const start = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart()
  if (start.startsWith('<') && /<svg[\s>]/.test(start)) return 'image/svg+xml'
  return undefined
}

/** English Metric Units, the Office formats' length, in the window's pixels: 914,400 to the inch, 96 pixels to it. */
export const emuPixels = (value: string | undefined): number | undefined => {
  const emu = Number(value)
  return Number.isFinite(emu) && emu > 0 ? Math.round(emu / 9525) : undefined
}

const UNIT_PIXELS: Record<string, number> = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, px: 1 }

/** A length as OpenDocument and VML write it ("2.5cm", "72pt") in the window's pixels. */
export const lengthPixels = (value: string | undefined): number | undefined => {
  const match = /^\s*([\d.]+)\s*(in|cm|mm|pt|pc|px)\s*$/.exec(value ?? '')
  if (!match) return undefined
  const pixels = Number(match[1]) * (UNIT_PIXELS[match[2] as string] ?? 1)
  return Number.isFinite(pixels) && pixels > 0 ? Math.round(pixels) : undefined
}

/**
 * The figures of a file as they are found, each part read once: the same picture placed twice is one figure. Past the
 * limits, a figure is left out.
 */
export class Figures {
  readonly list: OfficeFigure[] = []
  private bytes = 0
  private readonly found = new Map<string, number>()
  private readonly equations = new Map<string, Promise<string | undefined>>()
  private readonly archive: Archive
  private readonly options: NumberFormatOptions
  private readonly cells: CellSource | undefined

  /** The figures of a file, its numbers written as `options` says, its charts' formulas read from `cells` when given. */
  constructor(archive: Archive, options: NumberFormatOptions = {}, cells?: CellSource) {
    this.archive = archive
    this.options = options
    this.cells = cells
  }

  /** The picture in a part of the archive, by its place in the list; none when there is no such part or no room. */
  async picture(part: string | undefined, alt: string, size: { width?: number | undefined; height?: number | undefined } = {}): Promise<number | undefined> {
    return this.add(JSON.stringify(['picture', part, alt, size.width, size.height]), async () => {
      const read = part === undefined ? undefined : partOf(this.archive, part)
      if (!read) return undefined
      const bytes = await read().catch(() => undefined)
      if (!bytes) return undefined
      const type = pictureType(bytes)
      if (type !== undefined) {
        if (this.bytes + bytes.length > PICTURE_BYTES_LIMIT) return { kind: 'unshown', alt, what: 'picture' }
        this.bytes += bytes.length
        return { kind: 'picture', type, bytes, alt, width: size.width, height: size.height }
      }
      // A metafile is drawn as SVG, at the size the file gives it, else its own.
      const drawn = drawMetafile(bytes)
      if (!drawn || this.bytes + drawn.svg.length > PICTURE_BYTES_LIMIT) return { kind: 'unshown', alt, what: 'picture' }
      this.bytes += drawn.svg.length
      return {
        kind: 'picture',
        type: 'image/svg+xml',
        bytes: drawn.svg,
        alt,
        ...shownSize(size, drawn)
      }
    })
  }

  /** The chart in a part of the archive, read by `read` from its XML. */
  async chart(
    part: string | undefined,
    alt: string,
    read: (xml: string, options: NumberFormatOptions, cells?: () => Promise<CellRange | undefined>) => Promise<OfficeChart | undefined>
  ): Promise<number | undefined> {
    return this.add(JSON.stringify(['chart', part, alt]), async () => {
      const xml = part === undefined ? undefined : await textOf(this.archive, part).catch(() => undefined)
      // An object that is no chart, an equation or a document within the document, shows nothing here.
      if (xml === undefined || part === undefined || !/<(c:chartSpace|chart:chart)\b/.test(xml)) return undefined
      const source = this.cells
      // The cells are read only when a series asks for them, and a workbook that cannot be read names none.
      const cells = source && (() => source({ part, xml }).catch(() => undefined))
      const chart = await read(xml, this.options, cells)
      return chart ? { kind: 'chart', ...chart } : { kind: 'unshown', alt, what: 'chart' }
    })
  }

  /**
   * The equation an object of Equation Editor or MathType keeps in a part of the archive (`oleObject1.bin`, a compound
   * file of its own), as linear text, read once; none for another object or one that cannot be read.
   */
  equation(part: string | undefined): Promise<string | undefined> {
    if (part === undefined) return Promise.resolve(undefined)
    let read = this.equations.get(part)
    if (!read) {
      const bytes = partOf(this.archive, part)
      read = bytes
        ? bytes().then(
            (object) => {
              try {
                return objectEquation(openCompound(object))
              } catch {
                return undefined
              }
            },
            () => undefined
          )
        : Promise.resolve(undefined)
      this.equations.set(part, read)
    }
    return read
  }

  private async add(key: string, make: () => Promise<OfficeFigure | undefined>): Promise<number | undefined> {
    const known = this.found.get(key)
    if (known !== undefined) return known
    if (this.list.length >= FIGURE_LIMIT) return undefined
    const figure = await make()
    if (!figure) return undefined
    this.list.push(figure)
    this.found.set(key, this.list.length - 1)
    return this.list.length - 1
  }
}

/** How each kind of chart is drawn: amounts compared as bars, a course as a line, a filled course as an area. */
export function chartKind(name: string): OfficeChart['chart'] {
  const kind = name.replace(/^[a-z]+:/, '').toLowerCase()
  if (kind.startsWith('line') || kind.startsWith('scatter') || kind.startsWith('stock') || kind.startsWith('bubble')) return 'line'
  if (kind.startsWith('area') || kind.startsWith('surface')) return 'area'
  return 'bar'
}

/** A series as it is read: its name and its values and labels by their place, and the formulas naming their cells. */
export interface SeriesRead {
  name: string
  labels: Map<number, string>
  values: Map<number, number>
  formulas?: { name?: string; labels?: string; values?: string }
}

/** Whether a series kept none of what its formulas name: its values, its labels or its name. */
const wantsCells = ({ formulas, values, labels, name }: SeriesRead): boolean =>
  formulas !== undefined &&
  ((values.size === 0 && formulas.values !== undefined) || (labels.size === 0 && formulas.labels !== undefined) || (name === '' && formulas.name !== undefined))

/** A series' name, labels and values that its chart kept none of, read from the cells its formulas name. */
function fromCells(series: SeriesRead, cells: CellRange | undefined): void {
  const { formulas } = series
  if (!cells || !formulas) return
  if (series.values.size === 0 && formulas.values)
    cells(formulas.values)?.forEach((cell, at) => {
      if (cell.number !== undefined) series.values.set(at, cell.number)
    })
  if (series.labels.size === 0 && formulas.labels)
    cells(formulas.labels)?.forEach((cell, at) => {
      series.labels.set(at, cell.text)
    })
  if (series.name === '' && formulas.name) series.name = cells(formulas.name)?.[0]?.text ?? ''
}

/** The series read as the Chart block draws them: the points with a value, labelled by their category, or their place. */
function chartSeries(read: readonly SeriesRead[]): OfficeChart['series'] {
  return read
    .slice(0, SERIES_LIMIT)
    .map((series, index) => {
      const points = [...series.values.entries()]
        .sort(([one], [other]) => one - other)
        .slice(0, POINT_LIMIT)
        .map(([at, y]) => ({ x: series.labels.get(at) ?? read[0]?.labels.get(at) ?? String(at + 1), y }))
      return { name: series.name.trim() || `Series ${index + 1}`, points }
    })
    .filter((series) => series.points.length > 0)
}

/**
 * A chart as the Chart block draws it, from its series as read: a series that kept none of its values, labels or
 * name takes them from the cells its formulas name, when `cells` reads them. None when no series has a point.
 */
export function drawnChart(title: string, kind: OfficeChart['chart'], series: SeriesRead[], cells?: CellRange): OfficeChart | undefined {
  for (const one of series) fromCells(one, cells)
  const drawn = chartSeries(series)
  if (drawn.length === 0) return undefined
  return { title: title.replace(/\s+/g, ' ').trim(), chart: kind, series: drawn }
}

/**
 * A chart of Word, Excel or PowerPoint (DrawingML, `c:chartSpace`), from the values each series kept: its title, the
 * kind of its first plot, and each series' name, categories and values, as cached when the file was saved. A series
 * that kept none, as some programs write them, is read from the cells its formulas name, when `cells` gives them.
 */
export async function readChart(
  xml: string,
  options: NumberFormatOptions = {},
  cells?: () => Promise<CellRange | undefined>
): Promise<OfficeChart | undefined> {
  let title = ''
  let inTitle = false
  let titleText = false
  let plotted = false
  let kind: OfficeChart['chart'] | undefined
  const series: SeriesRead[] = []
  let current: SeriesRead | undefined
  let reading: 'name' | 'labels' | 'values' | undefined
  let point = 0
  let levels = 0
  let value: string | undefined
  // Categories kept as numbers are labelled as their format shows them: dates, most often.
  let format: string | undefined
  let formula: string | undefined
  for (const event of xmlEvents(xml)) {
    if (event.type === 'open') {
      const name = event.name
      if (name === 'c:plotArea') plotted = true
      else if (name === 'c:title' && !plotted) inTitle = true
      // A title's words, written or kept from a cell, and not the formula naming the cell.
      else if (inTitle && (name === 'a:t' || name === 'c:v')) titleText = true
      else if (plotted && current === undefined && /^c:\w+Chart$/.test(name)) kind ??= chartKind(name)
      else if (name === 'c:ser') current = { name: '', labels: new Map(), values: new Map() }
      else if (current && name === 'c:tx') reading = 'name'
      else if (current && (name === 'c:cat' || name === 'c:xVal')) {
        reading = 'labels'
        levels = 0
        format = undefined
      } else if (current && (name === 'c:val' || name === 'c:yVal')) reading = 'values'
      else if (name === 'c:lvl') levels++
      else if (name === 'c:pt') point = Number(event.attributes.idx ?? 0)
      else if ((name === 'c:v' || name === 'c:formatCode') && reading) value = ''
      else if (name === 'c:f' && reading) formula = ''
    } else if (event.type === 'text') {
      if (value !== undefined) value += event.text
      else if (formula !== undefined) formula += event.text
      else if (titleText) title += event.text
    } else {
      const name = event.name
      if (name === 'c:title') inTitle = false
      else if ((name === 'a:t' || name === 'c:v') && titleText) titleText = false
      else if (name === 'a:p' && inTitle) title += ' '
      else if (name === 'c:f' && formula !== undefined) {
        if (current && reading) current.formulas = { ...current.formulas, [reading]: formula }
        formula = undefined
      } else if (name === 'c:formatCode' && value !== undefined) {
        if (reading === 'labels') format = value
        value = undefined
      } else if (name === 'c:v' && value !== undefined && current && reading) {
        // A category of several levels is labelled by its first.
        if (reading === 'name') current.name ||= value
        else if (reading === 'labels' && levels <= 1 && Number.isInteger(point) && point >= 0)
          current.labels.set(
            point,
            format !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? formatNumber(Number(value), format, options) : value
          )
        else if (reading === 'values' && Number.isInteger(point) && point >= 0 && value.trim() !== '' && Number.isFinite(Number(value)))
          current.values.set(point, Number(value))
        value = undefined
      } else if (name === 'c:tx' || name === 'c:cat' || name === 'c:xVal' || name === 'c:val' || name === 'c:yVal') reading = undefined
      else if (name === 'c:ser' && current) {
        series.push(current)
        current = undefined
      }
    }
  }
  return drawnChart(title, kind ?? 'bar', series, cells && series.some(wantsCells) ? await cells() : undefined)
}

/**
 * A chart of OpenDocument, from its own part (`Object 1/content.xml`): its class, its title, and the table of values it
 * keeps, whose first column labels the categories and whose first row names the series.
 */
export async function readOpenChart(xml: string): Promise<OfficeChart | undefined> {
  let kind: OfficeChart['chart'] = 'bar'
  let title = ''
  let inTitle = false
  const rows: string[][] = []
  let row: string[] | undefined
  let cell: { text: string; value: string | undefined; repeated: number } | undefined
  let inTable = false
  for (const event of xmlEvents(xml)) {
    if (event.type === 'open') {
      if (event.name === 'chart:chart') kind = chartKind(event.attributes['chart:class'] ?? 'chart:bar')
      else if (event.name === 'chart:title') inTitle = true
      else if (event.name === 'table:table') inTable = true
      else if (event.name === 'table:table-row' && inTable) row = []
      else if ((event.name === 'table:table-cell' || event.name === 'table:covered-table-cell') && row) {
        const repeated = Number(event.attributes['table:number-columns-repeated'] ?? 1)
        cell = { text: '', value: event.attributes['office:value'], repeated: Number.isInteger(repeated) && repeated > 0 ? Math.min(repeated, 50) : 1 }
      }
    } else if (event.type === 'text') {
      if (cell) cell.text += event.text
      else if (inTitle) title += event.text
    } else if (event.name === 'chart:title') inTitle = false
    else if ((event.name === 'table:table-cell' || event.name === 'table:covered-table-cell') && cell && row) {
      for (let copy = 0; copy < cell.repeated; copy++) row.push(cell.value ?? cell.text.trim())
      cell = undefined
    } else if (event.name === 'table:table-row' && row) {
      if (rows.length < POINT_LIMIT + 1) rows.push(row)
      row = undefined
    } else if (event.name === 'table:table') inTable = false
  }
  const [head = [], ...body] = rows
  const series: SeriesRead[] = head.slice(1).map((name, index) => {
    const values = new Map<number, number>()
    const labels = new Map<number, string>()
    body.forEach((line, at) => {
      const value = line[index + 1]
      if (value !== undefined && value.trim() !== '' && Number.isFinite(Number(value))) values.set(at, Number(value))
      labels.set(at, line[0] ?? String(at + 1))
    })
    return { name, labels, values }
  })
  return drawnChart(title, kind, series)
}
