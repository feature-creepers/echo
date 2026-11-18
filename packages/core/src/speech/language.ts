/**
 * Tells which language a sentence is written in, among the languages it may be in, so the voice pronounces
 * it right and the assistant knows the language the person speaks. It needs no model. A script that only one
 * language uses says it at once (Korean, Japanese, Greek, Hindi, Arabic). In the Latin script, it counts the
 * very common words of each language, which is enough for a short sentence where letter statistics are not.
 * Languages it cannot tell apart this way are set by the user in the settings.
 */

const words = (list: string) => new Set(list.split(' '))

/** The very common words of the languages told apart by their words, written lower case. */
const COMMON: Record<string, ReadonlySet<string>> = {
  en: words(
    'the a an and or but is are was were be been have has had do does did will would can could should of to in on at for with from by it this that these those i you he she we they my your his her our their not no yes what which who how when where why there here as if so than then just very thanks please'
  ),
  fr: words(
    "le la les un une des du de et ou mais est sont était être avoir a ont avait fait faire va vont peut pouvez dans sur à au aux pour avec par ce cet cette ces il elle nous vous ils elles je tu mon ma mes ton ta tes son sa ses notre votre leur ne pas non oui que qui quoi comment quand où pourquoi y en si plus très bien merci beaucoup c'est j'ai n'est qu'il d'un d'une l'on mets lance"
  ),
  es: words(
    'el la los las un una unos unas y o pero es son era está están ser estar hay de del al en con por para que qué quién cómo cuándo dónde porque no sí muy más yo tú él ella nosotros vosotros ellos mi tu su nuestro este esta estos esas lo le se me te gracias hace tiempo'
  ),
  de: words(
    'der die das ein eine einen dem den des und oder aber ist sind war waren sein haben hat hatte wird werden kann können von zu im in auf an für mit aus bei nach nicht kein ja nein was wer wie wann wo warum ich du er sie es wir ihr mein dein sein unser auch noch sehr danke bitte heute morgen'
  ),
  it: words(
    "il lo la i gli le un uno una e o ma è sono era essere avere ha hanno di del della dei delle a al alla in nel nella con per su da che chi come quando dove perché non sì molto più io tu lui lei noi voi loro mio tuo suo questo questa quello grazie fa domani c'è"
  ),
  pt: words(
    'o a os as um uma uns umas e ou mas é são era está estão ser estar tem têm de do da dos das em no na nos nas com por para que quem como quando onde porque não sim muito mais eu tu ele ela nós vós eles elas meu teu seu nosso este esta isso obrigado obrigada faz amanhã'
  ),
  ru: words('и в не на я что он она с как это по но они мы к у вы так же от за бы будет какая какой где когда сегодня завтра спасибо'),
  uk: words('і в не на я що він вона з як це по але вони ми до у ви так та від за буде яка який де коли сьогодні завтра дякую'),
  bg: words('и в не на аз че той тя с как това по но те ние до у вие така ще е са от за какво къде кога днес утре благодаря'),
  nl: words(
    'de het een en of maar is zijn was waren hebben heeft had wordt worden kan kunnen van te in op aan voor met uit bij naar niet geen ja nee wat wie hoe wanneer waar waarom ik jij je hij zij wij jullie mijn jouw zijn ons ook nog heel dank bedankt morgen vandaag'
  )
}

/** Letters a language uses and few others do: a sentence with them leans that way. */
const LETTERS: Record<string, RegExp> = {
  fr: /[âçèêëîïôûœ]/i,
  es: /[ñ¿¡]/i,
  de: /[äöüß]/i,
  pt: /[ãõ]/i,
  it: /[ìò]/i
}

/** Scripts that only one of the languages writes in. */
const SCRIPTS: ReadonlyArray<[language: string, script: RegExp]> = [
  ['ko', /\p{Script=Hangul}/u],
  // Kana, or Chinese characters, which of these languages only Japanese writes.
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u],
  ['el', /\p{Script=Greek}/u],
  ['hi', /\p{Script=Devanagari}/u],
  ['ar', /\p{Script=Arabic}/u]
]

/** The Cyrillic languages, told apart by the letters only each of them uses. */
const CYRILLIC: ReadonlyArray<[language: string, letters: RegExp]> = [
  ['uk', /[їєіґ]/i],
  ['ru', /[ыэё]/i],
  ['bg', /ъ/i]
]

/**
 * The language of a sentence among `candidates`, or `fallback` when the sentence does not say: too short,
 * written with words common to several of them, or in a language it cannot tell.
 */
export function languageOf(sentence: string, candidates: readonly string[], fallback: string | undefined): string | undefined {
  const among = new Set(candidates)
  for (const [language, script] of SCRIPTS) if (script.test(sentence)) return among.has(language) ? language : fallback
  if (/\p{Script=Cyrillic}/u.test(sentence)) {
    const found = CYRILLIC.find(([language, letters]) => among.has(language) && letters.test(sentence))
    if (found) return found[0]
    return byWords(
      sentence,
      candidates.filter((language) => CYRILLIC.some(([cyrillic]) => cyrillic === language)),
      fallback
    )
  }
  return byWords(sentence, candidates, fallback)
}

/** The candidate whose common words the sentence uses most, unless none does or two do as much. */
function byWords(sentence: string, candidates: readonly string[], fallback: string | undefined): string | undefined {
  const said = sentence.toLowerCase().match(/[\p{L}']+/gu) ?? []
  let best: { language: string; score: number } | undefined
  let second = 0
  for (const language of candidates) {
    const common = COMMON[language]
    if (!common) continue
    let score = said.filter((word) => common.has(word)).length
    if (LETTERS[language]?.test(sentence)) score += 2
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
