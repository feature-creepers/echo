import { describe, expect, it } from 'vitest'
import { type Condition, type ConditionRule, cellValue, serialNow, type Threshold, withConditions } from './conditional-formats.ts'
import { type FormulaValue, readFormula, serialOf } from './sheet-formula.ts'
import type { CellLook, SheetLook } from './sheet-look.ts'

const RED = { text: { color: '#9c0006' }, fill: '#ffc7ce' }
const BOLD = { text: { bold: true } }

const plain: CellLook = { text: { font: 'Calibri', size: 11 }, borders: {}, align: 'left', vertical: 'bottom', wrap: false, indent: 0 }

/** A sheet of one column of values, each cell in the same plain look. */
function sheet(values: FormulaValue[]): { look: SheetLook; data: { value: (row: number, column: number) => FormulaValue; now: number; date1904: boolean } } {
  return {
    look: {
      columns: [48],
      rows: values.map(() => 15),
      cells: values.map(() => [0]),
      looks: [plain],
      merges: [],
      grid: true,
      headings: true,
      zoom: 1,
      text: plain.text
    },
    data: { value: (row, column) => (column === 0 ? (values[row] ?? null) : null), now: serialOf(2026, 11, 19, false) + 0.5, date1904: false }
  }
}

const formula = (text: string) =>
  readFormula(text) ??
  (() => {
    throw new Error(`"${text}" is not read.`)
  })()

/** A condition over the whole column, written for its first cell. */
const over = (rows: number, rule: ConditionRule, priority = 1, stop = false): Condition => ({
  blocks: [{ row: 0, column: 0, rows, columns: 1 }],
  anchor: { row: 0, column: 0 },
  priority,
  stop,
  rule
})

/** The look of each cell of the column, after its conditions. */
function looksAfter(values: FormulaValue[], ...conditions: Condition[]) {
  const { look, data } = sheet(values)
  const after = withConditions(look, conditions, data)
  return { after, looks: after.cells.map((row) => after.looks[row[0] ?? -1]) }
}

