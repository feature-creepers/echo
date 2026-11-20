import { MAX_EVERY_HOURS, MIN_EVERY_HOURS, type Timing, WEEKDAYS, type Weekday } from '@repo/protocol'

/**
 * A job's timing as the Reminders page edits it: every field of every kind at once, so switching how often keeps
 * what was typed, and the timing read back from it, checked as the person meant it. A job on files or mail is not
 * edited here: its folder or its account is checked when it is set, by asking.
 */

/** A timing on the clock, which the editor changes. */
export type Clocked = Exclude<Timing, { kind: 'files' | 'mail' }>

/** How often a job rings, as the editor offers it. */
export type Often = Clocked['kind']

export const OFTEN: readonly { value: Often; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'hourly', label: 'Every few hours' }
]

export interface TimingForm {
  often: Often
  /** For once: the day, as YYYY-MM-DD. */
  date: string
  /** The time of day, as HH:MM: for once, daily, weekdays, weekly and monthly. */
  time: string
  /** For weekly. */
  days: Weekday[]
  /** For monthly: the day of the month. */
  day: number
  /** For hourly. */
  every: number
  from: string
  until: string
}

/** The form for a timing, the fields its kind does not use filled from `today` (YYYY-MM-DD) and its own time. */
export function formOf(timing: Clocked, today: string): TimingForm {
  const time = timing.kind === 'once' ? timing.at.slice(11, 16) : timing.kind === 'hourly' ? timing.from : timing.time
  return {
    often: timing.kind,
    date: timing.kind === 'once' ? timing.at.slice(0, 10) : today,
    time,
    days: timing.kind === 'weekly' ? [...timing.days] : [],
    day: timing.kind === 'monthly' ? timing.day : Number(today.slice(8, 10)) || 1,
    every: timing.kind === 'hourly' ? timing.every : 2,
    from: timing.kind === 'hourly' ? timing.from : time,
    until: timing.kind === 'hourly' ? timing.until : '17:00'
  }
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The timing the form says, or what is wrong with it in words for the person. `now` is the person's clock now, as
 * YYYY-MM-DDTHH:MM in the zone the jobs ring in: a single time must be to come.
 */
export function timingOf(form: TimingForm, now: string): { ok: true; timing: Timing } | { ok: false; problem: string } {
  const time = CLOCK.test(form.time) ? form.time : undefined
  switch (form.often) {
    case 'once': {
      if (!DATE.test(form.date) || !time) return { ok: false, problem: 'Pick a day and a time.' }
      const at = `${form.date}T${time}`
      if (at <= now) return { ok: false, problem: 'That time has passed: pick one to come.' }
      return { ok: true, timing: { kind: 'once', at } }
    }
    case 'daily':
    case 'weekdays':
      return time ? { ok: true, timing: { kind: form.often, time } } : { ok: false, problem: 'Pick a time.' }
    case 'weekly': {
      if (!time) return { ok: false, problem: 'Pick a time.' }
      const days = WEEKDAYS.filter((day) => form.days.includes(day))
      return days.length > 0 ? { ok: true, timing: { kind: 'weekly', time, days } } : { ok: false, problem: 'Pick at least one day.' }
    }
    case 'monthly':
      if (!time) return { ok: false, problem: 'Pick a time.' }
      return Number.isInteger(form.day) && form.day >= 1 && form.day <= 31
        ? { ok: true, timing: { kind: 'monthly', time, day: form.day } }
        : { ok: false, problem: 'Pick a day of the month, from 1 to 31.' }
    case 'hourly': {
      if (!CLOCK.test(form.from) || !CLOCK.test(form.until)) return { ok: false, problem: 'Pick the first and the last time.' }
      if (form.until <= form.from) return { ok: false, problem: 'The last time comes after the first, the same day.' }
      if (!Number.isInteger(form.every) || form.every < MIN_EVERY_HOURS || form.every > MAX_EVERY_HOURS)
        return { ok: false, problem: `Every ${MIN_EVERY_HOURS} to ${MAX_EVERY_HOURS} hours.` }
      return { ok: true, timing: { kind: 'hourly', every: form.every, from: form.from, until: form.until } }
    }
  }
}

/** The person's clock now, in a zone, as YYYY-MM-DDTHH:MM: what a single time is compared with. */
export function localNow(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now)
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
