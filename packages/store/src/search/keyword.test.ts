import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ERASURE } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { openStore, STORE_FILE, type Store } from '../store.ts'

const EXCHANGE = 'channel.exchange'
const FACT = 'memory.fact'

const folders: string[] = []
const open: Store[] = []

function store(at = mkdtempSync(join(tmpdir(), 'search-test-')), now?: () => Date): Store {
  if (!folders.includes(at)) folders.push(at)
  const opened = openStore(now ? { folder: at, now } : { folder: at })
  open.push(opened)
  return opened
}

afterEach(() => {
  for (const opened of open.splice(0)) {
    try {
      opened.close()
    } catch {
      // Already closed by the test.
    }
  }
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true, maxRetries: 5 })
})

const exchange = (said: string, replied = '') => ({
  type: EXCHANGE,
  payload: { turn: `t-${said.length}`, at: '2026-11-17T08:00:00.000Z', persona: 'first', said, replied, outcome: 'done' }
})
const fact = (text: string) => ({
  type: FACT,
  payload: { fact: `f-${text.length}`, text, kind: 'other', origin: 'told', sources: [], since: '2026-11-17T08:00:00.000Z' }
})

describe('keyword search in the store', () => {
  it('dates words brought in from elsewhere when they were said, and finds them by that date', () => {
    const { records, search } = store(undefined, () => new Date('2026-11-17T08:00:00Z'))
    const [old] = records.append([{ ...exchange('The boat is moored in Brest.'), at: '2025-03-01T10:00:00.000Z' }])
    expect(old?.at).toBe('2025-03-01T10:00:00.000Z')
    expect(records.read([EXCHANGE])[0]?.at).toBe('2025-03-01T10:00:00.000Z')
    expect(search.search({ text: 'boat Brest', types: [EXCHANGE], limit: 5, before: '2026-01-01T00:00:00.000Z' })).toHaveLength(1)
    expect(search.search({ text: 'boat Brest', types: [EXCHANGE], limit: 5, after: '2026-01-01T00:00:00.000Z' })).toEqual([])
  })

  it('finds what was said and the facts at once, the best match first', () => {
    const { records, search } = store()
    const [garden, roses] = records.append([exchange('We talked about the garden', 'Yes, the garden.'), exchange('The roses in the garden need water')])
    const [tea] = records.append([fact('The user prefers green tea.')])

    const hits = search.search({ text: 'roses garden', types: [EXCHANGE], limit: 5 })
    expect(hits.map((hit) => hit.record)).toEqual([roses?.id, garden?.id])
    expect(hits[0]).toMatchObject({ type: EXCHANGE, at: roses?.at, snippet: 'The roses in the garden need water' })
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.POSITIVE_INFINITY)

    expect(search.search({ text: 'What tea do I like?', types: [FACT], limit: 5 }).map((hit) => hit.record)).toEqual([tea?.id])
    expect(search.search({ text: 'garden', types: [FACT], limit: 5 })).toEqual([])
  })

  it('folds accents and case, finds longer words by how they start, and passes over words that carry nothing', () => {
    const { records, search } = store()
    records.append([exchange('Élodie loves GARDENING')])

    expect(search.search({ text: 'elodie', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
    expect(search.search({ text: 'garden', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
    expect(search.search({ text: 'what is the', types: [EXCHANGE], limit: 5 })).toEqual([])
  })

  it('reads what is typed as words, never as search syntax', () => {
    const { records, search } = store()
    records.append([exchange('Notes about NEAR and OR')])
    for (const text of ['"unbalanced', 'garden* AND -roses', 'NEAR(a b)', "l'été (enfin) : ^col", 'notes OR']) {
      expect(() => search.search({ text, types: [EXCHANGE], limit: 5 })).not.toThrow()
    }
    expect(search.search({ text: '"notes', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
  })

  it('ranks the recent higher when asked, and keeps to a period', () => {
    let day = 0
    const { records, search } = store(undefined, () => new Date(Date.UTC(2026, 0, 1 + 300 * day++)))
    const [old, recent] = records.append([exchange('The trip to Porto'), exchange('The trip to Porto')])
    expect(old?.at).toBe('2026-01-01T00:00:00.000Z')

    const now = '2026-11-17T00:00:00.000Z'
    const ranked = search.search({ text: 'Porto trip', types: [EXCHANGE], limit: 5, recency: { now, halfLifeDays: 30 } })
    expect(ranked.map((hit) => hit.record)).toEqual([recent?.id, old?.id])
    expect(search.search({ text: 'Porto', types: [EXCHANGE], limit: 5, after: '2026-06-01' }).map((hit) => hit.record)).toEqual([recent?.id])
    expect(search.search({ text: 'Porto', types: [EXCHANGE], limit: 5, before: '2026-06-01' }).map((hit) => hit.record)).toEqual([old?.id])
  })

  it('erases what a tombstone names: its content and its place in the index', () => {
    const { records, search } = store()
    const [secret, kept] = records.append([fact('The locker code is 4512.'), fact('The locker is on floor two.')])
    records.append([{ type: ERASURE, payload: { records: [secret?.id] } }])

    expect(records.read([FACT]).map((record) => record.payload === null)).toEqual([true, false])
    expect(search.search({ text: 'locker code 4512', types: [FACT], limit: 5 }).map((hit) => hit.record)).toEqual([kept?.id])
  })

  it('takes in, on opening, the records written while there was no index', () => {
    const at = mkdtempSync(join(tmpdir(), 'search-test-'))
    const first = store(at)
    first.records.append([exchange('Before the index existed')])
    first.close()
    const raw = new DatabaseSync(join(at, STORE_FILE))
    raw.exec('delete from search_text')
    raw.exec('update search_progress set indexed = 0')
    raw.close()

    const reopened = store(at)
    expect(reopened.search.search({ text: 'index existed', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
    // Taken in once only.
    reopened.close()
    expect(store(at).search.search({ text: 'index existed', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
  })
})
