/**
 * The objects of other apps a sheet of an Excel workbook of 2007 or later holds (docs/SPEC.md, section 9.7). The sheet
 * lists each (`oleObjects`): its program, its part, and in Excel 2010 and later the picture Excel last drew of it
 * (`objectPr`). Excel also draws each as a shape of the sheet's drawing for older apps (VML, its `legacyDrawing`),
 * which keeps that picture and the object's size, and Excel 2010 places each in the sheet's own drawing by that shape's
 * identifier (`a14:compatExt`).
 */

import { type Archive, relationships, textOf } from './archive.ts'
import { lengthPixels } from './office-figures.ts'
import type { CellAnchor, CellPoint } from './office-text.ts'
import { xmlEvents } from './xml.ts'

/** An object of another app as a sheet holds it: the shape it is drawn as, its program, its part, its picture and size. */
export interface SheetObject {
  /** The identifier of the shape Excel draws it as, by which the sheet's drawing places it. */
  shape: number
  program: string
  part: string | undefined
  /** The part of the picture Excel last drew of it. */
  picture: string | undefined
  width?: number | undefined
  height?: number | undefined
  /** Whether it is shown as its program's icon rather than its content. */
  icon: boolean
  /** Where it is on the sheet's cells. */
  anchor?: CellAnchor | undefined
}

/**
 * Where an object is on the cells, as the shape of the drawing for older apps keeps it (`x:Anchor`): its first column,
 * the pixels into it, its first row, the pixels into it, then the same of its last cell.
 */
export function vmlAnchor(text: string): CellAnchor | undefined {
  const values = text.split(',').map((value) => Number(value.trim()))
  if (values.length !== 8 || values.some((value) => !Number.isInteger(value) || value < 0)) return undefined
  const [column, x, row, y, lastColumn, lastX, lastRow, lastY] = values as [number, number, number, number, number, number, number, number]
  return { from: { column, x: x * 0.75, row, y: y * 0.75 }, to: { column: lastColumn, x: lastX * 0.75, row: lastRow, y: lastY * 0.75 } }
}

/** The number of a shape as VML names it (`_x0000_s1025`) and Excel 2010's drawing does (`spid`). */
export const shapeNumber = (name: string | undefined): number | undefined => {
  const found = /_x0000_s(\d+)$/.exec(name ?? '')?.[1]
  return found === undefined ? undefined : Number(found)
}

/** The most objects a sheet's are read for: a preview, not the workbook. */
const OBJECT_LIMIT = 200

/**
 * The objects of other apps a sheet holds, in the order of its list, from its part's XML and its relationships' targets.
 * Each object listed twice, for newer apps and for older ones (`mc:AlternateContent`), is read once.
 */
export async function sheetObjects(archive: Archive, xml: string, targets: ReadonlyMap<string, string>): Promise<SheetObject[]> {
  const listed = xml.indexOf('<oleObjects')
  if (listed < 0) return []
  const objects = new Map<number, SheetObject>()
  let current: SheetObject | undefined
  // Excel 2010's own properties anchor an object on the cells: its first and last cells, in English Metric Units.
  let point: CellPoint | undefined
  let part: 'column' | 'row' | 'x' | 'y' | undefined
  for (const event of xmlEvents(xml.slice(listed))) {
    if (event.type === 'close' && event.name === 'oleObjects') break
    if (event.type === 'text' && point && part) {
      const value = Number(event.text.trim())
      if (Number.isFinite(value)) point[part] = part === 'x' || part === 'y' ? value / 12_700 : value
      continue
    }
    if (event.type === 'close') {
      if ((event.name === 'from' || event.name === 'to') && point && current) {
        current.anchor = event.name === 'from' ? { ...current.anchor, from: point } : { ...current.anchor, to: point }
        point = undefined
      } else part = undefined
      continue
    }
    if (event.type !== 'open') continue
    if (current && (event.name === 'from' || event.name === 'to')) point = { row: 0, column: 0, x: 0, y: 0 }
    else if (point) part = ({ 'xdr:col': 'column', 'xdr:row': 'row', 'xdr:colOff': 'x', 'xdr:rowOff': 'y' } as const)[event.name]
    else if (event.name === 'oleObject') {
      const shape = Number(event.attributes.shapeId)
      current = undefined
      if (!Number.isInteger(shape) || objects.has(shape) || objects.size >= OBJECT_LIMIT) continue
      current = {
        shape,
        program: event.attributes.progId ?? '',
        part: targets.get(event.attributes['r:id'] ?? ''),
        picture: undefined,
        icon: event.attributes.dvAspect === 'DVASPECT_ICON'
      }
      objects.set(shape, current)
    } else if (event.name === 'objectPr' && current) current.picture = targets.get(event.attributes['r:id'] ?? '')
  }
  if (objects.size === 0) return []
  // The drawing for older apps keeps each object's size, and its picture when Excel 2007 wrote the workbook.
  const legacy = targets.get(/<legacyDrawing\b[^>]*\br:id="([^"]*)"/.exec(xml)?.[1] ?? '')
  const vml = legacy === undefined ? undefined : await textOf(archive, legacy).catch(() => undefined)
  if (vml !== undefined && legacy !== undefined) {
    const pictures = await relationships(archive, legacy)
    let shape: SheetObject | undefined
    let anchored = false
    for (const event of xmlEvents(vml)) {
      if (event.type === 'open' && event.name === 'x:Anchor') anchored = true
      else if (event.type === 'close' && event.name === 'x:Anchor') anchored = false
      else if (event.type === 'text' && anchored && shape) shape.anchor ??= vmlAnchor(event.text)
      if (event.type === 'open' && event.name === 'v:shape') {
        shape = objects.get(shapeNumber(event.attributes.id) ?? -1)
        if (!shape) continue
        const style = event.attributes.style ?? ''
        shape.width = lengthPixels(/(?:^|;)\s*width:([^;]+)/.exec(style)?.[1])
        shape.height = lengthPixels(/(?:^|;)\s*height:([^;]+)/.exec(style)?.[1])
      } else if (event.type === 'open' && event.name === 'v:imagedata' && shape)
        shape.picture ??= pictures.get(event.attributes['o:relid'] ?? event.attributes['r:id'] ?? '')
      else if (event.type === 'close' && event.name === 'v:shape') shape = undefined
    }
  }
  return [...objects.values()]
}
