/**
 * The conditional formats of a sheet of an Excel workbook of 97 to 2003 (docs/SPEC.md, section 9.7), read into
 * `conditional-formats.ts` from the records `binary-office.ts` keeps: each block's header (`CFHEADER`), the cells it
 * applies to, then its conditions (`CF`), up to three, each a comparison of the cell's value or a formula, in the tokens
 * of Excel 97, with the font, borders and fill it sets; of a block's conditions, the first that holds applies. Excel
 * 2007 adds the order of each and whether it stops the others (`CFEx`), and blocks of its own rules (`CONDFMT12`,
 * `CF12`): the same, its templates, scales of colours, data bars, filters of the highest or lowest, and icon sets.
 */

import { reader } from './binary-records.ts'
import type { Block, Condition, ConditionRule, DatePeriod, Threshold } from './conditional-formats.ts'
import type { BorderLook, Sides, TextLook } from './document-look.ts'
import { EXCEL_LINES } from './older-sheet-look.ts'
import { type Formula, type Place, readFormulaTokens } from './sheet-formula.ts'
import { type ConditionLook, paletteColor, tinted, type WorkbookColors } from './sheet-look.ts'

/** A record of a sheet's conditional formats, by its type. */
export interface ConditionRecord {
  type: number
  bytes: Uint8Array
}

const COMPARISONS: readonly (Extract<ConditionRule, { kind: 'compare' }>['operator'] | undefined)[] = [
  undefined,
  'between',
  'notBetween',
  '=',
  '<>',
  '>',
  '<',
  '>=',
  '<='
]

/** What a condition sets (`DXFN`): only what it does not mark as unchanged, each part present by its flag. */
function lookOf(bytes: Uint8Array, from: number, colors: Pick<WorkbookColors, 'palette'>): { look: ConditionLook; end: number } {
  const record = reader(bytes)
  const flags = record.u32(from)
  const more = record.u16(from + 4)
  const unchanged = (bit: number) => (flags & (1 << bit)) !== 0
  // Colours from 64 on are the system's: the text's automatic one.
  const color = (index: number) => (index >= 0 && index < 64 ? paletteColor(index, colors) : undefined)
  const look: ConditionLook = {}
  let at = from + 6
  // A number format, its own or Excel's by its number, which the look leaves out.
  if (flags & 0x0200_0000) at += more & 0x0001 ? record.u16(at) : 2
  if (flags & 0x0400_0000) {
    const text: TextLook = {}
    const style = record.u32(at + 68)
    const same = record.u32(at + 88)
    if (!(same & 0x02)) text.italic = (style & 0x02) !== 0
    if (!(same & 0x80)) text.struck = (style & 0x80) !== 0
    if (record.u32(at + 100) === 0) text.bold = record.u16(at + 72) >= 600
    if (record.u32(at + 96) === 0) {
      const underline = record.u8(at + 76)
      text.underline = underline === 0 ? undefined : underline === 2 || underline === 0x22 ? 'double' : 'solid'
    }
    const ink = record.i32(at + 80)
    if (ink !== -1 && color(ink)) text.color = color(ink)
    if (Object.keys(text).length > 0) look.text = text
    at += 118
  }
  if (flags & 0x0800_0000) at += 8
  if (flags & 0x1000_0000) {
    const [lines, inks] = [record.u32(at), record.u32(at + 4)]
    const side = (kind: number, ink: number): BorderLook => {
      const line = EXCEL_LINES[kind]
      return line ? { ...line, color: color(ink) ?? '#000000' } : { width: 0, style: 'solid', color: '#000000' }
    }
    const borders: Sides<BorderLook> = {}
    if (!unchanged(10)) borders.left = side(lines & 0x0f, (lines >>> 16) & 0x7f)
    if (!unchanged(11)) borders.right = side((lines >>> 4) & 0x0f, (lines >>> 23) & 0x7f)
    if (!unchanged(12)) borders.top = side((lines >>> 8) & 0x0f, inks & 0x7f)
    if (!unchanged(13)) borders.bottom = side((lines >>> 12) & 0x0f, (inks >>> 7) & 0x7f)
    if (Object.keys(borders).length > 0) look.borders = borders
    at += 8
  }
  if (flags & 0x2000_0000) {
    const pattern = (record.u16(at) >>> 10) & 0x3f
    const inks = record.u16(at + 2)
    // A solid fill is in its background colour, unlike a style's; no pattern at all is no fill.
    const fill = !unchanged(18) ? color((inks >>> 7) & 0x7f) : !unchanged(17) ? color(inks & 0x7f) : undefined
    if (unchanged(16) || pattern !== 0) {
      if (fill) look.fill = fill
    }
    at += 4
  }
  if (flags & 0x4000_0000) at += 2
  return { look, end: at }
}

