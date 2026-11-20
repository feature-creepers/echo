import { type Feed, feedFigure, feedPoints, feedsOf, type SeriesFeed, type ViewSpec } from '@repo/catalog'
import type { Web } from '../ports/web.ts'
import { keptReadings } from './readings.ts'

/** The largest document a feed may name: a feed is a few figures, not a dataset. */
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000
/**
 * How long a reading is kept: every view drawing the same address within this time shares one reading, and no
 * address is asked more than once in it, whatever the clients.
 */
const FRESH_MS = 30_000
/** How many addresses are kept read, the latest used first. */
const KEPT = 32

export type ReadFeed = { ok: true; document: unknown } | { ok: false; problem: string }

export interface Feeds {
  /** The JSON document at this address, read again once its reading is older than half a minute. */
  read(url: string): Promise<ReadFeed>
  /** Check every feed of a view against its address: one that gives nothing comes back to be corrected. */
  check(spec: ViewSpec): Promise<string[]>
}

/**
 * The live figures of the screen (docs/SPEC.md, section 9.4). The core reads the public JSON address a block's feed
 * names, for the clients, which then need no access of their own to it; a view is checked against its feeds before
 * it is shown, so a path that finds nothing is corrected by the model, not seen by the person.
 */
export function createFeeds(web: Web | undefined, now: () => Date): Feeds {
  const kept = keptReadings<ReadFeed>(KEPT, { ms: FRESH_MS, now })

  const read = (url: string): Promise<ReadFeed> =>
    kept(url, async () => {
      if (!web) return { ok: false, problem: 'this core cannot read the web.' }
      const answer = await web.read(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS })
      if (!answer.ok) return { ok: false, problem: answer.reason }
      try {
        return { ok: true, document: JSON.parse(answer.text) }
      } catch {
        return { ok: false, problem: 'it is not JSON. A feed names an address that answers JSON (an API), not a page.' }
      }
    })

  return {
    read,
    async check(spec) {
      const problems: string[] = []
      await Promise.all(
        feedsOf(spec.elements).map(async ({ id, type, feed, series }) => {
          const where = `"${id}" (${type})${series === undefined ? '' : `, series ${series + 1}`}: feed`
          const answer = await read(feed.url)
          if (!answer.ok) return void problems.push(`${where}: ${feed.url} could not be read: ${answer.problem}`)
          const taken = 'x' in feed ? feedPoints(answer.document, feed as SeriesFeed) : feedFigure(answer.document, feed as Feed)
          if (!taken.ok) problems.push(`${where}: ${taken.problem} in what ${feed.url} answers.`)
          else if (type === 'Progress' && !Array.isArray(taken.value)) {
            const { number, text } = taken.value as { text: string; number?: number }
            if (number === undefined || number < 0 || number > 1) problems.push(`${where}: it gives ${text}, which is not a number from 0 to 1: set its scale.`)
          }
        })
      )
      return problems
    }
  }
}
