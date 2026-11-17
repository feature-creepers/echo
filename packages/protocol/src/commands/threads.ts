import { z } from 'zod'
import { threadIdSchema, threadsSchema } from '../threads.ts'

export const threadCommands = {
  /** Read the threads, most recent first, and the one in focus. */
  'threads.read': {
    input: z.object({}),
    output: threadsSchema
  },

  /** Bring a thread to the stage: its view, and its last answer as the caption. */
  'thread.focus': {
    input: z.object({ thread: threadIdSchema }),
    output: z.object({})
  }
}
