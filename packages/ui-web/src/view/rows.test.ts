import { describe, expect, it } from 'vitest'
import { inRows, type ViewWidth } from './rows.ts'

/** Cards of these widths, a dash for one the assistant gave none, laid out and read back as each row's spans. */
const spans = (widths: string, stacked = false) =>
  inRows(
    widths.split(' ').map((width) => (width === '-' ? {} : { width: width as ViewWidth })),
    stacked
  ).map((row) => row.map((placed) => placed.span).join('+'))

describe('the cards of an answer in rows', () => {
  it.each([
    ['one card across the whole row', '-', ['12']],
    ['two cards half each', '- -', ['6+6']],
    ['three cards a third each', '- - -', ['4+4+4']],
    ['four cards two by two', '- - - -', ['6+6', '6+6']],
    ['five cards in thirds, the last row filled', '- - - - -', ['4+4+4', '4+8']],
    ['a main card and what supports it', 'two-thirds third', ['8+4']],
    ['a full card on a row of its own', 'third full third', ['12', '12', '12']],
    ['what does not fit on the next row', 'two-thirds half', ['12', '12']],
    ['a card with no width as a half beside one that has', 'half -', ['6+6']],
    ['the last card grown to fill its row', 'third third', ['4+8']],
    ['thirds then a main card', 'third third third two-thirds', ['4+4+4', '12']]
  ])('lays %s', (_case, widths, rows) => {
    expect(spans(widths)).toEqual(rows)
  })

  it('stacks every card on a row of its own in a narrow window', () => {
    expect(spans('two-thirds third -', true)).toEqual(['12', '12', '12'])
  })

  it('lays no card as no row', () => {
    expect(inRows([], false)).toEqual([])
  })
})
