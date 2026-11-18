import {
  type CommandError,
  type Event,
  type Job,
  type JobKind,
  type JobState,
  jobSchema,
  type Notification,
  type QuietHours,
  recurrenceWords,
  type ScheduleView,
  type Timing
} from '@repo/protocol'
import { z } from 'zod'
import type { Timers } from '../ports/clock.ts'
import { ERASURE, type Records, type StoredRecord } from '../ports/records.ts'
import type { Checked } from '../views/screen.ts'
import { DEFAULT_QUIET, isQuiet, QUIET_SET, readQuietHours } from './quiet.ts'
import { clockAt, nextTime, onceAt } from './timing.ts'
import { lateSentence, reminderCard } from './words.ts'

/**
 * Reminders and scheduled tasks (docs/SPEC.md, section 7.10). A job is kept as records and read back at start, so
 * it rings after a restart. Its time comes from the clock and the timers the core is given, never from the
 * machine's own, so the whole of it is tested by moving time by hand.
 *
 * A job is never changed in place: each version is a record of type `schedule.job` carrying its whole state, and a
 * later record with the same identifier replaces it. Each time a job rings, a `schedule.rang` record says so, which
 * is how a recurring job knows the times it has already rung. Deleting is an erasure naming all of them.
 */

/** The type of a job's record: one version of one job. */
export const JOB = 'schedule.job'
/** The type of the record written each time a job rings. */
export const RANG = 'schedule.rang'
/** The type of the record written when everything is paused at once, or resumed. */
export const HELD = 'schedule.held'

/** How late a job may ring and still count as on time: a timer can fire a little after its moment. */
export const ON_TIME_MS = 2 * 60_000
/** How late a one-time job may ring, worded as late, when the app was not running at its time. Later, it is missed. */
export const LATE_LIMIT_MS = 12 * 60 * 60_000
/**
 * The longest the scheduler sleeps before looking at the clock again. A timer counts time only while the machine
 * is awake, so a long one would ring late after the machine slept; looking every minute keeps a job on time.
 */
const LOOK_MS = 60_000
/** How often a job that rang while the person was being answered looks again for a pause to be said in. */
const PAUSE_LOOK_MS = 1_000
/** How many jobs can wait to ring at once. More is more likely a model gone wrong than a person's plan. */
export const MAX_JOBS = 100

const jobRecordSchema = jobSchema.omit({ id: true, next: true, last: true }).extend({
  job: z.string().min(1).max(64),
  /** From when its times count: when it was set, or resumed. A recurring job never rings for a time before it. */
  from: z.string()
})
type JobRecord = z.infer<typeof jobRecordSchema>

const rangSchema = z.object({ job: z.string(), due: z.string() })

/** A job as the scheduler holds it: its latest version, the records of all its versions, and when it last rang. */
interface Kept {
  record: JobRecord
  records: string[]
  last: number | undefined
}

/** What a job does at its time, as the conversation carries it out (docs/SPEC.md, section 7.8). */
export interface Proactive {
  /** Whether the person is being answered: a reminder waits for a pause rather than talk over the answer. */
  busy(): boolean
  /** Say a reminder, a turn of its own with nothing to work out, and show its card in the stream. */
  remind(reminder: { sentence: string; language: string | undefined; card: Checked; silent: boolean }): void
  /** Carry out a task now, as if the person had just asked it. */
  run(task: { title: string; request: string; language: string | undefined; silent: boolean }): void
  /** Show a notification on the devices that can. */
  notify(notification: Notification): void
}

export interface ScheduleOptions {
  records: Records
  now: () => Date
  /** The person's time zone, as an IANA name: the jobs ring by its clock. */
  zone: () => string
  /** Left out, nothing rings by itself: jobs can still be set, read and changed. */
  timers?: Timers | undefined
  newId: () => string
  proactive: Proactive
}

/** A job to set, as read from a tool. */
export interface NewJob {
  kind: JobKind
  title: string
  sentence?: string | undefined
  request?: string | undefined
  language?: string | undefined
  timing: Timing
}

/** What can change in a job. What is left out keeps its value. */
export interface JobChange {
  title?: string | undefined
  sentence?: string | undefined
  request?: string | undefined
  timing?: Timing | undefined
  paused?: boolean | undefined
}

