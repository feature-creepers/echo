import type { Exchange } from '@repo/protocol'
import { z } from 'zod'
import type { Harness } from '../ports/harness.ts'
import { shorten } from '../text.ts'
import { dayOf } from './answer.ts'

/**
 * Thread summaries (docs/SPEC.md, section 10.2): for each thread, a few sentences on what it is about, where it
 * stands and what is still open, written while the assistant sleeps. The orchestrator reads them to know where a
 * request belongs, and a thread's new session is given its summary, so it knows what came before the few
 * exchanges it is told again word for word.
 */

/** The type of the record that keeps a thread's summary. The latest one for a thread is its summary. */
export const THREAD_SUMMARY = 'memory.thread-summary'

const summaryRecordSchema = z.object({
  thread: z.string().min(1),
  text: z.string().min(1),
  /** The last exchange it was written from: the next one is written from the exchanges after it. */
  through: z.string().min(1)
})
export type SummaryRecord = z.infer<typeof summaryRecordSchema>

export function readSummaryRecord(payload: unknown): SummaryRecord | undefined {
  const read = summaryRecordSchema.safeParse(payload)
  return read.success ? read.data : undefined
}

/** The most threads one sleep summarises, the most recently used first: the others wait for the next sleep. */
export const SUMMARIES_PER_SLEEP = 8
/** The most new exchanges one summary reads, the latest ones. */
const SUMMARY_EXCHANGES = 24
const SAID_LENGTH = 600
const REPLIED_LENGTH = 900
const SUMMARY_LENGTH = 900

export const SUMMARY_INSTRUCTIONS = [
  'You keep the summary of one thread of conversation between a person and their voice assistant.',
  'You are given the summary so far, if there is one, and the exchanges since. Write the new summary: at most 100 words of plain prose, in English, saying what the thread is about, what was done or decided, where it stands now, what is still open, and the people, places, files or things it names.',
  'Keep from the summary so far what still matters. Dates are absolute. Add nothing the exchanges do not say. No headings, no lists, no markup.'
].join('\n')

/** Ask the model for a thread's new summary. Rejects when the harness fails. */
export async function writeSummary(
  harness: Harness,
  thread: { title?: string | undefined; summary?: string | undefined },
  exchanges: readonly Exchange[],
  now: Date
): Promise<string> {
  const lines = exchanges
    .slice(-SUMMARY_EXCHANGES)
    .map(
      (exchange) =>
        `[${exchange.at.slice(0, 16).replace('T', ' ')}] The person: ${shorten(exchange.said, SAID_LENGTH)}\nThe assistant: ${shorten(exchange.replied, REPLIED_LENGTH) || '(no answer)'}`
    )
  const input = [
    `Today is ${dayOf(now)}.`,
    ...(thread.title === undefined ? [] : [`The thread: "${thread.title}".`]),
    `The summary so far: ${thread.summary ?? '(none yet)'}`,
    `The exchanges since:\n${lines.join('\n\n')}`
  ].join('\n\n')
  return shorten(await harness.complete({ role: 'utility', instructions: SUMMARY_INSTRUCTIONS, input }), SUMMARY_LENGTH)
}

/**
 * The threads whose summary is behind: those with exchanges after the last one their summary was written from,
 * the most recently used first, `SUMMARIES_PER_SLEEP` at most, each with those exchanges.
 */
export function summariesDue(exchanges: readonly Exchange[], summaries: ReadonlyMap<string, SummaryRecord>): { thread: string; exchanges: Exchange[] }[] {
  const byThread = new Map<string, Exchange[]>()
  for (const exchange of exchanges) {
    if (exchange.thread === undefined || exchange.outcome === 'running') continue
    const list = byThread.get(exchange.thread) ?? []
    list.push(exchange)
    byThread.set(exchange.thread, list)
  }
  const due: { thread: string; exchanges: Exchange[]; last: string }[] = []
  for (const [thread, list] of byThread) {
    const through = summaries.get(thread)?.through
    const index = through === undefined ? -1 : list.findIndex((exchange) => exchange.turn === through)
    const fresh = list.slice(index + 1).filter((exchange) => exchange.said.trim() !== '' || exchange.replied.trim() !== '')
    if (fresh.length > 0) due.push({ thread, exchanges: fresh, last: fresh.at(-1)?.at ?? '' })
  }
  return due
    .sort((one, other) => other.last.localeCompare(one.last))
    .slice(0, SUMMARIES_PER_SLEEP)
    .map(({ thread, exchanges: list }) => ({ thread, exchanges: list }))
}
