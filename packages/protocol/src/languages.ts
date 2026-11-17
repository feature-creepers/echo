import { z } from 'zod'

/**
 * The languages the assistant can answer aloud in: those its voice speaks, by ISO 639-1 code, with their
 * names in English, in the order to offer them. `heard` marks those the speech recognition hears too.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', heard: true },
  { code: 'fr', name: 'French', heard: true },
  { code: 'ar', name: 'Arabic', heard: false },
  { code: 'bg', name: 'Bulgarian', heard: true },
  { code: 'hr', name: 'Croatian', heard: true },
  { code: 'cs', name: 'Czech', heard: true },
  { code: 'da', name: 'Danish', heard: true },
  { code: 'nl', name: 'Dutch', heard: true },
  { code: 'et', name: 'Estonian', heard: true },
  { code: 'fi', name: 'Finnish', heard: true },
  { code: 'de', name: 'German', heard: true },
  { code: 'el', name: 'Greek', heard: true },
  { code: 'hi', name: 'Hindi', heard: false },
  { code: 'hu', name: 'Hungarian', heard: true },
  { code: 'id', name: 'Indonesian', heard: false },
  { code: 'it', name: 'Italian', heard: true },
  { code: 'ja', name: 'Japanese', heard: false },
  { code: 'ko', name: 'Korean', heard: false },
  { code: 'lv', name: 'Latvian', heard: true },
  { code: 'lt', name: 'Lithuanian', heard: true },
  { code: 'pl', name: 'Polish', heard: true },
  { code: 'pt', name: 'Portuguese', heard: true },
  { code: 'ro', name: 'Romanian', heard: true },
  { code: 'ru', name: 'Russian', heard: true },
  { code: 'sk', name: 'Slovak', heard: true },
  { code: 'sl', name: 'Slovenian', heard: true },
  { code: 'es', name: 'Spanish', heard: true },
  { code: 'sv', name: 'Swedish', heard: true },
  { code: 'tr', name: 'Turkish', heard: false },
  { code: 'uk', name: 'Ukrainian', heard: true },
  { code: 'vi', name: 'Vietnamese', heard: false }
] as const satisfies ReadonlyArray<{ code: string; name: string; heard: boolean }>

export type LanguageCode = (typeof LANGUAGES)[number]['code']

const codes = LANGUAGES.map((language) => language.code) as [LanguageCode, ...LanguageCode[]]
const heardCodes = LANGUAGES.filter((language) => language.heard).map((language) => language.code) as [LanguageCode, ...LanguageCode[]]

/** Every language's code, in the order to offer them. */
export const LANGUAGE_CODES: readonly LanguageCode[] = codes
/** The codes of the languages the speech recognition hears. */
export const HEARD_LANGUAGES: readonly LanguageCode[] = heardCodes

/** The name of a language, from its code; the code itself for one the product does not know. */
export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code
}

/** The language the person speaks: found from what they say (`auto`), or the one they set. */
export const spokenLanguageSchema = z.enum(['auto', ...heardCodes])
/** The language the assistant answers in: the one the person speaks (`spoken`), or the one they set. */
export const answerLanguageSchema = z.enum(['spoken', ...codes])

/** The languages of the conversation, as the user set them. */
export const languagesSchema = z.object({
  spoken: spokenLanguageSchema,
  answers: answerLanguageSchema
})
export type Languages = z.infer<typeof languagesSchema>

/** Until the user sets them: the language is found from what is said, and answered in. */
export const DEFAULT_LANGUAGES: Languages = { spoken: 'auto', answers: 'spoken' }
