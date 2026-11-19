import { exchangeSchema, retentionDaysSchema } from '@repo/protocol'
import { z } from 'zod'
import { EXCHANGE, RESUME, RESUMED, STEP, WORK } from '../channel/channel.ts'
import type { Records, StoredRecord } from '../ports/records.ts'
import { VIEW_CLEARED, VIEW_SHOWN } from '../views/screen.ts'

/**
 * How long the conversation's words are kept (docs/SPEC.md, section 10.2). The log is kept for good unless the
 * person sets a period; past it, the words are erased with the same tombstone as a forgotten fact, so they leave
 * the search index too. What was made of them stays: the facts, the profile and the threads' summaries, which the
 * person reads and forgets on their own.
 */

/** The type of the record written each time the person changes how long the conversation is kept. */
export const RETENTION_SET = 'memory.retention-set'

const retentionRecord = z.object({ days: retentionDaysSchema.nullable() })

/** How many days a retention record keeps the conversation, null for good, or nothing when it cannot be read. */
export function readRetention(payload: unknown): number | null | undefined {
  const read = retentionRecord.safeParse(payload)
  return read.success ? read.data.days : undefined
}

/** How often the period is applied while the app stays open, besides when it opens and when the period changes. */
export const RETENTION_PASS_MS = 12 * 60 * 60_000

const DAY_MS = 24 * 60 * 60_000

/**
 * The records that carry the conversation's words: each line, each tool call, each request taken up, each view shown.
 * The closing of a view is read too, to know which views are no longer on the screen; it names a view and says
 * nothing, so it is kept.
 */
export const CONVERSATION_RECORDS = [EXCHANGE, STEP, WORK, RESUME, RESUMED, VIEW_SHOWN, VIEW_CLEARED] as const

/** What a pass erases: the records, and the turns whose lines go with them. */
export interface Expired {
  records: string[]
  turns: Set<string>
}

/** The moment before which the words go, for a period counted back from `now`. */
export function keptSince(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

/** The views whose latest record closes them: those are no longer on the screen. */
function closedViews(records: readonly StoredRecord[]): Set<string> {
  const closed = new Map<string, boolean>()
  for (const record of records) {
    if (record.payload === null) continue
    if (record.type === VIEW_CLEARED) {
      const view = (record.payload as { view?: unknown }).view
      if (typeof view === 'string') closed.set(view, true)
    } else if (record.type === VIEW_SHOWN) {
      const view = (record.payload as { id?: unknown }).id
      if (typeof view === 'string') closed.set(view, false)
    }
  }
  return new Set([...closed].flatMap(([view, gone]) => (gone ? [view] : [])))
}

/**
 * The records among `records` that carry the conversation's words and that `chosen` picks, but for a view still on
 * the screen, which stays however it was chosen, and the closing of a view, which says nothing. A record already
 * erased is not named again.
 */
function wordsAmong(records: readonly StoredRecord[], chosen: (record: StoredRecord) => boolean): Expired {
  const closed = closedViews(records)
  const words: Expired = { records: [], turns: new Set() }
  for (const record of records) {
    if (record.payload === null || record.type === VIEW_CLEARED || !chosen(record)) continue
    if (record.type === VIEW_SHOWN) {
      const view = (record.payload as { id?: unknown }).id
      if (typeof view !== 'string' || !closed.has(view)) continue
    }
    if (record.type === EXCHANGE) {
      const line = exchangeSchema.safeParse(record.payload)
      if (line.success) words.turns.add(line.data.turn)
    }
    words.records.push(record.id)
  }
  return words
}

/** The records written before `since` that carry the conversation's words. A view still on the screen is kept, however old. */
export function expiredRecords(records: readonly StoredRecord[], since: string): Expired {
  return wordsAmong(records, (record) => record.at < since)
}

/**
 * The words of these turns (docs/SPEC.md, section 10.7): their lines, their tool calls with what went in and out,
 * the requests recorded to take them up after a restart, and the views they showed that the person has since closed.
 * What forgetting a fact erases of the conversation it was learned in.
 */
export function wordsOfTurns(records: readonly StoredRecord[], turns: ReadonlySet<string>): Expired {
  if (turns.size === 0) return { records: [], turns: new Set() }
  return wordsAmong(records, (record) => {
    const turn = turnOf(record)
    return turn !== undefined && turns.has(turn)
  })
}

/** The turn a record of the conversation belongs to, when it says. */
function turnOf(record: StoredRecord): string | undefined {
  const payload = record.payload as { turn?: unknown; exchange?: { turn?: unknown } } | null
  const turn = record.type === WORK ? payload?.exchange?.turn : payload?.turn
  return typeof turn === 'string' ? turn : undefined
}

/** The records a pass erases now, from the records as they are. Nothing when the conversation is kept for good. */
export function expiredNow(records: Records, days: number | null, now: Date): Expired {
  if (days === null) return { records: [], turns: new Set() }
  return expiredRecords(records.read(CONVERSATION_RECORDS), keptSince(now, days))
}
