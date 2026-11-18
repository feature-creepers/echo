import type { Event, Job, ScheduleView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followSchedule } from './schedule.ts'

const job = (id: string): Job => ({
  id,
  kind: 'reminder',
  title: id,
  sentence: 'Time.',
  timing: { kind: 'daily', time: '08:00' },
  state: 'active',
  since: '2026-11-17T08:00:00Z'
})
const view = (revision: number, jobs: Job[] = []): ScheduleView => ({
  revision,
  jobs,
  quiet: { on: true, from: '23:00', until: '07:30' },
  held: false,
  timeZone: 'Europe/Paris'
})

function fakeSession(read: ScheduleView) {
  const listeners = new Set<(event: Event) => void>()
  const ran: { name: string; input: unknown }[] = []
  const session: Session = {
    run: (name, input) => {
      ran.push({ name, input })
      return Promise.resolve({ schedule: name === 'schedule.read' ? read : view(read.revision + 5) } as never)
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => undefined
  }
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  return { session, emit, ran }
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('the schedule, followed', () => {
  it('reads the schedule, then keeps the later of what is read and what is announced', async () => {
    const { session, emit } = fakeSession(view(1, [job('a')]))
    emit({ type: 'event', name: 'schedule.changed', schedule: view(3, [job('a'), job('b')]) })
    const schedule = followSchedule(session)
    emit({ type: 'event', name: 'schedule.changed', schedule: view(2, [job('a'), job('b')]) })
    await settled()
    expect(schedule.current()?.jobs.map((one) => one.id)).toEqual(['a', 'b'])
    emit({ type: 'event', name: 'schedule.changed', schedule: view(4, []) })
    expect(schedule.current()?.jobs).toEqual([])
  })

  it('pauses, deletes, sets the quiet hours and holds everything through the core', async () => {
    const { session, ran } = fakeSession(view(1))
    const schedule = followSchedule(session)
    await schedule.pause('a', true)
    await schedule.remove(['a', 'b'])
    await schedule.setQuiet({ from: '22:00' })
    await schedule.hold(true)
    expect(ran.slice(1)).toEqual([
      { name: 'schedule.pause', input: { job: 'a', paused: true } },
      { name: 'schedule.delete', input: { jobs: ['a', 'b'] } },
      { name: 'schedule.quiet.set', input: { from: '22:00' } },
      { name: 'schedule.hold', input: { held: true } }
    ])
    expect(schedule.current()?.revision).toBe(6)
  })
})
