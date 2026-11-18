import { type Job, recurrenceWords, type Timing } from '@repo/protocol'

/**
 * The Reminders page in words: when a job rings, written as the person's own clock and calendar write it, and how
 * often, in plain language.
 */

const formats = new Map<string, Intl.DateTimeFormat>()
const format = (locale: string | undefined, zone: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${zone}|${JSON.stringify(options)}`
  let found = formats.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone })
    formats.set(key, found)
  }
  return found
}

/** A time of day, "07:30", as the person's clock writes it: "7:30 AM", "07:30". */
export function clockWords(clock: string, locale?: string): string {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)
  return format(locale, 'UTC', { hour: 'numeric', minute: '2-digit' }).format(Date.UTC(2000, 0, 1, hours, minutes))
}

/** The time of day of an instant, in the zone the jobs ring in. */
export function timeOf(instant: string, zone: string, locale?: string): string {
  return format(locale, zone, { hour: 'numeric', minute: '2-digit' }).format(new Date(instant))
}

/** The calendar day of an instant in a zone, as a number that two days can be compared and counted by. */
const dayNumber = (instant: Date, zone: string) => {
  const parts = format('en-US', zone, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(instant)
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? 0)
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000
}

/** The day of an instant, from where today stands: "Today", "Tomorrow", "Mon 23 Nov", with the year when it is not this one. */
export function dayOf(instant: string, now: Date, zone: string, locale?: string): string {
  const at = new Date(instant)
  const days = dayNumber(at, zone) - dayNumber(now, zone)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  const sameYear = format('en-US', zone, { year: 'numeric' }).format(at) === format('en-US', zone, { year: 'numeric' }).format(now)
  return format(locale, zone, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(at)
}

/** How often a job rings, in plain words, starting with a capital: "Every weekday at 7:30 AM", "Once". */
export function howOften(timing: Timing, locale?: string): string {
  const words = recurrenceWords(timing, (clock) => clockWords(clock, locale)) ?? 'once'
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** What a job does, in a word. */
export const KIND_WORDS: Record<Job['kind'], string> = { reminder: 'Reminder', task: 'Task' }

/** What a job says or does at its time, shown under its title. */
export function whatItDoes(job: Job): string | undefined {
  return job.kind === 'reminder' ? job.sentence : job.request
}

/** When a past job rang, or was due: the time it was due, which is when it was meant for. */
export function whenPast(job: Job, now: Date, zone: string, locale?: string): string | undefined {
  const due = job.last ?? (job.timing.kind === 'once' ? onceInstant(job.timing.at, zone) : undefined)
  if (!due) return undefined
  return `${dayOf(due, now, zone, locale)}, ${timeOf(due, zone, locale)}`
}

/** The instant of a local date and time in a zone, near enough to name its day and time: the offset that day. */
function onceInstant(local: string, zone: string): string {
  const guess = new Date(`${local.length === 16 ? `${local}:00` : local}Z`)
  const parts = format('en-US', zone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(guess)
  const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? 0)
  const shown = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'))
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString()
}
