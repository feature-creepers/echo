import { z } from 'zod'
import { turnIdSchema } from './conversation.ts'
import { clockTimeSchema } from './schedule.ts'

/**
 * What the assistant knows about the user, as a client sees it: the facts true now, where each was
 * learned, and when the assistant sleeps to make sense of what it heard (docs/SPEC.md, section 10).
 */

/** What a fact is about. The order is the order a client shows them in. */
export const FACT_KINDS = [
  /** Someone in the user's life, and who they are to them. */
  'person',
  /** What the user likes, dislikes, or wants done a certain way. */
  'preference',
  /** Something the user is working on. */
  'project',
  /** A commitment or an event with its date. */
  'date',
  /** A decision the user kept after the assistant objected, so the objection is not raised again. */
  'override',
  /** Anything else worth keeping. */
  'other'
] as const
export const factKindSchema = z.enum(FACT_KINDS)
export type FactKind = z.infer<typeof factKindSchema>

export const factIdSchema = z.string().min(1).max(64)

/** The longest a fact can be, in characters. A fact is one short statement. */
export const FACT_MAX_LENGTH = 500

/** How a fact came to be known, or last changed. */
export const FACT_ORIGINS = [
  /** Made sense of while the assistant slept, from what the user said. */
  'conversation',
  /** The user asked the assistant to remember it. */
  'told',
  /** The user corrected it by hand. */
  'edited',
  /** Brought in from what the proof of concept knew: its notes, or the user's context file. */
  'imported'
] as const

/** A turn a fact was learned from: when, and what the user said, shortened. */
const factSourceSchema = z.object({
  turn: turnIdSchema,
  /** When it was said: an ISO 8601 date in UTC. */
  at: z.string(),
  /** What the user said, shortened. Left out when the line is no longer in the log. */
  said: z.string().optional()
})

/** A short statement about the user, true now. */
const factSchema = z.object({
  id: factIdSchema,
  text: z.string().min(1).max(FACT_MAX_LENGTH),
  kind: factKindSchema,
  origin: z.enum(FACT_ORIGINS),
  /** When it was first learned. */
  since: z.string(),
  /** When it last changed. */
  at: z.string(),
  sources: z.array(factSourceSchema)
})
export type Fact = z.infer<typeof factSchema>

/** When the assistant falls asleep to make sense of what it heard. */
const SLEEP_MODES = [
  /** After a quiet period with no exchange. */
  'quiet',
  /** At a set time of day. */
  'time',
  /** Whichever of the two comes first. */
  'quiet-or-time',
  /** Only when the user says so. */
  'asked',
  /** Never: only what the user asks it to remember is kept as a fact. */
  'never'
] as const
export type SleepMode = (typeof SLEEP_MODES)[number]

export const sleepSettingsSchema = z.object({
  when: z.enum(SLEEP_MODES),
  /** How long a quiet period lasts before it sleeps, in minutes. */
  quietMinutes: z.number().int().min(1).max(1440),
  /** The time of day it sleeps at, as HH:MM on the core's clock. */
  time: clockTimeSchema
})
export type SleepSettings = z.infer<typeof sleepSettingsSchema>

/** How many days the conversation's words are kept, from a month to ten years. */
export const retentionDaysSchema = z.number().int().min(1).max(3650)

/** The periods a client offers for keeping the conversation, in days, shortest first. Kept for good is offered besides. */
export const RETENTION_CHOICES = [30, 90, 180, 365, 730] as const

/** What an import of the proof of concept's files brought in: facts from its notes and context, lines of its history. */
export const importSchema = z.object({
  at: z.string(),
  facts: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative()
})
export type MemoryImport = z.infer<typeof importSchema>

/** How many records of a kind can be found by meaning, of those there are. */
const meaningCountSchema = z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })

/** The model search by meaning runs, as the person is told of it before downloading it. */
const meaningModelSchema = z.object({
  name: z.string(),
  /** The size of its download. */
  bytes: z.number().int().nonnegative(),
  /** Where it is downloaded from. */
  source: z.string(),
  licence: z.string()
})

/**
 * Search by meaning (docs/SPEC.md, section 10.4): whether its model is here, and how much of the memory it can find.
 * Nothing is downloaded until the person asks.
 */
const meaningSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('absent'),
    model: meaningModelSchema,
    /** Why the last download failed, in words for the person. Left out once another starts. */
    failed: z.string().optional()
  }),
  z.object({ state: z.literal('downloading'), model: meaningModelSchema, received: z.number().nonnegative(), total: z.number().nonnegative() }),
  /** The lines of the log, and the facts, that have a vector: the rest is found by keyword until the next sleep. */
  z.object({ state: z.literal('ready'), model: meaningModelSchema, lines: meaningCountSchema, facts: meaningCountSchema }),
  /** It cannot run where the core runs, and why, in the core's words. */
  z.object({ state: z.literal('unavailable'), model: meaningModelSchema, why: z.string() })
])
export type Meaning = z.infer<typeof meaningSchema>

/** Everything the assistant knows about the user, as a client shows it. */
export const memoryViewSchema = z.object({
  /** Goes up with each change, so a client holding two copies keeps the later one. */
  revision: z.number().int().nonnegative(),
  /** The facts true now, by kind, in the order of `FACT_KINDS`. A kind with no fact is left out. */
  groups: z.array(z.object({ kind: factKindSchema, facts: z.array(factSchema) })),
  /** The short portrait drawn from the facts and given to every session. Left out until there is one. */
  profile: z.string().optional(),
  sleep: sleepSettingsSchema,
  /** How many days the conversation's words are kept, or null to keep them for good. */
  retentionDays: retentionDaysSchema.nullable(),
  /** The latest import of what the proof of concept knew: when, and how much it brought in. Left out until one is done. */
  imported: importSchema.optional(),
  /** Search by meaning. Left out by a core that offers none. */
  meaning: meaningSchema.optional()
})
export type MemoryView = z.infer<typeof memoryViewSchema>

/** Whether the assistant is asleep, and how far its work has gone. */
export const assistantStateSchema = z.object({
  asleep: z.boolean(),
  /** When it fell asleep. */
  since: z.string().optional(),
  /** The exchanges this sleep is making sense of, and how many it has been through. Left out once it is done. */
  work: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).optional(),
  /** When a sleep last finished its work. */
  lastSlept: z.string().optional()
})
export type AssistantState = z.infer<typeof assistantStateSchema>
