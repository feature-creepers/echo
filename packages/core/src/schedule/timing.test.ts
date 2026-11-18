import type { Timing } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { momentWords, nextTime, readTiming, timingWords } from './timing.ts'

const PARIS = 'Europe/Paris'
/** Wednesday 18 November 2026, 14:13 in Paris. */
const NOW = Date.parse('2026-11-18T13:13:20Z')
const iso = (instant: number | undefined) => (instant === undefined ? undefined : new Date(instant).toISOString().slice(0, 16))

describe('reading the timing a model gives', () => {
  it.each<[string, unknown, Timing]>([
    ['a local date and time', { kind: 'once', at: '2026-11-19T08:00' }, { kind: 'once', at: '2026-11-19T08:00' }],
    ['minutes from now, to the second', { kind: 'once', inMinutes: 2 }, { kind: 'once', at: '2026-11-18T14:15:20' }],
    ['every day', { kind: 'daily', time: '07:30' }, { kind: 'daily', time: '07:30' }],
    ['weekdays', { kind: 'weekdays', time: '07:30' }, { kind: 'weekdays', time: '07:30' }],
    [
      'days of the week, in any case and order',
      { kind: 'weekly', time: '18:00', days: ['Thursday', 'monday'] },
      { kind: 'weekly', time: '18:00', days: ['monday', 'thursday'] }
    ],
    ['a day of the month', { kind: 'monthly', time: '09:00', day: 31 }, { kind: 'monthly', time: '09:00', day: 31 }],
    ['every few hours', { kind: 'hourly', every: 2, from: '09:00', until: '17:00' }, { kind: 'hourly', every: 2, from: '09:00', until: '17:00' }],
    ['files arriving, the first time', { kind: 'files', folder: ' ~/Downloads ' }, { kind: 'files', folder: '~/Downloads', repeat: false }],
    [
      'files of a kind, each time',
      { kind: 'files', folder: 'C:\\Scans', pattern: '*.pdf', repeat: true },
      { kind: 'files', folder: 'C:\\Scans', pattern: '*.pdf', repeat: true }
    ]
  ])('takes %s', (_case, input, expected) => {
    expect(readTiming(input, NOW, PARIS)).toEqual({ ok: true, timing: expected })
  })

  it.each([
    ['no kind', {}, /"kind"/],
    ['a day that does not exist', { kind: 'once', at: '2026-02-30T08:00' }, /real local date/],
    ['a moment that has passed', { kind: 'once', at: '2026-11-18T14:00' }, /passed: it is now 2026-11-18T14:13/],
    ['a moment years away', { kind: 'once', at: '2032-01-01T08:00' }, /more than 5 years/],
    ['no time for once', { kind: 'once' }, /"at"/],
    ['less than a minute', { kind: 'once', inMinutes: 0 }, /at least 1/],
    ['a time of day that is not one', { kind: 'daily', time: '25:00' }, /"time" is a time of day/],
    ['no days for weekly', { kind: 'weekly', time: '08:00', days: [] }, /"days"/],
    ['a day that is not a weekday', { kind: 'weekly', time: '08:00', days: ['lundi'] }, /"lundi"/],
    ['a day of the month out of range', { kind: 'monthly', time: '08:00', day: 32 }, /from 1 to 31/],
    ['less than an hour apart', { kind: 'hourly', every: 0, from: '09:00', until: '17:00' }, /from 1 to 12/],
    ['an hour that ends before it starts', { kind: 'hourly', every: 1, from: '17:00', until: '09:00' }, /later time/],
    ['files with no folder', { kind: 'files', pattern: '*.pdf' }, /"folder"/]
  ])('refuses %s, saying why', (_case, input, problem) => {
    const read = readTiming(input, NOW, PARIS)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problem).toMatch(problem)
  })
})

