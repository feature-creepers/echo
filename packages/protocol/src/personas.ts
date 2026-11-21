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
const stanceSchema = z.enum(STANCES)
export type Stance = z.infer<typeof stanceSchema>

/** The colour a persona shows. The values behind each name are design values, known to the renderers. */
const ACCENTS = ['blue', 'red'] as const
/** A persona kept before the accents were redrawn names the blue one `cyan`, which it was. */
const accentSchema = z.preprocess((kept) => (kept === 'cyan' ? 'blue' : kept), z.enum(ACCENTS))
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
const lookSchema = z.enum(LOOKS)
export type Look = z.infer<typeof lookSchema>

/** The look of a persona written before personas had one: the look its accent first came with. */
const LOOK_OF_ACCENT: Record<Accent, Look> = { blue: 'hud', red: 'lens' }

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
  /** Something else than letters from A to Z, digits, and hyphens between them. */
  | 'characters'

export type PersonaNameReading = { ok: true; name: string } | { ok: false; problem: PersonaNameProblem }

/** A name as it is kept: words of capitals and digits, joined by single hyphens. */
const KEPT = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/

/**
 * A name in the form a persona carries it, as far as typing can be turned into it: accents dropped, capitals,
 * and a hyphen where there were spaces. What is left may still not be a name; `readPersonaName` says.
 */
function personaNameForm(typed: string): string {
  return typed
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .toUpperCase()
}

/**
 * Read a name as someone typed it, and say whether a persona can carry it.
 *
 * A persona's name is written as a call sign is: capitals from A to Z and digits, in words joined by hyphens
 * ("ADA", "UNIT-7"). It reads the same on every screen and in every script the user writes in, and it is told
 * apart from the words around it in a sentence. Typing is forgiving: small letters become capitals, accents
 * are dropped and spaces become hyphens. Client and core both use this, so they never disagree.
 */
export function readPersonaName(typed: string): PersonaNameReading {
  const name = personaNameForm(typed)
  if (name === '') return { ok: false, problem: 'empty' }
  if (name.length > PERSONA_NAME_MAX_LENGTH) return { ok: false, problem: 'too-long' }
  if (!KEPT.test(name)) return { ok: false, problem: 'characters' }
  return { ok: true, name }
}

/**
 * A name kept by an earlier version, which allowed more, in the form names take now: what cannot be written
 * becomes a hyphen. Nothing when no letter or digit is left, and the persona then keeps its default name.
 */
export function earlierPersonaName(kept: string): string | undefined {
  const name = personaNameForm(kept)
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, PERSONA_NAME_MAX_LENGTH)
    .replace(/^-+|-+$/g, '')
  return name === '' ? undefined : name
}

/**
 * A name as it is said aloud: in capitals, a voice may spell it letter by letter, so it is given as a word
 * ("UNIT-7" is said "Unit 7").
 */
export function spokenPersonaName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

/** Whether two names would be heard as the same: they differ at most by case. Two personas cannot share one. */
export function samePersonaName(one: string, other: string): boolean {
  return one.normalize('NFC').toLowerCase() === other.normalize('NFC').toLowerCase()
}
