import { z } from 'zod'
import { allowanceSchema, protectedPlaceSchema } from '../access.ts'
import { accessUseSchema, activityCheckSchema, fileChangeSchema, fileDiffSchema, fileVersionSchema, useIdSchema } from '../activity.ts'
import { turnIdSchema } from '../conversation.ts'

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
   * What a use changed, file by file, as diffs: the version kept before it against the version it left. With a
   * turn instead, what every use of that turn changed, each file once, from before the first change to it to after
   * the last. A use that changed no file has none.
   */
  'activity.diff': {
    input: z.union([z.object({ use: useIdSchema }), z.object({ turn: turnIdSchema })]),
    output: z.object({ files: z.array(fileDiffSchema) })
  },

  /**
   * The versions the core kept of one file, by where it is: the one each change left, the latest first, and the one
   * before the first change kept.
   */
  'activity.versions': {
    input: z.object({ path: z.string().min(1).max(4096) }),
    output: z.object({ versions: z.array(fileVersionSchema) })
  },

  /**
   * Put a kept version of a file back, as the person asked: what the file held is kept first, and the restoring is a
   * use of its own in the activity, so it can be undone in turn. `gone` when that version is no longer kept.
   */
  'activity.restore': {
    input: z.object({ use: useIdSchema, path: z.string().min(1).max(4096), side: z.enum(['before', 'after']) }),
    output: z.object({ outcome: z.enum(['done', 'gone']), versions: z.array(fileVersionSchema) })
  },

  /**
   * What each turn given changed on the computer: its uses that created, changed or deleted a file, and the files
   * as the turn left them, each once, with the lines it added and removed in all.
   */
  'activity.changes': {
    input: z.object({ turns: z.array(turnIdSchema).max(50) }),
    output: z.object({
      turns: z.array(z.object({ turn: turnIdSchema, uses: z.array(accessUseSchema), files: z.array(fileChangeSchema) }))
    })
  },

  /** Check the activity's chain: whether any record kept was changed, taken out or erased before its time. */
  'activity.check': {
    input: z.object({}),
    output: activityCheckSchema
  },

  /**
   * The whole activity kept, with its seals and the chain's check, as one JSON document to save: `name` is the file
   * name it suggests.
   */
  'activity.export': {
    input: z.object({}),
    output: z.object({ name: z.string(), text: z.string() })
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
