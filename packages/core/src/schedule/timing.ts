import {
  clockTimeSchema,
  FILE_PATTERN_MAX_LENGTH,
  localDateTimeSchema,
  MAX_EVERY_HOURS,
  MIN_EVERY_HOURS,
  recurrenceWords,
  type Timing,
  WATCHED_FOLDER_MAX_LENGTH,
  WEEKDAYS,
  type Weekday
} from '@repo/protocol'
import { z } from 'zod'
import { addDays, daysInMonth, instantOf, minutesOf, sameDate, type WallDate, type WallTime, wallTimeAt, weekdayOf } from './zoned.ts'

/**
 * When a job rings (docs/SPEC.md, section 7.10): the timing a model gives, checked as a person would check it (a
 * real day, in the future, not absurdly far), and the next time it rings on the person's clock.
 */

/** How far ahead a job can be set: further is more likely a mistake than a plan. */
const FURTHEST_YEARS = 5

/** How many days ahead the next time of a recurring job is looked for: a monthly job on the 31st waits two months at most. */
const SEARCH_DAYS = 400

const MINUTE_MS = 60_000

/** A local date and time, "2026-11-19T08:00" or with seconds, read into its parts. Nothing when it is not a real moment. */
function readLocal(text: string): WallTime | undefined {
  if (!localDateTimeSchema.safeParse(text).success) return undefined
  const [date = '', time = ''] = text.split('T')
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined
  return { year, month, day, hour, minute, second }
}

const two = (number: number) => String(number).padStart(2, '0')

/** A wall time written as a local date and time, to the second only when it has seconds. */
function writeLocal(wall: WallTime): string {
  const time = `${two(wall.hour)}:${two(wall.minute)}${wall.second === 0 ? '' : `:${two(wall.second)}`}`
  return `${wall.year}-${two(wall.month)}-${two(wall.day)}T${time}`
}

/** The times of day a recurring timing rings on a date, in minutes from midnight, in order. */
function timesOn(timing: Exclude<Timing, { kind: 'once' | 'files' }>, date: WallDate): number[] {
  const weekday = weekdayOf(date)
  switch (timing.kind) {
    case 'daily':
      return [minutesOf(timing.time)]
    case 'weekdays':
      return weekday < 5 ? [minutesOf(timing.time)] : []
    case 'weekly':
      return timing.days.includes(WEEKDAYS[weekday] as Weekday) ? [minutesOf(timing.time)] : []
    case 'monthly':
      return date.day === Math.min(timing.day, daysInMonth(date.year, date.month)) ? [minutesOf(timing.time)] : []
    case 'hourly': {
      const times: number[] = []
      for (let minute = minutesOf(timing.from); minute <= minutesOf(timing.until); minute += timing.every * 60) times.push(minute)
      return times
    }
  }
}

/** The instant a one-time timing rings. Nothing when its moment is not a real one, such as the 31st of a short month. */
export function onceAt(timing: Extract<Timing, { kind: 'once' }>, zone: string): number | undefined {
  const wall = readLocal(timing.at)
  return wall ? instantOf(wall, zone) : undefined
}

/**
 * The first time a timing rings strictly after `after`, in milliseconds since 1970, on the clock of `zone`. Nothing
 * when it never rings again: a one-time timing whose moment is past.
 */
export function nextTime(timing: Timing, after: number, zone: string): number | undefined {
  // A job on files rings when they arrive, at no time of its own.
  if (timing.kind === 'files') return undefined
  if (timing.kind === 'once') {
    const at = onceAt(timing, zone)
    return at !== undefined && at > after ? at : undefined
  }
  const start = wallTimeAt(after, zone)
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const date = addDays(start, offset)
    for (const minute of timesOn(timing, date)) {
      const instant = instantOf({ ...date, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 }, zone)
      if (instant > after) return instant
    }
  }
  return undefined
}

/** A timing as a model writes it: one kind, and the fields that kind needs. */
const timingInput = z.object({
  kind: z.enum(['once', 'daily', 'weekdays', 'weekly', 'monthly', 'hourly', 'files']),
  at: z.string().optional(),
  inMinutes: z.number().optional(),
  time: z.string().optional(),
  days: z.array(z.string()).optional(),
  day: z.number().optional(),
  every: z.number().optional(),
  from: z.string().optional(),
  until: z.string().optional(),
  folder: z.string().optional(),
  pattern: z.string().optional(),
  repeat: z.boolean().optional()
})

