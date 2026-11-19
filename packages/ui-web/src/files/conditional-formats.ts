/**
 * A sheet's conditional formats (docs/SPEC.md, section 9.7), as each format's reader finds them, worked out over its
 * look as Excel and LibreOffice show them: a cell whose condition holds takes what the condition sets over its style,
 * the conditions first in order first; a scale of colours fills each number's cell in its colour, a data bar draws a bar
 * in it and an icon set an icon.
 */

import type { BorderLook, Sides, TextLook } from './document-look.ts'
import {
  type Comparison,
  compareValues,
  dayOf,
  evaluateFormula,
  type Formula,
  type FormulaContext,
  type FormulaValue,
  formulaHolds,
  type Place
} from './sheet-formula.ts'
import type { CellKind, CellLook, CellMark, ConditionLook, MergedCells, SheetLook } from './sheet-look.ts'
import { css, fromHex } from './slide-svg.ts'

/** A value a scale, a bar or an icon set measures from: the lowest or highest of its numbers, or one worked out from them. */
export type Threshold =
  | { kind: 'lowest' | 'highest' | 'automatic-lowest' | 'automatic-highest' }
  | { kind: 'number' | 'percent' | 'percentile'; value: Formula }

/** The periods a date's condition names. */
export type DatePeriod =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'last7Days'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear'

export type ConditionRule =
  /** A formula that holds, worked out for each cell. */
  | { kind: 'formula'; formula: Formula; look: ConditionLook }
  /** The cell's value compared with one or two values worked out for it. */
  | { kind: 'compare'; operator: Comparison | 'between' | 'notBetween'; operands: Formula[]; look: ConditionLook }
  /** The cell's text, whatever its case, holding a text or not, or starting or ending with it. */
  | { kind: 'text'; test: 'contains' | 'notContains' | 'beginsWith' | 'endsWith'; text: string; look: ConditionLook }
  | { kind: 'blank'; blank: boolean; look: ConditionLook }
  | { kind: 'error'; error: boolean; look: ConditionLook }
  /** A number among the highest or lowest of its cells', so many or a share of them. */
  | { kind: 'rank'; count: number; percent: boolean; bottom: boolean; look: ConditionLook }
  /** A number above or below their average, or so many standard deviations from it. */
  | { kind: 'average'; above: boolean; equal: boolean; deviations: number; look: ConditionLook }
  /** A value that another of its cells holds too, or that none does. */
  | { kind: 'repeated'; unique: boolean; look: ConditionLook }
  | { kind: 'date'; period: DatePeriod; look: ConditionLook }
  | { kind: 'scale'; stops: { threshold: Threshold; color: string }[] }
  | {
      kind: 'bar'
      low: Threshold
      high: Threshold
      color: string
      /** The colour of a negative number's bar, which goes back from an axis, where it has one. */
      negative?: string | undefined
      axis: boolean
      gradient: boolean
      border?: string | undefined
      /** Whether the cell's value shows beside its bar. */
      shown: boolean
      /** The shortest and longest bar, in hundredths of its cell's width. */
      least: number
      most: number
    }
  | {
      kind: 'icons'
      set: string
      /** From the lowest: the value each icon starts at, at least it or more than it, and the icon itself where it is not the set's. */
      steps: { threshold: Threshold; atLeast: boolean; icon?: { set: string; index: number } | undefined }[]
      reverse: boolean
      shown: boolean
    }

/** A block of cells, from its first. */
export type Block = MergedCells

/**
 * A conditional format: the blocks it applies to, the cell its formulas are written for, its order, and whether it stops
 * those after it where it holds: all of them, or only those of its group, as LibreOffice takes the first of a format's
 * conditions that holds and still works out its other formats.
 */
export interface Condition {
  blocks: Block[]
  anchor: Place
  priority: number
  stop: boolean
  group?: number | undefined
  rule: ConditionRule
}

/** What a sheet's conditions are worked out from: each cell's value, and now, as the workbook counts days. */
export interface SheetData {
  value(row: number, column: number): FormulaValue
  now: number
  date1904: boolean
}

