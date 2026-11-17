import { z } from 'zod'
import { personaIdSchema } from './personas.ts'

/**
 * The one conversation between the user and the assistant, as a client sees it: what was said, what was
 * answered, and where the assistant stands now.
 */

export const turnIdSchema = z.string().min(1).max(64)
export type TurnId = z.infer<typeof turnIdSchema>

/** The longest thing a user can say in one go, in characters. */
export const UTTERANCE_MAX_LENGTH = 8000

/** A two-letter language code, such as 'en' or 'fr'. */
export const languageSchema = z.string().regex(/^[a-z]{2}$/)

/** How a turn ended, or that it has not yet. */
export const TURN_OUTCOMES = [
  /** The assistant is still answering. */
  'running',
  /** It answered. */
  'done',
  /** The user stopped it, by saying or doing something else. */
  'stopped',
  /** It could not answer. */
  'failed'
] as const

/** One thing the user said and what the assistant answered: a line of the transcript. */
export const exchangeSchema = z.object({
  turn: turnIdSchema,
  /** When the user said it: an ISO 8601 date in UTC. */
  at: z.string(),
  /** The persona that answered. */
  persona: personaIdSchema,
  /** The thread that answered. Left out when the assistant answered at once, without one. */
  thread: z.string().min(1).max(64).optional(),
  /** What the user said. Empty when the assistant started the turn itself: see `trigger`. */
  said: z.string(),
  /** Why the assistant started this turn itself, when it did: the greeting and briefing when the app opens. */
  trigger: z.enum(['greeting']).optional(),
  /** What the assistant said aloud, so far. */
  replied: z.string(),
  outcome: z.enum(TURN_OUTCOMES),
  /** Why it could not answer, in words for the user. Only when the outcome is 'failed'. */
  problem: z.string().optional()
})
export type Exchange = z.infer<typeof exchangeSchema>

/** An AI agent program the assistant can run on, and whether it can be used. */
export const harnessStateSchema = z.object({
  /** Identifies it: 'claude-code', 'codex'. */
  id: z.string().min(1).max(64),
  /** Its name, as the user knows it. */
  name: z.string(),
  installed: z.boolean(),
  signedIn: z.boolean(),
  version: z.string().optional(),
  account: z.string().optional(),
  /** Why it cannot be used, in words for the user. */
  problem: z.string().optional()
})
export type HarnessState = z.infer<typeof harnessStateSchema>

/** The harnesses on the machine of the core, and the one the assistant runs on. */
export const enginesSchema = z.object({
  harnesses: z.array(harnessStateSchema),
  /** The one in use: the user's choice when it can be used, otherwise the first that can. Left out when none can. */
  active: z.string().optional()
})
export type Engines = z.infer<typeof enginesSchema>