describe('the next time a job rings', () => {
  it.each<[string, Timing, string, string | undefined]>([
    ['once, still to come', { kind: 'once', at: '2026-11-19T08:00' }, '2026-11-18T13:13', '2026-11-19T07:00'],
    ['once, past', { kind: 'once', at: '2026-11-18T08:00' }, '2026-11-18T13:13', undefined],
    ['daily, later today', { kind: 'daily', time: '20:00' }, '2026-11-18T13:13', '2026-11-18T19:00'],
    ['daily, tomorrow', { kind: 'daily', time: '08:00' }, '2026-11-18T13:13', '2026-11-19T07:00'],
    ['weekdays, over the weekend', { kind: 'weekdays', time: '07:30' }, '2026-11-20T08:00', '2026-11-23T06:30'],
    ['weekly, on the next day named', { kind: 'weekly', time: '18:00', days: ['monday', 'thursday'] }, '2026-11-18T13:13', '2026-11-19T17:00'],
    ['monthly on the 31st, in a 30-day month', { kind: 'monthly', time: '09:00', day: 31 }, '2026-11-18T13:13', '2026-11-30T08:00'],
    ['monthly on the 31st, in February', { kind: 'monthly', time: '09:00', day: 31 }, '2027-02-01T00:00', '2027-02-28T08:00'],
    ['every two hours, the next of the day', { kind: 'hourly', every: 2, from: '09:00', until: '17:00' }, '2026-11-18T13:13', '2026-11-18T14:00'],
    ['every two hours, after the last of the day', { kind: 'hourly', every: 2, from: '09:00', until: '17:00' }, '2026-11-18T16:30', '2026-11-19T08:00'],
    // 8:00 stays 8:00 on the person's clock when the clocks change: one hour less in UTC after the change.
    ['daily, across the change to summer time', { kind: 'daily', time: '08:00' }, '2026-03-28T08:00', '2026-03-29T06:00'],
    ['daily, across the change to winter time', { kind: 'daily', time: '08:00' }, '2026-10-24T08:00', '2026-10-25T07:00'],
    ['daily in the skipped hour, rung after it', { kind: 'daily', time: '02:30' }, '2026-03-28T03:00', '2026-03-29T01:30'],
    ['daily in the hour shown twice, rung once', { kind: 'daily', time: '02:30' }, '2026-10-25T00:30', '2026-10-26T01:30']
  ])('%s', (_case, timing, after, expected) => {
    expect(iso(nextTime(timing, Date.parse(`${after}:00Z`), PARIS))).toBe(expected)
  })

  it('follows the clock of the zone it is asked in', () => {
    const timing: Timing = { kind: 'daily', time: '08:00' }
    expect(iso(nextTime(timing, NOW, 'America/New_York'))).toBe('2026-11-19T13:00')
    expect(iso(nextTime(timing, NOW, 'Asia/Tokyo'))).toBe('2026-11-18T23:00')
  })
})

describe('words for a model', () => {
  it('says when a moment comes, from where the day stands', () => {
    expect(momentWords(Date.parse('2026-11-18T13:15:00Z'), NOW, PARIS)).toBe('today at 14:15')
    expect(momentWords(Date.parse('2026-11-19T07:00:00Z'), NOW, PARIS)).toBe('tomorrow at 08:00')
    expect(momentWords(Date.parse('2026-11-23T06:30:00Z'), NOW, PARIS)).toBe('Monday 23 November at 07:30')
    expect(momentWords(Date.parse('2027-01-04T06:30:00Z'), NOW, PARIS)).toBe('Monday 4 January 2027 at 07:30')
  })

  it('says how often, and when next', () => {
    const next = Date.parse('2026-11-19T06:30:00Z')
    expect(timingWords({ kind: 'weekdays', time: '07:30' }, next, NOW, PARIS)).toBe('every weekday at 07:30 (next tomorrow at 07:30)')
    expect(timingWords({ kind: 'once', at: '2026-11-19T07:30' }, next, NOW, PARIS)).toBe('tomorrow at 07:30')
  })

  it.each<[Timing, string]>([
    [{ kind: 'files', folder: 'C:\\Users\\ada\\Downloads', repeat: false }, 'when a file arrives in Downloads'],
    [{ kind: 'files', folder: '/home/ada/Scans/', pattern: '*.pdf', repeat: true }, 'each time a file named *.pdf arrives in Scans']
  ])('says what sets off a job on files, with no time', (timing, words) => {
    expect(timingWords(timing, undefined, NOW, PARIS)).toBe(words)
    expect(nextTime(timing, NOW, PARIS)).toBeUndefined()
  })
})
