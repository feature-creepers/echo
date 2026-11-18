/**
 * Clocks on the wall of a time zone, and the instants they show: what lets a job set for 8:00 ring at 8:00 on the
 * person's clock, the day the clocks change included. Only the `Intl` of the place the core runs in is used, which
 * knows the rules of every zone.
 */

/** A date with no zone, as a calendar shows it. `month` runs from 1 to 12. */
export interface WallDate {
  year: number
  month: number
  day: number
}

/** A date and a time of day with no zone, as a clock on a wall shows it. */
export interface WallTime extends WallDate {
  hour: number
  minute: number
  second: number
}

const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatterFor = (zone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

/** Whether a zone is one this place knows, by its IANA name. */
export function knownZone(zone: string): boolean {
  try {
    formatterFor(zone)
    return true
  } catch {
    return false
  }
}

/** What a zone's clock shows at an instant, in milliseconds since 1970. */
export function wallTimeAt(instant: number, zone: string): WallTime {
  const parts = formatterFor(zone).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((one) => one.type === type)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour') % 24, minute: part('minute'), second: part('second') }
}

/** A wall time read as if it were in UTC: what makes two of them comparable, and calendar arithmetic simple. */
const asUtc = (wall: WallTime) => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)

/** How far a zone's clock is ahead of UTC at an instant, in milliseconds. */
export function offsetAt(instant: number, zone: string): number {
  const second = Math.floor(instant / 1000) * 1000
  return asUtc(wallTimeAt(second, zone)) - second
}

/**
 * The instant a zone's clock shows a wall time. A time the clocks skip when they go forward is taken as that long
 * after (2:30 on the night they jump from 2:00 to 3:00 is 3:30), and a time they show twice when they go back is the
 * first of the two, as the alarms of phones do.
 */
export function instantOf(wall: WallTime, zone: string): number {
  const local = asUtc(wall)
  // A zone changes its offset at most once in two days: the offsets a day either side are the only candidates.
  const before = offsetAt(local - DAY_MS, zone)
  const after = offsetAt(local + DAY_MS, zone)
  const shown = [before, after].map((offset) => local - offset).filter((instant) => asUtc(wallTimeAt(instant, zone)) === local)
  return shown.length > 0 ? Math.min(...shown) : local - before
}

/** The date `days` after the one given, on a calendar, with no zone to change it. */
export function addDays(date: WallDate, days: number): WallDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

/** The day of the week of a date, from 0 for Monday to 6 for Sunday. */
export function weekdayOf(date: WallDate): number {
  return (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7
}

/** How many days a month has. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Whether two dates are the same day. */
export const sameDate = (one: WallDate, other: WallDate) => one.year === other.year && one.month === other.month && one.day === other.day
