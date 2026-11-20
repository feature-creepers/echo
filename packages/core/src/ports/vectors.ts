import type { SearchHit } from './search.ts'

/**
 * What the core needs to search by meaning: a vector for each record that has text to search (docs/SPEC.md,
 * section 10.4).
 *
 * Vectors are derived data, as the keyword index is (section 5.2): made by the core from the text `searchableText`
 * gives, each kept with the name of the model that made it, never synced or exported. An erasure takes the vectors
 * of the records it names, in the transaction that writes it. Where vectors cannot be kept, every call finds nothing
 * and keyword search answers alone.
 */

/** Whether vectors can be kept here, and why not, in words for the person. */
export type VectorsAvailable = { ok: true } | { ok: false; why: string }

/** A record that has text to search and no vector of a model yet. */
export interface WithoutVector {
  record: string
  /** Its text, as `searchableText` gives it. */
  text: string
}

/** The vector of a record. */
export interface RecordVector {
  record: string
  vector: Float32Array
}

export interface NearestQuery {
  /** Only vectors made by this model. */
  model: string
  /** What is looked for, made by the same model. */
  vector: Float32Array
  /** Only records of these types. */
  types: readonly string[]
  /** At most this many hits. */
  limit: number
  /** Only records written at or after this date, ISO 8601. */
  after?: string | undefined
  /** Only records written before this date, ISO 8601. */
  before?: string | undefined
}

/** Of the records of one type that have text to search, how many there are and how many have a vector of a model. */
export interface VectorCount {
  type: string
  total: number
  done: number
}

export interface Vectors {
  available(): VectorsAvailable
  /** Records with text to search and no vector of this model, the newest first. */
  missing(model: string, limit: number): WithoutVector[]
  /** Keep vectors made by this model, in place of any a record had. */
  put(model: string, vectors: readonly RecordVector[]): void
  /** The records nearest in meaning, the nearest first. A hit's score is the cosine similarity. */
  nearest(query: NearestQuery): SearchHit[]
  /** How far the records of each type are searchable by this model. */
  count(model: string): VectorCount[]
  /** Drop the vectors of every other model. */
  keepOnly(model: string): void
  /** Drop every vector. */
  clear(): void
}
