import type { Job } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { clockWords, dayOf, howOften, timeOf, whenPast } from './words.ts'

const PARIS = 'Europe/Paris'
/** Wednesday 18 November 2026, 14:13 in Paris. */
const NOW = new Date('2026-11-18T13:13:00Z')

describe('the words of the Reminders page', () => {
  it('writes a time of day as the locale does', () => {
    expect(clockWords('07:30', 'en-US')).toBe('7:30 AM')
    expect(clockWords('19:05', 'en-GB')).toBe('19:05')
    // How a locale pads the hour is its own business: the hour and minutes are what matter.
    expect(clockWords('07:30', 'fr-FR')).toMatch(/^0?7:30$/)
  })

  it('writes the time of an instant on the clock of the zone the jobs ring in', () => {
    expect(timeOf('2026-11-19T07:00:00.000Z', PARIS, 'en-GB')).toMatch(/^0?8:00$/)
    expect(timeOf('2026-11-19T07:00:00.000Z', 'America/New_York', 'en-US')).toBe('2:00 AM')
  })

  it.each([
    ['2026-11-18T20:00:00.000Z', 'Today'],
    ['2026-11-19T07:00:00.000Z', 'Tomorrow'],
    ['2026-11-17T07:00:00.000Z', 'Yesterday'],
    ['2026-11-23T06:30:00.000Z', 'Mon 23 Nov'],
    ['2027-01-04T06:30:00.000Z', 'Mon,? 4 Jan 2027']
  ])('names the day of %s as %s', (instant, words) => {
    expect(dayOf(instant, NOW, PARIS, 'en-GB')).toMatch(new RegExp(`^${words}$`))
  })

  it('says how often in plain words', () => {
    expect(howOften({ kind: 'weekdays', time: '07:30' }, 'en-US')).toBe('Every weekday at 7:30 AM')
    expect(howOften({ kind: 'weekly', time: '18:00', days: ['thursday', 'monday'] }, 'en-GB')).toBe('Every Monday and Thursday at 18:00')
    expect(howOften({ kind: 'monthly', time: '19:00', day: 1 }, 'en-GB')).toBe('On the 1st of every month at 19:00')
    expect(howOften({ kind: 'hourly', every: 2, from: '10:00', until: '18:00' }, 'en-GB')).toBe('Every 2 hours from 10:00 to 18:00')
    expect(howOften({ kind: 'once', at: '2026-11-19T08:00' }, 'en-GB')).toBe('Once')
  })

  it('says when a past job was due', () => {
    const missed: Job = {
      id: 'a',
      kind: 'reminder',
      title: 'Feed the cat',
      timing: { kind: 'once', at: '2026-11-18T08:00' },
      state: 'missed',
      since: '2026-11-17T20:00:00Z'
    }
    expect(whenPast(missed, NOW, PARIS, 'en-GB')).toMatch(/^Today, 0?8:00$/)
    expect(whenPast({ ...missed, state: 'done', last: '2026-11-17T07:00:00.000Z' }, NOW, PARIS, 'en-GB')).toMatch(/^Yesterday, 0?8:00$/)
  })
})
