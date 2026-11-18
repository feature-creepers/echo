import {
  type Access,
  accessSchema,
  type CommandError,
  type CommandInput,
  DEFAULT_INTERRUPTIONS,
  DEFAULT_LANGUAGES,
  type Interruptions,
  interruptionsSchema,
  type Languages,
  languagesSchema,
  type Persona,
  type Settings
} from '@repo/protocol'
import { z } from 'zod'
import { applyChoice, checkChoice, PERSONAS_SET, type PersonaChoice, readChoice } from '../personas/choice.ts'
import { DEFAULT_PERSONAS } from '../personas/defaults.ts'
import type { Records } from '../ports/records.ts'

/** A change of access: what is left out, or undefined, keeps its value. */
export type AccessChange = { [Name in Exclude<keyof Access, 'folder'>]?: Access[Name] | undefined }

export type SettingsChange = { ok: true; settings: Settings } | { ok: false; error: CommandError }

/** The type of the record written when the user picks the harness to run on, or lets the core pick. */
export const ENGINES_PREFERRED = 'engines.preferred'
/** The type of the record written when the user picks the model a harness answers with, or goes back to its default. */
export const ENGINES_MODEL = 'engines.model'
/** The type of the record written when the user picks how hard a harness's answers reason, or goes back to the model's default. */
export const ENGINES_EFFORT = 'engines.effort'
/** The type of the record written when the user changes what the assistant may reach on the computer. It carries the whole of it. */
export const ACCESS_SET = 'access.set'
/**
 * Written in each `access.set` record since approvals have three levels. Before, `trust` with the whole computer
 * to change let commands run without asking: a record without it reads that as `auto`.
 */
const ACCESS_LEVELS = 3
/** The type of the record written when the user sets the languages of the conversation. It carries both. */
export const LANGUAGES_SET = 'languages.set'
/** The type of the record written when the user sets when the assistant speaks up by itself. It carries all of it. */
export const INTERRUPTIONS_SET = 'interruptions.set'

const preferredSchema = z.object({ harness: z.string().min(1).nullable() })
const modelSchema = z.object({ harness: z.string().min(1), model: z.string().min(1).nullable() })
const effortSchema = z.object({ harness: z.string().min(1), effort: z.string().min(1).nullable() })

/** The user's settings, as the rest of the core reads and changes them. */
export interface UserSettings {
  read(): Settings
  /** Name the personas and pick the one that answers. This also marks them as confirmed by the user. */
  setPersonas(asked: CommandInput<'personas.set'>): SettingsChange
  /** Run on this harness whenever it is ready, or on the first one ready (`null`). The harness is not checked here. */
  prefer(harness: string | null): Settings
  /** The model a harness answers with, or its default (`null`). Neither is checked here. */
  chooseModel(harness: string, model: string | null): Settings
  /** How hard a harness's answers reason, or the model's default (`null`). Neither is checked here. */
  chooseEffort(harness: string, effort: string | null): Settings
  /** What the assistant may reach on the computer. What is left out keeps its value. The places are not checked here. */
  setAccess(change: AccessChange): Settings
  /** The language the person speaks and the one the assistant answers in. What is left out keeps its value. */
  setLanguages(change: { [Name in keyof Languages]?: Languages[Name] | undefined }): Settings
  /** When the assistant speaks up by itself. What is left out keeps its value. */
  setInterruptions(change: { [Name in keyof Interruptions]?: Interruptions[Name] | undefined }): Settings
  /** Be told each time the settings change. Returns a function that stops the telling. */
  onChange(listener: (settings: Settings) => void): () => void
}

/**
 * The user's settings: the defaults, then every choice the user recorded, in order.
 *
 * Only choices are kept, never the defaults, so a user who never renamed a persona gets its default name
 * as each version of the product defines it, and one who never chose a model gets the default model of
 * each version.
 */
