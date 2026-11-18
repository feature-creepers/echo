/**
 * Whether something the person said answers a question on screen: yes, yes for the whole session, no, or
 * neither. Spoken or pressed, an answer is a few words; anything longer, or both at once, is something else
 * they want to say. And whether they asked to stop everything.
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

/** Said with a yes, or alone, a yes that lasts until the app quits: "yes, for the session", "oui, pour la session". */
const SESSION = [
  'for the session',
  'for this session',
  'for the whole session',
  'for the rest of the session',
  'pour la session',
  'pour cette session',
  'pour toute la session',
  'pour le reste de la session'
]

/** "Stop everything", in the languages the assistant hears, alone or after its name. */
const STOP_EVERYTHING = ['stop everything', 'stop it all', 'stop all of it', 'arrête tout', 'arrêtez tout', 'arrete tout', 'stoppe tout', 'stop tout']

/** The longest an answer is, in words. */
const MAX_WORDS = 7
/** The longest "stop everything" is, with the assistant's name or a word before it. */
const MAX_STOP_WORDS = 5

const normal = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `

const says = (text: string, words: readonly string[]) => words.some((word) => text.includes(` ${word} `))

export function answerOf(said: string): 'yes' | 'session' | 'no' | undefined {
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
  if (says(text, SESSION)) return 'session'
  return says(text, YES) ? 'yes' : undefined
}

/** Whether the person asked to stop everything the assistant is doing. */
export function stopsEverything(said: string): boolean {
  const text = normal(said)
  return text.trim().split(' ').length <= MAX_STOP_WORDS && says(text, STOP_EVERYTHING)
}
