import { z } from 'zod'
import { exchangeSchema, stepSchema } from '../conversation.ts'
import { threadIdSchema, threadSchema, threadsSchema } from '../threads.ts'
import { viewSchema } from '../views.ts'

export const threadCommands = {
  /** Read the threads, most recent first, and the one in focus. */
  'threads.read': {
    input: z.object({}),
    output: threadsSchema
  },

  /**
   * Read one thread whole, for the side sheet: every exchange it answered with its full written answer, every
   * tool call it made with what went in and came out, and the views it showed. Asides included.
   */
  'thread.read': {
    input: z.object({ thread: threadIdSchema }),
    output: z.object({ thread: threadSchema, exchanges: z.array(exchangeSchema), steps: z.array(stepSchema), views: z.array(viewSchema) })
  },

  /** Bring a thread to the stage: its view, and its last answer as the caption. An aside's card comes back beside the topic. */
  'thread.focus': {
    input: z.object({ thread: threadIdSchema }),
    output: z.object({})
  }
}