/** A cell's value for its conditions, from what it holds, its text as shown and its number. */
export function cellValue(kind: CellKind | undefined, text: string | undefined, number: number | undefined): FormulaValue {
  if (kind === 'number') return number ?? text ?? null
  if (kind === 'logical') return text?.toUpperCase() === 'TRUE'
  if (kind === 'error') return { error: text ?? '#N/A' }
  if (kind === 'text') return text ?? ''
  return null
}

/** Now as a workbook counts days, from 1900 or 1904, in the person's own time. */
export function serialNow(date1904: boolean, now = new Date()): number {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())
  const days = local / 86_400_000 - Date.UTC(1899, 11, 30) / 86_400_000
  return date1904 ? days - 1462 : days
}

/** The numbers of a condition's cells, and how often each value is there, read once for the conditions that need them. */
interface Summary {
  numbers: number[]
  mean: number
  deviation: number
  counts: Map<string, number>
}

/** What a value counts as among others: numbers by their value, text whatever its case; none for nothing or an error. */
function valueKey(value: FormulaValue): string | undefined {
  if (value === null || (typeof value === 'object' && value !== null)) return undefined
  if (typeof value === 'string') return value === '' ? undefined : `t${value.toUpperCase()}`
  return `${typeof value}${String(value)}`
}

const isError = (value: FormulaValue): boolean => typeof value === 'object' && value !== null

/** The look a cell has in Excel with no style of its own. */
function plainLook(look: SheetLook, value: FormulaValue): CellLook {
  const align = typeof value === 'number' ? 'right' : typeof value === 'boolean' || isError(value) ? 'center' : 'left'
  return { text: look.text, borders: {}, align, vertical: 'bottom', wrap: false, indent: 0 }
}

/**
 * A sheet's look with its conditional formats worked out over it, read when they are given as a reader; as it was when
 * they cannot be read, so that conditions never cost a sheet its look.
 */
export function withConditions(look: SheetLook, conditions: readonly Condition[] | (() => readonly Condition[]), data: SheetData): SheetLook {
  try {
    return conditioned(look, typeof conditions === 'function' ? conditions() : conditions, data)
  } catch {
    return look
  }
}

