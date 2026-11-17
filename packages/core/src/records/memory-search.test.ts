import { describe, expect, it } from 'vitest'
import { EXCHANGE } from '../channel/channel.ts'
import { ERASURE } from '../ports/records.ts'
import { memoryRecords } from './memory.ts'
import { memorySearch } from './memory-search.ts'

const exchange = (said: string, at = '2026-11-17T08:00:00.000Z') => ({
  type: EXCHANGE,
  payload: { turn: said.slice(0, 8), at, persona: 'first', said, replied: '', outcome: 'done' }
})

describe('the search kept in memory', () => {
  it('finds records by their words, the best match first, and none for words that carry nothing', () => {
    let day = 0
    const records = memoryRecords({ now: () => new Date(Date.UTC(2026, 10, ++day)) })
    const [garden, both] = records.append([exchange('We talked about the garden'), exchange('The garden and the roses need water')])
    records.append([exchange('Nothing to see here')])
    const search = memorySearch(records)

    const hits = search.search({ text: 'roses in the garden', types: [EXCHANGE], limit: 5 })
    expect(hits.map((hit) => hit.record)).toEqual([both?.id, garden?.id])
    expect(hits[0]).toMatchObject({ type: EXCHANGE, at: both?.at, snippet: 'The garden and the roses need water' })
    expect(search.search({ text: 'the and of', types: [EXCHANGE], limit: 5 })).toEqual([])
  })

  it('matches longer words by how they start, and ignores accents', () => {
    const records = memoryRecords()
    records.append([exchange('Gardening with Élodie')])
    const search = memorySearch(records)
    expect(search.search({ text: 'garden elodie', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
  })

  it('ranks the recent higher when asked, and keeps to a period', () => {
    const records = memoryRecords({ now: () => new Date('2026-01-01T00:00:00Z') })
    const [old] = records.append([exchange('The trip to Rome is planned')])
    const search = memorySearch(records)
    const now = '2026-11-17T00:00:00.000Z'

    expect(search.search({ text: 'trip', types: [EXCHANGE], limit: 1, recency: { now, halfLifeDays: 30 } })[0]?.score).toBeLessThan(
      search.search({ text: 'trip', types: [EXCHANGE], limit: 1 })[0]?.score ?? 0
    )
    expect(search.search({ text: 'trip', types: [EXCHANGE], limit: 5, after: '2026-06-01' })).toEqual([])
    expect(search.search({ text: 'trip', types: [EXCHANGE], limit: 5, before: '2026-06-01' }).map((hit) => hit.record)).toEqual([old?.id])
  })

  it('no longer finds what was erased', () => {
    const records = memoryRecords()
    const [secret] = records.append([exchange('The secret code is 4512')])
    records.append([{ type: ERASURE, payload: { records: [secret?.id] } }])
    expect(memorySearch(records).search({ text: 'secret code', types: [EXCHANGE], limit: 5 })).toEqual([])
  })
})