export type ScheduleChange = { ok: true; schedule: ScheduleView } | { ok: false; error: CommandError }

export interface Schedule {
  /**
   * A client is there to hear what rings, and to be shown it: from now on jobs ring. What fell due while the app
   * was not running rings now, or is marked missed.
   */
  listen(): void
  read(): ScheduleView
  /** One job, as a client sees it. */
  get(job: string): Job | undefined
  /** Set a job. Refused when it would never ring, or when too many wait. */
  create(job: NewJob): { ok: true; job: Job } | { ok: false; problem: string }
  /** Change a job: its words, its timing, or pause and resume it. */
  change(job: string, change: JobChange): { ok: true; job: Job } | { ok: false; problem: string }
  /** Delete jobs for good: their records are erased. */
  remove(jobs: readonly string[]): ScheduleChange
  setQuiet(quiet: { [Key in keyof QuietHours]?: QuietHours[Key] | undefined }): ScheduleView
  /** Whether it is the quiet hours now. */
  quiet(): boolean
  /**
   * Pause everything at once, or resume: what "stop everything" calls. While held nothing rings; once resumed, a
   * one-time reminder due less than twelve hours ago rings late, and recurring jobs go on from their next time.
   */
  hold(held: boolean): ScheduleView
  held(): boolean
  /** Be told `schedule.changed`. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** Stop looking at the clock. Called once, when the core stops. */
  close(): void
}

const unknownJob = (job: string): { ok: false; problem: string } => ({ ok: false, problem: `There is no job "${job}" waiting to ring.` })

