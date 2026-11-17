/**
 * What the core needs to remember things for good: records, written once and never changed.
 *
 * A change is a new record, never an edit. Every record says which core wrote it and where it stands
 * among that core's records, so two cores can later exchange what the other lacks.
 *
 * The one exception is forgetting. An erasure is a record of its own, a tombstone, and the records it names
 * keep their place but lose their content: a user who asks to forget something is not kept from it by the
 * rule that records never change.
 */

/**
 * The type of a tombstone. Appending one empties the payload of every record it names, which is read back
 * as `null`, and takes their text out of the search index. Its payload is `Erasure`.
 */
export const ERASURE = 'record.erasure'

/** The payload of a tombstone: the records whose content is erased. */
export interface Erasure {
  records: string[]
}

/** The records an erasure names, or nothing when the payload is not one. */
export function erasedBy(record: NewRecord): readonly string[] {
  if (record.type !== ERASURE) return []
  const named = (record.payload as Partial<Erasure> | null)?.records
  return Array.isArray(named) ? named.filter((id): id is string => typeof id === 'string') : []
}

/** A record as the core writes it. */
export interface NewRecord {
  /** What kind of record this is, which tells how to read its payload. */
  type: string
  /** The content, as plain JSON data. */
  payload: unknown
}

/** A record as it is kept. */
export interface StoredRecord extends NewRecord {
  /** Identifies the record everywhere, for good. */
  id: string
  /** The core that wrote it. */
  origin: string
  /** Its position among the records of that core, starting at 1. */
  sequence: number
  /** When it was written: an ISO 8601 date in UTC. */
  at: string
}

export interface Records {
  /** Write records, all of them or none, and return them as stored. An erasure among them empties the records it names. */
  append(records: readonly NewRecord[]): StoredRecord[]
  /** Every record of the given types, in the order they were written. */
  read(types: readonly string[]): StoredRecord[]
}
