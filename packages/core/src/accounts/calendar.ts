import { localDateTimeSchema } from '@repo/protocol'
import type { CalendarEvent } from '../ports/accounts.ts'
import { addDays, instantOf, type WallDate, wallTimeAt } from '../schedule/zoned.ts'

/**
 * The calendar as a model reads it (docs/SPEC.md, section 12.1, `calendar`): a span asked on the person's clock, and
 * the events found, in order, each day under its date, times in the person's time zone.
 */

/** The longest span read at once. */
export const MAX_SPAN_DAYS = 62
/** The most events given at once. */
export const MAX_EVENTS = 200
/** How much of an event's description is given. */
const DESCRIPTION_LENGTH = 500

const DAY_MS = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** An event, and the account it is in. */
export interface FoundEvent extends CalendarEvent {
  account: string
}

/** A span to read: two instants, in milliseconds, and how a person says it ("from 3 to 9 December"). */
export type Span = { ok: true; from: number; until: number; words: string } | { ok: false; problem: string }

/** A local date or date and time, read: a date stands for its start, or for its end when `end`. */
function readMoment(text: string, zone: string, end: boolean): number | undefined {
  const date = DATE.exec(text)
  if (date) {
    const wall: WallDate = { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }
    const day = end ? addDays(wall, 1) : wall
    const instant = instantOf({ ...day, hour: 0, minute: 0, second: 0 }, zone)
    return wallTimeAt(instant, zone).day === day.day ? instant : undefined
  }
  if (!localDateTimeSchema.safeParse(text).success) return undefined
  const [year, month, day, hour, minute, second = 0] = text.split(/[-T:]/).map(Number) as [number, number, number, number, number, number?]
  const instant = instantOf({ year, month, day, hour, minute, second }, zone)
  return wallTimeAt(instant, zone).day === day ? instant : undefined
}

/** The span a model asked for, `until` included when it is a date, checked: in order, and 62 days at most. */
export function readSpan(from: string, until: string, zone: string): Span {
  const start = readMoment(from, zone, false)
  const end = readMoment(until, zone, true)
  if (start === undefined) return { ok: false, problem: `"from" is a local date, "2026-12-03", or a date and time, "2026-12-03T14:00": not "${from}".` }
  if (end === undefined) return { ok: false, problem: `"until" is a local date, "2026-12-09", or a date and time, "2026-12-09T18:00": not "${until}".` }
  if (end <= start) return { ok: false, problem: '"until" comes after "from".' }
  // An hour of slack: a span over the night the clocks change is an hour longer or shorter.
  if (end - start > MAX_SPAN_DAYS * DAY_MS + 3_600_000) return { ok: false, problem: `That is more than ${MAX_SPAN_DAYS} days: read it in shorter spans.` }
  return { ok: true, from: start, until: end, words: spanWords(start, end - 1, zone) }
}

const formats = new Map<string, Intl.DateTimeFormat>()
const format = (zone: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${zone}:${JSON.stringify(options)}`
  let found = formats.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options })
    formats.set(key, found)
  }
  return found
}

/** "from 3 to 9 December", "from 28 November to 3 December", "of 3 December". */
export function spanWords(from: number, last: number, zone: string): string {
  const one = wallTimeAt(from, zone)
  const other = wallTimeAt(last, zone)
  const dayMonth = format(zone, { day: 'numeric', month: 'long' })
  const full = format(zone, { day: 'numeric', month: 'long', year: 'numeric' })
  if (one.year === other.year && one.month === other.month && one.day === other.day) return `of ${dayMonth.format(from)}`
  if (one.year !== other.year) return `from ${full.format(from)} to ${full.format(last)}`
  if (one.month === other.month) return `from ${one.day} to ${dayMonth.format(last)}`
  return `from ${dayMonth.format(from)} to ${dayMonth.format(last)}`
}

/** When an event starts, as an instant: an event all day at the start of its first day on the person's clock. */
function startOf(event: CalendarEvent, zone: string): number {
  if (!event.allDay) return Date.parse(event.start)
  const [year = 0, month = 1, day = 1] = event.start.split('-').map(Number)
  return instantOf({ year, month, day, hour: 0, minute: 0, second: 0 }, zone)
}

/** Events in order: by start, an event all day first on its day, then by title. */
export function inOrder(events: readonly FoundEvent[], zone: string): FoundEvent[] {
  return [...events].sort(
    (one, other) => startOf(one, zone) - startOf(other, zone) || Number(other.allDay) - Number(one.allDay) || one.title.localeCompare(other.title)
  )
}

/** "09:00". */
const clock = (instant: number, zone: string) => format(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant)
/** "Thursday 3 December 2026". */
const dayWords = (instant: number, zone: string) =>
  format(zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(instant).replace(',', '')

/** When an event is, on its day: "all day", "09:00–10:00", "23:00 – Friday 4 December 2026 01:00". */
function whenOf(event: CalendarEvent, zone: string): string {
  if (event.allDay) {
    const [year = 0, month = 1, day = 1] = event.end.split('-').map(Number)
    const last = instantOf({ ...addDays({ year, month, day }, -1), hour: 12, minute: 0, second: 0 }, zone)
    return event.end > addDate(event.start, 1) ? `all day, until ${dayWords(last, zone)}` : 'all day'
  }
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  const sameDay = dayWords(start, zone) === dayWords(Math.max(start, end - 1), zone)
  return sameDay ? `${clock(start, zone)}–${clock(end, zone)}` : `${clock(start, zone)} – ${dayWords(end, zone)} ${clock(end, zone)}`
}

/** A date written YYYY-MM-DD, `days` later. */
function addDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const next = addDays({ year, month, day }, days)
  return `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`
}

/** The events, under their days, for a model. They are in order already. */
export function eventLines(events: readonly FoundEvent[], zone: string, accounts: number): string {
  const lines: string[] = []
  let day = ''
  for (const event of events) {
    const heading = dayWords(startOf(event, zone) + (event.allDay ? 12 * 3_600_000 : 0), zone)
    if (heading !== day) {
      if (lines.length > 0) lines.push('')
      lines.push(heading)
      day = heading
    }
    const where = event.place ? ` · at ${event.place.replace(/\s+/g, ' ').trim()}` : ''
    const from = accounts > 1 ? `${event.calendar}, ${event.account}` : event.calendar
    lines.push(`- ${whenOf(event, zone)} · ${event.title.replace(/\s+/g, ' ').trim()}${where} · ${from}${event.declined ? ' · declined' : ''}`)
    const description = event.description?.replace(/\s+/g, ' ').trim()
    if (description) lines.push(`  ${description.length > DESCRIPTION_LENGTH ? `${description.slice(0, DESCRIPTION_LENGTH)}…` : description}`)
  }
  return lines.join('\n')
}

/** What is left of today, from now, for the briefing: "09:00 Dentist", "all day: Holiday". */
export function todayLines(events: readonly FoundEvent[], zone: string): string {
  return events.map((event) => `- ${event.allDay ? 'all day' : clock(Date.parse(event.start), zone)} · ${event.title.replace(/\s+/g, ' ').trim()}`).join('\n')
}
