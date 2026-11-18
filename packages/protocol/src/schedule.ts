import { z } from 'zod'
import { languageSchema } from './conversation.ts'

/**
 * What the assistant was asked to do later (docs/SPEC.md, section 7.10): reminders it says at their time, and
 * tasks it carries out at theirs, once or again and again, in the person's own time zone. Kept by the core, so
 * they ring after a restart, and shown on the Reminders page, where the person pauses or deletes them.
 */

export const jobIdSchema = z.string().min(1).max(64)

/** What a job does at its time. */
export const JOB_KINDS = [
  /** Say a sentence, written when it was set, in the language of the conversation. No model is needed. */
  'reminder',
  /** Carry out a request, as if the person had just asked it. */
  'task'
] as const
export const jobKindSchema = z.enum(JOB_KINDS)
export type JobKind = z.infer<typeof jobKindSchema>

/** Where a job stands. */
export const JOB_STATES = [
  /** It will ring at its next time. */
  'active',
  /** The person paused it: it rings again once resumed, from then on. */
  'paused',
  /** A one-time job that rang. */
  'done',
  /** A one-time job whose time passed while the app was not running, too long ago to ring late. */
  'missed'
] as const
export const jobStateSchema = z.enum(JOB_STATES)
export type JobState = z.infer<typeof jobStateSchema>

/** The days of the week, Monday first, as a recurring job names them. */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export const weekdaySchema = z.enum(WEEKDAYS)
export type Weekday = z.infer<typeof weekdaySchema>

/** A time of day on the person's clock, as HH:MM. */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

/** A date and time on the person's clock, with no zone: "2026-11-19T08:00", seconds allowed. */
export const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)

/** The shortest gap between two times of a job that rings every few hours, and the longest. */
export const MIN_EVERY_HOURS = 1
export const MAX_EVERY_HOURS = 12

/** The longest a folder's path, and a pattern of file names, a job watches can be. */
export const WATCHED_FOLDER_MAX_LENGTH = 1024
export const FILE_PATTERN_MAX_LENGTH = 120

/**
 * When a job rings, always on the person's clock in their time zone, so 8:00 stays 8:00 when the clocks change.
 * A day of the month a month does not have (the 31st in April) rings on its last day. A job can also ring when
 * files arrive or change in a folder the person granted, rather than at a time: a download finished, a scan.
 */
export const timingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: localDateTimeSchema }),
  z.object({ kind: z.literal('daily'), time: clockTimeSchema }),
  z.object({ kind: z.literal('weekdays'), time: clockTimeSchema }),
  z.object({ kind: z.literal('weekly'), time: clockTimeSchema, days: z.array(weekdaySchema).min(1).max(7) }),
  z.object({ kind: z.literal('monthly'), time: clockTimeSchema, day: z.number().int().min(1).max(31) }),
  /** Every few hours from one time of day to another, every day: "every 2 hours from 9:00 to 17:00". */
  z.object({ kind: z.literal('hourly'), every: z.number().int().min(MIN_EVERY_HOURS).max(MAX_EVERY_HOURS), from: clockTimeSchema, until: clockTimeSchema }),
  /**
   * When a file arrives or changes in a folder, once its writing is over: the folder as the system names it, the
   * names it is about ("*.pdf"), and whether it rings each time or only the first.
   */
  z.object({
    kind: z.literal('files'),
    folder: z.string().min(1).max(WATCHED_FOLDER_MAX_LENGTH),
    pattern: z.string().min(1).max(FILE_PATTERN_MAX_LENGTH).optional(),
    repeat: z.boolean()
  })
])
export type Timing = z.infer<typeof timingSchema>

/** The longest a job's title, its sentence or its request can be, in characters. */
export const JOB_TITLE_MAX_LENGTH = 80
export const JOB_SENTENCE_MAX_LENGTH = 300
export const JOB_REQUEST_MAX_LENGTH = 1000

