import type { DatabaseSync } from 'node:sqlite'
import { erasedBy, type NewRecord, type SearchHit, searchableText, type Vectors, type VectorsAvailable } from '@repo/core'
import { getLoadablePath } from 'sqlite-vec'
import { transaction } from '../database.ts'

/** How many words of a record a hit shows: its beginning, as there are no words found to show it around. */
const SNIPPET_WORDS = 24

/**
 * The vectors' table is made for the dimensions of the model the product uses (multilingual-e5-small). A model of
 * other dimensions drops it and makes it again.
 */
const DEFAULT_DIMENSIONS = 384

/** The vectors, as the records see them: an erasure takes the vectors of what it names. */
export interface VectorIndex extends Vectors {
  /** Take in a record just written, inside the transaction that writes it. */
  take(record: NewRecord): void
}

/**
 * Load sqlite-vec into the open file. The file must have been opened with extensions allowed; loading them is
 * refused from then on. Says why when it cannot be loaded: the store works as before, without vectors.
 */
export function loadVectorExtension(database: DatabaseSync, extension: () => string = getLoadablePath): VectorsAvailable {
  try {
    // SQLite opens the file itself, out of reach of Electron's archive support: a packaged app ships it unpacked beside the archive.
    database.loadExtension(extension().replace(/\.asar([\\/])/, '.asar.unpacked$1'))
    return { ok: true }
  } catch (error) {
    return { ok: false, why: `sqlite-vec could not be loaded (${(error instanceof Error ? error.message : String(error)).trim()})` }
  } finally {
    database.enableLoadExtension(false)
  }
}

/**
 * Vectors in a `vec0` table of sqlite-vec, beside the records, each row keyed by its record's row number. Derived data,
 * not a numbered migration: the table exists only where the extension loads, and is made when it does.
 */
export function createVectors(database: DatabaseSync, available: VectorsAvailable): VectorIndex {
  if (!available.ok) {
    return {
      available: () => available,
      missing: () => [],
      put: () => undefined,
      nearest: () => [],
      count: () => [],
      keepOnly: () => undefined,
      clear: () => undefined,
      take: () => undefined
    }
  }

  const make = (dimensions: number) =>
    database.exec(
      `create virtual table if not exists record_vector using vec0(embedding float[${dimensions}] distance_metric=cosine, model text, type text, at text)`
    )
  make(DEFAULT_DIMENSIONS)
  const made = String(database.prepare("select sql from sqlite_master where name = 'record_vector'").get()?.sql ?? '')
  let dimensions = Number(/float\[(\d+)\]/.exec(made)?.[1] ?? DEFAULT_DIMENSIONS)

  const erase = database.prepare('delete from record_vector where rowid = (select rowid from record where id = ?)')
  // An erased record keeps its place with an empty payload: it never gets a vector again.
  const target = database.prepare("select rowid, type, at from record where id = ? and payload != 'null'")

  return {
    available: () => available,

    missing(model, limit) {
      const rows = database
        .prepare(
          `select r.id as id, s.text as text
           from search_text s join record r on r.id = s.record
           where r.rowid not in (select rowid from record_vector where model = ?)
           order by r.at desc
           limit ?`
        )
        .all(model, limit)
      return rows.map((row) => ({ record: String(row.id), text: String(row.text) }))
    },

    put(model, vectors) {
      if (vectors.length === 0) return
      transaction(database, () => {
        const size = (vectors[0] as (typeof vectors)[number]).vector.length
        if (size !== dimensions) {
          database.exec('drop table record_vector')
          make(size)
          dimensions = size
        }
        const remove = database.prepare('delete from record_vector where rowid = ?')
        const insert = database.prepare('insert into record_vector (rowid, embedding, model, type, at) values (?, ?, ?, ?, ?)')
        for (const { record, vector } of vectors) {
          if (vector.length !== dimensions) throw new Error(`A vector of ${vector.length} numbers among vectors of ${dimensions}.`)
          const row = target.get(record)
          if (!row) continue
          // sqlite-vec takes a row number only as an integer: a JavaScript number would be bound as a real.
          const rowid = BigInt(row.rowid as number | bigint)
          remove.run(rowid)
          insert.run(rowid, bytesOf(vector), model, String(row.type), String(row.at))
        }
      })
    },

    nearest({ model, vector, types, limit, after, before }) {
      if (types.length === 0 || limit <= 0 || vector.length !== dimensions) return []
      const conditions = ['embedding match ?', 'k = ?', 'model = ?', `type in (${types.map(() => '?').join(', ')})`]
      const values: Array<string | number | Uint8Array> = [bytesOf(vector), limit, model, ...types]
      if (after !== undefined) {
        conditions.push('at >= ?')
        values.push(after)
      }
      if (before !== undefined) {
        conditions.push('at < ?')
        values.push(before)
      }
      const rows = database
        .prepare(
          `with near as (select rowid, distance from record_vector where ${conditions.join(' and ')})
           select r.id as id, r.type as type, r.at as at, r.payload as payload, near.distance as distance
           from near join record r on r.rowid = near.rowid
           order by near.distance`
        )
        .all(...values)
      return rows.map((row): SearchHit => {
        const text = searchableText({ type: String(row.type), payload: JSON.parse(String(row.payload)) }) ?? ''
        // The cosine distance is one less the similarity.
        return { record: String(row.id), type: String(row.type), at: String(row.at), snippet: beginningOf(text), score: 1 - Number(row.distance) }
      })
    },

    count(model) {
      const totals = database.prepare('select r.type as type, count(*) as total from search_text s join record r on r.id = s.record group by r.type').all()
      const done = new Map(
        database
          .prepare('select type, count(*) as done from record_vector where model = ? group by type')
          .all(model)
          .map((row) => [String(row.type), Number(row.done)])
      )
      return totals.map((row) => ({ type: String(row.type), total: Number(row.total), done: done.get(String(row.type)) ?? 0 }))
    },

    keepOnly(model) {
      database.prepare('delete from record_vector where model != ?').run(model)
    },

    clear() {
      database.exec('delete from record_vector')
    },

    take(record) {
      for (const erased of erasedBy(record)) erase.run(erased)
    }
  }
}

/** A vector as SQLite is given it: the bytes of its 32-bit floats. */
function bytesOf(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

function beginningOf(text: string): string {
  const words = text.split(/\s+/).filter((word) => word !== '')
  return words.length <= SNIPPET_WORDS ? words.join(' ') : `${words.slice(0, SNIPPET_WORDS).join(' ')}…`
}
