import type { ThreadRead } from '@repo/client'
import type { Exchange, Step, Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { type ThreadPages, withEarlier, withLatest } from './thread-pages.ts'

const thread: Thread = { id: 'th1', title: 'Echo', kind: 'topic', state: 'working', at: '2026-11-19T11:00:00.000Z' }
const exchange = (turn: string, replied = 'Done.'): Exchange => ({
  turn,
  at: '2026-11-19T10:00:00.000Z',
  persona: 'p1',
  thread: 'th1',
  said: 'Work on it.',
  replied,
  outcome: 'done'
})
const step = (turn: string): Step => ({ call: `${turn}-c`, turn, thread: 'th1', tool: 'computer_run', at: '2026-11-19T10:00:00.000Z' })

/** A page of the requests named, the first at `earlier` in the thread. */
const page = (turns: string[], earlier: number, earlierSteps = 0, replied?: string): ThreadRead => ({
  thread,
  exchanges: turns.map((turn) => exchange(turn, replied)),
  steps: turns.map(step),
  views: turns.map((turn) => ({ id: `v-${turn}`, title: `View of ${turn}`, turn })),
  earlier,
  earlierSteps
})
const pagesOf = (turns: string[], earlier: number): ThreadPages => withLatest(undefined, page(turns, earlier))
const turnsOf = (pages: ThreadPages) => pages.entries.map((entry) => entry.exchange.turn)

describe('the latest page read again', () => {
  it.each([
    ['the first read', undefined, page(['t8', 't9'], 8), ['t8', 't9'], 8],
    ['the same requests, one answered since', pagesOf(['t8', 't9'], 8), page(['t8', 't9'], 8), ['t8', 't9'], 8],
    ['a new request, the page still starting where it did', pagesOf(['t8', 't9'], 8), page(['t8', 't9', 't10'], 8), ['t8', 't9', 't10'], 8],
    ['a new request, the page now starting later', pagesOf(['t8', 't9'], 8), page(['t9', 't10'], 9), ['t8', 't9', 't10'], 8],
    [
      'earlier pages read before, kept in front',
      pagesOf(['t5', 't6', 't7', 't8', 't9'], 5),
      page(['t8', 't9', 't10'], 8),
      ['t5', 't6', 't7', 't8', 't9', 't10'],
      5
    ],
    ['so many new requests that some were never read', pagesOf(['t8', 't9'], 8), page(['t12', 't13'], 12), ['t12', 't13'], 12],
    ['a page reaching further back than what was read', pagesOf(['t9'], 9), page(['t7', 't8', 't9'], 7), ['t7', 't8', 't9'], 7]
  ])('%s', (_name, pages, latest, turns, earlier) => {
    const merged = withLatest(pages, latest)
    expect(turnsOf(merged)).toEqual(turns)
    expect(merged.earlier).toBe(earlier)
  })

  it('replaces a request with what it now says', () => {
    const merged = withLatest(pagesOf(['t8', 't9'], 8), page(['t8', 't9'], 8, 0, 'Finished.'))
    expect(merged.entries.map((entry) => entry.exchange.replied)).toEqual(['Finished.', 'Finished.'])
  })

  it('gives each request its own calls and views', () => {
    const [first, second] = withLatest(undefined, page(['t1', 't2'], 0)).entries
    expect(first?.steps.map((one) => one.turn)).toEqual(['t1'])
    expect(second?.views.map((one) => one.title)).toEqual(['View of t2'])
  })

  it('says how many calls the first request of a page leaves out, and only of it', () => {
    const entries = withLatest(undefined, page(['t1', 't2'], 0, 40)).entries
    expect(entries.map((entry) => entry.earlierSteps)).toEqual([40, 0])
  })
})

describe('a page of earlier requests', () => {
  it.each([
    ['goes in front', pagesOf(['t8', 't9'], 8), page(['t5', 't6', 't7'], 5), ['t5', 't6', 't7', 't8', 't9'], 5],
    ['reaching the first request, leaves nothing earlier', pagesOf(['t3'], 3), page(['t0', 't1', 't2'], 0), ['t0', 't1', 't2', 't3'], 0],
    ['holding nothing, its request forgotten since, ends the reading', pagesOf(['t3'], 3), page([], 0), ['t3'], 0],
    ['never repeats a request already read', pagesOf(['t2', 't3'], 2), page(['t1', 't2'], 1), ['t1', 't2', 't3'], 1]
  ])('%s', (_name, pages, earlier, turns, count) => {
    const merged = withEarlier(pages, earlier)
    expect(turnsOf(merged)).toEqual(turns)
    expect(merged.earlier).toBe(count)
  })
})