/** The timing a tool takes, as a JSON Schema, for a model. */
export const TIMING_INPUT_SCHEMA = {
  type: 'object',
  description:
    'When, on the person\'s clock. "once" with "at" (a local date and time, "2026-11-19T08:00") or "inMinutes" (for "in 10 minutes"); "daily" or "weekdays" with "time" ("07:30"); "weekly" with "time" and "days"; "monthly" with "time" and "day" (1 to 31); "hourly" with "every" (hours, 1 to 12), "from" and "until" (times of day). Or "files", when files arrive or change in a folder the person granted: "folder" ("~/Downloads"), "pattern" ("*.pdf") if only some, and "repeat" for each time rather than the first.',
  properties: {
    kind: { type: 'string', enum: ['once', 'daily', 'weekdays', 'weekly', 'monthly', 'hourly', 'files'] },
    at: { type: 'string', description: 'For once: the local date and time, "2026-11-19T08:00".' },
    inMinutes: { type: 'number', description: 'For once, instead of "at": how many minutes from now.' },
    time: { type: 'string', description: 'The time of day, "07:30".' },
    days: { type: 'array', items: { type: 'string', enum: [...WEEKDAYS] }, description: 'For weekly: the days.' },
    day: { type: 'number', description: 'For monthly: the day of the month. A month without it rings on its last day.' },
    every: { type: 'number', description: 'For hourly: how many hours apart, 1 to 12.' },
    from: { type: 'string', description: 'For hourly: the first time of the day, "09:00".' },
    until: { type: 'string', description: 'For hourly: the last time of the day, "17:00".' },
    folder: { type: 'string', description: 'For files: the folder, absolute or from the home folder with ~.' },
    pattern: { type: 'string', description: 'For files: the names it is about, "*.pdf"; several separated by commas. Left out, any file.' },
    repeat: { type: 'boolean', description: 'For files: true to ring each time, false (the default) for the first time only.' }
  },
  required: ['kind']
} as const

export type TimingReading = { ok: true; timing: Timing } | { ok: false; problem: string }

const refuse = (problem: string): TimingReading => ({ ok: false, problem })

const clockProblem = (field: string, value: string | undefined) =>
  value === undefined ? `Give "${field}", a time of day such as "07:30".` : `"${field}" is a time of day such as "07:30", not "${value}".`

/**
 * Read the timing a model gave, as the person meant it, and check it: a real day, a moment to come, at most five
 * years ahead. The problem, when there is one, is written for the model, which corrects it or asks the person.
 */
