import { z } from 'zod'
import {
  JOB_REQUEST_MAX_LENGTH,
  JOB_SENTENCE_MAX_LENGTH,
  JOB_TITLE_MAX_LENGTH,
  jobIdSchema,
  MAX_SNOOZE_MINUTES,
  quietHoursSchema,
  scheduleViewSchema,
  timingSchema
} from '../schedule.ts'

const scheduleOutput = z.object({ schedule: scheduleViewSchema })

export const scheduleCommands = {
  /** Read the reminders and tasks set, the quiet hours, and whether everything is paused. */
  'schedule.read': {
    input: z.object({}),
    output: scheduleOutput
  },

  /** Pause a job, or resume it: it rings again from its next time after now, never for the times it was paused. */
  'schedule.pause': {
    input: z.object({ job: jobIdSchema, paused: z.boolean() }),
    output: scheduleOutput
  },

  /**
   * Snooze a reminder that rang, from its card or its notification: it rings once more in so many minutes. Its own
   * times go on. Refused for a reminder that has not rung, a paused one, a task, and one that rings on files.
   */
  'schedule.snooze': {
    input: z.object({ job: jobIdSchema, minutes: z.number().int().min(1).max(MAX_SNOOZE_MINUTES) }),
    output: scheduleOutput
  },

  /**
   * Change a job's words or its timing, from the Reminders page. What is left out keeps its value. The timing is
   * checked as when a job is set: a moment to come, at most five years ahead. A new timing counts from now, and leaves
   * a snooze behind. A job on files keeps its folder: it is changed by asking, which checks the folder.
   */
  'schedule.change': {
    input: z.object({
      job: jobIdSchema,
      title: z.string().trim().min(1).max(JOB_TITLE_MAX_LENGTH).optional(),
      sentence: z.string().trim().min(1).max(JOB_SENTENCE_MAX_LENGTH).optional(),
      request: z.string().trim().min(1).max(JOB_REQUEST_MAX_LENGTH).optional(),
      timing: timingSchema.optional()
    }),
    output: scheduleOutput
  },

  /** Delete jobs for good: what they said is erased. */
  'schedule.delete': {
    input: z.object({ jobs: z.array(jobIdSchema).min(1).max(500) }),
    output: scheduleOutput
  },

  /** Choose the quiet hours. What is left out keeps its value. */
  'schedule.quiet.set': {
    input: quietHoursSchema.partial(),
    output: scheduleOutput
  },

  /**
   * Pause everything at once, or resume ("stop everything"). While paused, nothing rings; once resumed, a one-time
   * reminder whose time passed less than twelve hours ago rings late, and recurring jobs go on from their next time.
   */
  'schedule.hold': {
    input: z.object({ held: z.boolean() }),
    output: scheduleOutput
  }
}