describe('a sheet’s conditional formats', () => {
  it.each<[string, ConditionRule, FormulaValue[], boolean[]]>([
    ['a value greater than another', { kind: 'compare', operator: '>', operands: [formula('5')], look: RED }, [3, 5, 8, null], [false, false, true, false]],
    [
      'a value between two, either way round',
      { kind: 'compare', operator: 'between', operands: [formula('10'), formula('2')], look: RED },
      [1, 2, 10, 11],
      [false, true, true, false]
    ],
    [
      'a value not between two',
      { kind: 'compare', operator: 'notBetween', operands: [formula('2'), formula('10')], look: RED },
      [1, 5, 11],
      [true, false, true]
    ],
    [
      'a text equal to another whatever its case',
      { kind: 'compare', operator: '=', operands: [formula('"done"')], look: RED },
      ['Done', 'open'],
      [true, false]
    ],
    ['a blank as nothing compared with a number', { kind: 'compare', operator: '<', operands: [formula('5')], look: RED }, [null, 7], [true, false]],
    ['a formula that holds for the row', { kind: 'formula', formula: formula('MOD(ROW(),2)=0'), look: RED }, [1, 2, 3, 4], [false, true, false, true]],
    ['a formula naming the cell itself', { kind: 'formula', formula: formula('A1>A2'), look: RED }, [5, 3, 4, 9], [true, false, false, true]],
    ['a text it holds', { kind: 'text', test: 'contains', text: 'AN', look: RED }, ['banana', 'kiwi', 12, null], [true, false, false, false]],
    ['a text it does not hold', { kind: 'text', test: 'notContains', text: 'an', look: RED }, ['banana', 'kiwi', null], [false, true, true]],
    ['a text it starts with', { kind: 'text', test: 'beginsWith', text: 'ki', look: RED }, ['Kiwi', 'skin'], [true, false]],
    ['a text it ends with', { kind: 'text', test: 'endsWith', text: 'Wi', look: RED }, ['kiwi', 'wild'], [true, false]],
    ['a blank', { kind: 'blank', blank: true, look: RED }, [null, '  ', 'x', 0], [true, true, false, false]],
    ['an error', { kind: 'error', error: true, look: RED }, [{ error: '#N/A' }, 1], [true, false]],
    ['the two highest', { kind: 'rank', count: 2, percent: false, bottom: false, look: RED }, [4, 9, 1, 7, 'x'], [false, true, false, true, false]],
    ['the lowest 25 in a hundred', { kind: 'rank', count: 25, percent: true, bottom: true, look: RED }, [4, 9, 1, 7], [false, false, true, false]],
    ['above the average', { kind: 'average', above: true, equal: false, deviations: 0, look: RED }, [1, 2, 4, 6], [false, false, true, true]],
    ['below or at the average', { kind: 'average', above: false, equal: true, deviations: 0, look: RED }, [1, 2, 3, 6], [true, true, true, false]],
    [
      'a standard deviation above the average',
      { kind: 'average', above: true, equal: false, deviations: 1, look: RED },
      [1, 1, 1, 1, 10],
      [false, false, false, false, true]
    ],
    [
      'a value another cell holds too',
      { kind: 'repeated', unique: false, look: RED },
      ['a', 'A', 'b', 3, 3, null, null],
      [true, true, false, true, true, false, false]
    ],
    ['a value no other cell holds', { kind: 'repeated', unique: true, look: RED }, ['a', 'A', 'b', 3], [false, false, true, true]],
    [
      'a day of this week, counted from Sunday',
      { kind: 'date', period: 'thisWeek', look: RED },
      [serialOf(2026, 11, 15, false), serialOf(2026, 11, 21, false), serialOf(2026, 11, 22, false), 'x'],
      [true, true, false, false]
    ],
    [
      'a day of the last seven',
      { kind: 'date', period: 'last7Days', look: RED },
      [serialOf(2026, 11, 13, false), serialOf(2026, 11, 12, false), serialOf(2026, 11, 19, false) + 0.75],
      [true, false, true]
    ],
    ['a day of last month', { kind: 'date', period: 'lastMonth', look: RED }, [serialOf(2026, 10, 31, false), serialOf(2026, 11, 1, false)], [true, false]]
  ])('fills the cells of %s', (_, rule, values, filled) => {
    const { looks } = looksAfter(values, over(values.length, rule))
    expect(looks.map((look) => look?.fill === '#ffc7ce')).toEqual(filled)
    for (const [index, look] of looks.entries()) if (filled[index]) expect(look?.text).toEqual({ ...plain.text, color: '#9c0006' })
  })

  it('takes each part of a look from the first condition that sets it, and stops where a condition that holds says so', () => {
    const values = [8, 3]
    const { looks } = looksAfter(
      values,
      over(2, { kind: 'compare', operator: '>', operands: [formula('5')], look: BOLD }, 1),
      over(2, { kind: 'compare', operator: '>', operands: [formula('0')], look: { text: { bold: false, italic: true }, fill: '#00ff00' } }, 2)
    )
    expect(looks[0]).toMatchObject({ fill: '#00ff00', text: { bold: true, italic: true } })
    expect(looks[1]).toMatchObject({ fill: '#00ff00', text: { bold: false, italic: true } })
    const stopped = looksAfter(
      values,
      over(2, { kind: 'compare', operator: '>', operands: [formula('5')], look: BOLD }, 1, true),
      over(2, { kind: 'compare', operator: '>', operands: [formula('0')], look: { fill: '#00ff00' } }, 2)
    )
    expect(stopped.looks[0]).toMatchObject({ text: { bold: true } })
    expect(stopped.looks[0]?.fill).toBeUndefined()
    expect(stopped.looks[1]?.fill).toBe('#00ff00')
    // A condition of a group stops only the others of its group.
    const grouped = looksAfter(
      values,
      { ...over(2, { kind: 'compare', operator: '>', operands: [formula('5')], look: BOLD }, 1, true), group: 1 },
      { ...over(2, { kind: 'compare', operator: '>', operands: [formula('0')], look: { text: { italic: true } } }, 2, true), group: 1 },
      { ...over(2, { kind: 'compare', operator: '>', operands: [formula('0')], look: { fill: '#00ff00' } }, 3, true), group: 2 }
    )
    expect(grouped.looks[0]).toMatchObject({ fill: '#00ff00', text: { bold: true } })
    expect(grouped.looks[0]?.text.italic).toBeUndefined()
    expect(grouped.looks[1]).toMatchObject({ fill: '#00ff00', text: { italic: true } })
  })

  it('leaves a sheet with no condition, or none that holds, as it was, its looks shared', () => {
    const { look, data } = sheet([1, 2, 3])
    expect(withConditions(look, [], data)).toBe(look)
    const after = withConditions(look, [over(3, { kind: 'compare', operator: '>', operands: [formula('5')], look: RED })], data)
    expect(after.looks).toEqual([plain])
    expect(after.marks).toBeUndefined()
    const twice = withConditions(look, [over(3, { kind: 'compare', operator: '>', operands: [formula('1')], look: RED })], data)
    expect(twice.looks).toHaveLength(2)
    expect(twice.cells).toEqual([[0], [1], [1]])
  })

  it('fills a number’s cell on a scale of two or three colours, between its stops', () => {
    const lowest: Threshold = { kind: 'lowest' }
    const highest: Threshold = { kind: 'highest' }
    const { looks } = looksAfter(
      [0, 5, 10, 'text'],
      over(4, {
        kind: 'scale',
        stops: [
          { threshold: lowest, color: '#ff0000' },
          { threshold: { kind: 'percentile', value: formula('50') }, color: '#ffffff' },
          { threshold: highest, color: '#0000ff' }
        ]
      })
    )
    expect(looks.map((look) => look?.fill)).toEqual(['#ff0000', '#ffffff', '#0000ff', undefined])
    const two = looksAfter(
      [0, 2.5, 10],
      over(3, {
        kind: 'scale',
        stops: [
          { threshold: { kind: 'number', value: formula('0') }, color: '#000000' },
          { threshold: { kind: 'number', value: formula('10') }, color: '#ffffff' }
        ]
      })
    )
    expect(two.looks[1]?.fill).toBe('#404040')
  })

  it('draws a number’s bar between its shortest and longest, and back from an axis for a negative one', () => {
    const bar: ConditionRule = {
      kind: 'bar',
      low: { kind: 'lowest' },
      high: { kind: 'highest' },
      color: '#638ec6',
      gradient: true,
      axis: false,
      shown: true,
      least: 10,
      most: 90
    }
    const { after } = looksAfter([0, 5, 10, null], over(4, bar))
    expect(after.marks?.map((row) => row?.[0]?.bar?.end)).toEqual([0.1, 0.5, 0.9])
    expect(after.marks?.[3]).toBeUndefined()
    const axis = looksAfter(
      [-5, 10, 5],
      over(3, {
        ...bar,
        low: { kind: 'automatic-lowest' },
        high: { kind: 'automatic-highest' },
        axis: true,
        negative: '#ff0000',
        gradient: false,
        shown: false
      })
    )
    expect(axis.after.marks?.[0]?.[0]).toEqual({
      bar: { start: 0, end: 1 / 3, color: '#ff0000', axis: 1 / 3, gradient: false, border: undefined },
      hidden: true
    })
    expect(axis.after.marks?.[1]?.[0]?.bar).toMatchObject({ start: 1 / 3, end: 1, color: '#638ec6' })
  })

  it('gives a number the icon of the last step it reaches, from the other end where the set is reversed', () => {
    const percent = (value: string): Threshold => ({ kind: 'percent', value: formula(value) })
    const icons: ConditionRule = {
      kind: 'icons',
      set: '3Arrows',
      steps: [
        { threshold: percent('0'), atLeast: true },
        { threshold: percent('33'), atLeast: true },
        { threshold: percent('67'), atLeast: true }
      ],
      reverse: false,
      shown: true
    }
    const { after } = looksAfter([0, 33, 50, 67, 100], over(5, icons))
    expect(after.marks?.map((row) => row?.[0]?.icon?.index)).toEqual([0, 1, 1, 2, 2])
    const reversed = looksAfter([0, 100], over(2, { ...icons, reverse: true }))
    expect(reversed.after.marks?.map((row) => row?.[0]?.icon?.index)).toEqual([2, 0])
    const own = looksAfter(
      [0, 100],
      over(2, {
        ...icons,
        steps: [
          { threshold: percent('0'), atLeast: true, icon: { set: 'NoIcons', index: 0 } },
          { threshold: percent('50'), atLeast: false, icon: { set: '3Stars', index: 2 } }
        ]
      })
    )
    expect(own.after.marks?.[0]).toBeUndefined()
    expect(own.after.marks?.[1]?.[0]?.icon).toEqual({ set: '3Stars', index: 2 })
  })

  it('sets what a condition sets over each stretch of a cell’s text in a font of its own', () => {
    const { look, data } = sheet(['Total due'])
    const after = withConditions(
      {
        ...look,
        runs: [
          [
            [
              { start: 0, text: { bold: true } },
              { start: 6, text: { italic: true } }
            ]
          ]
        ]
      },
      [over(1, { kind: 'text', test: 'contains', text: 'due', look: RED })],
      data
    )
    expect(after.runs?.[0]?.[0]).toEqual([
      { start: 0, text: { bold: true, color: '#9c0006' } },
      { start: 6, text: { italic: true, color: '#9c0006' } }
    ])
  })

  it.each<[Parameters<typeof cellValue>, FormulaValue]>([
    [['number', '1,234.00', 1234], 1234],
    [['text', 'Apple', undefined], 'Apple'],
    [['logical', 'TRUE', undefined], true],
    [['error', '#N/A', undefined], { error: '#N/A' }],
    [['empty', '', undefined], null],
    [[undefined, undefined, undefined], null]
  ])('reads a cell %j as the value %j', (read, value) => {
    expect(cellValue(...read)).toEqual(value)
  })

  it('counts now as the workbook counts days', () => {
    expect(Math.floor(serialNow(false, new Date(2026, 10, 19, 18, 0)))).toBe(46345)
    expect(serialNow(false, new Date(2026, 10, 19, 18, 0)) % 1).toBeCloseTo(0.75)
    expect(Math.floor(serialNow(true, new Date(2026, 10, 19)))).toBe(46345 - 1462)
  })
})
