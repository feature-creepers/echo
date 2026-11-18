import type { Event, Notification, Timing } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { createSchedule, type NewJob, type Proactive } from './schedule.ts'

const PARIS = 'Europe/Paris'
/** Wednesday 18 November 2026, 14:13 in Paris. */
const START = Date.parse('2026-11-18T13:13:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** What the conversation was asked to do, in order. */
type Done =
  | { said: string; silent: boolean; card: string | undefined; language: string | undefined }
  | { ran: string; silent: boolean }
  | { notified: Notification }

interface Setup {
  records?: ReturnType<typeof memoryRecords>
  /** Where the clock starts, in milliseconds since 1970. */
  at?: number
  /** Whether a client is there from the start. */
  listening?: boolean
}

function setup({ records = memoryRecords(), at = START, listening = true }: Setup = {}) {
  const timers = manualTimers()
  let busy = false
  const done: Done[] = []
  const proactive: Proactive = {
    busy: () => busy,
    remind: ({ sentence, silent, card, language }) =>
      done.push({ said: sentence, silent, card: (card.spec.elements.when?.props as { text?: string } | undefined)?.text, language }),
    run: ({ request, silent }) => done.push({ ran: request, silent }),
    notify: (notification) => done.push({ notified: notification })
  }
  let ids = 0
  const schedule = createSchedule({
    records,
    now: () => new Date(at + timers.elapsed()),
    zone: () => PARIS,
    timers,
    newId: () => `job-${++ids}`,
    proactive
  })
  const events: Event[] = []
  schedule.onEvent((event) => events.push(event))
  if (listening) schedule.listen()
  return {
    schedule,
    timers,
    records,
    done,
    events,
    setBusy: (value: boolean) => {
      busy = value
    },
    said: () => done.flatMap((one) => ('said' in one ? [one.said] : [])),
    ran: () => done.flatMap((one) => ('ran' in one ? [one.ran] : [])),
    notified: () => done.flatMap((one) => ('notified' in one ? [one.notified] : []))
  }
}

const reminder = (timing: Timing, title = 'Feed the cat', sentence = "It's time to feed the cat."): NewJob => ({
  kind: 'reminder',
  title,
  sentence,
  language: 'en',
  timing
})

describe('a reminder', () => {
  it('says its sentence at its time, with a card and a notification, and is done', () => {
    const { schedule, timers, said, notified, done } = setup()
    const set = schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:15' }))
    expect(set.ok && set.job.next).toBe('2026-11-18T13:15:00.000Z')

    timers.advance(MINUTE)
    expect(said()).toEqual([])
    timers.advance(MINUTE)
    expect(said()).toEqual(["It's time to feed the cat."])
    expect(notified()).toEqual([{ title: 'Feed the cat', body: "It's time to feed the cat.", silent: false, unlessFocused: false }])
    expect(done.find((one) => 'card' in one)).toMatchObject({ card: '14:15' })
    expect(schedule.read().jobs[0]).toMatchObject({ state: 'done', last: '2026-11-18T13:15:00.000Z' })
  })

  it('rings once a minute is past even when the machine slept through its timer', () => {
    const { schedule, timers, said } = setup()
    schedule.create(reminder({ kind: 'once', at: '2026-11-18T18:00' }))
    // The scheduler looks at the clock at least every minute, never trusting one long timer.
    expect(timers.next()).toBe(MINUTE)
    timers.advance(4 * HOUR + 47 * MINUTE)
    expect(said()).toEqual(["It's time to feed the cat."])
  })

  it('waits for a pause in the conversation to be said, but notifies at once', () => {
    const { schedule, timers, said, notified, setBusy } = setup()
    schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:14' }))
    setBusy(true)
    timers.advance(MINUTE)
    expect(notified()).toHaveLength(1)
    expect(said()).toEqual([])
    timers.advance(5_000)
    expect(said()).toEqual([])
    setBusy(false)
    timers.advance(1_000)
    expect(said()).toEqual(["It's time to feed the cat."])
  })

  it('is silent in the quiet hours: a silent notification, nothing said aloud', () => {
    const { schedule, timers, done } = setup({ at: Date.parse('2026-11-18T22:00:00Z') })
    schedule.create(reminder({ kind: 'once', at: '2026-11-18T23:30' }))
    timers.advance(31 * MINUTE)
    expect(done).toEqual([
      { notified: { title: 'Feed the cat', body: "It's time to feed the cat.", silent: true, unlessFocused: false } },
      { said: "It's time to feed the cat.", silent: true, card: '23:30', language: 'en' }
    ])
  })

  it('is refused when its time has passed', () => {
    const { schedule } = setup()
    expect(schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:00' }))).toEqual({ ok: false, problem: 'That would never ring: its time has passed.' })
  })
})

describe('after a restart', () => {
  it('rings at its time, read back from the records', () => {
    const first = setup()
    first.schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:15' }))
    first.schedule.close()

    const second = setup({ records: first.records, at: START + MINUTE })
    second.timers.advance(MINUTE)
    expect(second.said()).toEqual(["It's time to feed the cat."])
  })

  it('rings nothing before a client is there to hear it', () => {
    const first = setup()
    first.schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:15' }))

    const second = setup({ records: first.records, at: START + 5 * MINUTE, listening: false })
    second.timers.advance(MINUTE)
    expect(second.done).toEqual([])
    second.schedule.listen()
    expect(second.said()).toEqual(['You asked me to remind you at 14:15: Feed the cat.'])
  })

  it('rings late, saying so, a one-time reminder missed by less than twelve hours', () => {
    const first = setup()
    first.schedule.create({ ...reminder({ kind: 'once', at: '2026-11-19T08:00' }), title: 'Nourrir le chat', sentence: "C'est l'heure.", language: 'fr' })

    const second = setup({ records: first.records, at: Date.parse('2026-11-19T07:47:00Z') })
    expect(second.said()).toEqual(["Tu m'avais demandé de te le rappeler à 8:00: Nourrir le chat."])
    expect(second.done.find((one) => 'card' in one)).toMatchObject({ card: 'Due at 08:00 · rang late, at 08:47', language: 'fr' })
    expect(second.schedule.read().jobs[0]?.state).toBe('done')
  })

  it('marks missed a one-time reminder missed by twelve hours or more', () => {
    const first = setup()
    first.schedule.create(reminder({ kind: 'once', at: '2026-11-19T08:00' }))

    const second = setup({ records: first.records, at: Date.parse('2026-11-19T19:00:00Z') })
    expect(second.done).toEqual([])
    expect(second.schedule.read().jobs[0]).toMatchObject({ state: 'missed' })
    expect(second.events.at(-1)).toMatchObject({ name: 'schedule.changed' })
  })

  it('does not replay the times a recurring job missed, and rings at its next one', () => {
    const first = setup()
    first.schedule.create(reminder({ kind: 'daily', time: '08:00' }, 'Stretch', 'Time to stretch.'))

    // Two days later, at 9:00: the two mornings missed are not said.
    const second = setup({ records: first.records, at: Date.parse('2026-11-20T08:00:00Z') })
    expect(second.said()).toEqual([])
    expect(second.schedule.read().jobs[0]?.next).toBe('2026-11-21T07:00:00.000Z')
    second.timers.advance(23 * HOUR)
    expect(second.said()).toEqual(['Time to stretch.'])
  })

  it('does not ring twice for a time it rang at just before the restart', () => {
    const first = setup({ at: Date.parse('2026-11-19T06:59:00Z') })
    first.schedule.create(reminder({ kind: 'daily', time: '08:00' }, 'Stretch', 'Time to stretch.'))
    first.timers.advance(MINUTE)
    expect(first.said()).toEqual(['Time to stretch.'])

    const second = setup({ records: first.records, at: Date.parse('2026-11-19T07:01:00Z') })
    second.timers.advance(MINUTE)
    expect(second.said()).toEqual([])
    expect(second.schedule.read().jobs[0]?.next).toBe('2026-11-20T07:00:00.000Z')
  })
})

describe('recurring jobs', () => {
  it('ring every weekday at their time, and only then', () => {
    // Friday 20 November, 7:00 in Paris.
    const { schedule, timers, ran } = setup({ at: Date.parse('2026-11-20T06:00:00Z') })
    schedule.create({ kind: 'task', title: 'Weather in Lyon', request: 'Give me the weather in Lyon.', timing: { kind: 'weekdays', time: '07:30' } })
    timers.advance(HOUR)
    expect(ran()).toEqual(['Give me the weather in Lyon.'])
    // Saturday and Sunday pass in silence; Monday rings.
    timers.advance(2 * 24 * HOUR)
    expect(ran()).toHaveLength(1)
    timers.advance(24 * HOUR)
    expect(ran()).toHaveLength(2)
  })

  it('keep their time on the clock across the change to winter time', () => {
    // Saturday 24 October 2026, 9:00 in Paris, summer time.
    const { schedule, timers, said } = setup({ at: Date.parse('2026-10-24T07:00:00Z') })
    schedule.create(reminder({ kind: 'daily', time: '08:00' }, 'Stretch', 'Time to stretch.'))
    expect(schedule.read().jobs[0]?.next).toBe('2026-10-25T07:00:00.000Z')
    timers.advance(24 * HOUR)
    expect(said()).toEqual(['Time to stretch.'])
    expect(schedule.read().jobs[0]?.next).toBe('2026-10-26T07:00:00.000Z')
  })

  it('ring every few hours between two times', () => {
    const { schedule, timers, said } = setup({ at: Date.parse('2026-11-18T07:30:00Z') })
    schedule.create(reminder({ kind: 'hourly', every: 3, from: '09:00', until: '15:00' }, 'Water', 'Drink some water.'))
    timers.advance(12 * HOUR)
    expect(said()).toEqual(['Drink some water.', 'Drink some water.', 'Drink some water.'])
  })
})

describe('changing jobs', () => {
  it('pauses, and resumes from the next time without the ones paused through', () => {
    const { schedule, timers, said } = setup({ at: Date.parse('2026-11-18T06:00:00Z') })
    const set = schedule.create(reminder({ kind: 'daily', time: '08:00' }, 'Stretch', 'Time to stretch.'))
    const id = set.ok ? set.job.id : ''
    schedule.change(id, { paused: true })
    expect(schedule.read().jobs[0]).toMatchObject({ state: 'paused' })
    expect(schedule.read().jobs[0]?.next).toBeUndefined()
    timers.advance(2 * 24 * HOUR)
    expect(said()).toEqual([])
    schedule.change(id, { paused: false })
    expect(said()).toEqual([])
    timers.advance(24 * HOUR)
    expect(said()).toEqual(['Time to stretch.'])
  })

  it('takes a new timing, from now', () => {
    const { schedule, timers, said } = setup()
    const set = schedule.create(reminder({ kind: 'once', at: '2026-11-18T20:00' }))
    schedule.change(set.ok ? set.job.id : '', { timing: { kind: 'once', at: '2026-11-18T14:20' } })
    timers.advance(7 * MINUTE)
    expect(said()).toEqual(["It's time to feed the cat."])
  })

  it('deletes for good: its records are erased', () => {
    const { schedule, records, timers, said } = setup()
    const set = schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:15' }))
    const deleted = schedule.remove([set.ok ? set.job.id : ''])
    expect(deleted.ok && deleted.schedule.jobs).toEqual([])
    expect(records.read(['schedule.job']).map((record) => record.payload)).toEqual([null])
    timers.advance(10 * MINUTE)
    expect(said()).toEqual([])
  })

  it('keeps the quiet hours the person chose, after a restart too', () => {
    const first = setup()
    first.schedule.setQuiet({ from: '22:00', until: '06:00' })
    expect(setup({ records: first.records }).schedule.read().quiet).toEqual({ on: true, from: '22:00', until: '06:00' })
  })
})

describe('everything paused at once', () => {
  it('rings nothing while held, then rings late what is still worth it', () => {
    const { schedule, timers, said } = setup()
    schedule.create(reminder({ kind: 'once', at: '2026-11-18T14:15' }))
    schedule.create(reminder({ kind: 'daily', time: '14:30' }, 'Stretch', 'Time to stretch.'))
    schedule.hold(true)
    expect(schedule.read().held).toBe(true)
    timers.advance(HOUR)
    expect(said()).toEqual([])
    schedule.hold(false)
    // The one-time reminder rings late; the daily one goes on from tomorrow.
    expect(said()).toEqual(['You asked me to remind you at 14:15: Feed the cat.'])
    expect(schedule.read().jobs.find((job) => job.title === 'Stretch')?.next).toBe('2026-11-19T13:30:00.000Z')
  })

  it('stays held after a restart', () => {
    const first = setup()
    first.schedule.hold(true)
    expect(setup({ records: first.records }).schedule.held()).toBe(true)
  })
})

describe('a job on files', () => {
  /** A schedule whose folders are watched by hand: `arrive` reports paths in a folder, as the system would. */
  function watched({ held = false } = {}) {
    const timers = manualTimers()
    const watchers = new Map<string, (paths: readonly string[]) => void>()
    const done: string[] = []
    let ids = 0
    const schedule = createSchedule({
      records: memoryRecords(),
      now: () => new Date(START + timers.elapsed()),
      zone: () => PARIS,
      timers,
      newId: () => `job-${++ids}`,
      proactive: {
        busy: () => false,
        remind: ({ sentence, card }) => done.push(`${sentence} | ${(card.spec.elements.when?.props as { text?: string } | undefined)?.text}`),
        run: ({ request }) => done.push(request),
        notify: () => undefined
      },
      files: {
        watch(folder, changed) {
          watchers.set(folder, changed)
          return () => watchers.delete(folder)
        },
        fileAt: async () => ({ size: 1 }),
        reaches: () => true
      }
    })
    if (held) schedule.hold(true)
    schedule.listen()
    const arrive = async (folder: string, ...paths: string[]) => {
      watchers.get(folder)?.(paths)
      timers.advance(3_000)
      for (let step = 0; step < 10; step++) await Promise.resolve()
    }
    return { schedule, watchers, done, arrive }
  }

  it('says a reminder the first time a file arrives, naming it, and is done', async () => {
    const { schedule, watchers, done, arrive } = watched()
    schedule.create(reminder({ kind: 'files', folder: '/home/ada/Downloads', repeat: false }, 'Download done', 'Your download is done.'))
    expect([...watchers.keys()]).toEqual(['/home/ada/Downloads'])
    expect(schedule.read().jobs[0]).toMatchObject({ state: 'active' })
    expect(schedule.read().jobs[0]?.next).toBeUndefined()
    await arrive('/home/ada/Downloads', '/home/ada/Downloads/film.mkv')
    expect(done).toEqual(['Your download is done. | film.mkv · in Downloads'])
    expect(schedule.read().jobs[0]).toMatchObject({ state: 'done' })
    expect(watchers.size).toBe(0)
  })

  it('carries out a task each time, told which files set it off', async () => {
    const { schedule, done, arrive } = watched()
    schedule.create({
      kind: 'task',
      title: 'File the scans',
      request: 'File the new scans.',
      timing: { kind: 'files', folder: '/s', pattern: '*.pdf', repeat: true }
    })
    await arrive('/s', '/s/a.pdf')
    expect(done[0]).toBe('File the new scans.\n\n(What set it off: this file arrived or changed in /s, written in full: /s/a.pdf.)')
    expect(schedule.read().jobs[0]).toMatchObject({ state: 'active' })
  })

  it('watches nothing while everything is held, nor while the job is paused', () => {
    const { schedule, watchers } = watched({ held: true })
    const set = schedule.create(reminder({ kind: 'files', folder: '/d', repeat: true }))
    expect(watchers.size).toBe(0)
    schedule.hold(false)
    expect(watchers.size).toBe(1)
    if (set.ok) schedule.change(set.job.id, { paused: true })
    expect(watchers.size).toBe(0)
  })
})
