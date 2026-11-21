import { z } from 'zod'

/**
 * A thread: a hidden working conversation, behind the single channel the user sees. The user never opens or closes
 * one; the assistant does, and the side panel shows them on request. What it answers is filed in a topic
 * (`topics.ts`), which is what the person sees.
 */
export const threadIdSchema = z.string().min(1).max(64)

const THREAD_KINDS = [
  /** It answers the person: a recipe, a form, a trip, a quick question. */
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
   * The topic its answers are filed in. A sub-thread has none: it works for its thread's. A thread recorded before
   * there were topics has none either: it is read as a topic of its own, under its own identifier.
   */
  topic: z.string().min(1).max(64).optional(),
  /**
   * For a project: the folder the thread works in, absolute, as the system names it. Its session runs there, reads
   * the folder's own instructions for those who work in it, and works on its files as a developer would.
   */
  folder: z.string().min(1).max(4096).optional(),
  /** Put away by the person: the side sheet folds it under Archived. Work on it brings it back. */
  archived: z.boolean().optional(),
  /** When it was last used: an ISO 8601 date in UTC. */
  at: z.string()
})
export type Thread = z.infer<typeof threadSchema>

export const threadsSchema = z.object({
  /** The most recent first. */
  threads: z.array(threadSchema),
  /** The thread the person last turned to: the one that answered them last, or that they brought back. */
  focus: threadIdSchema.optional()
})
export type Threads = z.infer<typeof threadsSchema>
