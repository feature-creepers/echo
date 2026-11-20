import { describe, expect, it } from 'vitest'
import type { SearchHit } from '../ports/search.ts'
import { fuse, MEANING_FLOOR } from './fusion.ts'

const NOW = '2026-11-17T10:00:00.000Z'
const recency = { now: NOW, halfLifeDays: 45 }

/** A hit on a record, written `daysAgo` days before now. */
const hit = (record: string, score: number, daysAgo = 0): SearchHit => ({
  record,
  type: 'channel.exchange',
  at: new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString(),
  snippet: `the words of ${record}`,
  score
})
const near = (record: string, daysAgo = 0) => hit(record, 0.9, daysAgo)

describe('reciprocal rank fusion', () => {
  const cases: Array<{ name: string; keyword: SearchHit[]; meaning: SearchHit[]; limit?: number; found: string[] }> = [
    { name: 'keyword hits only keep their order', keyword: [hit('a', 9), hit('b', 5), hit('c', 1)], meaning: [], found: ['a', 'b', 'c'] },
    {
      name: 'hits by meaning only, by similarity',
      keyword: [],
      meaning: [hit('a', 0.86), hit('b', 0.95), hit('c', 0.9)],
      found: ['b', 'c', 'a']
    },
    {
      name: 'both lists overlapping: what both found first, then each list in turn',
      keyword: [hit('a', 9), hit('b', 5)],
      meaning: [hit('c', 0.95), hit('b', 0.9)],
      found: ['b', 'a', 'c']
    },
    {
      name: 'a record found both ways outranks one found first by either',
      keyword: [hit('first-by-keyword', 9), hit('x', 8), hit('both', 7)],
      meaning: [hit('first-by-meaning', 0.99), hit('y', 0.98), hit('both', 0.97)],
      found: ['both', 'first-by-keyword', 'first-by-meaning', 'x', 'y']
    },
    { name: 'a tie goes to the more recent record', keyword: [hit('old', 9, 30)], meaning: [near('recent', 1)], found: ['recent', 'old'] },
    {
      name: 'hits by meaning fade with age, as keyword hits do',
      keyword: [],
      meaning: [hit('old', 0.95, 365), hit('recent', 0.88, 2)],
      found: ['recent', 'old']
    },
    {
      name: 'hits by meaning under the floor are dropped',
      keyword: [hit('a', 3)],
      meaning: [hit('under', MEANING_FLOOR - 0.001), hit('at', MEANING_FLOOR)],
      found: ['a', 'at']
    },
    {
      name: 'the limit is kept',
      keyword: [hit('a', 9), hit('b', 8)],
      meaning: [near('c'), near('d')],
      limit: 3,
      found: ['a', 'c', 'b']
    },
    { name: 'nothing found, nothing given', keyword: [], meaning: [hit('far', 0.75)], found: [] }
  ]

  for (const { name, keyword, meaning, limit = 10, found } of cases) {
    it(name, () => {
      expect(fuse({ keyword, meaning, recency, limit }).map((one) => one.record)).toEqual(found)
    })
  }

  it('scores a record by its ranks, and keeps the snippet of its keyword hit', () => {
    const [both] = fuse({ keyword: [hit('both', 9)], meaning: [{ ...hit('both', 0.9), snippet: 'its beginning' }], recency, limit: 5 })
    expect(both).toMatchObject({ record: 'both', snippet: 'the words of both' })
    expect(both?.score).toBeCloseTo(2 / 61, 10)
  })
})
