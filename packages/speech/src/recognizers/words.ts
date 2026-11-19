/**
 * The person's own words, given to the recogniser to favour (docs/SPEC.md, section 12.4): names and terms it would
 * not know or would write otherwise. Parakeet favours the pieces a word is written with when it weighs several ways
 * of hearing at once (`modified_beam_search`, the library's hotwords). The library cuts each word into the model's
 * pieces itself, given them as a vocabulary file, which the model set does not ship: it is written from the
 * model's own list of pieces, the order they were learned in standing for their score.
 */

/**
 * How much a word of the person's is favoured. Measured on names spoken by the voice: at 2 some are still missed, 3
 * hears them, and at 4.5 it starts hearing them where they were not said ("Grafana" heard as "Grana").
 */
export const WORD_BOOST = 3

/** The most words the service takes for one utterance, and the longest one: what the person's settings keep. */
export const MAX_WORDS = 200
export const MAX_WORD_LENGTH = 60

/** The model's pieces, from its list (`tokens.txt`): a piece and its number on each line. */
function piecesOf(tokens: string): { piece: string; number: number }[] {
  return tokens.split(/\r?\n/).flatMap((line) => {
    const space = line.lastIndexOf(' ')
    const number = Number(line.slice(space + 1))
    return space > 0 && Number.isInteger(number) ? [{ piece: line.slice(0, space), number }] : []
  })
}

/** The vocabulary file the library cuts words with: each piece and its score, the earlier learned the higher. */
export function piecesVocabulary(tokens: string): string {
  return piecesOf(tokens)
    .map(({ piece, number }) => `${piece}\t${-number}\n`)
    .join('')
}

/** A piece the model uses to mark its own work, not to write: `<unk>`, `<|endoftext|>`. */
const MARK = /^<.*>$/

/** The characters the model's pieces write, "▁" (where a word starts) aside. */
export function writtenCharacters(tokens: string): Set<string> {
  const characters = new Set<string>()
  for (const { piece } of piecesOf(tokens)) {
    if (MARK.test(piece)) continue
    for (const character of piece) if (character !== '▁') characters.add(character)
  }
  return characters
}

/**
 * The words as the library takes them for one utterance: each with its boost, "/" between them. A word is made of
 * what the library reads as text: "/" and ":" separate and score, so they become spaces. One with a character no
 * piece writes is left out, since the library drops all the words when it cannot cut one.
 */
export function hotwords(words: readonly string[], characters: ReadonlySet<string>): string {
  const kept: string[] = []
  for (const word of words) {
    const clean = word.replace(/[/:]/g, ' ').replace(/\s+/g, ' ').trim()
    if (clean === '' || [...clean].some((character) => character !== ' ' && !characters.has(character))) continue
    kept.push(`${clean} :${WORD_BOOST}`)
  }
  return kept.join('/')
}
