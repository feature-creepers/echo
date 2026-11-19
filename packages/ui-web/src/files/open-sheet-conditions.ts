/**
 * The conditional formats of a sheet of an OpenDocument spreadsheet (docs/SPEC.md, section 9.7), read into
 * `conditional-formats.ts`: those LibreOffice writes in its own extension (`calcext:conditional-formats`), each a
 * format of conditions, a scale of colours, a data bar, an icon set or a date's condition over its blocks of cells, and
 * otherwise the conditions of the standard, which a cell's style maps to another style (`style:map`).
 */

import type { Block, Condition, ConditionRule, DatePeriod, Threshold } from './conditional-formats.ts'
import { colorOf, type TextLook } from './document-look.ts'
import { bordersOf, definedLook, textLook } from './open-look.ts'
import type { StyleBook } from './open-styles.ts'
import { type Formula, type Place, readFormula } from './sheet-formula.ts'
import type { ConditionLook } from './sheet-look.ts'
import { childAt, childrenNamed, type XmlNode } from './xml.ts'

/** A cell's place as OpenDocument writes it, `Sheet1.$B$2`, from 0. */
function placeOf(text: string): Place | undefined {
  const found = /\.\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text.trim())
  if (!found) return undefined
  const column = [...(found[1] as string).toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1
  const row = Number(found[2]) - 1
  return row >= 0 && column >= 0 ? { row, column } : undefined
}

/** The blocks of cells a list of ranges names, `Sheet1.A1:Sheet1.B5 'My sheet'.D2`, sheet names quoted or not. */
export function readOpenBlocks(list: string): Block[] {
  const blocks: Block[] = []
  const cell = String.raw`(?:\$?'(?:[^']|'')*'|[^\s.:']*)\.\$?[A-Za-z]{1,3}\$?\d+`
  for (const found of list.matchAll(new RegExp(`(${cell})(?::(${cell}))?`, 'g'))) {
    const first = placeOf(found[1] ?? '')
    const last = found[2] === undefined ? first : placeOf(found[2])
    if (!first || !last) continue
    const row = Math.min(first.row, last.row)
    const column = Math.min(first.column, last.column)
    blocks.push({ row, column, rows: Math.abs(last.row - first.row) + 1, columns: Math.abs(last.column - first.column) + 1 })
  }
  return blocks
}

/** A list of operands, split where a separator is outside strings, brackets and references. */
function operandsOf(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let at = 0; at < text.length; at++) {
    const character = text[at]
    if (character === '"') quoted = !quoted
    else if (quoted) continue
    else if (character === '(' || character === '[') depth++
    else if (character === ')' || character === ']') depth--
    else if ((character === ',' || character === ';') && depth === 0) {
      parts.push(text.slice(start, at))
      start = at + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim())
}

const DATES: Record<string, DatePeriod> = {
  today: 'today',
  yesterday: 'yesterday',
  tomorrow: 'tomorrow',
  'last-7-days': 'last7Days',
  'this-week': 'thisWeek',
  'last-week': 'lastWeek',
  'next-week': 'nextWeek',
  'this-month': 'thisMonth',
  'last-month': 'lastMonth',
  'next-month': 'nextMonth',
  'this-year': 'thisYear',
  'last-year': 'lastYear',
  'next-year': 'nextYear'
}

const RANKS: Record<string, { bottom: boolean; percent: boolean }> = {
  'top-elements': { bottom: false, percent: false },
  'bottom-elements': { bottom: true, percent: false },
  'top-percent': { bottom: false, percent: true },
  'bottom-percent': { bottom: true, percent: true }
}

const TEXTS: Record<string, Extract<ConditionRule, { kind: 'text' }>['test']> = {
  'contains-text': 'contains',
  'not-contains-text': 'notContains',
  'begins-with': 'beginsWith',
  'ends-with': 'endsWith'
}

/**
 * A condition as LibreOffice writes it (`>5`, `between(1,10)`, `formula-is(MOD(ROW(),2)=0)`, `top-elements(3)`), or as
 * the standard does (`cell-content()>5`, `cell-content-is-between(1,10)`, `is-true-formula(…)`); none when not read.
 */
