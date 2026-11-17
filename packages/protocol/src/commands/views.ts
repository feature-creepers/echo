import { z } from 'zod'
import { viewSchema } from '../views.ts'

export const viewCommands = {
  /** Read a file the assistant wrote: its latest version, for a preview or a download. */
  'file.read': {
    input: z.object({ file: z.string().min(1).max(64) }),
    output: z.object({ name: z.string(), mime: z.string(), format: z.enum(['markdown', 'text', 'csv']), version: z.number().int(), text: z.string() })
  },

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
