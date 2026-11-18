import { z } from 'zod'

/**
 * A persona is one of the characters the assistant can be. The user talks to the assistant by the name of
 * the persona in use, and chooses that name.
 *
 * A persona is data. Nothing in the product may depend on which persona it is or on what it is called:
 * behaviour follows the stance, and the look follows the accent.
 */

/** How the assistant handles a request it has doubts about. */
export const STANCES = [
  /** Mentions a serious problem in one sentence and proceeds. */
  'accommodating',
  /** Stops before acting on a serious problem, proposes the better way, and complies once the user confirms. */
  'critical'
] as const
export const stanceSchema = z.enum(STANCES)
export type Stance = z.infer<typeof stanceSchema>

/** The colour a persona shows. The values behind each name are design values, known to the renderers. */
export const ACCENTS = ['cyan', 'red'] as const
export const accentSchema = z.enum(ACCENTS)
export type Accent = z.infer<typeof accentSchema>

/**
 * How a persona's core is drawn. Each value names a design, never a persona: the renderers know how to draw
 * each one, always in the persona's accent.
 */
export const LOOKS = [
  /** A camera's lens: black glass in a brushed metal ring, with a lamp deep inside it. */
  'lens',
  /** A holographic instrument: fine rings of arcs and ticks turning round a small bright core. */
  'hud'
] as const
export const lookSchema = z.enum(LOOKS)
export type Look = z.infer<typeof lookSchema>

/** The look of a persona written before personas had one: the look its accent first came with. */
const LOOK_OF_ACCENT: Record<Accent, Look> = { cyan: 'hud', red: 'lens' }

export const personaIdSchema = z.string().min(1).max(64)
export type PersonaId = z.infer<typeof personaIdSchema>

export const personaSchema = z
  .object({
    /** Identifies the persona for good. It never changes and is never shown. */
    id: personaIdSchema,
    /** What the user calls it. */
    name: z.string().min(1),
    stance: stanceSchema,
    accent: accentSchema,
    look: lookSchema.optional()
  })
  .transform(({ look, ...persona }) => ({ ...persona, look: look ?? LOOK_OF_ACCENT[persona.accent] }))
export type Persona = z.infer<typeof personaSchema>

/** The longest name a persona can have, in characters. */
export const PERSONA_NAME_MAX_LENGTH = 24

export type PersonaNameProblem =
  /** Nothing was typed. */
  | 'empty'
  /** More than `PERSONA_NAME_MAX_LENGTH` characters. */
  | 'too-long'
  /** Something else than letters, digits, spaces, hyphens, apostrophes and full stops, or no letter or digit at all. */
  | 'characters'

export type PersonaNameReading = { ok: true; name: string } | { ok: false; problem: PersonaNameProblem }

const ALLOWED = /^[\p{L}\p{M}\p{N} .'’-]+$/u
const SAYABLE = /[\p{L}\p{N}]/u

/**
 * Read a name as someone typed it, and say whether a persona can carry it.
 *
 * A name is something the user says aloud, so it is kept to what can be said: letters and digits of any
 * script, with spaces, hyphens, apostrophes and full stops between them. Surrounding spaces are dropped
 * and runs of spaces become one. Client and core both use this, so they never disagree.
 */
export function readPersonaName(typed: string): PersonaNameReading {
  const name = typed.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (name === '') return { ok: false, problem: 'empty' }
  if ([...name].length > PERSONA_NAME_MAX_LENGTH) return { ok: false, problem: 'too-long' }
  if (!ALLOWED.test(name) || !SAYABLE.test(name)) return { ok: false, problem: 'characters' }
  return { ok: true, name }
}

/** Whether two names would be heard as the same: they differ at most by case. Two personas cannot share one. */
export function samePersonaName(one: string, other: string): boolean {
  return one.normalize('NFC').toLowerCase() === other.normalize('NFC').toLowerCase()
}
