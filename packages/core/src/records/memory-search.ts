import { foldWord, keywordsOf, searchableText } from '../memory/searchable.ts'
import type { Records } from '../ports/records.ts'
import type { Search, SearchHit } from '../ports/search.ts'

const SNIPPET_LENGTH = 160
const DAY_MS = 86_400_000

/**
 * A search that reads every record it is asked about, each time. For tests and for a core with no store: it
 * finds what the store's index finds, ranked more plainly, and its cost grows with the records.
 *
 * A word matches the words of a record that start with it, as the store's index does for longer words.
 */
export function memorySearch(records: Records): Search {
  return {
    search({ text, types, limit, after, before, recency }) {
      const keywords = keywordsOf(text)
      if (keywords.length === 0) return []
      const hits: SearchHit[] = []
      for (const record of records.read(types)) {
        if ((after !== undefined && record.at < after) || (before !== undefined && record.at >= before)) continue
        const content = searchableText(record)
        if (content === undefined) continue
        const words = (content.match(/[\p{L}\p{N}]+/gu) ?? []).map(foldWord)
        const found = keywords.filter((keyword) => words.some((word) => matches(word, keyword)))
        if (found.length === 0) continue
        const relevance = found.length + found.length / (words.length + 1)
        const age = recency ? Math.max(0, Date.parse(recency.now) - Date.parse(record.at)) / DAY_MS : 0
        const score = recency ? relevance / (1 + age / recency.halfLifeDays) : relevance
        hits.push({ record: record.id, type: record.type, at: record.at, snippet: snippetOf(content, found[0] ?? ''), score })
      }
      return hits.sort((one, other) => other.score - one.score).slice(0, limit)
    }
  }
}

/** Short words must match whole, longer ones may start a word: "kid" finds neither "kidney" nor "kids", "garden" finds "gardening". */
const matches = (word: string, keyword: string) => (keyword.length >= 4 ? word.startsWith(keyword) : word === keyword)

function snippetOf(content: string, keyword: string): string {
  if (content.length <= SNIPPET_LENGTH) return content
  const at = Math.max(0, foldWord(content).indexOf(keyword) - SNIPPET_LENGTH / 3)
  const piece = content.slice(at, at + SNIPPET_LENGTH)
  return `${at > 0 ? '…' : ''}${piece}${at + SNIPPET_LENGTH < content.length ? '…' : ''}`
}