/** The sets of icons of Excel 2007, by their number. */
const ICON_SETS = [
  '3Arrows',
  '3ArrowsGray',
  '3Flags',
  '3TrafficLights1',
  '3Signs',
  '3TrafficLights2',
  '3Symbols',
  '3Symbols2',
  '4Arrows',
  '4ArrowsGray',
  '4RedToBlack',
  '4Rating',
  '4TrafficLights',
  '5Arrows',
  '5ArrowsGray',
  '5Rating',
  '5Quarters'
]

/** The periods of a date's template, by its number. */
const PERIODS = new Map<number, DatePeriod>([
  [0x0f, 'today'],
  [0x10, 'tomorrow'],
  [0x11, 'yesterday'],
  [0x12, 'last7Days'],
  [0x13, 'lastMonth'],
  [0x14, 'nextMonth'],
  [0x15, 'thisWeek'],
  [0x16, 'nextWeek'],
  [0x17, 'lastWeek'],
  [0x18, 'thisMonth']
])

type RecordReader = ReturnType<typeof reader>

/** A colour of Excel 2007 (`CFColor`): of the palette, in full, or of the theme with its tint; none for the automatic one. */
function colorAt(record: RecordReader, at: number, colors: Pick<WorkbookColors, 'palette' | 'theme'>): string | undefined {
  const kind = record.u32(at)
  const value = record.u32(at + 4)
  if (kind === 1) return value < 64 ? paletteColor(value, colors) : undefined
  if (kind === 2)
    return `#${[0, 1, 2]
      .map((part) =>
        record
          .u8(at + 4 + part)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`
  if (kind !== 3) return undefined
  // The theme's first four colours come dark then light, which the theme keeps light then dark.
  const theme = colors.theme[value < 4 ? ([1, 0, 3, 2][value] ?? value) : value]
  return theme === undefined ? undefined : tinted(theme, record.f64(at + 8))
}

/** A threshold of Excel 2007 (`CFVO`), and where what follows it starts: a number, given or by a formula, or the lowest or highest. */
function thresholdAt(record: RecordReader, at: number, anchor: Place): { threshold: Threshold | undefined; end: number } {
  const kind = record.u8(at)
  const size = record.u16(at + 1)
  const formula = size > 0 ? readFormulaTokens(record.bytes(at + 3, size), anchor) : undefined
  const given = size > 0 || kind === 2 || kind === 3 ? undefined : record.f64(at + 3)
  const end = at + 3 + size + (given === undefined ? 0 : 8)
  const value: Formula | undefined = formula ?? (given === undefined ? undefined : { kind: 'value', value: given })
  if (kind === 2) return { threshold: { kind: 'lowest' }, end }
  if (kind === 3) return { threshold: { kind: 'highest' }, end }
  if (!value) return { threshold: undefined, end }
  return { threshold: { kind: kind === 4 ? 'percent' : kind === 5 ? 'percentile' : 'number', value }, end }
}

/** The first text a formula holds, as Excel's templates of text write theirs (`SEARCH("late",A1)`). */
function textIn(formula: Formula): string | undefined {
  if (formula.kind === 'value') return typeof formula.value === 'string' ? formula.value : undefined
  const parts =
    formula.kind === 'unary' ? [formula.operand] : formula.kind === 'binary' ? [formula.left, formula.right] : formula.kind === 'call' ? formula.operands : []
  for (const part of parts) {
    const found = textIn(part)
    if (found !== undefined) return found
  }
  return undefined
}

/** A rule's kind and comparison, its formulas, its template, and where its own part starts (`rgbCT`). */
interface RuleParts {
  kind: number
  comparison: number
  formulas: (Formula | undefined)[]
  template: number
  /** Where the template's parameters are, and the rule's own part. */
  parameters: number
  own: number
}

