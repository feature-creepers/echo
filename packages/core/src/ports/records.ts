/**
 * What the core needs to remember things for good: records, written once and never changed.
 *
 * A change is a new record, never an edit. Every record says which core wrote it and where it stands
 * among that core's records, so two cores can later exchange what the other lacks.
 */

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
  /** Write records, all of them or none, and return them as stored. */
  append(records: readonly NewRecord[]): StoredRecord[]
  /** Every record of the given types, in the order they were written. */
  read(types: readonly string[]): StoredRecord[]
}
