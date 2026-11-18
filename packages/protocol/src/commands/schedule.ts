import { z } from 'zod'
import { jobIdSchema, quietHoursSchema, scheduleViewSchema } from '../schedule.ts'

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
