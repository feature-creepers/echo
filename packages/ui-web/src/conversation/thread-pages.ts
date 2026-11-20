import type { ThreadRead } from '@repo/client'
import type { Exchange, Step, Thread } from '@repo/protocol'

/** A view as the sheet names it, under the request that showed it. */
type ViewTitle = ThreadRead['views'][number]

/** One request as the sheet shows it: what was asked and answered, its calls, the views it showed. */
export interface ThreadEntry {
  exchange: Exchange
  steps: Step[]
  views: ViewTitle[]
  /** How many of its first calls are left out: it made too many to show. */
  earlierSteps: number
}

/** What the sheet has read of a thread: a run of its requests, the latest included, oldest first. */
export interface ThreadPages {
  thread: Thread
  entries: ThreadEntry[]
  /** How many requests come before the first one read, still to be read. */
  earlier: number
}

const entriesOf = (page: ThreadRead): ThreadEntry[] =>
  page.exchanges.map((exchange, index) => ({
    exchange,
    steps: page.steps.filter((step) => step.turn === exchange.turn),
    views: page.views.filter((view) => view.turn === exchange.turn),
    earlierSteps: index === 0 ? page.earlierSteps : 0
  }))

/**
 * The latest page, read again as the thread works: it replaces the requests it holds, and those read before it, as
 * the person scrolled up, stay in front of it. A request's place is counted from the thread's first: where the
 * page starts tells whether it joins what was read. When it does not, so many requests having come since that
 * some were never read, the page alone is kept.
 */
export function withLatest(pages: ThreadPages | undefined, page: ThreadRead): ThreadPages {
  const fresh = entriesOf(page)
  if (pages === undefined || page.earlier < pages.earlier || page.earlier > pages.earlier + pages.entries.length) {
    return { thread: page.thread, entries: fresh, earlier: page.earlier }
  }
  const turns = new Set(page.exchanges.map((exchange) => exchange.turn))
  const before = pages.entries.slice(0, page.earlier - pages.earlier).filter((entry) => !turns.has(entry.exchange.turn))
  return { thread: page.thread, entries: [...before, ...fresh], earlier: pages.earlier }
}

/** A page of the requests before the first one read, as the person scrolls up: it goes in front. */
export function withEarlier(pages: ThreadPages, page: ThreadRead): ThreadPages {
  const known = new Set(pages.entries.map((entry) => entry.exchange.turn))
  return {
    thread: pages.thread,
    entries: [...entriesOf(page).filter((entry) => !known.has(entry.exchange.turn)), ...pages.entries],
    earlier: page.earlier
  }
}
