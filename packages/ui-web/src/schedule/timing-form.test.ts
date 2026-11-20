import type { Timing } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { type Clocked, formOf, localNow, type TimingForm, timingOf } from './timing-form.ts'

const NOW = '2026-11-19T01:30'
const base: TimingForm = formOf({ kind: 'daily', time: '08:00' }, '2026-11-19')

describe('the timing the editor reads back', () => {
  it.each<[string, Partial<TimingForm>, Timing | string]>([
    ['once, to come', { often: 'once', date: '2026-11-19', time: '08:00' }, { kind: 'once', at: '2026-11-19T08:00' }],
    ['once, passed', { often: 'once', date: '2026-11-19', time: '01:30' }, 'That time has passed: pick one to come.'],
    ['once, with no day', { often: 'once', date: '' }, 'Pick a day and a time.'],
    ['every day', { often: 'daily', time: '07:30' }, { kind: 'daily', time: '07:30' }],
    ['every weekday, with no time', { often: 'weekdays', time: '' }, 'Pick a time.'],
    ['every week, its days in order', { often: 'weekly', days: ['friday', 'monday'] }, { kind: 'weekly', time: '08:00', days: ['monday', 'friday'] }],
    ['every week, with no day', { often: 'weekly', days: [] }, 'Pick at least one day.'],
    ['every month', { often: 'monthly', day: 31 }, { kind: 'monthly', time: '08:00', day: 31 }],
    ['every month, a day that is none', { often: 'monthly', day: 32 }, 'Pick a day of the month, from 1 to 31.'],
    ['every few hours', { often: 'hourly', every: 2, from: '09:00', until: '17:00' }, { kind: 'hourly', every: 2, from: '09:00', until: '17:00' }],
    ['every few hours, ending before it starts', { often: 'hourly', from: '17:00', until: '09:00' }, 'The last time comes after the first, the same day.'],
    ['every few hours, too far apart', { often: 'hourly', every: 13 }, 'Every 1 to 12 hours.']
  ])('%s', (_case, changed, expected) => {
    const read = timingOf({ ...base, ...changed }, NOW)
    expect(read).toEqual(typeof expected === 'string' ? { ok: false, problem: expected } : { ok: true, timing: expected })
  })

  it.each<Clocked>([
    { kind: 'once', at: '2026-12-24T19:00' },
    { kind: 'weekdays', time: '07:30' },
    { kind: 'weekly', time: '18:00', days: ['tuesday', 'thursday'] },
    { kind: 'monthly', time: '09:00', day: 1 },
    { kind: 'hourly', every: 3, from: '08:00', until: '20:00' }
  ])('gives back $kind as it was, untouched', (timing) => {
    expect(timingOf(formOf(timing, '2026-11-19'), NOW)).toEqual({ ok: true, timing })
  })

  it('reads the clock in the zone the jobs ring in', () => {
    expect(localNow(new Date('2026-11-19T00:30:00Z'), 'Europe/Paris')).toBe('2026-11-19T01:30')
    expect(localNow(new Date('2026-11-19T00:30:00Z'), 'America/Montreal')).toBe('2026-11-18T19:30')
  })
})
