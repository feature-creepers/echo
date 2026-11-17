import type { DatabaseSync } from 'node:sqlite'
import { erasedBy, keywordsOf, type NewRecord, type Search, type SearchHit, searchableText } from '@repo/core'
import { transaction } from '../database.ts'

/** How many words of a record a hit shows around what was found. */
const SNIPPET_WORDS = 24

/** The keyword index, as the records see it: it takes in each record as it is written. */
export interface KeywordIndex extends Search {
  /** Take in a record just written, inside the transaction that writes it. */
  take(record: NewRecord & { id: string }, rowid: number | bigint): void
  /** Take in every record written since the index last read the table: on opening, after an older version wrote, or after a sync. */
  catchUp(): void
}

/**
 * Keyword search with FTS5, ranked by bm25 and, when asked, by how recent a record is. A word of four letters
 * or more also finds the words it starts, so "garden" finds "gardening".
 */
export function createKeywordIndex(database: DatabaseSync): KeywordIndex {
  const insert = database.prepare('insert into search_text (text, record) values (?, ?)')
  const remove = database.prepare('delete from search_text where record = ?')
  const progress = database.prepare('update search_progress set indexed = ?')
  const indexed = database.prepare('select indexed from search_progress')
  const behind = database.prepare('select rowid, id, type, payload from record where rowid > ? order by rowid')

  const take = (record: NewRecord & { id: string }, rowid: number | bigint) => {
    const text = searchableText(record)
    if (text !== undefined) insert.run(text, record.id)
    for (const erased of erasedBy(record)) remove.run(erased)
    progress.run(rowid)
  }

  return {
    take,

    catchUp() {
      transaction(database, () => {
        const from = Number(indexed.get()?.indexed ?? 0)
        for (const row of behind.all(from)) {
          take({ id: String(row.id), type: String(row.type), payload: JSON.parse(String(row.payload)) }, Number(row.rowid))
        }
      })
    },

    search({ text, types, limit, after, before, recency }) {
      const keywords = keywordsOf(text)
      if (keywords.length === 0 || types.length === 0 || limit <= 0) return []
      // Every keyword is only letters and digits, so quoting it is enough to keep it from being read as syntax.
      const match = keywords.map((keyword) => (keyword.length >= 4 ? `"${keyword}"*` : `"${keyword}"`)).join(' OR ')
      const conditions = [`search_text match ?`, `r.type in (${types.map(() => '?').join(', ')})`]
      const values: Array<string | number> = [match, ...types]
      if (after !== undefined) {
        conditions.push('r.at >= ?')
        values.push(after)
      }
      if (before !== undefined) {
        conditions.push('r.at < ?')
        values.push(before)
      }
      // bm25 is lower for a better match. A record `halfLifeDays` old counts half as much as one written now.
      const score = recency ? '-bm25(search_text) / (1 + max(0, julianday(?) - julianday(r.at)) / ?)' : '-bm25(search_text)'
      const scoreValues = recency ? [recency.now, recency.halfLifeDays] : []
      const rows = database
        .prepare(
          `select r.id as id, r.type as type, r.at as at, snippet(search_text, 0, '', '', '…', ${SNIPPET_WORDS}) as snippet, ${score} as score
           from search_text join record r on r.id = search_text.record
           where ${conditions.join(' and ')}
           order by score desc
           limit ?`
        )
        .all(...scoreValues, ...values, limit)
      return rows.map(
        (row): SearchHit => ({ record: String(row.id), type: String(row.type), at: String(row.at), snippet: String(row.snippet), score: Number(row.score) })
      )
    }
  }
}
