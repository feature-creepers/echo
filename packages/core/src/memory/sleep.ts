import { type SleepSettings, sleepSettingsSchema } from '@repo/protocol'
import type { Timers } from '../ports/clock.ts'

/**
 * When the assistant falls asleep (docs/SPEC.md, section 10.6): after a quiet period, at a time of day,
 * whichever comes first, only when told, or never. The setting is the user's, kept as records like every
 * other choice: the defaults, then each change, the latest winning.
 */

/** The type of the record written each time the user changes when the assistant sleeps. Its payload is the whole setting. */
export const SLEEP_SET = 'memory.sleep-set'

export const DEFAULT_SLEEP: SleepSettings = { when: 'quiet', quietMinutes: 10, time: '03:00' }

export function readSleepSettings(payload: unknown): SleepSettings | undefined {
  const read = sleepSettingsSchema.safeParse(payload)
  return read.success ? read.data : undefined
}

const MINUTE_MS = 60_000
/** When it is time to sleep but a turn is under way, how long to wait before looking again. */
const BUSY_RETRY_MS = MINUTE_MS

/** How long from `now` until the next time the clock shows `time` (HH:MM), on the core's clock. Never zero. */
export function untilTimeOfDay(now: Date, time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  const next = new Date(now)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export interface SleepScheduleOptions {
  now: () => Date
  /** Left out, the assistant falls asleep only when told. */
  timers?: Timers | undefined
  /** It is time to sleep. */
  fallAsleep(): void
  /** Whether the assistant is answering. It does not fall asleep in the middle of an answer. */
  busy(): boolean
}

/** The timers that put the assistant to sleep. */
export interface SleepSchedule {
  /** Something was said or answered: the quiet period starts again. */
  heard(): void
  /** The setting changed: the timers follow it. */
  follow(settings: SleepSettings): void
  close(): void
}

export function createSleepSchedule(initial: SleepSettings, options: SleepScheduleOptions): SleepSchedule {
  let settings = initial
  let cancelQuiet = () => {}
  let cancelDaily = () => {}
  const later = (ms: number, work: () => void) => options.timers?.after(ms, work) ?? (() => {})

  const usesQuiet = () => settings.when === 'quiet' || settings.when === 'quiet-or-time'
  const usesTime = () => settings.when === 'time' || settings.when === 'quiet-or-time'

  const fire = (rearm: (delay?: number) => void) => () => {
    if (options.busy()) return rearm(BUSY_RETRY_MS)
    options.fallAsleep()
    if (usesTime()) armDaily()
  }

  const armQuiet = (delay = settings.quietMinutes * MINUTE_MS) => {
    cancelQuiet()
    cancelQuiet = usesQuiet() ? later(delay, fire(armQuiet)) : () => {}
  }

  const armDaily = (delay?: number) => {
    cancelDaily()
    cancelDaily = usesTime() ? later(delay ?? untilTimeOfDay(options.now(), settings.time), fire(armDaily)) : () => {}
  }

  armQuiet()
  armDaily()

  return {
    heard: () => armQuiet(),
    follow(next) {
      settings = next
      armQuiet()
      armDaily()
    },
    close() {
      cancelQuiet()
      cancelDaily()
    }
  }
}
