import { describe, expect, it } from 'vitest'
import { addDays, daysInMonth, instantOf, offsetAt, wallTimeAt, weekdayOf } from './zoned.ts'

const wall = (text: string) => {
  const [date = '', time = ''] = text.split(' ')
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return { year, month, day, hour, minute, second: 0 }
}
const utc = (instant: number) => new Date(instant).toISOString().slice(0, 16)

describe('the instant a clock shows', () => {
  it.each([
    // An ordinary winter and summer time, either side of the Atlantic.
    ['Europe/Paris', '2026-11-18 08:00', '2026-11-18T07:00'],
    ['Europe/Paris', '2026-07-01 08:00', '2026-07-01T06:00'],
    ['America/New_York', '2026-11-18 08:00', '2026-11-18T13:00'],
    ['Asia/Tokyo', '2026-11-18 08:00', '2026-11-17T23:00'],
    ['Asia/Kolkata', '2026-11-18 08:00', '2026-11-18T02:30'],
    // The night Paris goes forward, 2:00 becomes 3:00: 2:30 does not exist, and is taken as 3:30.
    ['Europe/Paris', '2026-03-29 02:30', '2026-03-29T01:30'],
    ['Europe/Paris', '2026-03-29 03:00', '2026-03-29T01:00'],
    ['Europe/Paris', '2026-03-29 01:59', '2026-03-29T00:59'],
    // The night Paris goes back, 3:00 becomes 2:00: 2:30 is shown twice, and the first is taken.
    ['Europe/Paris', '2026-10-25 02:30', '2026-10-25T00:30'],
    ['Europe/Paris', '2026-10-25 03:00', '2026-10-25T02:00'],
    // New York goes forward at 2:00 on the second Sunday of March, and back on the first Sunday of November.
    ['America/New_York', '2026-03-08 02:30', '2026-03-08T07:30'],
    ['America/New_York', '2026-11-01 01:30', '2026-11-01T05:30']
  ])('in %s, %s is %s UTC', (zone, local, expected) => {
    expect(utc(instantOf(wall(local), zone))).toBe(expected)
  })

  it('reads back as the same wall time, except in a skipped hour', () => {
    const instant = instantOf(wall('2026-11-18 08:00'), 'Europe/Paris')
    expect(wallTimeAt(instant, 'Europe/Paris')).toEqual(wall('2026-11-18 08:00'))
    expect(wallTimeAt(instantOf(wall('2026-03-29 02:30'), 'Europe/Paris'), 'Europe/Paris')).toEqual(wall('2026-03-29 03:30'))
  })

  it('knows the offset either side of a change', () => {
    expect(offsetAt(Date.parse('2026-03-29T00:59:00Z'), 'Europe/Paris')).toBe(3_600_000)
    expect(offsetAt(Date.parse('2026-03-29T01:00:00Z'), 'Europe/Paris')).toBe(7_200_000)
  })
})

describe('the calendar', () => {
  it('moves across months and years', () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 })
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({ year: 2028, month: 2, day: 29 })
  })

  it('names the day of the week from Monday', () => {
    expect(weekdayOf({ year: 2026, month: 11, day: 16 })).toBe(0)
    expect(weekdayOf({ year: 2026, month: 11, day: 22 })).toBe(6)
  })

  it('counts the days of a month, leap years included', () => {
    expect([daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2026, 4), daysInMonth(2026, 12)]).toEqual([28, 29, 30, 31])
  })
})
