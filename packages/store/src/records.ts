import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Records, StoredRecord } from '@repo/core'
import { transaction } from './database.ts'

/** The records of a core, in its file. */
export function createRecords(database: DatabaseSync, now: () => Date = () => new Date()): Records {
  const origin = coreId(database)
  const last = database.prepare('select coalesce(max(sequence), 0) as last from record where origin = ?')
  const insert = database.prepare('insert into record (id, origin, sequence, at, type, payload) values (?, ?, ?, ?, ?, ?)')

  return {
    append(records) {
      if (records.length === 0) return []
      return transaction(database, () => {
        let sequence = Number(last.get(origin)?.last ?? 0)
        return records.map((record): StoredRecord => {
          const payload: string | undefined = JSON.stringify(record.payload)
          if (payload === undefined) throw new Error(`A record of type "${record.type}" has a payload that is not JSON data.`)
          const stored = { id: randomUUID(), origin, sequence: ++sequence, at: now().toISOString(), type: record.type }
          insert.run(stored.id, stored.origin, stored.sequence, stored.at, stored.type, payload)
          return { ...stored, payload: JSON.parse(payload) }
        })
      })
    },

    read(types) {
      if (types.length === 0) return []
      const marks = types.map(() => '?').join(', ')
      const rows = database.prepare(`select id, origin, sequence, at, type, payload from record where type in (${marks}) order by rowid`).all(...types)
      return rows.map((row) => ({
        id: String(row.id),
        origin: String(row.origin),
        sequence: Number(row.sequence),
        at: String(row.at),
        type: String(row.type),
        payload: JSON.parse(String(row.payload))
      }))
    }
  }
}

/** The identifier of the core that owns the file, made the first time the file is opened. */
function coreId(database: DatabaseSync): string {
  const known = database.prepare('select id from core').get()?.id
  if (typeof known === 'string') return known
  const created = randomUUID()
  database.prepare('insert into core (id) values (?)').run(created)
  return created
}
