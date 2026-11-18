import type { QuietHours, ScheduleView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The reminders and tasks set, kept current for as long as it is followed. Nothing until the core has answered. */
export interface ScheduleState extends Followed<ScheduleView | undefined> {
  /** The core could not be read from: nothing will arrive until the schedule is followed again. */
  unread: Followed<boolean>
  /** Pause a job, or resume it from its next time. */
  pause(job: string, paused: boolean): Promise<void>
  /** Delete jobs for good. */
  remove(jobs: readonly string[]): Promise<void>
  /** Choose the quiet hours. What is left out keeps its value. */
  setQuiet(quiet: Partial<QuietHours>): Promise<void>
  /** Pause everything at once, or resume. */
  hold(held: boolean): Promise<void>
  unfollow(): void
}

/**
 * Read the schedule from the core and follow its changes, from this device or another, or because a job rang. Two
 * copies can cross on the way, one read and one announced: the later revision wins.
 */
export function followSchedule(session: Session): ScheduleState {
  const schedule = cell<ScheduleView | undefined>(undefined)
  const unread = cell(false)
  const accept = (view: ScheduleView) => {
    const known = schedule.current()
    if (known && known.revision > view.revision) return
    schedule.set(view)
  }
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'schedule.changed') accept(event.schedule)
  })
  session.run('schedule.read', {}).then(
    ({ schedule: view }) => accept(view),
    () => unread.set(schedule.current() === undefined)
  )
  return {
    current: schedule.current,
    subscribe: schedule.subscribe,
    unread: { current: unread.current, subscribe: unread.subscribe },
    async pause(job, paused) {
      accept((await session.run('schedule.pause', { job, paused })).schedule)
    },
    async remove(jobs) {
      accept((await session.run('schedule.delete', { jobs: [...jobs] })).schedule)
    },
    async setQuiet(quiet) {
      accept((await session.run('schedule.quiet.set', quiet)).schedule)
    },
    async hold(held) {
      accept((await session.run('schedule.hold', { held })).schedule)
    },
    unfollow: stopEvents
  }
}
