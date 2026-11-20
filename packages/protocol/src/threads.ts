import { z } from 'zod'

/**
 * A thread: a hidden working conversation about one topic, behind the single channel the user sees.
 * The user never opens or closes one; the assistant does, and the activity panel shows them on request.
 */
export const threadIdSchema = z.string().min(1).max(64)

const THREAD_KINDS = [
  /**
   * A topic the conversation can come back to: a recipe, a form, a trip. A side question is one too, opened beside the
   * topic on the stage without taking its place (`beside`).
   */
  'topic',
  /**
   * Part of a topic's work, handed by its thread to a thread of its own so both go on at once. It answers that thread,
   * never the person: nothing it writes is said, and its result goes back to the thread that opened it.
   */
  'subthread'
] as const

const THREAD_STATES = [
  /** It is answering. */
  'working',
  /** It finished while another topic was in focus: its answer is waiting to be seen. */
  'ready',
  /** Idle. */
  'parked'
] as const

export const threadSchema = z.object({
  id: threadIdSchema,
  title: z.string(),
  kind: z.enum(THREAD_KINDS),
  state: z.enum(THREAD_STATES),
  /** For a sub-thread: the thread that opened it, which it works for. */
  parent: threadIdSchema.optional(),
  /**
   * For a topic opened for a side question (docs/SPEC.md, section 7.5): the topic on the stage when it was asked, which
   * kept the stage. The side sheet lists it under that topic.
   */
  beside: threadIdSchema.optional(),
  /**
   * For a project: the folder the thread works in, absolute, as the system names it. Its session runs there, reads
   * the folder's own instructions for those who work in it, and works on its files as a developer would.
   */
  folder: z.string().min(1).max(4096).optional(),
  /** When it was last used: an ISO 8601 date in UTC. */
  at: z.string()
})
export type Thread = z.infer<typeof threadSchema>

export const threadsSchema = z.object({
  /** The most recent first. */
  threads: z.array(threadSchema),
  /** The topic on the stage. */
  focus: threadIdSchema.optional()
})
export type Threads = z.infer<typeof threadsSchema>