function conditioned(look: SheetLook, conditions: readonly Condition[], data: SheetData): SheetLook {
  if (conditions.length === 0) return look
  const size = { rows: look.rows.length, columns: look.columns.length }
  const ordered = [...conditions].sort((one, other) => one.priority - other.priority)
  // Each condition's cells, once each, and the conditions of each cell, in order.
  const cellsOf = ordered.map((condition) => {
    const places = new Map<number, Place>()
    for (const block of condition.blocks)
      for (let row = Math.max(0, block.row); row < Math.min(block.row + block.rows, size.rows); row++)
        for (let column = Math.max(0, block.column); column < Math.min(block.column + block.columns, size.columns); column++)
          places.set(row * size.columns + column, { row, column })
    return places
  })
  const byCell = new Map<number, number[]>()
  cellsOf.forEach((places, index) => {
    for (const key of places.keys()) {
      const list = byCell.get(key) ?? []
      list.push(index)
      byCell.set(key, list)
    }
  })
  const summaries = new Map<number, Summary>()
  const summaryOf = (index: number): Summary => {
    const known = summaries.get(index)
    if (known) return known
    const values = [...(cellsOf[index]?.values() ?? [])].map(({ row, column }) => data.value(row, column))
    const numbers = values.filter((value): value is number => typeof value === 'number').sort((one, other) => one - other)
    const mean = numbers.reduce((sum, value) => sum + value, 0) / Math.max(numbers.length, 1)
    const deviation = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(numbers.length, 1))
    const counts = new Map<string, number>()
    for (const value of values) {
      const key = valueKey(value)
      if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const summary = { numbers, mean, deviation, counts }
    summaries.set(index, summary)
    return summary
  }
  const contextOf = (at: Place, anchor: Place): FormulaContext => ({
    value: (row, column) => data.value(row, column),
    rows: size.rows,
    columns: size.columns,
    at,
    anchor,
    now: data.now,
    date1904: data.date1904
  })

  const looks = [...look.looks]
  const known = new Map(looks.map((one, index) => [JSON.stringify(one), index]))
  const cells = look.cells.map((row) => [...row])
  let runs = look.runs
  const marks: (CellMark | undefined)[][] = []
  for (const [key, list] of byCell) {
    const at = { row: Math.floor(key / size.columns), column: key % size.columns }
    const value = data.value(at.row, at.column)
    const set: { text: TextLook; borders: Sides<BorderLook>; fill?: string | undefined } = { text: {}, borders: {} }
    const mark: CellMark = {}
    const stopped = new Set<number>()
    for (const index of list) {
      const condition = ordered[index] as Condition
      const { rule } = condition
      // A group's condition that holds stops its others that set a look, not its scale, bar or icons.
      if (rule.kind === 'scale' || rule.kind === 'bar' || rule.kind === 'icons') {
        if (typeof value !== 'number') continue
        const summary = summaryOf(index)
        const context = contextOf(condition.anchor, condition.anchor)
        if (rule.kind === 'scale' && set.fill === undefined) set.fill = scaleColor(rule, value, summary, context)
        else if (rule.kind === 'bar' && !mark.bar) {
          mark.bar = barOf(rule, value, summary, context)
          if (mark.bar && !rule.shown) mark.hidden = true
        } else if (rule.kind === 'icons' && !mark.icon) {
          mark.icon = iconOf(rule, value, summary, context)
          if (mark.icon && !rule.shown) mark.hidden = true
        }
        continue
      }
      if (condition.group !== undefined && stopped.has(condition.group)) continue
      if (!holds(rule, value, () => summaryOf(index), contextOf(at, condition.anchor))) continue
      for (const [name, one] of Object.entries(rule.look.text ?? {})) if (!(name in set.text)) Object.assign(set.text, { [name]: one })
      if (set.fill === undefined && rule.look.fill !== undefined) set.fill = rule.look.fill
      for (const [side, one] of Object.entries(rule.look.borders ?? {})) if (!(side in set.borders)) Object.assign(set.borders, { [side]: one })
      if (condition.stop && condition.group !== undefined) stopped.add(condition.group)
      else if (condition.stop) break
    }
    const changed = Object.keys(set.text).length > 0 || set.fill !== undefined || Object.keys(set.borders).length > 0
    if (changed) {
      const base = looks[cells[at.row]?.[at.column] ?? -1] ?? plainLook(look, value)
      const next: CellLook = { ...base, text: { ...base.text, ...set.text }, fill: set.fill ?? base.fill, borders: { ...base.borders, ...set.borders } }
      const name = JSON.stringify(next)
      let index = known.get(name)
      if (index === undefined) {
        index = looks.push(next) - 1
        known.set(name, index)
      }
      const line = cells[at.row]
      if (line) line[at.column] = index
      // A cell's text in stretches of their own fonts takes what the condition sets over each.
      const stretches = runs?.[at.row]?.[at.column]
      if (stretches && Object.keys(set.text).length > 0) {
        runs = runs?.map((row) => (row ? [...row] : row))
        const row = runs?.[at.row]
        if (row) row[at.column] = stretches.map((run) => ({ ...run, text: { ...run.text, ...set.text } }))
      }
    }
    if (mark.bar || mark.icon) {
      marks[at.row] ??= []
      ;(marks[at.row] as (CellMark | undefined)[])[at.column] = mark
    }
  }
  return { ...look, cells, looks, ...(runs ? { runs } : {}), ...(marks.length > 0 ? { marks } : {}) }
}

