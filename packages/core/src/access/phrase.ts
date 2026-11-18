import type { ConfirmationPhrase } from '@repo/protocol'
import { sha256 } from './sha256.ts'
import { wordsOf } from './words.ts'

/** The fewest words a confirmation phrase has: a single word is said by chance too easily. */
export const MIN_PHRASE_WORDS = 2

/**
 * A confirmation phrase as the core keeps it (docs/SPEC.md, section 12.4, approvals away from the screen): the
 * fingerprint of its words, written as they are heard (small letters, no punctuation), and how many there are. The
 * phrase itself is never kept, shown or told to a session. Nothing when it is too short to be one.
 */
export function phraseOf(text: string): ConfirmationPhrase | undefined {
  const words = wordsOf(text)
  if (words.length < MIN_PHRASE_WORDS) return undefined
  return { hash: sha256(words.join(' ')), words: words.length }
}

/** Whether something said holds the phrase, its words in a row, whatever else is said around them. */
export function saysPhrase(said: string, phrase: ConfirmationPhrase): boolean {
  const words = wordsOf(said)
  for (let start = 0; start + phrase.words <= words.length; start++) {
    if (sha256(words.slice(start, start + phrase.words).join(' ')) === phrase.hash) return true
  }
  return false
}