export function createSchedule(options: ScheduleOptions): Schedule {
  const { records, timers, proactive } = options
  const listeners = new Set<(event: Event) => void>()
  const kept = new Map<string, Kept>()
  let quiet = DEFAULT_QUIET
  let held = false
  let revision = 0
  /** Nothing rings before a client is there to hear it: a reminder due at launch is not said to nobody. */
  let listening = false
  const clock = () => options.now().getTime()

  // ---------------------------------------------------------------- replay

  const take = (record: StoredRecord) => {
    if (record.type === QUIET_SET) {
      quiet = readQuietHours(record.payload) ?? quiet
      return
    }
    if (record.type === HELD) {
      held = (record.payload as { held?: unknown } | null)?.held === true
      return
    }
    if (record.type === RANG) {
      const rang = rangSchema.safeParse(record.payload)
      const job = rang.success ? kept.get(rang.data.job) : undefined
      if (!rang.success || !job) return
      job.records.push(record.id)
      job.last = Math.max(job.last ?? Number.NEGATIVE_INFINITY, Date.parse(rang.data.due))
      return
    }
    const read = jobRecordSchema.safeParse(record.payload)
    if (!read.success) return
    const before = kept.get(read.data.job)
    kept.set(read.data.job, { record: read.data, records: [...(before?.records ?? []), record.id], last: before?.last })
  }
  for (const record of records.read([JOB, RANG, QUIET_SET, HELD])) take(record)
  revision = kept.size

  // ---------------------------------------------------------------- reading

  /** When a job rings next, if it is active: a recurring one never for a time before `from`, nor one it rang at. */
  const nextOf = (entry: Kept, now: number): number | undefined => {
    const { record } = entry
    if (record.state !== 'active') return undefined
    if (record.timing.kind === 'once') return entry.last === undefined ? onceAt(record.timing, options.zone()) : undefined
    // A recurring job does not ring again for the times it missed: only one due a moment ago still counts.
    const after = Math.max(Date.parse(record.from) - 1, entry.last ?? Number.NEGATIVE_INFINITY, now - ON_TIME_MS)
    return nextTime(record.timing, after, options.zone())
  }

  const toJob = (entry: Kept, now: number): Job => {
    const { job: id, from: _from, ...rest } = entry.record
    const next = nextOf(entry, now)
    return {
      id,
      ...rest,
      ...(next === undefined || Number.isNaN(next) ? {} : { next: new Date(next).toISOString() }),
      ...(entry.last === undefined ? {} : { last: new Date(entry.last).toISOString() })
    }
  }

  const read = (): ScheduleView => {
    const now = clock()
    const jobs = [...kept.values()].map((entry) => toJob(entry, now))
    const waiting = jobs.filter((job) => job.state === 'active' || job.state === 'paused')
    const past = jobs.filter((job) => job.state === 'done' || job.state === 'missed')
    // Waiting jobs, the next to ring first and the paused after them; past ones, the latest first.
    const at = (job: Job) => (job.next ? Date.parse(job.next) : Number.POSITIVE_INFINITY)
    waiting.sort((one, other) => at(one) - at(other) || one.since.localeCompare(other.since))
    const ended = (job: Job) => job.last ?? (job.timing.kind === 'once' ? new Date(onceAt(job.timing, options.zone())).toISOString() : job.since)
    past.sort((one, other) => ended(other).localeCompare(ended(one)))
    return { revision, jobs: [...waiting, ...past], quiet, held, timeZone: options.zone() }
  }

  const changed = () => {
    revision++
    const schedule = read()
    for (const listener of listeners) listener({ type: 'event', name: 'schedule.changed', schedule })
    arm()
    return schedule
  }

  const write = (record: JobRecord) => {
    const [stored] = records.append([{ type: JOB, payload: record }])
    if (stored) take(stored)
  }

  // ---------------------------------------------------------------- ringing

  /** Reminders that rang while the person was being answered, said at the next pause. */
  const waiting: (() => void)[] = []
  let cancelPause = () => {}

  const sayWhenFree = () => {
    cancelPause()
    while (waiting.length > 0 && !proactive.busy()) waiting.shift()?.()
    if (waiting.length > 0 && timers) cancelPause = timers.after(PAUSE_LOOK_MS, sayWhenFree)
  }

  /** A job's time has come: it rings, worded as late when it is. */
  const ring = (entry: Kept, due: number, now: number) => {
    const { record } = entry
    const zone = options.zone()
    const late = now - due > ON_TIME_MS
    const silent = isQuiet(quiet, now, zone)
    const [rang] = records.append([{ type: RANG, payload: { job: record.job, due: new Date(due).toISOString() } }])
    if (rang) take(rang)
    if (record.timing.kind === 'once') write({ ...record, state: 'done' })

    if (record.kind === 'reminder') {
      const sentence = late ? lateSentence(record.title, due, zone, record.language) : (record.sentence ?? record.title)
      const every = recurrenceWords(record.timing)
      const when = late ? `Due at ${clockAt(due, zone)} · rang late, at ${clockAt(now, zone)}` : `${clockAt(due, zone)}${every ? ` · ${every}` : ''}`
      // The notification goes at once, so a person away from the screen has it; the voice waits for a pause.
      proactive.notify({ title: record.title, body: sentence, silent, unlessFocused: false })
      waiting.push(() => proactive.remind({ sentence, language: record.language, card: reminderCard(record.title, when), silent }))
    } else {
      waiting.push(() => proactive.run({ title: record.title, request: record.request ?? record.title, language: record.language, silent }))
    }
  }

  /** Look at the clock: ring what is due, mark missed what is too late to ring, then sleep until the next time. */
  const look = () => {
    if (held || !listening) return
    const now = clock()
    let moved = false
    for (const entry of [...kept.values()]) {
      if (entry.record.state !== 'active') continue
      const due = nextOf(entry, now)
      if (due === undefined || Number.isNaN(due) || due > now) continue
      if (now - due <= ON_TIME_MS || (entry.record.timing.kind === 'once' && now - due < LATE_LIMIT_MS)) ring(entry, due, now)
      else write({ ...entry.record, state: 'missed' })
      moved = true
    }
    sayWhenFree()
    if (moved) changed()
    else arm()
  }

  let cancelLook = () => {}
  function arm() {
    cancelLook()
    if (!timers || held || !listening) return
    const now = clock()
    const nexts = [...kept.values()].map((entry) => nextOf(entry, now)).filter((next): next is number => next !== undefined && !Number.isNaN(next))
    if (nexts.length === 0) return
    cancelLook = timers.after(Math.max(0, Math.min(LOOK_MS, Math.min(...nexts) - now)), look)
  }

  // ---------------------------------------------------------------- changes

  const pending = () => [...kept.values()].filter((entry) => entry.record.state === 'active' || entry.record.state === 'paused').length

  const neverRings = (timing: Timing, now: number) =>
    timing.kind === 'once' ? onceAt(timing, options.zone()) <= now : nextTime(timing, now, options.zone()) === undefined

  const create: Schedule['create'] = (job) => {
    if (pending() >= MAX_JOBS) return { ok: false, problem: `${MAX_JOBS} reminders and tasks are already waiting. Cancel some first.` }
    const now = clock()
    if (neverRings(job.timing, now)) return { ok: false, problem: 'That would never ring: its time has passed.' }
    const id = options.newId()
    const at = new Date(now).toISOString()
    write({
      job: id,
      kind: job.kind,
      title: job.title,
      ...(job.kind === 'reminder' && job.sentence !== undefined ? { sentence: job.sentence } : {}),
      ...(job.kind === 'task' && job.request !== undefined ? { request: job.request } : {}),
      ...(job.language === undefined ? {} : { language: job.language }),
      timing: job.timing,
      state: 'active',
      since: at,
      from: at
    })
    changed()
    const entry = kept.get(id) as Kept
    return { ok: true, job: toJob(entry, now) }
  }

  const change: Schedule['change'] = (id, asked) => {
    const entry = kept.get(id)
    if (!entry || (entry.record.state !== 'active' && entry.record.state !== 'paused')) return unknownJob(id)
    const now = clock()
    const timing = asked.timing ?? entry.record.timing
    const state: JobState = asked.paused === undefined ? entry.record.state : asked.paused ? 'paused' : 'active'
    if (state === 'active' && neverRings(timing, now)) return { ok: false, problem: 'That would never ring: its time has passed.' }
    // Resumed, or given a new timing, a job counts its times from now: it does not ring for the ones it was paused through.
    const restarts = (state === 'active' && entry.record.state === 'paused') || asked.timing !== undefined
    write({
      ...entry.record,
      ...(asked.title === undefined ? {} : { title: asked.title }),
      ...(asked.sentence === undefined || entry.record.kind !== 'reminder' ? {} : { sentence: asked.sentence }),
      ...(asked.request === undefined || entry.record.kind !== 'task' ? {} : { request: asked.request }),
      timing,
      state,
      ...(restarts ? { from: new Date(now).toISOString() } : {})
    })
    // A new timing is a new job as far as its times go: what it rang under the old one does not hold it back.
    if (asked.timing !== undefined) entry.last = undefined
    changed()
    return { ok: true, job: toJob(kept.get(id) as Kept, now) }
  }

  const remove: Schedule['remove'] = (ids) => {
    const known = ids.filter((id) => kept.has(id))
    if (known.length === 0) return { ok: false, error: { code: 'invalid-input', message: `There is no job "${ids[0]}".` } }
    const erased = known.flatMap((id) => kept.get(id)?.records ?? [])
    records.append([{ type: ERASURE, payload: { records: erased } }])
    for (const id of known) kept.delete(id)
    return { ok: true, schedule: changed() }
  }

  return {
    read,
    listen() {
      if (listening) return
      listening = true
      look()
    },
    get(id) {
      const entry = kept.get(id)
      return entry ? toJob(entry, clock()) : undefined
    },
    create,
    change,
    remove,
    setQuiet(asked) {
      const next = { ...quiet, ...Object.fromEntries(Object.entries(asked).filter(([, value]) => value !== undefined)) }
      records.append([{ type: QUIET_SET, payload: next }])
      quiet = next
      return changed()
    },
    quiet: () => isQuiet(quiet, clock(), options.zone()),
    hold(next) {
      if (next === held) return read()
      records.append([{ type: HELD, payload: { held: next } }])
      held = next
      if (held) {
        cancelLook()
        cancelPause()
        waiting.length = 0
        return changed()
      }
      const schedule = changed()
      look()
      return schedule
    },
    held: () => held,
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close() {
      cancelLook()
      cancelPause()
    }
  }
}

/** Whether a job is still to ring: active or paused. */
export const isWaiting = (job: Job) => job.state === 'active' || job.state === 'paused'
