import { erasedBy, type Records, type StoredRecord } from '../ports/records.ts'

export interface MemoryRecordsOptions {
  /** The name of the core that writes. */
  origin?: string
  now?: () => Date
}

/**
 * Records kept in memory and gone with the process. For tests, and as the plainest statement of what
 * the port promises.
 */
export function memoryRecords({ origin = 'memory', now = () => new Date() }: MemoryRecordsOptions = {}): Records {
  const stored: StoredRecord[] = []
  return {
    append(records) {
      const written = records.map((record, index): StoredRecord => {
        const sequence = stored.length + index + 1
        return {
          id: `${origin}-${sequence}`,
          origin,
          sequence,
          at: record.at ?? now().toISOString(),
          type: record.type,
          payload: structuredCloneJson(record.payload)
        }
      })
      stored.push(...written)
      const erased = new Set(written.flatMap(erasedBy))
      for (const record of stored) if (erased.has(record.id)) record.payload = null
      return written.map((record) => ({ ...record }))
    },
    read(types) {
      return stored.filter((record) => types.includes(record.type)).map((record) => ({ ...record, payload: structuredCloneJson(record.payload) }))
    }
  }
}

/** A payload goes through JSON, as it would on its way to a file: what comes back is never the object that went in. */
function structuredCloneJson(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload))
}