export function readOpenRule(value: string, look: ConditionLook, sheet: string): ConditionRule | undefined {
  const text = value.trim().replace(/^cell-content\(\)\s*/, '')
  const formula = (one: string | undefined): Formula | undefined => (one === undefined ? undefined : readFormula(one, sheet))
  const compared = /^(<=|>=|!=|<>|=|<|>)([\s\S]*)$/.exec(text)
  if (compared) {
    const operand = formula(compared[2])
    const operator = compared[1] === '!=' ? '<>' : (compared[1] as '<=' | '>=' | '<>' | '=' | '<' | '>')
    return operand ? { kind: 'compare', operator, operands: [operand], look } : undefined
  }
  const call = /^([a-z][a-z0-9-]*)(?:\(([\s\S]*)\))?$/.exec(text)
  if (!call) return undefined
  const name = (call[1] as string).replace(/^cell-content-is-/, '')
  const operands = call[2] === undefined ? [] : operandsOf(call[2])
  if (name === 'between' || name === 'not-between') {
    const read = operands.map(formula)
    const [one, two] = read
    return read.length === 2 && one && two
      ? { kind: 'compare', operator: name === 'between' ? 'between' : 'notBetween', operands: [one, two], look }
      : undefined
  }
  if (name === 'formula-is' || name === 'is-true-formula') {
    const read = formula(call[2])
    return read ? { kind: 'formula', formula: read, look } : undefined
  }
  const test = TEXTS[name]
  if (test) {
    const read = formula(operands[0])
    return read?.kind === 'value' && typeof read.value === 'string' ? { kind: 'text', test, text: read.value, look } : undefined
  }
  const rank = RANKS[name]
  if (rank) {
    const count = Number(operands[0])
    return Number.isFinite(count) ? { kind: 'rank', count, ...rank, look } : undefined
  }
  if (name === 'duplicate' || name === 'unique') return { kind: 'repeated', unique: name === 'unique', look }
  if (name === 'is-error' || name === 'is-no-error') return { kind: 'error', error: name === 'is-error', look }
  const average = /^(above|below)(-equal)?-average$/.exec(name)
  if (average) return { kind: 'average', above: average[1] === 'above', equal: average[2] !== undefined, deviations: 0, look }
  return undefined
}

/**
 * A style's name as OpenDocument keeps it from the name a person sees, which LibreOffice's conditions give: each
 * character a name cannot hold, the underscore among them, written as its code between underscores (`Accent 1` is
 * `Accent_20_1`).
 */
export const styleName = (shown: string): string => shown.replace(/[^A-Za-z0-9.-]/g, (character) => `_${character.charCodeAt(0).toString(16)}_`)

/**
 * What a cell style named by a condition sets, by its name or the name a person sees, the style and those it comes
 * from, the spreadsheet's default style left out: a condition's style changes what it sets, never the cell's own font.
 */
