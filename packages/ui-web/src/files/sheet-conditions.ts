/**
 * The conditional formats of a sheet of Excel 2007 and later (docs/SPEC.md, section 9.7), read into
 * `conditional-formats.ts`: each `conditionalFormatting`'s blocks of cells and its rules, what a rule sets by the
 * workbook's differential formats (`dxfs`), and what Excel 2010 adds in the sheet's extensions (`x14`): data bars with
 * an axis, a border and a solid fill, and the icon sets and icons of its own.
 */

import type { Block, Condition, ConditionRule, DatePeriod, Threshold } from './conditional-formats.ts'
import { type Formula, readFormula } from './sheet-formula.ts'
import { readConditionLook, type WorkbookStyles, workbookColor } from './sheet-look.ts'
import { childAt, childrenNamed, textIn, type XmlNode, xmlTree } from './xml.ts'

/** A cell's or a block's place, `B2` or `A1:C9`, from 0; none when it is not one. */
export function readBlock(text: string): Block | undefined {
  const found = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(text.trim())
  if (!found) return undefined
  const column = (letters: string) => [...letters.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1
  const [first, second] = [
    { row: Number(found[2]) - 1, column: column(found[1] as string) },
    { row: Number(found[4] ?? found[2]) - 1, column: column(found[3] ?? (found[1] as string)) }
  ]
  const row = Math.min(first.row, second.row)
  const left = Math.min(first.column, second.column)
  if (row < 0 || left < 0) return undefined
  return { row, column: left, rows: Math.abs(second.row - first.row) + 1, columns: Math.abs(second.column - first.column) + 1 }
}

const COMPARISONS: Record<string, Extract<ConditionRule, { kind: 'compare' }>['operator']> = {
  lessThan: '<',
  lessThanOrEqual: '<=',
  equal: '=',
  notEqual: '<>',
  greaterThanOrEqual: '>=',
  greaterThan: '>',
  between: 'between',
  notBetween: 'notBetween'
}

const TEXT_TESTS: Record<string, Extract<ConditionRule, { kind: 'text' }>['test']> = {
  containsText: 'contains',
  notContainsText: 'notContains',
  beginsWith: 'beginsWith',
  endsWith: 'endsWith'
}

const PERIODS: readonly DatePeriod[] = [
  'today',
  'yesterday',
  'tomorrow',
  'last7Days',
  'thisWeek',
  'lastWeek',
  'nextWeek',
  'thisMonth',
  'lastMonth',
  'nextMonth'
]

const on = (value: string | undefined, usual: boolean) => (value === undefined ? usual : value === '1' || value === 'true')

/**
 * A sheet's conditional formats, read from its part, on a sheet of this name, with the workbook's styles. A rule whose
 * formula names another sheet or what is not read is left out.
 */
export function readSheetConditions(xml: string, styles: WorkbookStyles, sheet: string): Condition[] {
  const formula = (text: string | undefined) => (text === undefined ? undefined : readFormula(text, sheet))
  const color = (node: XmlNode | undefined) => workbookColor(node, styles.colors)
  // A threshold, its value in `val` or, in Excel 2010's, in a formula of its own.
  const threshold = (node: XmlNode): Threshold | undefined => {
    const type = node.attributes.type
    if (type === 'min') return { kind: 'lowest' }
    if (type === 'max') return { kind: 'highest' }
    if (type === 'autoMin') return { kind: 'automatic-lowest' }
    if (type === 'autoMax') return { kind: 'automatic-highest' }
    const value = formula(node.attributes.val ?? textOf(childAt(node, 'xm:f')))
    if (!value) return undefined
    return { kind: type === 'percent' ? 'percent' : type === 'percentile' ? 'percentile' : 'number', value }
  }
  const thresholds = (node: XmlNode | undefined, name: string) => childrenNamed(node, name).map(threshold)

  // Excel 2010's rules, by the identifier the main rules name them by; those no main rule names stand on their own.
  const extended = new Map<string, XmlNode>()
  const own: { node: XmlNode; blocks: string }[] = []
  for (const part of xml.match(/<x14:conditionalFormatting\b(?:[^>]*\/>|[\s\S]*?<\/x14:conditionalFormatting>)/g) ?? []) {
    const node = childAt(xmlTree(part), 'x14:conditionalFormatting')
    const blocks = textOf(childAt(node, 'xm:sqref')) ?? ''
    for (const rule of childrenNamed(node, 'x14:cfRule')) {
      if (rule.attributes.id) extended.set(rule.attributes.id, rule)
      own.push({ node: rule, blocks })
    }
  }
  const named = new Set<string>()

  const read = (rule: XmlNode, blocks: Block[], order: number): Condition | undefined => {
    const first = blocks[0]
    if (!first) return undefined
    const type = rule.attributes.type ?? ''
    const inline = childAt(rule, 'x14:dxf')
    const look = inline ? readConditionLook(inline, styles.colors) : (styles.differences?.[Number(rule.attributes.dxfId)] ?? {})
    const formulas = [...childrenNamed(rule, 'formula'), ...childrenNamed(rule, 'xm:f')].map((one) => formula(textIn(one)))
    let read: ConditionRule | undefined
    if (type === 'cellIs') {
      const operator = COMPARISONS[rule.attributes.operator ?? '']
      const operands = formulas.filter((one): one is Formula => one !== undefined)
      if (operator && operands.length === formulas.length && operands.length >= (operator === 'between' || operator === 'notBetween' ? 2 : 1))
        read = { kind: 'compare', operator, operands, look }
    } else if (type === 'expression') {
      const [only] = formulas
      if (only) read = { kind: 'formula', formula: only, look }
    } else if (TEXT_TESTS[type] && rule.attributes.text !== undefined) {
      read = { kind: 'text', test: TEXT_TESTS[type], text: rule.attributes.text, look }
    } else if (type === 'containsBlanks' || type === 'notContainsBlanks') read = { kind: 'blank', blank: type === 'containsBlanks', look }
    else if (type === 'containsErrors' || type === 'notContainsErrors') read = { kind: 'error', error: type === 'containsErrors', look }
    else if (type === 'top10') {
      const count = Number(rule.attributes.rank ?? 10)
      read = {
        kind: 'rank',
        count: Number.isFinite(count) ? count : 10,
        percent: on(rule.attributes.percent, false),
        bottom: on(rule.attributes.bottom, false),
        look
      }
    } else if (type === 'aboveAverage') {
      const deviations = Number(rule.attributes.stdDev ?? 0)
      read = {
        kind: 'average',
        above: on(rule.attributes.aboveAverage, true),
        equal: on(rule.attributes.equalAverage, false),
        deviations: Number.isFinite(deviations) ? deviations : 0,
        look
      }
    } else if (type === 'duplicateValues' || type === 'uniqueValues') read = { kind: 'repeated', unique: type === 'uniqueValues', look }
    else if (type === 'timePeriod') {
      const period = PERIODS.find((one) => one === rule.attributes.timePeriod)
      if (period) read = { kind: 'date', period, look }
    } else if (type === 'colorScale') read = scaleOf(childAt(rule, 'colorScale'))
    else if (type === 'dataBar') read = barOf(rule)
    else if (type === 'iconSet') read = iconsOf(childAt(rule, 'iconSet') ?? childAt(rule, 'x14:iconSet'))
    if (!read) return undefined
    const priority = Number(rule.attributes.priority)
    return {
      blocks,
      anchor: { row: first.row, column: first.column },
      priority: Number.isFinite(priority) ? priority : order,
      stop: on(rule.attributes.stopIfTrue, false),
      rule: read
    }
  }

  const scaleOf = (node: XmlNode | undefined): ConditionRule | undefined => {
    const steps = thresholds(node, 'cfvo')
    const colors = childrenNamed(node, 'color').map(color)
    if (steps.length < 2 || steps.length !== colors.length) return undefined
    const stops = steps.map((step, index) => ({ threshold: step, color: colors[index] }))
    return stops.every((stop): stop is { threshold: Threshold; color: string } => stop.threshold !== undefined && stop.color !== undefined)
      ? { kind: 'scale', stops }
      : undefined
  }

  // A data bar, as Excel 2007 writes it, with what Excel 2010 adds to it by its identifier, or Excel 2010's alone.
  const barOf = (rule: XmlNode): ConditionRule | undefined => {
    const main = childAt(rule, 'dataBar')
    const id = textOf(childAt(rule, 'extLst', 'ext', 'x14:id'))
    const added = childAt(id === undefined ? rule : extended.get(id), 'x14:dataBar') ?? childAt(rule, 'x14:dataBar')
    if (id !== undefined && extended.has(id)) named.add(id)
    const [low, high] = added ? thresholds(added, 'x14:cfvo') : thresholds(main, 'cfvo')
    const fill = color(childAt(main, 'color')) ?? color(childAt(added, 'x14:fillColor'))
    if (!low || !high || !fill) return undefined
    const length = (value: string | undefined, usual: number) => {
      const read = Number(value ?? usual)
      return Number.isFinite(read) ? Math.min(Math.max(read, 0), 100) : usual
    }
    const attributes = { ...main?.attributes, ...added?.attributes }
    return {
      kind: 'bar',
      low,
      high,
      color: fill,
      negative: added && !on(added.attributes.negativeBarColorSameAsPositive, false) ? color(childAt(added, 'x14:negativeFillColor')) : undefined,
      axis: added !== undefined && added.attributes.axisPosition !== 'none',
      gradient: on(added?.attributes.gradient, true),
      border: added && on(added.attributes.border, false) ? color(childAt(added, 'x14:borderColor')) : undefined,
      shown: on(rule.attributes.showValue ?? main?.attributes.showValue ?? attributes.showValue, true),
      least: length(attributes.minLength, 10),
      most: length(attributes.maxLength, 90)
    }
  }

  const iconsOf = (node: XmlNode | undefined): ConditionRule | undefined => {
    if (!node) return undefined
    const steps = [...thresholds(node, 'cfvo'), ...thresholds(node, 'x14:cfvo')]
    const nodes = [...childrenNamed(node, 'cfvo'), ...childrenNamed(node, 'x14:cfvo')]
    const icons = childrenNamed(node, 'x14:cfIcon')
    if (steps.length < 2 || steps.some((step) => step === undefined)) return undefined
    return {
      kind: 'icons',
      set: node.attributes.iconSet ?? '3TrafficLights1',
      steps: steps.map((step, index) => {
        const icon = icons[index]
        return {
          threshold: step as Threshold,
          atLeast: on(nodes[index]?.attributes.gte, true),
          icon: icon ? { set: icon.attributes.iconSet ?? 'NoIcons', index: Number(icon.attributes.iconId ?? 0) } : undefined
        }
      }),
      reverse: on(node.attributes.reverse, false),
      shown: on(node.attributes.showValue, true)
    }
  }

  const conditions: Condition[] = []
  let order = 0
  for (const part of xml.match(/<conditionalFormatting\b(?:[^>]*\/>|[\s\S]*?<\/conditionalFormatting>)/g) ?? []) {
    const node = childAt(xmlTree(part), 'conditionalFormatting')
    const blocks = blocksOf(node?.attributes.sqref)
    for (const rule of childrenNamed(node, 'cfRule')) {
      const condition = read(rule, blocks, order++)
      if (condition) conditions.push(condition)
    }
  }
  // Excel 2010's rules that no rule of Excel 2007 stands for.
  for (const { node, blocks } of own) {
    if (named.has(node.attributes.id ?? '')) continue
    const condition = read(node, blocksOf(blocks), order++)
    if (condition) conditions.push(condition)
  }
  return conditions
}

const textOf = (node: XmlNode | undefined) => (node ? textIn(node).trim() : undefined)

/** The blocks of cells a list names, `A1:B5 D2`. */
const blocksOf = (list: string | undefined): Block[] =>
  (list ?? '')
    .split(/\s+/)
    .map(readBlock)
    .filter((block): block is Block => block !== undefined)
