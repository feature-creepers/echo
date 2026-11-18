/**
 * Whether something the person said answers a question on screen: yes, no, or neither. Spoken or pressed, an
 * answer is a few words; anything longer, or both at once, is something else they want to say.
 */

const NO = [
  "don't allow",
  'do not allow',
  "don't",
  'do not',
  'no',
  'nope',
  'deny',
  'refuse',
  'cancel',
  'stop',
  'not now',
  'never mind',
  'non',
  "n'autorise pas",
  'annule',
  'pas maintenant',
  'surtout pas',
  'laisse tomber'
]
const YES = [
  // What the buttons of a card say, read aloud.
  'give access',
  'create it',
  'change it',
  'run it',
  'delete it',
  'click it',
  'type it',
  'choose it',
  'press it',
  'upload it',
  'allow',
  'yes',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'sure',
  'go ahead',
  'go on',
  'do it',
  'approve',
  'approved',
  'fine',
  'please do',
  'of course',
  'oui',
  'ouais',
  'vas-y',
  'vas y',
  'allez',
  "d'accord",
  'autorise',
  'accepte',
  "c'est bon",
  'bien sûr',
  'fais-le',
  'fais le'
]

/** The longest an answer is, in words. */
const MAX_WORDS = 6

const normal = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `

const says = (text: string, words: readonly string[]) => words.some((word) => text.includes(` ${word} `))

export function answerOf(said: string): 'yes' | 'no' | undefined {
  const text = normal(said)
  if (text.trim().split(' ').length > MAX_WORDS) return undefined
  // "Don't allow" says "allow" too: a refusal is looked for first, and a sentence that says both is neither.
  if (says(text, NO))
    return says(
      text.replace(/don't allow|do not allow/g, ''),
      YES.filter((word) => word !== 'allow')
    )
      ? undefined
      : 'no'
  return says(text, YES) ? 'yes' : undefined
}
