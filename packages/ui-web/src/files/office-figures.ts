/**
 * The pictures and charts of an Office file (docs/SPEC.md, section 9.7). A picture is shown from its own bytes when
 * the window can show its format, known from the bytes rather than the name; a chart is drawn from the values its
 * file kept when it was last saved, as the Chart block draws, so neither needs its app.
 */

import { type Archive, partOf, textOf } from './archive.ts'
import type { OfficeChart, OfficeFigure } from './office-text.ts'
import { xmlEvents } from './xml.ts'

/** The most figures a file shows, and the most bytes its pictures hold together: a preview, not the file. */
export const FIGURE_LIMIT = 200
export const PICTURE_BYTES_LIMIT = 64 * 1024 * 1024
/** The most series and points a chart draws. */
const SERIES_LIMIT = 6
const POINT_LIMIT = 200

const startsWith = (bytes: Uint8Array, ...values: number[]) => values.every((value, index) => bytes[index] === value)

/** The type of a picture the window shows, from its first bytes; none for a format it does not (EMF, WMF, TIFF). */
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
  private readonly archive: Archive

  constructor(archive: Archive) {
    this.archive = archive
  }

  /** The picture in a part of the archive, by its place in the list; none when there is no such part or no room. */
  async picture(part: string | undefined, alt: string, size: { width?: number | undefined; height?: number | undefined } = {}): Promise<number | undefined> {
    return this.add(JSON.stringify(['picture', part, alt, size.width, size.height]), async () => {
      const read = part === undefined ? undefined : partOf(this.archive, part)
      if (!read) return undefined
      const bytes = await read().catch(() => undefined)
      if (!bytes) return undefined
      const type = pictureType(bytes)
      if (type === undefined || this.bytes + bytes.length > PICTURE_BYTES_LIMIT) return { kind: 'unshown', alt, what: 'picture' }
      this.bytes += bytes.length
      return { kind: 'picture', type, bytes, alt, width: size.width, height: size.height }
    })
  }

  /** The chart in a part of the archive, read by `read` from its XML. */
  async chart(
    part: string | undefined,
    alt: string,
    read: (xml: string, archive: Archive, part: string) => Promise<OfficeChart | undefined>
  ): Promise<number | undefined> {
    return this.add(JSON.stringify(['chart', part, alt]), async () => {
      const xml = part === undefined ? undefined : await textOf(this.archive, part).catch(() => undefined)
      // An object that is no chart, an equation or a document within the document, shows nothing here.
      if (xml === undefined || part === undefined || !/<(c:chartSpace|chart:chart)\b/.test(xml)) return undefined
      const chart = await read(xml, this.archive, part)
      return chart ? { kind: 'chart', ...chart } : { kind: 'unshown', alt, what: 'chart' }
    })
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
function chartKind(name: string): OfficeChart['chart'] {
  const kind = name.replace(/^[a-z]+:/, '').toLowerCase()
  if (kind.startsWith('line') || kind.startsWith('scatter') || kind.startsWith('stock') || kind.startsWith('bubble')) return 'line'
  if (kind.startsWith('area') || kind.startsWith('surface')) return 'area'
  return 'bar'
}

/** A series as it is read: its name and its values and labels by their place. */
interface SeriesRead {
  name: string
  labels: Map<number, string>
  values: Map<number, number>
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
 * A chart of Word, Excel or PowerPoint (DrawingML, `c:chartSpace`), from the values each series kept: its title, the
 * kind of its first plot, and each series' name, categories and values, as cached when the file was saved.
 */
export async function readChart(xml: string): Promise<OfficeChart | undefined> {
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
      } else if (current && (name === 'c:val' || name === 'c:yVal')) reading = 'values'
      else if (name === 'c:lvl') levels++
      else if (name === 'c:pt') point = Number(event.attributes.idx ?? 0)
      else if (name === 'c:v' && reading) value = ''
    } else if (event.type === 'text') {
      if (value !== undefined) value += event.text
      else if (titleText) title += event.text
    } else {
      const name = event.name
      if (name === 'c:title') inTitle = false
      else if ((name === 'a:t' || name === 'c:v') && titleText) titleText = false
      else if (name === 'a:p' && inTitle) title += ' '
      else if (name === 'c:v' && value !== undefined && current && reading) {
        // A category of several levels is labelled by its first.
        if (reading === 'name') current.name ||= value
        else if (reading === 'labels' && levels <= 1 && Number.isInteger(point) && point >= 0) current.labels.set(point, value)
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
  const drawn = chartSeries(series)
  if (drawn.length === 0) return undefined
  return { title: title.replace(/\s+/g, ' ').trim(), chart: kind ?? 'bar', series: drawn }
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
  const drawn = chartSeries(series)
  if (drawn.length === 0) return undefined
  return { title: title.replace(/\s+/g, ' ').trim(), chart: kind, series: drawn }
}
