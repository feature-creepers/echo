import { SEARCHABLE_TYPES, searchableText } from '../memory/searchable.ts'
import type { Records, StoredRecord } from '../ports/records.ts'
import type { SearchHit } from '../ports/search.ts'
import type { Vectors, VectorsAvailable } from '../ports/vectors.ts'

const SNIPPET_LENGTH = 160

/**
 * Vectors kept in memory beside records kept in memory. For tests, and as the plainest statement of what the port
 * promises: a record's text is read from the records each time, so what an erasure empties has no vector any more.
 */
export function memoryVectors(records: Records, available: VectorsAvailable = { ok: true }): Vectors {
  const kept = new Map<string, { model: string; vector: Float32Array }>()
  const searchable = () =>
    records
      .read(SEARCHABLE_TYPES)
      .flatMap((record) => {
        const text = searchableText(record)
        return text === undefined ? [] : [{ record, text }]
      })
      .sort((one, other) => newestFirst(one.record, other.record))
  const usable = available.ok

  return {
    available: () => available,
    missing: (model, limit) =>
      usable
        ? searchable()
            .filter(({ record }) => kept.get(record.id)?.model !== model)
            .slice(0, limit)
            .map(({ record, text }) => ({ record: record.id, text }))
        : [],
    put(model, vectors) {
      if (!usable) return
      const known = new Set(searchable().map(({ record }) => record.id))
      for (const { record, vector } of vectors) if (known.has(record)) kept.set(record, { model, vector })
    },
    nearest({ model, vector, types, limit, after, before }) {
      if (!usable) return []
      return searchable()
        .flatMap(({ record, text }): SearchHit[] => {
          const made = kept.get(record.id)
          if (made?.model !== model || !types.includes(record.type)) return []
          if ((after !== undefined && record.at < after) || (before !== undefined && record.at >= before)) return []
          return [{ record: record.id, type: record.type, at: record.at, snippet: text.slice(0, SNIPPET_LENGTH), score: cosine(vector, made.vector) }]
        })
        .sort((one, other) => other.score - one.score)
        .slice(0, limit)
    },
    count(model) {
      if (!usable) return []
      const counts = new Map<string, { type: string; total: number; done: number }>()
      for (const { record } of searchable()) {
        const count = counts.get(record.type) ?? { type: record.type, total: 0, done: 0 }
        count.total++
        if (kept.get(record.id)?.model === model) count.done++
        counts.set(record.type, count)
      }
      return [...counts.values()]
    },
    keepOnly(model) {
      for (const [record, made] of kept) if (made.model !== model) kept.delete(record)
    },
    clear: () => kept.clear()
  }
}

function newestFirst(one: StoredRecord, other: StoredRecord): number {
  return one.at === other.at ? other.sequence - one.sequence : one.at < other.at ? 1 : -1
}

function cosine(one: Float32Array, other: Float32Array): number {
  let dot = 0
  let left = 0
  let right = 0
  for (let index = 0; index < one.length; index++) {
    const a = one[index] ?? 0
    const b = other[index] ?? 0
    dot += a * b
    left += a * a
    right += b * b
  }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right)
}