/** Whether a condition that sets a look holds for a cell's value. */
function holds(
  rule: Exclude<ConditionRule, { kind: 'scale' | 'bar' | 'icons' }>,
  value: FormulaValue,
  summary: () => Summary,
  context: FormulaContext
): boolean {
  switch (rule.kind) {
    case 'formula':
      return formulaHolds(rule.formula, context)
    case 'compare': {
      if (isError(value)) return false
      const [one, two] = rule.operands.map((operand) => evaluateFormula(operand, context))
      const order = (operand: FormulaValue | undefined) => (operand === undefined ? undefined : compareValues(value, operand))
      const first = order(one)
      if (typeof first !== 'number') return false
      if (rule.operator === 'between' || rule.operator === 'notBetween') {
        const second = order(two)
        if (typeof second !== 'number') return false
        // Between the two values whichever comes first.
        const reversed = compareValues(one ?? null, two ?? null)
        const [fromLow, fromHigh] = typeof reversed === 'number' && reversed > 0 ? [second, first] : [first, second]
        const within = fromLow >= 0 && fromHigh <= 0
        return rule.operator === 'between' ? within : !within
      }
      return { '=': first === 0, '<>': first !== 0, '<': first < 0, '>': first > 0, '<=': first <= 0, '>=': first >= 0 }[rule.operator]
    }
    case 'text': {
      if (value === null || isError(value)) return rule.test === 'notContains'
      const own = (
        typeof value === 'number' ? String(Number(value.toPrecision(15))) : String(value === true ? 'TRUE' : value === false ? 'FALSE' : value)
      ).toUpperCase()
      const wanted = rule.text.toUpperCase()
      if (rule.test === 'contains') return own.includes(wanted)
      if (rule.test === 'notContains') return !own.includes(wanted)
      return rule.test === 'beginsWith' ? own.startsWith(wanted) : own.endsWith(wanted)
    }
    case 'blank': {
      const blank = value === null || (typeof value === 'string' && value.trim() === '')
      return blank === rule.blank
    }
    case 'error':
      return isError(value) === rule.error
    case 'rank': {
      if (typeof value !== 'number') return false
      const { numbers } = summary()
      const count = Math.max(1, rule.percent ? Math.floor((numbers.length * rule.count) / 100) : Math.floor(rule.count))
      if (numbers.length === 0) return false
      return rule.bottom ? value <= (numbers[Math.min(count, numbers.length) - 1] as number) : value >= (numbers[Math.max(numbers.length - count, 0)] as number)
    }
    case 'average': {
      if (typeof value !== 'number') return false
      const { numbers, mean, deviation } = summary()
      if (numbers.length === 0) return false
      const bound = mean + (rule.above ? 1 : -1) * rule.deviations * deviation
      return rule.above ? (rule.equal ? value >= bound : value > bound) : rule.equal ? value <= bound : value < bound
    }
    case 'repeated': {
      const key = valueKey(value)
      if (key === undefined) return false
      const count = summary().counts.get(key) ?? 0
      return rule.unique ? count === 1 : count > 1
    }
    case 'date':
      return typeof value === 'number' && inPeriod(rule.period, value, context)
  }
}

/** Whether a day falls in a period counted from today: weeks from Sunday, as Excel counts them. */
function inPeriod(period: DatePeriod, serial: number, context: FormulaContext): boolean {
  const day = Math.floor(serial)
  const today = Math.floor(context.now)
  const week = today - dayOf(today, context.date1904).weekday
  const [one, now] = [dayOf(day, context.date1904), dayOf(today, context.date1904)]
  const months = (one.year - now.year) * 12 + one.month - now.month
  const ranges: Record<DatePeriod, boolean> = {
    today: day === today,
    yesterday: day === today - 1,
    tomorrow: day === today + 1,
    last7Days: day > today - 7 && day <= today,
    thisWeek: day >= week && day < week + 7,
    lastWeek: day >= week - 7 && day < week,
    nextWeek: day >= week + 7 && day < week + 14,
    thisMonth: months === 0,
    lastMonth: months === -1,
    nextMonth: months === 1,
    thisYear: one.year === now.year,
    lastYear: one.year === now.year - 1,
    nextYear: one.year === now.year + 1
  }
  return ranges[period]
}

