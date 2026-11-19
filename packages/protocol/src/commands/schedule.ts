import { z } from 'zod'
import { jobIdSchema, MAX_SNOOZE_MINUTES, quietHoursSchema, scheduleViewSchema } from '../schedule.ts'

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