export function readTiming(input: unknown, now: number, zone: string): TimingReading {
  const read = timingInput.safeParse(input)
  if (!read.success) return refuse('Give the timing as an object with a "kind": once, daily, weekdays, weekly, monthly, hourly or files.')
  const given = read.data
  const furthest = now + FURTHEST_YEARS * 366 * 24 * 60 * MINUTE_MS
  const clock = (field: 'time' | 'from' | 'until') => (clockTimeSchema.safeParse(given[field]).success ? (given[field] as string) : undefined)

  switch (given.kind) {
    case 'once': {
      if (given.inMinutes !== undefined) {
        if (!Number.isFinite(given.inMinutes) || given.inMinutes < 1) return refuse('"inMinutes" is a number of minutes from now, at least 1.')
        const instant = now + Math.round(given.inMinutes * 60) * 1000
        if (instant > furthest) return refuse(`That is more than ${FURTHEST_YEARS} years away.`)
        return { ok: true, timing: { kind: 'once', at: writeLocal(wallTimeAt(instant, zone)) } }
      }
      if (given.at === undefined) return refuse('For once, give "at", a local date and time such as "2026-11-19T08:00", or "inMinutes".')
      const wall = readLocal(given.at)
      if (!wall) return refuse(`"at" is a real local date and time such as "2026-11-19T08:00", not "${given.at}".`)
      const instant = instantOf(wall, zone)
      if (instant <= now) {
        return refuse(
          `That moment has passed: it is now ${writeLocal({ ...wallTimeAt(now, zone), second: 0 })} on the person's clock. Give a moment to come, or ask them.`
        )
      }
      if (instant > furthest) return refuse(`That is more than ${FURTHEST_YEARS} years away.`)
      return { ok: true, timing: { kind: 'once', at: writeLocal(wall) } }
    }
    case 'daily':
    case 'weekdays': {
      const time = clock('time')
      return time ? { ok: true, timing: { kind: given.kind, time } } : refuse(clockProblem('time', given.time))
    }
    case 'weekly': {
      const time = clock('time')
      if (!time) return refuse(clockProblem('time', given.time))
      const days = WEEKDAYS.filter((day) => given.days?.some((named) => named.trim().toLowerCase() === day))
      const unknown = (given.days ?? []).filter((named) => !WEEKDAYS.includes(named.trim().toLowerCase() as Weekday))
      if (unknown.length > 0) return refuse(`"days" are days of the week in English, such as "monday": not ${unknown.map((day) => `"${day}"`).join(', ')}.`)
      if (days.length === 0) return refuse('For weekly, give "days": the days of the week it rings on, such as ["monday", "thursday"].')
      return { ok: true, timing: { kind: 'weekly', time, days } }
    }
    case 'monthly': {
      const time = clock('time')
      if (!time) return refuse(clockProblem('time', given.time))
      if (given.day === undefined || !Number.isInteger(given.day) || given.day < 1 || given.day > 31)
        return refuse('For monthly, "day" is a day of the month, from 1 to 31.')
      return { ok: true, timing: { kind: 'monthly', time, day: given.day } }
    }
    case 'hourly': {
      const from = clock('from')
      const until = clock('until')
      if (!from) return refuse(clockProblem('from', given.from))
      if (!until) return refuse(clockProblem('until', given.until))
      if (given.every === undefined || !Number.isInteger(given.every) || given.every < MIN_EVERY_HOURS || given.every > MAX_EVERY_HOURS) {
        return refuse(`For hourly, "every" is a whole number of hours, from ${MIN_EVERY_HOURS} to ${MAX_EVERY_HOURS}.`)
      }
      if (minutesOf(until) <= minutesOf(from)) return refuse('"until" is a later time of the same day than "from".')
      return { ok: true, timing: { kind: 'hourly', every: given.every, from, until } }
    }
    case 'files': {
      const folder = given.folder?.trim()
      if (!folder) return refuse('For files, give "folder": the folder to watch, such as "~/Downloads".')
      if (folder.length > WATCHED_FOLDER_MAX_LENGTH) return refuse('That folder path is too long.')
      const pattern = given.pattern?.trim()
      if (pattern !== undefined && pattern.length > FILE_PATTERN_MAX_LENGTH) return refuse(`"pattern" is ${FILE_PATTERN_MAX_LENGTH} characters at most.`)
      return { ok: true, timing: { kind: 'files', folder, ...(pattern ? { pattern } : {}), repeat: given.repeat ?? false } }
    }
  }
}

const dateWords = new Map<string, Intl.DateTimeFormat>()
const dateFormat = (zone: string, year: boolean) => {
  const key = `${zone}:${year}`
  let format = dateWords.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) })
    dateWords.set(key, format)
  }
  return format
}

/** The time of day of an instant on the person's clock, as HH:MM. */
export function clockAt(instant: number, zone: string): string {
  const wall = wallTimeAt(instant, zone)
  return `${two(wall.hour)}:${two(wall.minute)}`
}

/** A moment to come in plain words, from where `now` stands: "today at 14:15", "tomorrow at 08:00", "Monday 23 November at 07:30". */
export function momentWords(instant: number, now: number, zone: string): string {
  const day = wallTimeAt(instant, zone)
  const today = wallTimeAt(now, zone)
  const time = clockAt(instant, zone)
  if (sameDate(day, today)) return `today at ${time}`
  if (sameDate(day, addDays(today, 1))) return `tomorrow at ${time}`
  return `${dateFormat(zone, day.year !== today.year)
    .format(instant)
    .replace(',', '')} at ${time}`
}

/** A timing in plain words, for a model and for the card a reminder shows: when it rings next, and how often. */
export function timingWords(timing: Timing, next: number | undefined, now: number, zone: string): string {
  const recurring = recurrenceWords(timing)
  const coming = next === undefined ? undefined : momentWords(next, now, zone)
  if (!recurring) return coming ?? 'never again'
  return coming ? `${recurring} (next ${coming})` : recurring
}
