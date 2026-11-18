import { spokenPersonaName } from '@repo/protocol'

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A sentence as the voice should say it: the personas' names are written in capitals, which a voice may spell
 * letter by letter, so each is given to it as a word ("UNIT-7 is ready" is said "Unit 7 is ready"). Only a
 * name standing as a word of its own is changed.
 */
export function namesAsWords(sentence: string, names: readonly string[]): string {
  let said = sentence
  for (const name of names) {
    if (name === '') continue
    said = said.replace(new RegExp(`(?<![\\p{L}\\p{N}])${literal(name)}(?![\\p{L}\\p{N}])`, 'gu'), spokenPersonaName(name))
  }
  return said
}
