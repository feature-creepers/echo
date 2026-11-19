import { describe, expect, it } from 'vitest'
import { type ConditionRecord, readOlderConditions } from './older-sheet-conditions.ts'
import { PALETTE } from './sheet-look.ts'

const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)]
const f64 = (value: number) => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value, true)
  return Array.from({ length: 8 }, (_, index) => view.getUint8(index))
}
const zeros = (count: number) => Array.from({ length: count }, () => 0)

/** A block of cells (`Ref8U`): its first and last rows, then columns. */
const ref = (rows: [number, number], columns: [number, number]) => [...u16(rows[0]), ...u16(rows[1]), ...u16(columns[0]), ...u16(columns[1])]
/** A threshold (`CFVO`): its kind, then a number given. */
const threshold = (kind: number, value?: number) => [kind, ...u16(0), ...(value === undefined ? [] : f64(value))]
/** A colour in full (`CFColor`), or of the theme. */
const rgb = (red: number, green: number, blue: number) => [...u32(2), red, green, blue, 0, ...f64(0)]
const themed = (index: number, tint: number) => [...u32(3), ...u32(index), ...f64(tint)]

const COLORS = { palette: PALETTE, theme: ['#ffffff', '#000000', '#eeece1', '#1f497d', '#4f81bd'] }

/** A block of Excel 2007's rules over B2:B9, its identifier 2. */
const block = (count: number): ConditionRecord => ({
  type: 0x0879,
  bytes: new Uint8Array([
    ...u16(0x0879),
    ...u16(1),
    ...ref([1, 8], [1, 1]),
    ...u16(count),
    ...u16(2 << 1),
    ...ref([1, 8], [1, 1]),
    ...u16(1),
    ...ref([1, 8], [1, 1])
  ])
})

/** A rule of Excel 2007 (`CF12`) with no look of its own unless given, and its own part. */
function rule(
  kind: number,
  own: number[],
  options: { template?: number; parameters?: number[]; first?: number[]; priority?: number; stop?: boolean } = {}
): ConditionRecord {
  const first = options.first ?? []
  const parameters = options.parameters ?? []
  return {
    type: 0x087a,
    bytes: new Uint8Array([
      ...u16(0x087a),
      ...u16(0),
      ...zeros(8),
      kind,
      0,
      ...u16(first.length),
      ...u16(0),
      ...u32(0),
      0,
      0,
      ...first,
      ...u16(0),
      options.stop ? 0x02 : 0,
      ...u16(options.priority ?? 1),
      ...u16(options.template ?? 0),
      16,
      ...parameters,
      ...zeros(16 - parameters.length),
      ...own
    ])
  }
}

