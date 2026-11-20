import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createFactBook, FACT, type FactRecord } from './facts.ts'

const version = (fact: string, text: string, more: Partial<FactRecord> = {}): FactRecord => ({
  fact,
  text,
  kind: 'person',
  origin: 'conversation',
  sources: ['t1'],
  since: '2026-11-01T08:00:00.000Z',
  ...more
})

function bookWith(...versions: FactRecord[]) {
  const records = memoryRecords()
  const written = records.append(versions.map((payload) => ({ type: FACT, payload })))
  return { book: createFactBook(records.read([FACT])), written }
}

describe('the facts true now', () => {
  it('keeps the latest version of each fact, with the date it was first learned', () => {
    const { book, written } = bookWith(
      version('a', 'The user has a sister.'),
      version('a', 'The user has a sister, Anna.', { since: '2026-11-10T08:00:00.000Z', origin: 'edited' })
    )

    expect(book.current()).toHaveLength(1)
    expect(book.get('a')).toMatchObject({ text: 'The user has a sister, Anna.', origin: 'edited', since: '2026-11-01T08:00:00.000Z' })
    expect(book.get('a')?.versions).toEqual(written.map((record) => record.id))
    // Only the latest version is the fact, when a search finds an older one.
    expect(book.byRecord(written[1]?.id ?? '')?.fact).toBe('a')
    expect(book.byRecord(written[0]?.id ?? '')).toBeUndefined()
  })

  it('ends a fact that another replaces, and keeps it as history', () => {
    const { book, written } = bookWith(version('paris', 'The user lives in Paris.'), version('lyon', 'The user lives in Lyon.', { replaces: 'paris' }))

    expect(book.current().map((fact) => fact.fact)).toEqual(['lyon'])
    expect(book.get('paris')).toBeUndefined()
    expect(book.byRecord(written[0]?.id ?? '')).toBeUndefined()
    // Forgetting the new fact takes the one it replaced with it.
    expect(book.recordsToForget('lyon')).toEqual([written[1]?.id, written[0]?.id])
  })

  it('carries what a fact replaced through its later versions', () => {
    const { book } = bookWith(
      version('paris', 'The user lives in Paris.'),
      version('lyon', 'The user lives in Lyon.', { replaces: 'paris' }),
      version('lyon', 'The user lives in Lyon, near the river.')
    )
    expect(book.recordsToForget('lyon')).toHaveLength(3)
  })

  it('orders facts by kind, then from the oldest', () => {
    const { book } = bookWith(
      version('later', 'Likes tea.', { kind: 'preference', since: '2026-11-03T00:00:00.000Z' }),
      version('sooner', 'Likes jazz.', { kind: 'preference', since: '2026-11-02T00:00:00.000Z' }),
      version('anna', 'Anna is the sister.', { kind: 'person' })
    )
    expect(book.current().map((fact) => fact.fact)).toEqual(['anna', 'sooner', 'later'])
  })

  it('drops a forgotten fact and passes over erased or unreadable records', () => {
    const records = memoryRecords()
    records.append([
      { type: FACT, payload: version('a', 'Kept.') },
      { type: FACT, payload: null },
      { type: FACT, payload: { fact: 'b' } },
      { type: 'other', payload: version('c', 'Not a fact record.') }
    ])
    const book = createFactBook(records.read([FACT, 'other']))

    expect(book.current().map((fact) => fact.fact)).toEqual(['a'])
    book.drop('a')
    expect(book.current()).toEqual([])
  })
})
