import type { CommandError, CommandInput, Persona, Settings } from '@repo/protocol'
import { applyChoice, checkChoice, PERSONAS_SET, type PersonaChoice, readChoice } from '../personas/choice.ts'
import { DEFAULT_PERSONAS } from '../personas/defaults.ts'
import type { Records } from '../ports/records.ts'

export type SettingsChange = { ok: true; settings: Settings } | { ok: false; error: CommandError }

/** The user's settings, as the rest of the core reads and changes them. */
export interface UserSettings {
  read(): Settings
  /** Name the personas and pick the one that answers. This also marks them as confirmed by the user. */
  setPersonas(asked: CommandInput<'personas.set'>): SettingsChange
  /** Be told each time the settings change. Returns a function that stops the telling. */
  onChange(listener: (settings: Settings) => void): () => void
}

/**
 * The user's settings: the defaults, then every choice the user recorded, in order.
 *
 * Only choices are kept, never the defaults, so a user who never renamed a persona gets its default name
 * as each version of the product defines it.
 */
export function createUserSettings(records: Records, defaults: readonly [Persona, ...Persona[]] = DEFAULT_PERSONAS): UserSettings {
  let settings: Settings = { revision: 0, personas: { available: [...defaults], active: defaults[0].id, confirmed: false } }
  const listeners = new Set<(settings: Settings) => void>()

  for (const record of records.read([PERSONAS_SET])) {
    const choice = readChoice(record.payload)
    if (choice) settings = choose(settings, choice)
  }

  return {
    read: () => settings,

    setPersonas(asked) {
      const check = checkChoice(settings.personas, asked)
      if (!check.ok) return check

      const next = choose(settings, check.choice)
      if (settings.personas.confirmed && sameCast(settings, next)) return { ok: true, settings }

      records.append([{ type: PERSONAS_SET, payload: check.choice }])
      settings = next
      for (const listener of listeners) listener(settings)
      return { ok: true, settings }
    },

    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

function choose(settings: Settings, choice: PersonaChoice): Settings {
  const cast = applyChoice(settings.personas, choice)
  return { revision: settings.revision + 1, personas: { available: [...cast.available], active: cast.active, confirmed: true } }
}

function sameCast(one: Settings, other: Settings): boolean {
  return (
    one.personas.active === other.personas.active && one.personas.available.every((persona, index) => persona.name === other.personas.available[index]?.name)
  )
}
