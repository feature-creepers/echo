import { type QuietHours, quietHoursSchema } from '@repo/protocol'
import { minutesOf, wallTimeAt } from './zoned.ts'

/**
 * The quiet hours (docs/SPEC.md, section 7.10): every night by default, the assistant keeps its voice to itself.
 * A reminder then only shows a silent notification, and a task's answer is shown and not said. The setting is the
 * person's, kept as records like every other choice: the defaults, then each change, the latest winning.
 */

/** The type of the record written each time the person changes the quiet hours. Its payload is the whole setting. */
export const QUIET_SET = 'schedule.quiet-set'

export const DEFAULT_QUIET: QuietHours = { on: true, from: '23:00', until: '07:30' }

export function readQuietHours(payload: unknown): QuietHours | undefined {
  const read = quietHoursSchema.safeParse(payload)
  return read.success ? read.data : undefined
}

/** Whether an instant falls in the quiet hours, on the person's clock. Hours that start and end at the same time are none. */
export function isQuiet(quiet: QuietHours, instant: number, zone: string): boolean {
  if (!quiet.on) return false
  const from = minutesOf(quiet.from)
  const until = minutesOf(quiet.until)
  if (from === until) return false
  const wall = wallTimeAt(instant, zone)
  const minute = wall.hour * 60 + wall.minute
  // Hours that span midnight, as the night does, are the ones after `from` or before `until`.
  return from < until ? minute >= from && minute < until : minute >= from || minute < until
}
