import { describe, expect, it } from 'vitest'
import { DEFAULT_QUIET, isQuiet } from './quiet.ts'

const PARIS = 'Europe/Paris'
/** An instant at this time of day in Paris, on a winter's day. */
const at = (clock: string) => Date.parse(`2026-11-18T${clock}:00+01:00`)

describe('the quiet hours', () => {
  it.each([
    ['22:59', false],
    ['23:00', true],
    ['03:00', true],
    ['07:29', true],
    ['07:30', false],
    ['12:00', false]
  ])('by default, at %s, quiet is %s', (clock, quiet) => {
    expect(isQuiet(DEFAULT_QUIET, at(clock), PARIS)).toBe(quiet)
  })

  it('can sit within one day', () => {
    const afternoon = { on: true, from: '13:00', until: '15:00' }
    expect([isQuiet(afternoon, at('12:59'), PARIS), isQuiet(afternoon, at('13:00'), PARIS), isQuiet(afternoon, at('15:00'), PARIS)]).toEqual([
      false,
      true,
      false
    ])
  })

  it('are none when turned off, or when they start and end together', () => {
    expect(isQuiet({ ...DEFAULT_QUIET, on: false }, at('03:00'), PARIS)).toBe(false)
    expect(isQuiet({ on: true, from: '08:00', until: '08:00' }, at('08:00'), PARIS)).toBe(false)
  })
})
