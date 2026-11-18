/**
 * How the assistant mentions answers that finished out of sight, at the next pause (docs/SPEC.md, section 7.4):
 * "By the way, it's ready: Dinner for guests." No model is asked: the titles say what is ready, in the words of the
 * conversation, and the core adds the few words around them.
 */

/** The words around the titles, in the languages the core knows them in. The others use English. */
const READY: Record<string, { one: (what: string) => string; several: (what: string) => string }> = {
  en: { one: (what) => `By the way, it's ready: ${what}.`, several: (what) => `By the way, these are ready: ${what}.` },
  fr: { one: (what) => `Au fait, c'est prêt : ${what}.`, several: (what) => `Au fait, c'est prêt : ${what}.` },
  es: { one: (what) => `Por cierto, ya está listo: ${what}.`, several: (what) => `Por cierto, ya están listos: ${what}.` },
  de: { one: (what) => `Übrigens, das ist fertig: ${what}.`, several: (what) => `Übrigens, das ist fertig: ${what}.` },
  it: { one: (what) => `A proposito, è pronto: ${what}.`, several: (what) => `A proposito, sono pronti: ${what}.` },
  pt: { one: (what) => `A propósito, está pronto: ${what}.`, several: (what) => `A propósito, estão prontos: ${what}.` },
  nl: { one: (what) => `Trouwens, het is klaar: ${what}.`, several: (what) => `Trouwens, dit is klaar: ${what}.` }
}

/** The sentence that says these topics are ready, in a language by its ISO 639-1 code: their titles, joined as a person would. */
export function readySentence(titles: readonly string[], language: string | undefined): string {
  const known = language !== undefined && READY[language] !== undefined ? language : 'en'
  const words = READY[known] as (typeof READY)[string]
  const named = titles.map((title) => title.trim().replace(/[.!?…]+$/, '')).filter((title) => title !== '')
  const what = new Intl.ListFormat(known, { style: 'long', type: 'conjunction' }).format(named)
  return named.length > 1 ? words.several(what) : words.one(what)
}
