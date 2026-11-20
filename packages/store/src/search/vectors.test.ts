import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemory, ERASURE, type NewRecord } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { openStore, type Store, type StoreOptions } from '../store.ts'

const EXCHANGE = 'channel.exchange'
const FACT = 'memory.fact'
const MODEL = 'test-model'

const folders: string[] = []
const open: Store[] = []

function store(options: Partial<StoreOptions> = {}): Store {
  const folder = options.folder ?? mkdtempSync(join(tmpdir(), 'vectors-test-'))
  if (!folders.includes(folder)) folders.push(folder)
  const opened = openStore({ ...options, folder })
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

let turns = 0
const exchange = (said: string, at?: string): NewRecord => ({
  type: EXCHANGE,
  payload: { turn: `t-${++turns}`, at: at ?? '2026-11-17T08:00:00.000Z', persona: 'first', said, replied: '', outcome: 'done' },
  ...(at === undefined ? {} : { at })
})
const fact = (text: string): NewRecord => ({
  type: FACT,
  payload: { fact: `f-${++turns}`, text, kind: 'other', origin: 'told', sources: [], since: '2026-11-17T08:00:00.000Z' }
})

/** A vector pointing mostly one way: four directions are enough to tell the records apart. */
const toward = (direction: number, size = 4) => {
  const vector = new Float32Array(size)
  vector[direction] = 1
  vector[(direction + 1) % size] = 0.1
  return vector
}

describe('vectors in the store', () => {
  it('keeps them by record, and finds the nearest of a model, with types and a period', () => {
    const { records, vectors } = store()
    const [porto, tea, trip, elsewhere] = records.append([
      exchange('The trip to Porto is in March.', '2026-02-01T10:00:00.000Z'),
      fact('The user drinks green tea.'),
      exchange('Le voyage à Porto est en mars.', '2026-10-01T10:00:00.000Z'),
      exchange('Made by another model.', '2026-10-02T10:00:00.000Z')
    ])
    vectors.put(MODEL, [
      { record: porto?.id ?? '', vector: toward(0) },
      { record: tea?.id ?? '', vector: toward(2) },
      // Near the first, a little less so.
      { record: trip?.id ?? '', vector: Float32Array.of(1, 0.4, 0, 0) }
    ])
    vectors.put('other-model', [{ record: elsewhere?.id ?? '', vector: toward(0) }])

    const cases: Array<{ name: string; query: Partial<Parameters<typeof vectors.nearest>[0]>; found: Array<string | undefined> }> = [
      { name: 'both lines, nearest first', query: { types: [EXCHANGE] }, found: [porto?.id, trip?.id] },
      { name: 'the fact, by its model', query: { types: [FACT] }, found: [tea?.id] },
      { name: 'from a date on', query: { types: [EXCHANGE], after: '2026-06-01' }, found: [trip?.id] },
      { name: 'before a date', query: { types: [EXCHANGE], before: '2026-06-01' }, found: [porto?.id] },
      { name: 'at most the limit', query: { types: [EXCHANGE, FACT], limit: 1 }, found: [porto?.id] },
      { name: 'only the vectors of the model asked for', query: { model: 'unknown', types: [EXCHANGE, FACT] }, found: [] },
      { name: 'nothing for no type', query: { types: [] }, found: [] }
    ]
    for (const { name, query, found } of cases) {
      const hits = vectors.nearest({ model: MODEL, vector: toward(0), types: [], limit: 5, ...query })
      expect(
        hits.map((hit) => hit.record),
        name
      ).toEqual(found)
    }

    const [best] = vectors.nearest({ model: MODEL, vector: toward(0), types: [EXCHANGE], limit: 1 })
    expect(best).toMatchObject({ type: EXCHANGE, at: '2026-02-01T10:00:00.000Z', snippet: 'The trip to Porto is in March.' })
    expect(best?.score).toBeCloseTo(1, 5)
  })

  it('says which records have no vector of a model yet, the newest first, with their text', () => {
    const { records, vectors } = store()
    const [old, recent, gone] = records.append([
      exchange('An old line.', '2025-01-01T00:00:00.000Z'),
      exchange('A recent line.', '2026-11-01T00:00:00.000Z'),
      exchange('A line soon forgotten.', '2026-11-02T00:00:00.000Z'),
      { type: 'something.else', payload: { said: 'No text to search.' } }
    ])
    records.append([{ type: ERASURE, payload: { records: [gone?.id] } }])

    expect(vectors.missing(MODEL, 10)).toEqual([
      { record: recent?.id, text: 'A recent line.' },
      { record: old?.id, text: 'An old line.' }
    ])
    vectors.put(MODEL, [{ record: recent?.id ?? '', vector: toward(1) }])
    expect(vectors.missing(MODEL, 10).map((missing) => missing.record)).toEqual([old?.id])
    expect(vectors.missing('another-model', 1).map((missing) => missing.record)).toEqual([recent?.id])
    expect(vectors.count(MODEL)).toEqual([{ type: EXCHANGE, total: 2, done: 1 }])

    // A record erased before its vector was written gets none.
    vectors.put(MODEL, [{ record: gone?.id ?? '', vector: toward(1) }])
    expect(vectors.count(MODEL)).toEqual([{ type: EXCHANGE, total: 2, done: 1 }])
  })

  it('drops the vectors of what an erasure names, in the same transaction', () => {
    const { records, vectors } = store()
    const [secret, kept] = records.append([fact('The locker code is 4512.'), fact('The locker is on floor two.')])
    vectors.put(MODEL, [
      { record: secret?.id ?? '', vector: toward(0) },
      { record: kept?.id ?? '', vector: toward(0) }
    ])

    records.append([{ type: ERASURE, payload: { records: [secret?.id] } }])

    expect(vectors.nearest({ model: MODEL, vector: toward(0), types: [FACT], limit: 5 }).map((hit) => hit.record)).toEqual([kept?.id])
    expect(vectors.count(MODEL)).toEqual([{ type: FACT, total: 1, done: 1 }])
  })

  it('drops the vectors of a forgotten fact and its words, and of the words past the retention period', () => {
    const now = new Date('2026-11-17T10:00:00Z')
    const opened = store({ now: () => now })
    const { records, vectors } = opened
    const [old, said] = records.append([
      exchange('We spoke of the garden long ago.', '2025-01-01T00:00:00.000Z'),
      exchange('My locker code is 4512.', '2026-11-17T09:00:00.000Z')
    ])
    const memory = createMemory({
      records,
      search: opened.search,
      engines: { active: async () => undefined },
      log: { error: () => undefined },
      now: () => now,
      newId: () => 'fact-1',
      turn: () => (said?.payload as { turn: string } | undefined)?.turn
    })
    const locker = memory.remember('The user’s locker code is 4512.')
    const everything = () => vectors.missing(MODEL, 10).map((missing) => ({ record: missing.record, vector: toward(0) }))
    vectors.put(MODEL, everything())
    const found = () => vectors.nearest({ model: MODEL, vector: toward(0), types: [EXCHANGE, FACT], limit: 10 }).map((hit) => hit.record)
    expect(found()).toHaveLength(3)

    memory.forget(locker.fact)
    expect(found()).toEqual([old?.id])

    memory.setRetention(30)
    expect(found()).toEqual([])
    memory.close()
  })

  it('keeps only the vectors of one model when told', () => {
    const { records, vectors } = store()
    const [one, two] = records.append([fact('One.'), fact('Two.')])
    vectors.put('old-model', [{ record: one?.id ?? '', vector: toward(0) }])
    vectors.put(MODEL, [{ record: two?.id ?? '', vector: toward(0) }])

    vectors.keepOnly(MODEL)

    expect(vectors.count('old-model')).toEqual([{ type: FACT, total: 2, done: 0 }])
    expect(vectors.count(MODEL)).toEqual([{ type: FACT, total: 2, done: 1 }])
    vectors.clear()
    expect(vectors.count(MODEL)).toEqual([{ type: FACT, total: 2, done: 0 }])
  })

  it('makes the table again for a model of other dimensions, and keeps it so when opened again', () => {
    const opened = store()
    const [one, two] = opened.records.append([fact('One.'), fact('Two.')])
    opened.vectors.put('wide-model', [{ record: one?.id ?? '', vector: toward(0, 384) }])
    expect(opened.vectors.count('wide-model')).toEqual([{ type: FACT, total: 2, done: 1 }])

    opened.vectors.put(MODEL, [{ record: two?.id ?? '', vector: toward(1) }])

    expect(opened.vectors.count('wide-model')).toEqual([{ type: FACT, total: 2, done: 0 }])
    const folder = folders.at(-1) as string
    opened.close()
    const again = store({ folder })
    expect(again.vectors.nearest({ model: MODEL, vector: toward(1), types: [FACT], limit: 5 }).map((hit) => hit.record)).toEqual([two?.id])
    expect(() => again.vectors.put(MODEL, [{ record: one?.id ?? '', vector: toward(0, 5) }])).not.toThrow()
  })

  it('opens without sqlite-vec, says why, keeps no vector, and searches by keyword as before', () => {
    const unloadable = store({ vectorExtension: () => join(tmpdir(), 'no-such-extension') })
    const loaded = store()
    const lines = [exchange('The roses in the garden need water'), exchange('We talked about the garden'), fact('The user prefers green tea.')]
    for (const { records } of [unloadable, loaded]) records.append(lines)

    const why = unloadable.vectors.available()
    expect(why).toMatchObject({ ok: false, why: expect.stringContaining('sqlite-vec could not be loaded') })
    expect(loaded.vectors.available()).toEqual({ ok: true })
    expect(unloadable.vectors.missing(MODEL, 10)).toEqual([])
    unloadable.vectors.put(MODEL, [{ record: 'anything', vector: toward(0) }])
    expect(unloadable.vectors.nearest({ model: MODEL, vector: toward(0), types: [EXCHANGE], limit: 5 })).toEqual([])
    expect(unloadable.vectors.count(MODEL)).toEqual([])

    const query = { text: 'garden roses tea', types: [EXCHANGE, FACT], limit: 5 }
    const shape = (opened: Store) => opened.search.search(query).map(({ type, snippet, score }) => ({ type, snippet, score }))
    expect(shape(unloadable)).toEqual(shape(loaded))
    expect(shape(unloadable)).toHaveLength(3)
  })
})
