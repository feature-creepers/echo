/**
 * Whether what the person said is a thank you and nothing more: "thanks", "merci Ada", "ok, thank you so much". The
 * aside cards leave then, their question answered (docs/SPEC.md, section 7.5). Said with anything else ("thanks, and
 * the weather?"), it is not: the person is going on.
 */

/** The words that thank, in the languages the core knows them in. */
const THANKING = new Set([
  'thanks',
  'thank',
  'thankyou',
  'thx',
  'ty',
  'cheers',
  'merci',
  'gracias',
  'danke',
  'dankeschön',
  'grazie',
  'obrigado',
  'obrigada',
  'bedankt',
  'dank',
  'dankjewel',
  'dankuwel'
])

/** The words that go with a thank you without saying anything more. */
const WITH_THANKS = new Set([
  // English
  'you',
  'so',
  'very',
  'much',
  'a',
  'lot',
  'lots',
  'for',
  'that',
  'it',
  'ok',
  'okay',
  'oh',
  'great',
  'perfect',
  'cool',
  'nice',
  'awesome',
  'alright',
  'good',
  'super',
  // French
  'beaucoup',
  'bien',
  'très',
  'pour',
  'ça',
  'c',
  'est',
  'parfait',
  'génial',
  'top',
  'nickel',
  'd',
  'accord',
  // Spanish, German, Italian, Portuguese and Dutch
  'muchas',
  'muchísimas',
  'muy',
  'vale',
  'perfecto',
  'vielen',
  'sehr',
  'schön',
  'gut',
  'mille',
  'tante',
  'perfetto',
  'muito',
  'je',
  'u',
  'wel',
  'heel',
  'hartelijk'
])

export function isThanks(said: string, names: readonly string[] = []): boolean {
  const named = new Set(names.flatMap((name) => words(name)))
  const left = words(said).filter((word) => !named.has(word))
  return left.some((word) => THANKING.has(word)) && left.every((word) => THANKING.has(word) || WITH_THANKS.has(word))
}

/** The words of a sentence, in lower case, without what is not a letter. */
function words(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== '')
}
