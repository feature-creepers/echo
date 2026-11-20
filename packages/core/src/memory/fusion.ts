import type { SearchHit } from '../ports/search.ts'

/**
 * Keyword hits and hits by meaning, merged by reciprocal rank fusion (docs/SPEC.md, section 10.5). Each list is ranked
 * by its own score; a record then scores the sum, over the lists it is in, of 1 / (60 + its rank), ranks counted from 1.
 * The constant is the one of Cormack, Clarke and Büttcher (SIGIR 2009). Ties go to the more recent record.
 */

/**
 * The lowest similarity by meaning that is recalled, so that a turn about nothing remembered recalls nothing.
 * multilingual-e5-small puts every pair of texts between about 0.7 and 1: measured on the pairs of
 * packages/embedder/test/pairs.ts, sentences saying the same thing in English and French scored 0.823 to 0.921, and
 * unrelated ones 0.676 to 0.810, those close in form ("lost the keys", "lost the phone") the highest.
 */
export const MEANING_FLOOR = 0.815

const RANK_CONSTANT = 60
const DAY_MS = 86_400_000

export interface Fusion {
  /** Hits by keyword, best first, as the search ranked them, recency included. */
  keyword: readonly SearchHit[]
  /** Hits by meaning, their score the cosine similarity. */
  meaning: readonly SearchHit[]
  /** How hits by meaning fade, as the keyword hits beside them do: one this many days old counts half as much. */
  recency: { now: string; halfLifeDays: number }
  limit: number
}

/** The hits of both lists, each record once, best first. A record found both ways keeps its keyword hit's snippet. */
export function fuse({ keyword, meaning, recency, limit }: Fusion): SearchHit[] {
  const now = Date.parse(recency.now)
  const fading = (hit: SearchHit) => hit.score / (1 + Math.max(0, now - Date.parse(hit.at)) / DAY_MS / recency.halfLifeDays)
  const byMeaning = meaning
    .filter((hit) => hit.score >= MEANING_FLOOR)
    .map((hit) => ({ hit, rank: fading(hit) }))
    .sort((one, other) => other.rank - one.rank)
    .map(({ hit }) => hit)

  const merged = new Map<string, { hit: SearchHit; score: number }>()
  for (const list of [keyword, byMeaning]) {
    for (const [index, hit] of list.entries()) {
      const share = 1 / (RANK_CONSTANT + index + 1)
      const known = merged.get(hit.record)
      merged.set(hit.record, known ? { hit: known.hit, score: known.score + share } : { hit, score: share })
    }
  }
  return [...merged.values()]
    .sort((one, other) => other.score - one.score || newerFirst(one.hit, other.hit))
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score }))
}

function newerFirst(one: SearchHit, other: SearchHit): number {
  return one.at === other.at ? 0 : one.at < other.at ? 1 : -1
}
