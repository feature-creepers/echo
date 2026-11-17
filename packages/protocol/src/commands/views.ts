import { z } from 'zod'
import { viewSchema } from '../views.ts'

export const viewCommands = {
  /** Read what the assistant is showing now, if anything: for a client that connects after it was shown. */
  'view.read': {
    input: z.object({}),
    output: z.object({ view: viewSchema.optional(), margin: z.array(viewSchema).default([]) })
  },

  /** Remove what the assistant is showing on the stage, or one card of the margin. */
  'view.clear': {
    input: z.object({ view: z.string().min(1).max(64).optional() }),
    output: z.object({})
  }
}
