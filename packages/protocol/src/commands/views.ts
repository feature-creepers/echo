import { z } from 'zod'
import { viewSchema } from '../views.ts'

export const viewCommands = {
  /** Read what the assistant is showing now, if anything: for a client that connects after it was shown. */
  'view.read': {
    input: z.object({}),
    output: z.object({ view: viewSchema.optional() })
  },

  /** Remove what the assistant is showing. The user's way of clearing the screen. */
  'view.clear': {
    input: z.object({}),
    output: z.object({})
  }
}
