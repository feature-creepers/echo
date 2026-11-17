/**
 * What the core needs to find things again: a search over the text of its records.
 *
 * The index is derived data (docs/SPEC.md, section 5.2). An adapter keeps it in step with the records by
 * itself, as they are appended, indexing the text `searchableText` gives for each record and dropping what
 * an erasure names. It is never synced: each core rebuilds its own.
 *
 * Keyword search is what exists now. Vector search will be a second adapter whose hits are merged with these,
 * by the same record identifiers; keyword search must keep answering alone when there are no vectors.
 */

export interface SearchQuery {
  /** What to look for, as the user said it. The adapter picks the words with `keywordsOf`. */
  text: string
  /** Only records of these types. */
  types: readonly string[]
  /** At most this many hits. */
  limit: number
  /** Only records written at or after this date, ISO 8601. */
  after?: string
  /** Only records written before this date, ISO 8601. */
  before?: string
  /**
   * Rank recent records higher: a record this many days old counts half as much as one written `now`.
   * Left out, only how well the words match counts.
   */
  recency?: { now: string; halfLifeDays: number }
}

export interface SearchHit {
  /** The record found. */
  record: string
  type: string
  /** When the record was written, ISO 8601. */
  at: string
  /** A short piece of its text around the words found. */
  snippet: string
  /** Higher is better. Only comparable between hits of one search. */
  score: number
}

export interface Search {
  /** The best hits first. Nothing when no word of the text is worth looking for. */
  search(query: SearchQuery): SearchHit[]
}
