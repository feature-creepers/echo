import { z } from 'zod'

/**
 * What the assistant did on the computer, as the Activity page shows it (docs/SPEC.md, section 12.2): every use
 * of a file or a command, what was decided about it, and how it went. Kept 30 days.
 */

/** What was decided: it ran without asking, the person approved it, or it was refused. */
export const USE_DECISIONS = ['ran', 'approved', 'refused'] as const

/** Why, for each decision. */
export const USE_REASONS = [
  /** Ran: it only reads. */
  'read-only',
  /** Ran: the approval level lets it run without asking. */
  'level',
  /** Ran: the person allowed the same kind for the session. */
  'session',
  /** Approved with the card's button. */
  'pressed',
  /** Approved by saying or typing yes. */
  'said',
  /** Refused: it reaches beyond what was granted. */
  'outside',
  /** Refused: it reaches a place that is never reached. */
  'protected',
  /** Refused: the person said no. */
  'declined',
  /** Refused: nobody answered in time, or the person moved on. */
  'unanswered',
  /** Refused: the turn, or everything, was stopped. */
  'stopped'
] as const

export const useIdSchema = z.string().min(1).max(64)

export const accessUseSchema = z.object({
  id: useIdSchema,
  /** When it was decided: an ISO 8601 date. */
  at: z.string(),
  /** The thread that did it. */
  thread: z.string().optional(),
  /** The tool, as the harness or the core names it: Read, Write, Bash, apply_patch, a browser tool. */
  tool: z.string(),
  action: z.enum(['read', 'create', 'change', 'delete', 'run']),
  /** For a command, its line as it would run. */
  command: z.string().optional(),
  /** What it touches, absolute; for a command, the folder it runs in. */
  paths: z.array(z.string()),
  decision: z.enum(USE_DECISIONS),
  reason: z.enum(USE_REASONS),
  /** For a refusal, what the assistant was told. */
  detail: z.string().optional(),
  /** What the command was read as. */
  destructive: z.boolean().optional(),
  network: z.boolean().optional(),
  /** How it went, where the harness says: done, or failed with a short error. */
  outcome: z.object({ ok: z.boolean(), error: z.string().optional() }).optional(),
  /**
   * What can be undone: the file's previous version was kept (`restore`), or the file it created can go to the
   * trash (`trash`). `done` once it was, with when.
   */
  undo: z.object({ kind: z.enum(['restore', 'trash']), done: z.string().optional() }).optional()
})
export type AccessUse = z.infer<typeof accessUseSchema>
