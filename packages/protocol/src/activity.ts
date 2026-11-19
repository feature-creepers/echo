import { z } from 'zod'
import { turnIdSchema } from './conversation.ts'

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
  /** Refused: it reaches a destination on the network the person refused. */
  'destination',
  /** Refused: the person said no. */
  'declined',
  /** Refused: nobody answered in time, or the person moved on. */
  'unanswered',
  /** Refused: the turn, or everything, was stopped. */
  'stopped'
] as const

export const useIdSchema = z.string().min(1).max(64)

/**
 * A file as a change left it, in numbers: whether the change created, changed or deleted it, and how many lines it
 * added and removed. A file that is not text, or too large to compare, has no lines counted, and says why.
 */
export const fileChangeSchema = z.object({
  /** Where it is, absolute. */
  path: z.string(),
  status: z.enum(['created', 'changed', 'deleted']),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  /** It is not text: a NUL byte in its first 8 KB, or not UTF-8. */
  binary: z.boolean().optional(),
  /** It is too large to compare. */
  large: z.boolean().optional()
})
export type FileChange = z.infer<typeof fileChangeSchema>

/**
 * A version of a file the core kept (docs/SPEC.md, section 9.7): the one a change left, or the one before the first
 * change it kept of the file. Kept 30 days, as the activity is.
 */
export const fileVersionSchema = z.object({
  /** The use that left it, or before which it was kept. */
  use: useIdSchema,
  /** When: an ISO 8601 date. */
  at: z.string(),
  /** The version the change left (`after`), or the one before the first change kept (`before`). */
  side: z.enum(['before', 'after']),
  /** What made the change: the tool, as the activity names it. */
  tool: z.string(),
  /** For a command, its line. */
  command: z.string().optional(),
  /** What the change did to the file, in numbers. Left out for the version before. */
  change: fileChangeSchema.optional(),
  /** Whether it can be put back: its content was kept, and it is not a file deleted. */
  restorable: z.boolean()
})
export type FileVersion = z.infer<typeof fileVersionSchema>

/** The tool that puts a kept version of a file back, as the person asked, as the activity names it. */
export const RESTORE_TOOL = 'Restore'

export const accessUseSchema = z.object({
  id: useIdSchema,
  /** When it was decided: an ISO 8601 date. */
  at: z.string(),
  /** The thread that did it. */
  thread: z.string().optional(),
  /** The turn that did it, the thread answering it. */
  turn: turnIdSchema.optional(),
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
  undo: z.object({ kind: z.enum(['restore', 'trash']), done: z.string().optional() }).optional(),
  /** For a change made, each file it left, with the lines it added and removed. Left out for a change kept before they were counted. */
  changes: z.array(fileChangeSchema).optional()
})
export type AccessUse = z.infer<typeof accessUseSchema>

/**
 * A stretch of a file's diff: the lines that changed and three unchanged lines around them, as a unified diff shows
 * them. Each line is written as a unified diff writes it: a space before a line kept, `+` before a line added, `-`
 * before a line removed. A line that is only `\\` says the line before it has no end of line, as the last line of
 * a file may not.
 */
export const hunkSchema = z.object({
  /** Where it starts in the version before and in the version after, as a line number counting from 1, and how many lines of each it spans. */
  before: z.object({ start: z.number().int().nonnegative(), count: z.number().int().nonnegative() }),
  after: z.object({ start: z.number().int().nonnegative(), count: z.number().int().nonnegative() }),
  lines: z.array(z.string())
})
export type Hunk = z.infer<typeof hunkSchema>

/** What a change did to one file, line by line: the version kept before it against the version it left. */
export const fileDiffSchema = fileChangeSchema.extend({
  hunks: z.array(hunkSchema),
  /** How many lines each version has, so the lines unchanged after the last stretch can be counted. */
  lines: z.object({ before: z.number().int().nonnegative(), after: z.number().int().nonnegative() }),
  /** The diff stops short of the end: it was too long to show whole. */
  cut: z.boolean().optional(),
  /** Some lines were too long to show whole, and are shown in part. */
  clipped: z.boolean().optional(),
  /** The line endings changed, between CRLF and LF. When there is no stretch, they are all that changed. */
  endings: z.boolean().optional(),
  /** The version the change left was not kept, so it is compared with the file as it is now. */
  now: z.boolean().optional(),
  /** There is nothing to compare: the versions were not kept, or are gone. */
  missing: z.boolean().optional()
})
export type FileDiff = z.infer<typeof fileDiffSchema>

/**
 * Whether the activity's chain holds (docs/SPEC.md, section 12.2, the signed log): `intact` when every record kept
 * since the first sealed one matches its seal, `broken` with where and why when one does not, `empty` with nothing
 * kept. `head` is the last hash, to hold the log to later; records from before the chain are counted apart.
 */
export const activityCheckSchema = z.object({
  state: z.enum(['intact', 'broken', 'empty']),
  sealed: z.number().int().min(0),
  unsealed: z.number().int().min(0),
  head: z.string().nullable(),
  since: z.string().optional(),
  problem: z
    .object({
      at: z.string(),
      /** `changed`: a record no longer matches its seal; `missing`: one was taken out or moved; `erased`: emptied before its 30 days; `unsealed`: written without a seal. */
      reason: z.enum(['changed', 'missing', 'erased', 'unsealed'])
    })
    .optional()
})
export type ActivityCheck = z.infer<typeof activityCheckSchema>
