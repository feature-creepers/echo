import { exchangeSchema } from '@repo/protocol'
import { EXCHANGE } from '../channel/channel.ts'
import type { NewRecord } from '../ports/records.ts'
import { FACT, readFactRecord } from './facts.ts'

/**
 * What of the records is searched, and with which words. Every search adapter follows these two functions,
 * so the store and the in-memory double find the same things.
 */

/** The record types that have text to search. */
export const SEARCHABLE_TYPES: readonly string[] = [EXCHANGE, FACT]

/** The text of a record that a search should find it by. Nothing for a record that has none, or was erased. */
export function searchableText(record: NewRecord): string | undefined {
  if (record.type === EXCHANGE) {
    const exchange = exchangeSchema.safeParse(record.payload)
    if (!exchange.success) return undefined
    const text = [exchange.data.said, exchange.data.replied].filter((part) => part.trim() !== '').join('\n')
    return text === '' ? undefined : text
  }
  if (record.type === FACT) return readFactRecord(record.payload)?.text
  return undefined
}

/** The longest list of words a search looks for. A long utterance is mostly words that carry little. */
const MAX_KEYWORDS = 16

/**
 * Words that say nothing about what a sentence is about, in the two languages the user speaks. Searching for
 * them would match every line of the log.
 */
const STOPWORDS = new Set(
  [
    // English
    'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does',
    'doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself',
    'just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than',
    'that the their theirs them themselves then there these they this those through to too under until up very was we were what when where',
    'which while who whom why will with would you your yours yourself yourselves im ive id youre dont doesnt didnt cant wont isnt arent',
    'please tell know think want like get got let lets okay ok yes yeah hey hi hello thanks thank say said going go well really maybe',
    // French
    'au aux avec ce ces cet cette dans de des du elle elles en et eux il ils je la le les leur leurs lui ma mais me meme mes moi mon ne nos notre',
    'nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous est sont suis es etes sommes ete etre avoir',
    'ai as avons avez ont avait etait fait faire peux peut veux veut dit dis comme tout tous toute toutes tres bien oui non alors donc ca cela',
    'ceci quoi quand comment pourquoi ou y si plus moins encore aussi deja merci bonjour salut voila sais sait'
  ]
    .join(' ')
    .split(' ')
)

/** Fold a word to the form it is compared in: lower case, without accents. */
export function foldWord(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** The words of a text worth searching for: no short or empty words, each once, in the order said. */
export function keywordsOf(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const kept: string[] = []
  for (const word of words) {
    const folded = foldWord(word)
    if (folded.length < 2 || STOPWORDS.has(folded) || kept.includes(folded)) continue
    kept.push(folded)
    if (kept.length === MAX_KEYWORDS) break
  }
  return kept
}