describe('the conditional formats of a workbook of Excel 97 to 2003', () => {
  it('reads Excel 2007’s data bars, icon sets, scales and filters over the cells of their block', () => {
    const records = [
      block(4),
      rule(4, [0, 0, 0, 0, 10, 90, ...rgb(0x63, 0x8e, 0xc6), ...threshold(2), ...threshold(3)], { priority: 3 }),
      rule(6, [0, 0, 0, 3, 0, 0x05, ...threshold(4, 0), 1, ...zeros(4), ...threshold(4, 33), 1, ...zeros(4), ...threshold(4, 67), 0, ...zeros(4)], {
        priority: 4
      }),
      rule(3, [0, 0, 0, 2, 2, 3, ...threshold(2), ...f64(0), ...threshold(5, 50), ...f64(1), ...f64(0), ...rgb(0xff, 0, 0), ...f64(1), ...themed(4, 0)], {
        priority: 5
      }),
      rule(5, [...u16(4), 0, 0x02, ...u16(10)], { priority: 6, stop: true })
    ]
    const [bar, icons, scale, filter] = readOlderConditions(records, COLORS)
    // A bar's second flag hides its value, as Excel writes it.
    const hidden = rule(4, [0, 0, 0, 0x02, 0, 100, ...rgb(0, 0, 0), ...threshold(2), ...threshold(3)])
    expect(readOlderConditions([block(1), hidden], COLORS)[0]?.rule).toMatchObject({ kind: 'bar', shown: false, least: 0, most: 100 })
    expect(bar).toMatchObject({
      blocks: [{ row: 1, column: 1, rows: 8, columns: 1 }],
      anchor: { row: 1, column: 1 },
      priority: 3,
      stop: false,
      rule: { kind: 'bar', low: { kind: 'lowest' }, high: { kind: 'highest' }, color: '#638ec6', shown: true, least: 10, most: 90 }
    })
    expect(icons?.rule).toMatchObject({ kind: 'icons', set: '3Arrows', reverse: true, shown: false })
    expect(icons?.rule.kind === 'icons' && icons.rule.steps.map((step) => [step.threshold, step.atLeast])).toEqual([
      [{ kind: 'percent', value: { kind: 'value', value: 0 } }, true],
      [{ kind: 'percent', value: { kind: 'value', value: 33 } }, true],
      [{ kind: 'percent', value: { kind: 'value', value: 67 } }, false]
    ])
    expect(scale?.rule).toEqual({
      kind: 'scale',
      stops: [
        { threshold: { kind: 'lowest' }, color: '#ff0000' },
        { threshold: { kind: 'percentile', value: { kind: 'value', value: 50 } }, color: '#4f81bd' }
      ]
    })
    expect(filter).toMatchObject({ priority: 6, stop: true, rule: { kind: 'rank', count: 10, percent: true, bottom: true } })
  })

  it.each<[string, number, number[], number[], object]>([
    ['above the average by a standard deviation', 0x19, [...u16(1)], [], { kind: 'average', above: true, equal: false, deviations: 1 }],
    ['below or at the average', 0x1e, [], [], { kind: 'average', above: false, equal: true, deviations: 0 }],
    ['a value repeated', 0x1b, [], [], { kind: 'repeated', unique: false }],
    ['a blank', 0x09, [], [], { kind: 'blank', blank: true }],
    ['no error', 0x0c, [], [], { kind: 'error', error: false }],
    ['a day of last week', 0x17, [], [], { kind: 'date', period: 'lastWeek' }],
    [
      'a text it starts with, from its formula',
      0x08,
      [...u16(2)],
      [0x17, 4, 0, ...'late'.split('').map((one) => one.charCodeAt(0))],
      { kind: 'text', test: 'beginsWith', text: 'late' }
    ],
    ['a formula of its own', 0x01, [], [0x1d, 1], { kind: 'formula', formula: { kind: 'value', value: true } }]
  ])('reads Excel 2007’s template of %s', (_, template, parameters, first, read) => {
    expect(readOlderConditions([block(1), rule(2, [], { template, parameters, first })], COLORS)[0]?.rule).toMatchObject(read)
  })

  it('gives a condition of Excel 97 the order and the stop Excel 2007 adds to it, and leaves out one it turned off', () => {
    const header: ConditionRecord = {
      type: 0x01b0,
      bytes: new Uint8Array([...u16(1), ...u16(3 << 1), ...ref([0, 4], [0, 0]), ...u16(1), ...ref([0, 4], [0, 0])])
    }
    const flags = 0x0000ffff | (1 << 17) | (1 << 19) | (1 << 20) | 0x2000_0000
    const condition: ConditionRecord = {
      type: 0x01b1,
      bytes: new Uint8Array([1, 5, ...u16(3), ...u16(0), ...u32(flags), ...u16(0), ...u16(1 << 10), ...u16(0x40 | (13 << 7)), 0x1e, ...u16(10)])
    }
    const added = (on: number): ConditionRecord => ({
      type: 0x087b,
      bytes: new Uint8Array([...u16(0x087b), ...u16(1), ...ref([0, 4], [0, 0]), ...u32(0), ...u16(3), ...u16(0), 5, 0, ...u16(7), on, 0, 16, ...zeros(16)])
    })
    expect(readOlderConditions([header, condition], COLORS)[0]).toMatchObject({
      priority: 0,
      stop: true,
      group: 0,
      rule: { kind: 'compare', look: { fill: '#ffff00' } }
    })
    const ordered = readOlderConditions([header, condition, added(0x03)], COLORS)[0]
    expect(ordered).toMatchObject({ priority: 7, stop: true })
    expect(ordered?.group).toBeUndefined()
    expect(readOlderConditions([header, condition, added(0x00)], COLORS)).toEqual([])
    // Records cut short, or out of their block, are passed over.
    expect(readOlderConditions([{ type: 0x01b0, bytes: new Uint8Array(4) }, condition, rule(4, [0, 0])], COLORS)).toEqual([])
  })
})