/** A reminder or a task, as a client shows it. */
export const jobSchema = z.object({
  id: jobIdSchema,
  kind: jobKindSchema,
  /** A few words for the list and the notification, in the person's language: "Feed the cat". */
  title: z.string().min(1).max(JOB_TITLE_MAX_LENGTH),
  /** What a reminder says at its time: "It's eight: time to feed the cat." */
  sentence: z.string().min(1).max(JOB_SENTENCE_MAX_LENGTH).optional(),
  /** What a task carries out at its time, as the person would ask it: "Give me the weather in Lyon." */
  request: z.string().min(1).max(JOB_REQUEST_MAX_LENGTH).optional(),
  /** The language it was set in, which it is said in. */
  language: languageSchema.optional(),
  timing: timingSchema,
  state: jobStateSchema,
  /** When it was set: an ISO 8601 date in UTC. */
  since: z.string(),
  /** When it rings next, while it is active: an ISO 8601 date in UTC. */
  next: z.string().optional(),
  /** When it last rang: the time it was due, an ISO 8601 date in UTC. */
  last: z.string().optional()
})
export type Job = z.infer<typeof jobSchema>

/**
 * The hours the assistant keeps quiet, every night by default: a reminder only shows a silent notification, and a
 * task's answer is shown and not said. `from` after `until` spans midnight.
 */
export const quietHoursSchema = z.object({
  on: z.boolean(),
  from: clockTimeSchema,
  until: clockTimeSchema
})
export type QuietHours = z.infer<typeof quietHoursSchema>

/** Everything the assistant was asked to do later, as a client shows it. */
export const scheduleViewSchema = z.object({
  /** Goes up with each change, so a client holding two copies keeps the later one. */
  revision: z.number().int().nonnegative(),
  /** The active and paused jobs, the next to ring first, then the past ones, the latest first. */
  jobs: z.array(jobSchema),
  quiet: quietHoursSchema,
  /** Everything was paused at once ("stop everything"): nothing rings until it is resumed. */
  held: z.boolean(),
  /** The time zone the jobs ring in, as an IANA name: the person's. */
  timeZone: z.string()
})
export type ScheduleView = z.infer<typeof scheduleViewSchema>

/**
 * A notification for the device to show with the system's own (docs/SPEC.md, section 12.1, `device.notify`).
 * Pressed, it brings the app forward.
 */
export const notificationSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500),
  /** Shown with no sound: during the quiet hours. */
  silent: z.boolean(),
  /** Shown only when the app's window is not in front of the person, who would otherwise see it there. */
  unlessFocused: z.boolean()
})
export type Notification = z.infer<typeof notificationSchema>

const DAY_NAMES: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
}

/** "1st", "2nd", "23rd", "11th". */
export function ordinal(number: number): string {
  const tens = number % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[number % 10] ?? 'th')
  return `${number}${suffix}`
}

/** Words in a row, as a person lists them: "Monday, Wednesday and Friday". */
export function listed(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** The last name of a path, on any system: "Downloads" for "C:\Users\ada\Downloads" or "/home/ada/Downloads/". */
export function lastName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/**
 * A recurring job's timing in plain words, "every weekday at 07:30", for the person and for a model, each side
 * writing the times its own way through `time`. Nothing for a one-time job, whose words depend on the day it is. A
 * job on files is said by what sets it off: "each time a file arrives in Downloads".
 */
export function recurrenceWords(timing: Timing, time: (clock: string) => string = (clock) => clock): string | undefined {
  switch (timing.kind) {
    case 'once':
      return undefined
    case 'daily':
      return `every day at ${time(timing.time)}`
    case 'weekdays':
      return `every weekday at ${time(timing.time)}`
    case 'weekly': {
      const days = WEEKDAYS.filter((day) => timing.days.includes(day))
      if (days.length === 7) return `every day at ${time(timing.time)}`
      if (days.length === 5 && !days.includes('saturday') && !days.includes('sunday')) return `every weekday at ${time(timing.time)}`
      return `every ${listed(days.map((day) => DAY_NAMES[day]))} at ${time(timing.time)}`
    }
    case 'monthly':
      return `on the ${ordinal(timing.day)} of every month at ${time(timing.time)}`
    case 'hourly':
      return `every ${timing.every === 1 ? 'hour' : `${timing.every} hours`} from ${time(timing.from)} to ${time(timing.until)}`
    case 'files':
      return `${timing.repeat ? 'each time' : 'when'} a file${timing.pattern ? ` named ${timing.pattern}` : ''} arrives in ${lastName(timing.folder)}`
  }
}
