import { type CommandError, type CommandInput, type Persona, type PersonaId, personaIdSchema, readPersonaName, samePersonaName } from '@repo/protocol'
import { z } from 'zod'

/** The type of the record written each time the user names the personas or picks the one that answers. */
export const PERSONAS_SET = 'personas.set'

const choiceSchema = z.object({
  names: z.array(z.object({ persona: personaIdSchema, name: z.string().min(1) })),
  active: personaIdSchema
})

/** What the user chose, with every name in the form it is kept in. This is the payload of the record. */
export type PersonaChoice = z.infer<typeof choiceSchema>

/** The personas the user can pick, and the one that answers. */
export interface Cast {
  available: readonly Persona[]
  active: PersonaId
}

/** Read the payload of a record. Gives nothing for one this version cannot read, which is then skipped. */
export function readChoice(payload: unknown): PersonaChoice | undefined {
  const choice = choiceSchema.safeParse(payload)
  return choice.success ? choice.data : undefined
}

export type ChoiceCheck = { ok: true; choice: PersonaChoice } | { ok: false; error: CommandError }

/**
 * Check what the user asked for against the personas that exist, and put the names in the form they are kept in.
 *
 * Refused: a persona that does not exist, a name that cannot be said, and two personas that would be called the same.
 */
export function checkChoice(cast: Cast, asked: CommandInput<'personas.set'>): ChoiceCheck {
  const known = new Set(cast.available.map((persona) => persona.id))
  const names: PersonaChoice['names'] = []

  for (const { persona, name } of asked.names) {
    if (!known.has(persona)) return refuse('unknown-persona', `There is no persona "${persona}".`)
    if (names.some((given) => given.persona === persona)) return refuse('invalid-input', `The persona "${persona}" is named twice.`)
    const reading = readPersonaName(name)
    if (!reading.ok) return refuse('invalid-name', `The name given to the persona "${persona}" cannot be used: ${reading.problem}.`)
    names.push({ persona, name: reading.name })
  }
  if (!known.has(asked.active)) return refuse('unknown-persona', `There is no persona "${asked.active}".`)

  const choice: PersonaChoice = { names, active: asked.active }
  const renamed = applyChoice(cast, choice).available
  const clash = renamed.find((persona, index) => renamed.some((other, at) => at > index && samePersonaName(persona.name, other.name)))
  if (clash) return refuse('name-taken', `Two personas would be called "${clash.name}".`)

  return { ok: true, choice }
}

/**
 * The personas as a choice leaves them. What the choice says about a persona that no longer exists is skipped,
 * so a record written by another version never breaks this one.
 */
export function applyChoice(cast: Cast, choice: PersonaChoice): Cast {
  const available = cast.available.map((persona) => {
    const given = choice.names.find((name) => name.persona === persona.id)
    return given ? { ...persona, name: given.name } : persona
  })
  const active = available.some((persona) => persona.id === choice.active) ? choice.active : cast.active
  return { available, active }
}

function refuse(code: CommandError['code'], message: string): ChoiceCheck {
  return { ok: false, error: { code, message } }
}
