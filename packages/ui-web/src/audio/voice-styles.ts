import type { VoiceStyles } from '@repo/client'
import type { Persona, Stance } from '@repo/protocol'

/**
 * The voice style each stance speaks in until the user picks one for a language.
 *
 * Chosen on 19 November 2026 by measuring the voice's five men's styles in each of its 31 languages, the
 * same two sentences in each: their pitch, how much it moves, their pace, their brightness and how even their
 * loudness is, each set against the other styles of the language, then compared with the stance's manner.
 * Languages where a first measure was close were measured again, three times over, and the same style came
 * closest in every language, so a persona sounds like itself in each.
 * - The stance that goes along speaks as a polished, assured aide: crisp and quick, level in pitch and
 *   loudness, a light baritone. The polished, assured style comes closest.
 * - The stance that questions speaks calm and unhurried: soft, slow, warm rather than bright, level in pitch
 *   and loudness, a little lower. The warm, soothing style comes closest.
 */
const STYLE_OF_STANCE: Record<Stance, string> = { accommodating: 'm3', critical: 'm5' }

/** How each stance's pace compares with the pace set: the one that questions takes its time. */
const PACE_OF_STANCE: Record<Stance, number> = { accommodating: 1, critical: 0.95 }

/** A language's two-letter code, from the way a sentence or a setting writes it: "fr-FR" and "FR" are French. */
export function languageOf(language: string): string {
  return language.toLowerCase().split(/[-_]/)[0] ?? ''
}

/** The style a stance speaks in, until the user picks one. */
export function styleOfStance(stance: Stance): string {
  return STYLE_OF_STANCE[stance]
}

/** The voice style a persona speaks a language in: the one the user picked for it there, or its stance's. */
export function styleOf(persona: Persona | undefined, language: string, picked: VoiceStyles): string {
  if (!persona) return styleOfStance('accommodating')
  const code = languageOf(language)
  // Read as own keys only, so that a persona or a language called "constructor" finds nothing the object inherits.
  const own = Object.hasOwn(picked, persona.id) ? picked[persona.id] : undefined
  const style = own && Object.hasOwn(own, code) ? own[code] : undefined
  return style ?? styleOfStance(persona.stance)
}

/**
 * The styles picked, with a persona's style in a language changed. Picking the stance's own style lets the
 * pick go, so that the persona follows its stance there again.
 */
export function withPick(picked: VoiceStyles, persona: Persona, language: string, style: string): VoiceStyles {
  const code = languageOf(language)
  const own = Object.entries(Object.hasOwn(picked, persona.id) ? (picked[persona.id] ?? {}) : {}).filter(([kept]) => kept !== code)
  if (style !== styleOfStance(persona.stance)) own.push([code, style])
  const others = Object.entries(picked).filter(([id]) => id !== persona.id)
  // Made from entries rather than assigned key by key, so that a key such as "__proto__" stays a plain key.
  return Object.fromEntries(own.length > 0 ? [...others, [persona.id, Object.fromEntries(own)]] : others)
}

/** The pace a persona speaks at, from the pace set. */
export function paceOf(persona: Persona | undefined, speed: number): number {
  return speed * PACE_OF_STANCE[persona?.stance ?? 'accommodating']
}
