import { z } from 'zod'

/**
 * A thread: a hidden working conversation about one topic, behind the single channel the user sees.
 * The user never opens or closes one; the assistant does, and the activity panel shows them on request.
 */
export const threadIdSchema = z.string().min(1).max(64)

export const THREAD_KINDS = [
  /** A topic the conversation can come back to: a recipe, a form, a trip. */
  'topic',
  /** A side question answered without leaving the current topic. Its view goes in the margin. */
  'aside'
] as const

export const THREAD_STATES = [
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
