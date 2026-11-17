/**
 * Tells which language a sentence is written in, among the few the user speaks, so the voice pronounces it
 * right. It counts the very common words of each language: enough for a sentence, and it needs no model.
 */
const COMMON: Record<string, ReadonlySet<string>> = {
  en: new Set(
    'the a an and or but is are was were be been have has had do does did will would can could should of to in on at for with from by it this that these those i you he she we they my your his her our their not no yes what which who how when where why there here as if so than then just very'.split(
      ' '
    )
  ),
  fr: new Set(
    "le la les un une des du de et ou mais est sont était être avoir a ont avait fait faire va vont peut pouvez dans sur à au aux pour avec par ce cet cette ces il elle nous vous ils elles je tu mon ma mes ton ta tes son sa ses notre votre leur ne pas non oui que qui quoi comment quand où pourquoi y en si plus très bien c'est j'ai n'est qu'il d'un d'une l'on".split(
      ' '
    )
  )
}

/** Letters that English does not use and French does. */
const FRENCH_LETTERS = /[àâçéèêëîïôùûüœ]/i

/**
 * The language of a sentence among `candidates`, or `fallback` when the sentence does not say: too short,
 * or as close to one as to another.
 */
export function languageOf(sentence: string, candidates: readonly string[], fallback: string | undefined): string | undefined {
  const words = sentence.toLowerCase().match(/[\p{L}']+/gu) ?? []
  let best: { language: string; score: number } | undefined
  let second = 0
  for (const language of candidates) {
    const common = COMMON[language]
    if (!common) continue
    let score = words.filter((word) => common.has(word)).length
    if (language === 'fr' && FRENCH_LETTERS.test(sentence)) score += 2
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { language, score }
    } else if (score > second) {
      second = score
    }
  }
  if (!best || best.score === 0 || best.score === second) return fallback
  return best.language
}
