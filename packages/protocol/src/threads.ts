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

/**
 * A thread's copy of the repository its project is in (docs/SPEC.md, section 7.11): a git worktree on a branch of its
 * own, kept in the app's data, so that it works beside another thread without getting in its way.
 */
const threadCopySchema = z.object({
  /** Where the thread works in the copy: the project's folder as the copy holds it, absolute. */
  folder: z.string().min(1).max(4096),
  /** The branch the copy is on, made for it. It stays when the copy is removed. */
  branch: z.string().min(1).max(255),
  /** Where it started: the commit the project's folder was on, and its branch, when it was on one. */
  start: z.object({ commit: z.string().min(1).max(64), branch: z.string().min(1).max(255).optional() })
})
export type ThreadCopy = z.infer<typeof threadCopySchema>

/**
 * A copy of a repository kept in the app's data, as Settings lists it (docs/SPEC.md, section 7.11): a thread's, or a
 * folder left there that no thread names.
 */
export const keptCopySchema = z.object({
  /** Where it is, absolute: it is removed by it. */
  folder: z.string().min(1).max(4096),
  /** The thread that works in it, the project's folder it is a copy of and its branch. Left out for a folder no thread names. */
  thread: z.object({ id: threadIdSchema, title: z.string(), project: z.string(), branch: z.string() }).optional(),
  /** The room it takes, in bytes. Left out when it holds more files than are counted. */
  size: z.number().int().nonnegative().optional(),
  /** What removing it would lose, in words for the person. Left out when nothing would be: what was committed stays on its branch. */
  holds: z.string().optional()
})
export type KeptCopy = z.infer<typeof keptCopySchema>

/**
 * How long a thread is left alone before it counts as put away, in milliseconds: the side panel then folds it under
 * Archived by itself, and its copy of a repository is removed when nothing in it would be lost.
 */
export const IDLE_ARCHIVES_MS = 7 * 86_400_000

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
  /**
   * For a project's thread that works beside another, or was asked to: its copy of the repository. Its session runs
   * there; `folder` stays the project's own.
   */
  copy: threadCopySchema.optional(),
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