/**
 * A rule of Excel 97 or 2007 after its look: its comparison or formula, its template where it says more than its
 * formula, or its scale, data bar, filter or icon set.
 */
function ruleOf(
  record: RecordReader,
  parts: RuleParts,
  context: { look: ConditionLook; anchor: Place; colors: Pick<WorkbookColors, 'palette' | 'theme'> }
): ConditionRule | undefined {
  const { look, anchor, colors } = context
  const { kind, comparison, template, own } = parts
  const [first, second] = parts.formulas
  if (kind === 1) {
    const operator = COMPARISONS[comparison]
    const operands = operator === 'between' || operator === 'notBetween' ? [first, second] : [first]
    return operator && operands.every(Boolean) ? { kind: 'compare', operator, operands: operands as Formula[], look } : undefined
  }
  if (kind === 2) {
    const period = PERIODS.get(template)
    if (template === 0x07 || template === 0x1b) return { kind: 'repeated', unique: template === 0x07, look }
    if (template === 0x09 || template === 0x0a) return { kind: 'blank', blank: template === 0x09, look }
    if (template === 0x0b || template === 0x0c) return { kind: 'error', error: template === 0x0b, look }
    if (period) return { kind: 'date', period, look }
    if ([0x19, 0x1a, 0x1d, 0x1e].includes(template))
      return { kind: 'average', above: template === 0x19 || template === 0x1d, equal: template >= 0x1d, deviations: record.u16(parts.parameters), look }
    const text = first && template === 0x08 ? textIn(first) : undefined
    const test = (['contains', 'notContains', 'beginsWith', 'endsWith'] as const)[template === 0x08 ? record.u16(parts.parameters) : -1]
    if (text !== undefined && test) return { kind: 'text', test, text, look }
    return first ? { kind: 'formula', formula: first, look } : undefined
  }
  if (kind === 3) {
    const points = record.u8(own + 3)
    let end = own + 6
    const thresholds: (Threshold | undefined)[] = []
    for (let index = 0; index < points; index++) {
      const read = thresholdAt(record, end, anchor)
      thresholds.push(read.threshold)
      end = read.end + 8
    }
    const stops = thresholds.map((threshold, index) => ({ threshold, color: colorAt(record, end + index * 24 + 8, colors) }))
    return stops.length >= 2 && stops.every((stop): stop is { threshold: Threshold; color: string } => stop.threshold !== undefined && stop.color !== undefined)
      ? { kind: 'scale', stops }
      : undefined
  }
  if (kind === 4) {
    const color = colorAt(record, own + 6, colors)
    const low = thresholdAt(record, own + 22, anchor)
    const high = thresholdAt(record, low.end, anchor)
    if (!color || !low.threshold || !high.threshold) return undefined
    return {
      kind: 'bar',
      low: low.threshold,
      high: high.threshold,
      color,
      axis: false,
      gradient: true,
      shown: (record.u8(own + 3) & 0x02) !== 0,
      least: Math.min(record.u8(own + 4), 100),
      most: Math.min(record.u8(own + 5), 100)
    }
  }
  if (kind === 5) {
    const flags = record.u8(own + 3)
    return { kind: 'rank', count: record.u16(own + 4), percent: (flags & 0x02) !== 0, bottom: (flags & 0x01) === 0, look }
  }
  if (kind === 6) {
    const [count, set, flags] = [record.u8(own + 3), record.u8(own + 4), record.u8(own + 5)]
    const steps: Extract<ConditionRule, { kind: 'icons' }>['steps'] = []
    let end = own + 6
    for (let index = 0; index < count; index++) {
      const read = thresholdAt(record, end, anchor)
      if (!read.threshold) return undefined
      steps.push({ threshold: read.threshold, atLeast: record.u8(read.end) !== 0 })
      end = read.end + 5
    }
    const name = ICON_SETS[set]
    return name ? { kind: 'icons', set: name, steps, reverse: (flags & 0x04) !== 0, shown: (flags & 0x01) === 0 } : undefined
  }
  return undefined
}

/** The cells a block applies to (`SqRefU`), from where their count is. */
function blocksAt(record: RecordReader, at: number): Block[] {
  const blocks: Block[] = []
  for (let index = 0; index < Math.min(record.u16(at), 1026); index++) {
    const place = at + 2 + index * 8
    const [first, last, from, to] = [record.u16(place), record.u16(place + 2), record.u16(place + 4), record.u16(place + 6)]
    if (last >= first && to >= from) blocks.push({ row: first, column: from, rows: last - first + 1, columns: to - from + 1 })
  }
  return blocks
}