export function createUserSettings(
  records: Records,
  defaults: readonly [Persona, ...Persona[]] = DEFAULT_PERSONAS,
  /** Where the assistant's own folder is on this computer, told with the settings. */
  folder?: string
): UserSettings {
  let settings: Settings = {
    revision: 0,
    personas: { available: [...defaults], active: defaults[0].id, confirmed: false },
    engines: { models: {}, efforts: {} },
    access: accessSchema.parse(folder === undefined ? {} : { folder }),
    languages: DEFAULT_LANGUAGES,
    interruptions: DEFAULT_INTERRUPTIONS
  }
  const listeners = new Set<(settings: Settings) => void>()

  // A record this version cannot read is skipped, so one written by another version never breaks this one.
  for (const record of records.read([PERSONAS_SET, ENGINES_PREFERRED, ENGINES_MODEL, ENGINES_EFFORT, ACCESS_SET, LANGUAGES_SET, INTERRUPTIONS_SET])) {
    if (record.type === INTERRUPTIONS_SET) {
      const read = interruptionsSchema.safeParse(record.payload)
      if (read.success) settings = { ...settings, revision: settings.revision + 1, interruptions: read.data }
    } else if (record.type === LANGUAGES_SET) {
      const read = languagesSchema.safeParse(record.payload)
      if (read.success) settings = { ...settings, revision: settings.revision + 1, languages: read.data }
    } else if (record.type === ACCESS_SET) {
      const read = accessSchema.omit({ folder: true }).safeParse(record.payload)
      if (read.success) settings = withAccess(settings, migrated(read.data, record.payload))
    } else if (record.type === PERSONAS_SET) {
      const choice = readChoice(record.payload)
      if (choice) settings = choose(settings, choice)
    } else if (record.type === ENGINES_PREFERRED) {
      const read = preferredSchema.safeParse(record.payload)
      if (read.success) settings = withPreferred(settings, read.data.harness)
    } else if (record.type === ENGINES_EFFORT) {
      const read = effortSchema.safeParse(record.payload)
      if (read.success) settings = withEffort(settings, read.data.harness, read.data.effort)
    } else {
      const read = modelSchema.safeParse(record.payload)
      if (read.success) settings = withModel(settings, read.data.harness, read.data.model)
    }
  }

  const change = (next: Settings, record: { type: string; payload: unknown }) => {
    records.append([record])
    settings = next
    for (const listener of listeners) listener(settings)
    return settings
  }

  return {
    read: () => settings,

    setPersonas(asked) {
      const check = checkChoice(settings.personas, asked)
      if (!check.ok) return check

      const next = choose(settings, check.choice)
      if (settings.personas.confirmed && sameCast(settings, next)) return { ok: true, settings }
      return { ok: true, settings: change(next, { type: PERSONAS_SET, payload: check.choice }) }
    },

    prefer(harness) {
      if ((settings.engines.preferred ?? null) === harness) return settings
      return change(withPreferred(settings, harness), { type: ENGINES_PREFERRED, payload: { harness } })
    },

    chooseModel(harness, model) {
      if ((settings.engines.models[harness] ?? null) === model) return settings
      return change(withModel(settings, harness, model), { type: ENGINES_MODEL, payload: { harness, model } })
    },

    chooseEffort(harness, effort) {
      if ((settings.engines.efforts[harness] ?? null) === effort) return settings
      return change(withEffort(settings, harness, effort), { type: ENGINES_EFFORT, payload: { harness, effort } })
    },

    setAccess(asked) {
      const next = withAccess(settings, asked)
      if (JSON.stringify(chosen(next.access)) === JSON.stringify(chosen(settings.access))) return settings
      return change(next, { type: ACCESS_SET, payload: { ...chosen(next.access), levels: ACCESS_LEVELS } })
    },

    setLanguages(asked) {
      const next: Languages = { spoken: asked.spoken ?? settings.languages.spoken, answers: asked.answers ?? settings.languages.answers }
      if (next.spoken === settings.languages.spoken && next.answers === settings.languages.answers) return settings
      return change({ ...settings, revision: settings.revision + 1, languages: next }, { type: LANGUAGES_SET, payload: next })
    },

    setInterruptions(asked) {
      const next: Interruptions = { results: asked.results ?? settings.interruptions.results }
      if (next.results === settings.interruptions.results) return settings
      return change({ ...settings, revision: settings.revision + 1, interruptions: next }, { type: INTERRUPTIONS_SET, payload: next })
    },

    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

function choose(settings: Settings, choice: PersonaChoice): Settings {
  const cast = applyChoice(settings.personas, choice)
  return { ...settings, revision: settings.revision + 1, personas: { available: [...cast.available], active: cast.active, confirmed: true } }
}

function withPreferred(settings: Settings, harness: string | null): Settings {
  const { preferred: _, ...rest } = settings.engines
  return { ...settings, revision: settings.revision + 1, engines: harness === null ? rest : { ...rest, preferred: harness } }
}

function withModel(settings: Settings, harness: string, model: string | null): Settings {
  const { [harness]: _, ...others } = settings.engines.models
  return { ...settings, revision: settings.revision + 1, engines: { ...settings.engines, models: model === null ? others : { ...others, [harness]: model } } }
}

function withEffort(settings: Settings, harness: string, effort: string | null): Settings {
  const { [harness]: _, ...others } = settings.engines.efforts
  return {
    ...settings,
    revision: settings.revision + 1,
    engines: { ...settings.engines, efforts: effort === null ? others : { ...others, [harness]: effort } }
  }
}

/** What the user chose about access: all of it but where the assistant's folder is, which the core tells. */
const chosen = ({ folder: _, ...choices }: Access) => choices

/** Access as recorded before approvals had three levels, read as it behaved then. */
export function migrated(access: Omit<Access, 'folder'>, payload: unknown): Omit<Access, 'folder'> {
  const levels = (payload as { levels?: unknown } | null)?.levels
  if (levels === undefined && access.approvals === 'trust' && access.computer === 'write') return { ...access, approvals: 'auto' }
  return access
}

function withAccess(settings: Settings, asked: AccessChange): Settings {
  const defined = Object.fromEntries(Object.entries(asked).filter(([, value]) => value !== undefined))
  return { ...settings, revision: settings.revision + 1, access: { ...settings.access, ...defined } }
}

function sameCast(one: Settings, other: Settings): boolean {
  return (
    one.personas.active === other.personas.active && one.personas.available.every((persona, index) => persona.name === other.personas.available[index]?.name)
  )
}
