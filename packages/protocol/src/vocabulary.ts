import { z } from 'zod'

/**
 * The person's own words, for the recogniser (docs/SPEC.md, section 12.4): names, places and terms it would not know
 * or would write otherwise ("Okonkwo", "json-render"), heard as they are written. Each is a word or a few, as
 * the person writes it, capitals included.
 */

/** The most words the person can give: past them, hearing slows down and the words help less. */
export const MAX_WORDS = 200
/** The longest one can be, in characters. */
export const MAX_WORD_LENGTH = 60

export const vocabularySchema = z.array(z.string().min(1).max(MAX_WORD_LENGTH)).max(MAX_WORDS)
export type Vocabulary = z.infer<typeof vocabularySchema>

/**
 * The words as they are kept: spaces around and between them made single, each once whatever its capitals (the first
 * written wins), none empty, in the order given, the longest cut and the most kept.
 */
export function cleanVocabulary(words: readonly string[]): Vocabulary {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const word of words) {
    const clean = word.replace(/\s+/g, ' ').trim().slice(0, MAX_WORD_LENGTH).trim()
    const key = clean.toLowerCase()
    if (clean === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(clean)
    if (kept.length >= MAX_WORDS) break
  }
  return kept
}
