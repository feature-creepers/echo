import { type Exchange, exchangeSchema } from '@repo/protocol'
import { z } from 'zod'
import type { Records } from '../ports/records.ts'

/**
 * The type of the record written when a thread starts on a request: what it was asked, so that work the app's
 * restart cut short is taken up again when it opens.
 */
export const WORK = 'channel.work'

/** The type of the record a thread writes to be woken when the app opens again: what to carry on with. */
export const RESUME = 'channel.resume'

/** The type of the record written once work cut short, or planned for after a restart, is taken up again. */
export const RESUMED = 'channel.resumed'

/**
 * Work cut short longer ago than this is not taken up again by itself: the person has moved on. Its line is still
 * closed, as stopped, so what was asked and what it showed are not lost.
 */
const RESUME_WITHIN_MS = 24 * 60 * 60_000

/**
 * How many times in a row a thread may be woken by the app's restart, to carry its work on by itself, before the
 * person speaks to it again (docs/SPEC.md, section 7.11). A thread that installs a new build of the app it runs in
 * restarts it and is woken again when it opens: with no limit, it could go on for hours, and each time it writes
 * itself what to do next, its work can drift far from what the person asked.
 */
export const RESUMES_WITHOUT_THE_PERSON = 3

const workRecord = z.object({ thread: z.string().min(1), request: z.string(), exchange: exchangeSchema })
const resumeRecord = z.object({ id: z.string().min(1), thread: z.string().min(1), request: z.string() })
const resumedRecord = z.object({ id: z.string().min(1) })

/** Work to take up again when the app opens: a request cut short by the restart, or one a thread planned for it. */
export interface Resumption {
  /** The turn cut short, or the plan's own identifier. */
  id: string
  thread: string
  /** What the thread is told. */
  request: string
  /** For a request cut short: its line of the transcript, recorded as stopped once it is taken up. */
  cut?: Exchange | undefined
  /** Cut short too long ago to be taken up again: its line is closed, and nothing more. */
  late?: boolean | undefined
}

/**
 * What the last run of the app left to do, from the records, for threads still known: the requests its threads were
 * answering when it stopped, those cut short too long ago marked late; and what a thread asked to be woken with,
 * recent enough. None of them taken up yet.
 */
export function readResumptions(records: Records, transcript: readonly Exchange[], now: Date, known: (thread: string) => boolean): Resumption[] {
  const answered = new Set(transcript.map((line) => line.turn))
  const done = new Set<string>()
  const found = new Map<string, Resumption>()
  const recent = (at: string) => now.getTime() - Date.parse(at) <= RESUME_WITHIN_MS
  for (const record of records.read([WORK, RESUME, RESUMED])) {
    if (record.type === RESUMED) {
      const read = resumedRecord.safeParse(record.payload)
      if (read.success) done.add(read.data.id)
    } else if (record.type === WORK) {
      const read = workRecord.safeParse(record.payload)
      if (read.success && !answered.has(read.data.exchange.turn))
        found.set(read.data.exchange.turn, {
          id: read.data.exchange.turn,
          thread: read.data.thread,
          request: read.data.request,
          cut: read.data.exchange,
          ...(recent(record.at) ? {} : { late: true })
        })
    } else {
      const read = resumeRecord.safeParse(record.payload)
      if (read.success && recent(record.at)) found.set(read.data.id, read.data)
    }
  }
  return [...found.values()].filter((one) => !done.has(one.id) && known(one.thread))
}

/**
 * How many turns in a row a thread took up by itself after a restart, since the person last spoke to it. Each counts
 * once, whether it ended or the next restart cut it short: a turn cut short is kept only as stopped.
 */
export function resumesInARow(transcript: readonly Exchange[], thread: string): number {
  let count = 0
  for (let index = transcript.length - 1; index >= 0; index--) {
    const exchange = transcript[index]
    if (exchange?.thread !== thread) continue
    if (exchange.trigger === undefined) break
    if (exchange.trigger === 'resume') count++
  }
  return count
}

/** What the person last asked a thread, in their words: work it takes up by itself is held to it. */
export function lastRequest(transcript: readonly Exchange[], thread: string): string | undefined {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const exchange = transcript[index]
    if (exchange?.thread === thread && exchange.trigger === undefined && exchange.said.trim() !== '') return exchange.said
  }
  return undefined
}

/** What a thread is told when it is woken after a restart, with what the person asked to hold it to. */
export function wakeRequest(woken: { planned?: string | undefined; cut?: string | undefined; asked?: string | undefined }): string {
  const asked =
    woken.asked !== undefined && woken.asked !== woken.planned && woken.asked !== woken.cut ? `\n\nWhat the person asked, in their words: ${woken.asked}` : ''
  const scope = 'Carry on only with what the person asked, and add nothing they did not ask for. When it is done, stop and report.'
  if (woken.planned !== undefined)
    return `(The app has opened again, as you planned before it restarted. ${scope})${asked}\n\nYour note for now: ${woken.planned}`
  return `(The app restarted while you were working on this: it was updated, or reopened. Your session is new. Check where the work stands, in the files and what you did above, then carry it on to the end without redoing what is done. ${scope})${asked}\n\n${woken.cut ?? ''}`
}
