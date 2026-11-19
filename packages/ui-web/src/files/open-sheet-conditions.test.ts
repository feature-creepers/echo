import { describe, expect, it } from 'vitest'
import type { ConditionRule } from './conditional-formats.ts'
import { readOpenBlocks, readOpenRule, styleName } from './open-sheet-conditions.ts'
import { openSerial } from './open-sheet-look.ts'
import { serialOf } from './sheet-formula.ts'

describe('an OpenDocument sheet’s conditional formats', () => {
  it.each<[string, Partial<ConditionRule> | undefined]>([
    ['>5', { kind: 'compare', operator: '>' }],
    ['!=[.$B$1]', { kind: 'compare', operator: '<>' }],
    ['cell-content()<=10', { kind: 'compare', operator: '<=' }],
    ['between(1,10)', { kind: 'compare', operator: 'between' }],
    ['not-between(1;[.A1])', { kind: 'compare', operator: 'notBetween' }],
    ['cell-content-is-between(1,10)', { kind: 'compare', operator: 'between' }],
    ['formula-is(MOD(ROW();2)=0)', { kind: 'formula' }],
    ['is-true-formula(of:[.A1]>0)', { kind: 'formula' }],
    ['contains-text("a,b")', { kind: 'text', test: 'contains', text: 'a,b' }],
    ['begins-with("Re")', { kind: 'text', test: 'beginsWith', text: 'Re' }],
    ['top-elements(5)', { kind: 'rank', count: 5, bottom: false, percent: false }],
    ['bottom-percent(10)', { kind: 'rank', count: 10, bottom: true, percent: true }],
    ['above-equal-average', { kind: 'average', above: true, equal: true }],
    ['below-average', { kind: 'average', above: false, equal: false }],
    ['duplicate', { kind: 'repeated', unique: false }],
    ['is-no-error', { kind: 'error', error: false }],
    ['between(1)', undefined],
    ['contains-text([.A1])', undefined],
    ['cell-content-is-whole-number()', undefined],
    ['>[$Other.A1]', undefined]
  ])('reads the condition %s', (value, rule) => {
    const read = readOpenRule(value, {}, 'Sheet1')
    if (rule === undefined) expect(read).toBeUndefined()
    else expect(read).toMatchObject(rule)
  })

  it.each([
    ['Good', 'Good'],
    ['Accent 1', 'Accent_20_1'],
    ['ConditionalStyle_15', 'ConditionalStyle_5f_15'],
    ['Note.2-b', 'Note.2-b']
  ])('finds the style a person sees as %s by its name %s', (shown, name) => {
    expect(styleName(shown)).toBe(name)
  })

  it('reads the cells a format applies to, its sheets named quoted or not', () => {
    expect(readOpenBlocks("Sheet1.A1:Sheet1.B5 'My sheet'.$D$2 'It''s'.C3:'It''s'.A1")).toEqual([
      { row: 0, column: 0, rows: 5, columns: 2 },
      { row: 1, column: 3, rows: 1, columns: 1 },
      { row: 0, column: 0, rows: 3, columns: 3 }
    ])
  })

  it.each<[string | undefined, string | undefined, number | undefined]>([
    ['2026-11-19', undefined, serialOf(2026, 11, 19, false)],
    ['2026-11-19T18:00:00', undefined, serialOf(2026, 11, 19, false) + 0.75],
    [undefined, 'PT12H30M00S', 12.5 / 24],
    [undefined, undefined, undefined],
    ['soon', undefined, undefined]
  ])('counts the date %s and the time %s as a day of the sheet', (date, time, serial) => {
    expect(openSerial(date, time)).toBe(serial)
  })
})