/**
 * A sheet's conditional formats, from its records in order, with the workbook's palette and theme: those of Excel 97
 * (`CFHEADER`, `CF`), the first of a block's that holds unless what Excel 2007 adds to them (`CFEx`) gives each its
 * order and whether it stops those after it; and those of Excel 2007 (`CONDFMT12`, `CF12`), with their templates,
 * scales, data bars, filters and icon sets.
 */
export function readOlderConditions(records: readonly ConditionRecord[], colors: Pick<WorkbookColors, 'palette' | 'theme'>): Condition[] {
  // What Excel 2007 adds to a condition of Excel 97, by its block's identifier and its place in the block.
  const added = new Map<string, { priority: number; stop: boolean; active: boolean }>()
  for (const { type, bytes } of records) {
    if (type !== 0x087b) continue
    try {
      const record = reader(bytes)
      if (record.u32(12) !== 0) continue
      const flags = record.u8(24)
      added.set(`${record.u16(16)}/${record.u16(18)}`, { priority: record.u16(22), stop: (flags & 0x02) !== 0, active: (flags & 0x01) !== 0 })
    } catch {
      // A record cut short adds nothing.
    }
  }
  const conditions: Condition[] = []
  let block: { blocks: Block[]; anchor: Place; left: number; group: number; id: number; at: number; modern: boolean } | undefined
  let group = 0
  for (const { type, bytes } of records) {
    try {
      const record = reader(bytes)
      if (type === 0x01b0 || type === 0x0879) {
        // The cells it applies to, after the block that bounds them, whose first cell its formulas are written for.
        const from = type === 0x0879 ? 12 : 0
        block = {
          blocks: blocksAt(record, from + 12),
          anchor: { row: record.u16(from + 4), column: record.u16(from + 8) },
          left: record.u16(from),
          group: group++,
          id: record.u16(from + 2) >> 1,
          at: 0,
          modern: type === 0x0879
        }
        continue
      }
      const modern = type === 0x087a
      if ((type !== 0x01b1 && !modern) || !block || block.left <= 0 || block.modern !== modern) continue
      block.left--
      const place = block.at++
      const from = modern ? 12 : 0
      const [kind, comparison, firstSize, secondSize] = [record.u8(from), record.u8(from + 1), record.u16(from + 2), record.u16(from + 4)]
      // The look it sets; Excel 2007's says its size first, and is empty for a scale, a bar or icons.
      const size = modern ? record.u32(from + 6) : undefined
      const read = size === 0 ? { look: {}, end: from + 12 } : lookOf(bytes, size === undefined ? from + 6 : from + 10, colors)
      const end = size === undefined || size === 0 ? read.end : from + 10 + size
      const formulas = [
        firstSize > 0 ? readFormulaTokens(record.bytes(end, firstSize), block.anchor) : undefined,
        secondSize > 0 ? readFormulaTokens(record.bytes(end + firstSize, secondSize), block.anchor) : undefined
      ]
      const context = { look: read.look, anchor: block.anchor, colors }
      if (!modern) {
        const extra = added.get(`${block.id}/${place}`)
        if (extra && !extra.active) continue
        const rule = ruleOf(record, { kind, comparison, formulas, template: kind === 1 ? 0 : 1, parameters: 0, own: 0 }, context)
        if (rule)
          conditions.push({
            blocks: block.blocks,
            anchor: block.anchor,
            priority: extra?.priority ?? conditions.length,
            stop: extra?.stop ?? true,
            ...(extra ? {} : { group: block.group }),
            rule
          })
        continue
      }
      // After its formulas: the formula that says when it is active, its flags, its order, then its template.
      const active = end + firstSize + secondSize
      const after = active + 2 + record.u16(active)
      const rule = ruleOf(record, { kind, comparison, formulas, template: record.u16(after + 3), parameters: after + 6, own: after + 22 }, context)
      if (rule) conditions.push({ blocks: block.blocks, anchor: block.anchor, priority: record.u16(after + 1), stop: (record.u8(after) & 0x02) !== 0, rule })
    } catch {
      // A record cut short is passed over.
    }
  }
  return conditions
}
