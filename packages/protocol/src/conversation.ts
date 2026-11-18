import { z } from 'zod'
import { attachedSchema } from './files.ts'
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
  /** What the user handed over with it: files and folders. */
  attached: z.array(attachedSchema).optional(),
  /**
   * Why the assistant started this turn itself, when it did: the greeting and briefing when the app opens, a
   * reminder ringing, a task the person scheduled, whose request is then in `said`, or work taken up again after the
   * app restarted, the request it carries on in `said`.
   */
  trigger: z.enum(['greeting', 'reminder', 'task', 'resume']).optional(),
  /** What the assistant said aloud, so far: short, as a friend says it. */
  replied: z.string(),
  /**
   * The full answer, written for reading: complete, with the figures, sources and details the spoken reply leaves
   * out. Only a thread's answer that has more to it than what was said carries one; small talk does not.
   */
  written: z.string().optional(),
  outcome: z.enum(TURN_OUTCOMES),
  /** Why it could not answer, in words for the user. Only when the outcome is 'failed'. */
  problem: z.string().optional()
})
export type Exchange = z.infer<typeof exchangeSchema>

/** How hard a model reasons before it answers: a level the user can choose, described in plain words. */
export const harnessEffortSchema = z.object({
  /** What the harness's program is given for it: "high", "xhigh". */
  id: z.string().min(1).max(32),
  name: z.string(),
  description: z.string()
})
export type HarnessEffort = z.infer<typeof harnessEffortSchema>

/** A model the user can choose for the assistant's answers, described in plain words. */
export const harnessModelSchema = z.object({
  /** What the harness's program is given to run on it. */
  id: z.string().min(1).max(100),
  name: z.string(),
  /** What it is good for, in a few words for someone who does not follow AI news. */
  description: z.string(),
  /** The levels of reasoning it offers, from the lightest to the deepest. Empty when it offers no choice. */
  efforts: z.array(harnessEffortSchema).optional(),
  /** The level it reasons at when the user has not chosen, when the harness says. */
  defaultEffort: z.string().optional()
})
export type HarnessModel = z.infer<typeof harnessModelSchema>

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
  problem: z.string().optional(),
  /** The models the user can choose from for the answers. */
  models: z.array(harnessModelSchema).default([]),
  /** The one the answers use when the user has not chosen. */
  defaultModel: z.string().optional(),
  /** The one the answers use now: the user's choice, or the default. */
  model: z.string().optional(),
  /**
   * The level of reasoning the answers use now, among those of `model`: the user's choice, else the model's
   * default when the harness says. Left out, the program decides.
   */
  effort: z.string().optional()
})
export type HarnessState = z.infer<typeof harnessStateSchema>

/** The harnesses on the machine of the core, and the one the assistant runs on. */
export const enginesSchema = z.object({
  harnesses: z.array(harnessStateSchema),
  /** The one in use: the user's choice when it can be used, otherwise the first that can. Left out when none can. */
  active: z.string().optional()
})
export type Engines = z.infer<typeof enginesSchema>

/**
 * One tool call made while the assistant answered a turn: what was asked of the tool and what it gave back,
 * whole, for those who want to see the work behind an answer.
 */
export const stepSchema = z.object({
  /** Identifies the call, as the harness named it. */
  call: z.string().min(1).max(128),
  turn: turnIdSchema,
  /** The thread that made it. Left out for the session that hears every turn. */
  thread: z.string().min(1).max(64).optional(),
  /** The tool, by the name the core serves it under: 'web_search', 'ui_render'. */
  tool: z.string(),
  /** What the tool was given, as the session wrote it. */
  input: z.unknown().optional(),
  /** What the tool gave back, as text, cut when it is very long. Left out while it runs. */
  output: z.string().optional(),
  /** Whether the tool said it failed. */
  failed: z.boolean().optional(),
  /** For a use of the computer: the activity's record of it, with what was decided and the files it changed. */
  use: z.string().min(1).max(64).optional(),
  /** When it started and ended: ISO 8601 dates in UTC. */
  at: z.string(),
  ended: z.string().optional()
})
export type Step = z.infer<typeof stepSchema>
