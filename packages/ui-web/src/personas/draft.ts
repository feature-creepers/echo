import { type CommandInput, type Persona, type PersonaId, type PersonaNameProblem, readPersonaName, samePersonaName } from '@repo/protocol'

/**
 * What the user changed in the form and has not sent yet: only their own edits.
 * A persona they did not rename, and the choice of who answers if they did not make one, keep following
 * the settings, so a change made on another device meanwhile is shown and is never undone by this form.
 */
export interface PersonaDraft {
  /** The names typed, exactly as typed, for the personas the user renamed. */
  names: Readonly<Record<PersonaId, string>>
  /** The persona picked to answer, when the user picked one. */
  active?: PersonaId
}

/**
 * A name as it is typed, put in the form names are kept in as the user types: capitals, no accents, and a
 * hyphen for a space. Surrounding hyphens are left for the field to point out, since trimming as the user types
 * would swallow the space between two words.
 */
export function asTyped(typed: string): string {
  return typed
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s/g, '-')
    .toUpperCase()
}

/** A draft with no edit in it. */
export const NO_EDITS: PersonaDraft = { names: {} }

/** Why a name cannot be kept: it cannot be given to a persona at all, or another persona already has it. */
export type NameProblem = PersonaNameProblem | 'taken'

/** The name the form shows for a persona: what the user typed, or else the name it has. */
export function nameIn(draft: PersonaDraft, persona: Persona): string {
  return draft.names[persona.id] ?? persona.name
}

/** The persona the form shows as answering: the one the user picked, or else the one that answers now. */
export function activeIn(draft: PersonaDraft, active: PersonaId): PersonaId {
  return draft.active ?? active
}

/**
 * What is wrong with the names, by persona. Empty when the draft can be sent.
 *
 * The same rules as the core, applied first on the device so the user is told next to the field, as they type.
 * When two personas share a name, the later one is the one told.
 */
export function problemsOf(personas: readonly Persona[], draft: PersonaDraft): Partial<Record<PersonaId, NameProblem>> {
  const problems: Partial<Record<PersonaId, NameProblem>> = {}
  const kept: string[] = []
  for (const persona of personas) {
    const reading = readPersonaName(nameIn(draft, persona))
    if (!reading.ok) problems[persona.id] = reading.problem
    else if (kept.some((name) => samePersonaName(name, reading.name))) problems[persona.id] = 'taken'
    else kept.push(reading.name)
  }
  return problems
}

/** The draft as the command that sends it: the names the user typed, and who answers. */
export function choiceOf(personas: readonly Persona[], active: PersonaId, draft: PersonaDraft): CommandInput<'personas.set'> {
  const names = personas.flatMap((persona) => {
    const typed = draft.names[persona.id]
    return typed === undefined ? [] : [{ persona: persona.id, name: typed }]
  })
  return { names, active: activeIn(draft, active) }
}
