import { EXCHANGE } from '../channel/channel.ts'
import type { Search, SearchHit } from '../ports/search.ts'
import { shorten } from './answer.ts'
import { EARLIER_LINE } from './earlier.ts'
import { FACT, type FactBook, type KnownFact } from './facts.ts'

/**
 * What the assistant remembers that bears on what was just said, added to the turn before the model sees it
 * (docs/SPEC.md, section 10.5). It searches the facts and the raw log, so what sleep has not yet made sense of
 * is found too. It makes no model call: it runs before every turn, and must not delay the answer.
 */

/** The most of each that a turn is given. A few good memories help; many drown the question. */
const RECALLED_FACTS = 4
const RECALLED_EXCHANGES = 3
/** How fast a memory fades in the ranking: facts last, the words of a conversation less so. */
const FACT_HALF_LIFE_DAYS = 365
const EXCHANGE_HALF_LIFE_DAYS = 45
const SNIPPET_LENGTH = 220

export interface RecallSources {
  search: Search
  facts: FactBook
  now: () => Date
}

export interface RecallFor {
  /** What the user just said. */
  said: string
  /** Lines of the log written from this date on are already known to the session, and are not recalled. */
  knownSince?: string | undefined
}

/** The memories found for a turn, or nothing when none bears on it. */
export interface Recalled {
  facts: KnownFact[]
  exchanges: SearchHit[]
}

export function recallFor({ search, facts, now }: RecallSources, { said, knownSince }: RecallFor): Recalled {
  const at = now().toISOString()
  // Facts are searched in their past versions too, then kept only when true now: more than needed are asked for.
  const found = search
    .search({ text: said, types: [FACT], limit: RECALLED_FACTS * 3, recency: { now: at, halfLifeDays: FACT_HALF_LIFE_DAYS } })
    .flatMap((hit) => {
      const fact = facts.byRecord(hit.record)
      return fact ? [fact] : []
    })
    .slice(0, RECALLED_FACTS)
  const exchanges = search.search({
    text: said,
    // The lines of conversations held before this app, brought in with their dates, are recalled as the log is.
    types: [EXCHANGE, EARLIER_LINE],
    limit: RECALLED_EXCHANGES,
    recency: { now: at, halfLifeDays: EXCHANGE_HALF_LIFE_DAYS },
    ...(knownSince === undefined ? {} : { before: knownSince })
  })
  return { facts: found, exchanges }
}

/** The memories as the model reads them, ahead of what the user said. Nothing when there are none. */
export function recallBlock({ facts, exchanges }: Recalled): string | undefined {
  if (facts.length === 0 && exchanges.length === 0) return undefined
  const lines = [
    ...facts.map((fact) => `- ${fact.text} (known since ${fact.since.slice(0, 10)})`),
    ...exchanges.map((hit) => `- On ${hit.at.slice(0, 10)}, in conversation: "${shorten(hit.snippet, SNIPPET_LENGTH)}"`)
  ]
  return `[From your memory, which may bear on what follows. Use it if it helps; do not mention it otherwise.]\n${lines.join('\n')}`
}
