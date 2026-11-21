import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { erasedBy, type Records, type StoredRecord } from '@repo/core'
import { transaction } from './database.ts'
import type { KeywordIndex } from './search/keyword.ts'
import type { VectorIndex } from './search/vectors.ts'

/**
 * The records of a core, in its file. The search index and the vectors take in each record in the same transaction,
 * so neither is ever behind what was written or keeps what was erased.
 */
export function createRecords(database: DatabaseSync, index: KeywordIndex, vectors: VectorIndex, now: () => Date = () => new Date()): Records {
  const origin = coreId(database)
  const last = database.prepare('select coalesce(max(sequence), 0) as last from record where origin = ?')
  const insert = database.prepare('insert into record (id, origin, sequence, at, type, payload) values (?, ?, ?, ?, ?, ?)')
  // A tombstone keeps the record in its place and erases its content (the records port says why).
  const erase = database.prepare("update record set payload = 'null' where id = ?")
  /** The records whose type or identifier is one of those given, in the order they were written. */
  const select = (column: 'type' | 'id', values: readonly string[]): StoredRecord[] => {
    const rows = []
    for (let from = 0; from < values.length; from += NAMED_AT_ONCE) {
      const named = values.slice(from, from + NAMED_AT_ONCE)
      const marks = named.map(() => '?').join(', ')
      rows.push(
        ...database.prepare(`select rowid, id, origin, sequence, at, type, payload from record where ${column} in (${marks}) order by rowid`).all(...named)
      )
    }
    if (values.length > NAMED_AT_ONCE) rows.sort((one, other) => Number(one.rowid) - Number(other.rowid))
    return rows.map((row) => ({
      id: String(row.id),
      origin: String(row.origin),
      sequence: Number(row.sequence),
      at: String(row.at),
      type: String(row.type),
      payload: JSON.parse(String(row.payload))
    }))
  }

  return {
    append(records) {
      if (records.length === 0) return []
      return transaction(database, () => {
        let sequence = Number(last.get(origin)?.last ?? 0)
        return records.map((record): StoredRecord => {
          const payload: string | undefined = JSON.stringify(record.payload)
          if (payload === undefined) throw new Error(`A record of type "${record.type}" has a payload that is not JSON data.`)
          const stored = { id: randomUUID(), origin, sequence: ++sequence, at: record.at ?? now().toISOString(), type: record.type }
          const { lastInsertRowid } = insert.run(stored.id, stored.origin, stored.sequence, stored.at, stored.type, payload)
          const written = { ...stored, payload: JSON.parse(payload) }
          for (const erased of erasedBy(written)) erase.run(erased)
          index.take(written, lastInsertRowid)
          vectors.take(written)
          return written
        })
      })
    },

    read: (types) => select('type', types),
    get: (ids) => select('id', ids)
  }
}

/** The most values one statement names: SQLite takes a limited number of them. */
const NAMED_AT_ONCE = 500

/** The identifier of the core that owns the file, made the first time the file is opened. */
function coreId(database: DatabaseSync): string {
  const known = database.prepare('select id from core').get()?.id
  if (typeof known === 'string') return known
  const created = randomUUID()
  database.prepare('insert into core (id) values (?)').run(created)
  return created
}
