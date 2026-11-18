import { z } from 'zod'
import { allowanceSchema, protectedPlaceSchema } from '../access.ts'
import { accessUseSchema, useIdSchema } from '../activity.ts'

const standingOutput = z.object({ allowances: z.array(allowanceSchema), protected: z.array(protectedPlaceSchema) })

export const accessCommands = {
  /** What was allowed for this session, and the places never reached on this computer. */
  'access.read': {
    input: z.object({}),
    output: standingOutput
  },

  /** Take back something allowed for the session: it is asked again. */
  'access.forget': {
    input: z.object({ allowance: z.string().min(1).max(64) }),
    output: standingOutput
  },

  /** What the assistant did on the computer, the latest first, from before the use given when there is one. */
  'activity.read': {
    input: z.object({ limit: z.number().int().min(1).max(500).default(200), before: useIdSchema.optional() }),
    output: z.object({ uses: z.array(accessUseSchema), more: z.boolean() })
  },

  /**
   * Undo a use: put back the file's previous version, or move a file it created to the core's trash. When the
   * file changed since, nothing is done and `changed` says so, unless `anyway`.
   */
  'activity.undo': {
    input: z.object({ use: useIdSchema, anyway: z.boolean().default(false) }),
    output: z.object({ outcome: z.enum(['done', 'changed', 'gone']), use: accessUseSchema.optional() })
  },

  /**
   * Stop everything: every turn and thread is interrupted, every question waiting is withdrawn, the session's
   * approvals are forgotten, and what runs on its own is paused.
   */
  'everything.stop': {
    input: z.object({}),
    output: z.object({})
  }
}