function styleLook(book: StyleBook, name: string | undefined, fonts: ReadonlyMap<string, string>): ConditionLook {
  const found = book.chain('table-cell', name, false)
  const chain = found.length > 0 || name === undefined ? found : book.chain('table-cell', styleName(name), false)
  const layers = chain.filter((style) => style.attributes['style:name'] !== 'Default')
  const of = (kind: string): Record<string, string> => Object.assign({}, ...layers.map((style) => childAt(style, `style:${kind}-properties`)?.attributes ?? {}))
  const cell = of('table-cell')
  const { hidden: _hidden, highlight: _highlight, ...text } = textLook(of('text'), fonts)
  const look: ConditionLook = {}
  const set: TextLook = definedLook(text)
  if (Object.keys(set).length > 0) look.text = set
  const background = cell['fo:background-color']
  if (background !== undefined && background !== 'transparent') look.fill = colorOf(background.replace(/^#/, ''))
  const borders = Object.fromEntries(Object.entries(bordersOf(cell)).filter(([, side]) => side !== undefined))
  if (Object.keys(borders).length > 0) look.borders = borders
  return look
}

/** A threshold of a scale, a bar or an icon set (`calcext:type`, `calcext:value`). */
function thresholdOf(node: XmlNode, sheet: string): Threshold | undefined {
  const type = node.attributes['calcext:type']
  if (type === 'minimum') return { kind: 'lowest' }
  if (type === 'maximum') return { kind: 'highest' }
  if (type === 'auto-minimum') return { kind: 'automatic-lowest' }
  if (type === 'auto-maximum') return { kind: 'automatic-highest' }
  const value = readFormula(node.attributes['calcext:value'] ?? '0', sheet)
  if (!value) return undefined
  return { kind: type === 'percent' ? 'percent' : type === 'percentile' ? 'percentile' : 'number', value }
}

const on = (value: string | undefined, usual: boolean) => (value === undefined ? usual : value === 'true')

/**
 * A sheet's conditional formats: LibreOffice's, else those its cells' styles map; each format's conditions stop at the
 * first that holds, as LibreOffice takes them. `styleAt` gives each cell's style.
 */
export function readOpenConditions(
  table: XmlNode,
  book: StyleBook,
  fonts: ReadonlyMap<string, string>,
  sheet: string,
  styleAt: (row: number, column: number) => string | undefined,
  size: { rows: number; columns: number }
): Condition[] {
  const conditions: Condition[] = []
  const formats = childrenNamed(childAt(table, 'calcext:conditional-formats'), 'calcext:conditional-format')
  formats.forEach((format, group) => {
    const blocks = readOpenBlocks(format.attributes['calcext:target-range-address'] ?? '')
    const first = blocks[0]
    if (!first) return
    for (const entry of format.children) {
      const anchor = placeOf(entry.attributes['calcext:base-cell-address'] ?? '') ?? { row: first.row, column: first.column }
      const color = (name: string) => colorOf((entry.attributes[name] ?? '').replace(/^#/, ''))
      const steps = childrenNamed(entry, 'calcext:formatting-entry').map((one) => thresholdOf(one, sheet))
      let rule: ConditionRule | undefined
      if (entry.name === 'calcext:condition')
        rule = readOpenRule(entry.attributes['calcext:value'] ?? '', styleLook(book, entry.attributes['calcext:apply-style-name'], fonts), sheet)
      else if (entry.name === 'calcext:date-is') {
        const period = DATES[entry.attributes['calcext:date'] ?? '']
        if (period) rule = { kind: 'date', period, look: styleLook(book, entry.attributes['calcext:style'], fonts) }
      } else if (entry.name === 'calcext:color-scale') {
        const stops = childrenNamed(entry, 'calcext:color-scale-entry').map((one) => ({
          threshold: thresholdOf(one, sheet),
          color: colorOf((one.attributes['calcext:color'] ?? '').replace(/^#/, ''))
        }))
        if (
          stops.length >= 2 &&
          stops.every((stop): stop is { threshold: Threshold; color: string } => stop.threshold !== undefined && stop.color !== undefined)
        )
          rule = { kind: 'scale', stops }
      } else if (entry.name === 'calcext:data-bar') {
        const [low, high] = steps
        const positive = color('calcext:positive-color') ?? '#2a6099'
        const length = (name: string, usual: number) => {
          const value = Number(entry.attributes[name] ?? usual)
          return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : usual
        }
        if (low && high)
          rule = {
            kind: 'bar',
            low,
            high,
            color: positive,
            negative: color('calcext:negative-color'),
            axis: entry.attributes['calcext:axis-position'] !== 'none',
            gradient: on(entry.attributes['calcext:gradient'], true),
            shown: on(entry.attributes['calcext:show-value'], true),
            least: length('calcext:min-length', 0),
            most: length('calcext:max-length', 100)
          }
      } else if (entry.name === 'calcext:icon-set') {
        const nodes = childrenNamed(entry, 'calcext:formatting-entry')
        if (steps.length >= 2 && steps.every((step) => step !== undefined))
          rule = {
            kind: 'icons',
            set: entry.attributes['calcext:icon-set-type'] ?? '3Arrows',
            steps: steps.map((step, index) => ({ threshold: step as Threshold, atLeast: on(nodes[index]?.attributes['calcext:greater-equal'], true) })),
            reverse: false,
            shown: on(entry.attributes['calcext:show-value'], true)
          }
      }
      if (rule) conditions.push({ blocks, anchor, priority: conditions.length, stop: !['scale', 'bar', 'icons'].includes(rule.kind), group, rule })
    }
  })
  if (formats.length > 0) return conditions

  // The standard's conditions, which each cell style maps to another: each style's over the cells in it.
  const cellsOf = new Map<string, Block[]>()
  for (let row = 0; row < size.rows; row++)
    for (let column = 0; column < size.columns; column++) {
      const name = styleAt(row, column)
      if (name === undefined) continue
      const blocks = cellsOf.get(name) ?? []
      const last = blocks.at(-1)
      if (last && last.row === row && last.column + last.columns === column) last.columns++
      else blocks.push({ row, column, rows: 1, columns: 1 })
      cellsOf.set(name, blocks)
    }
  let group = 0
  for (const [name, blocks] of cellsOf) {
    const maps = book.chain('table-cell', name, false).flatMap((style) => childrenNamed(style, 'style:map'))
    const first = blocks[0]
    if (maps.length === 0 || !first) continue
    group++
    for (const map of maps) {
      const rule = readOpenRule(map.attributes['style:condition'] ?? '', styleLook(book, map.attributes['style:apply-style-name'], fonts), sheet)
      const anchor = placeOf(map.attributes['style:base-cell-address'] ?? '') ?? { row: first.row, column: first.column }
      if (rule) conditions.push({ blocks, anchor, priority: conditions.length, stop: true, group, rule })
    }
  }
  return conditions
}