/** A threshold's value among a condition's numbers; none when it cannot be worked out. */
function thresholdValue(threshold: Threshold, summary: Summary, context: FormulaContext): number | undefined {
  const { numbers } = summary
  const lowest = numbers[0]
  const highest = numbers.at(-1)
  if (lowest === undefined || highest === undefined) return undefined
  switch (threshold.kind) {
    case 'lowest':
      return lowest
    case 'highest':
      return highest
    case 'automatic-lowest':
      return Math.min(0, lowest)
    case 'automatic-highest':
      return Math.max(0, highest)
    default: {
      const value = evaluateFormula(threshold.value, context)
      if (typeof value !== 'number') return undefined
      if (threshold.kind === 'number') return value
      const share = Math.min(Math.max(value / 100, 0), 1)
      if (threshold.kind === 'percent') return lowest + (highest - lowest) * share
      // A percentile as Excel works one out, between the two numbers it falls between.
      const place = share * (numbers.length - 1)
      const below = numbers[Math.floor(place)] as number
      const above = numbers[Math.ceil(place)] as number
      return below + (above - below) * (place - Math.floor(place))
    }
  }
}

/** Two colours mixed, the second's share given. */
function mix(one: string, other: string, share: number): string {
  const [first, second] = [fromHex(one.replace(/^#/, '')), fromHex(other.replace(/^#/, ''))]
  if (!first || !second) return one
  const part = (a: number, b: number) => a + (b - a) * share
  return css({ red: part(first.red, second.red), green: part(first.green, second.green), blue: part(first.blue, second.blue), opacity: 1 })
}

/** A number's colour on a scale: its stop's, or between the two it falls between. */
function scaleColor(rule: Extract<ConditionRule, { kind: 'scale' }>, value: number, summary: Summary, context: FormulaContext): string | undefined {
  const stops = rule.stops.map((stop) => ({ at: thresholdValue(stop.threshold, summary, context), color: stop.color }))
  if (stops.length < 2 || stops.some((stop) => stop.at === undefined)) return undefined
  const first = stops[0] as { at: number; color: string }
  const last = stops.at(-1) as { at: number; color: string }
  if (value <= first.at) return mix(first.color, first.color, 0)
  if (value >= last.at) return mix(last.color, last.color, 0)
  for (let index = 1; index < stops.length; index++) {
    const [low, high] = [stops[index - 1] as { at: number; color: string }, stops[index] as { at: number; color: string }]
    if (value <= high.at) return mix(low.color, high.color, high.at === low.at ? 1 : (value - low.at) / (high.at - low.at))
  }
  return last.color
}

/** A number's bar: from the cell's start up to its share between the bar's lowest and highest, or from an axis either way. */
function barOf(rule: Extract<ConditionRule, { kind: 'bar' }>, value: number, summary: Summary, context: FormulaContext): CellMark['bar'] {
  const low = thresholdValue(rule.low, summary, context)
  const high = thresholdValue(rule.high, summary, context)
  if (low === undefined || high === undefined) return undefined
  const look = { gradient: rule.gradient, border: rule.border }
  if (rule.axis && low < 0) {
    const [from, to] = [Math.min(low, 0), Math.max(high, 0)]
    const span = to - from || 1
    const axis = -from / span
    const share = Math.min(Math.abs(value), value < 0 ? -from : to) / span
    return value < 0
      ? { start: axis - share, end: axis, color: rule.negative ?? rule.color, axis, ...look }
      : { start: axis, end: axis + share, color: rule.color, axis, ...look }
  }
  const ratio = high === low ? 1 : Math.min(Math.max((value - low) / (high - low), 0), 1)
  return { start: 0, end: (rule.least + (rule.most - rule.least) * ratio) / 100, color: rule.color, ...look }
}

/** A number's icon: the last whose step it reaches, counted from the other end where the set is reversed. */
function iconOf(rule: Extract<ConditionRule, { kind: 'icons' }>, value: number, summary: Summary, context: FormulaContext): CellMark['icon'] {
  if (rule.steps.length === 0 || rule.set === 'NoIcons') return undefined
  let reached = 0
  for (let index = 1; index < rule.steps.length; index++) {
    const step = rule.steps[index] as (typeof rule.steps)[number]
    const at = thresholdValue(step.threshold, summary, context)
    if (at !== undefined && (step.atLeast ? value >= at : value > at)) reached = index
  }
  const own = rule.steps[reached]?.icon
  if (own) return own.set === 'NoIcons' ? undefined : own
  return { set: rule.set, index: rule.reverse ? rule.steps.length - 1 - reached : reached }
}
