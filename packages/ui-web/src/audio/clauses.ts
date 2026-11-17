/** A sentence this long takes the voice long enough to make that it is made, and starts playing, a clause at a time. */
const LONG = 100
/** A clause shorter than this joins the next one: a voice says a very short piece flatly. */
const SHORTEST = 40

/**
 * A sentence cut where a speaker would breathe (after a comma, a semicolon, a colon or a dash) into pieces the
 * voice can make one after the other. The first piece is heard while the next ones are made, so a long sentence
 * starts sooner. A short sentence, or one with nowhere to breathe, stays whole.
 */
export function clauses(sentence: string): string[] {
  const text = sentence.trim()
  if (text.length < LONG) return [text]
  const pieces = text.split(/(?<=[,;:])\s+|\s+(?=[—–]\s)/)
  const out: string[] = []
  for (const piece of pieces) {
    const last = out.at(-1)
    if (last !== undefined && last.length < SHORTEST) out[out.length - 1] = `${last} ${piece}`
    else out.push(piece)
  }
  // A short tail is said with the clause before it.
  const tail = out.at(-1)
  if (out.length > 1 && tail !== undefined && tail.length < SHORTEST) out.splice(-2, 2, `${out.at(-2)} ${tail}`)
  return out
}
