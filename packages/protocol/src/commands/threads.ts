import { z } from 'zod'
import { exchangeSchema, stepSchema, turnIdSchema, UTTERANCE_MAX_LENGTH } from '../conversation.ts'
import { threadIdSchema, threadSchema, threadsSchema } from '../threads.ts'
import { viewSchema } from '../views.ts'

export const threadCommands = {
  /** Read the threads, most recent first, and the one in focus. */
  'threads.read': {
    input: z.object({}),
    output: threadsSchema
  },

  /**
   * Read a thread for the side sheet, a page at a time: its latest requests, or with `before` those just before
   * that request, as many as fit one message. Each comes with its full written answer, its tool calls as a
   * preview (what each was about, the start of what it gave back: `thread.step` reads one whole), and the titles of
   * the views it showed. `earlier` says how many requests come before the page. A request too
   * long to fit alone keeps its latest calls, `earlierSteps` saying how many of its first ones are left out.
   */
  'thread.read': {
    input: z.object({ thread: threadIdSchema, before: turnIdSchema.optional() }),
    output: z.object({
      thread: threadSchema,
      exchanges: z.array(exchangeSchema),
      steps: z.array(stepSchema),
      views: z.array(viewSchema.pick({ id: true, title: true, turn: true })),
      earlier: z.number().int().nonnegative().default(0),
      earlierSteps: z.number().int().nonnegative().default(0)
    })
  },

  /** Read one tool call of a thread whole, as the side sheet opens it: what it was given and what it gave back. */
  'thread.step': {
    input: z.object({ thread: threadIdSchema, call: stepSchema.shape.call }),
    output: z.object({ step: stepSchema })
  },

  /**
   * Stop work: one thread's, the request it answers and those waiting for it; or, with no thread, every thread's and
   * the answer on the stage, every session ending with what it still runs. Reminders and approvals are left as they
   * are: that is `everything.stop`. Says whether there was anything to stop.
   */
  'threads.stop': {
    input: z.object({ thread: threadIdSchema.optional() }),
    output: z.object({ stopped: z.boolean() })
  },

  /**
   * Take a finished thread's waiting answer as seen, or with no thread every one that waits (docs/SPEC.md, section
   * 7.4): it is no longer ready, and is not mentioned. Nothing else changes.
   */
  'threads.dismiss': {
    input: z.object({ thread: threadIdSchema.optional() }),
    output: z.object({})
  },

  /**
   * Put a thread away in the side sheet, or bring it back from there (docs/SPEC.md, section 13.2): folded under
   * Archived, with what is under it. Nothing else changes, and work on it brings it back by itself.
   */
  'thread.archive': {
    input: z.object({ thread: threadIdSchema, archived: z.boolean() }),
    output: z.object({})
  },

  /**
   * Turn to a thread: it takes the focus, its topic comes back to the top of the main screen, and what of its
   * waiting answer was not heard is said.
   */
  'thread.focus': {
    input: z.object({ thread: threadIdSchema }),
    output: z.object({})
  },

  /**
   * Open a project from the interface (docs/SPEC.md, section 7.11): work in a folder on the core's computer, as the
   * person asks. Choosing the folder there is their consent to its being read and changed, as in Settings, Access;
   * each use is still decided by their approval level. The request takes the stage, answered by the thread working
   * in that folder when it is free, else by a new one. A file, a place that is not there and a place never reached
   * are refused.
   */
  'project.open': {
    input: z.object({
      folder: z.string().trim().min(1).max(4096),
      request: z.string().trim().min(1).max(UTTERANCE_MAX_LENGTH)
    }),
    output: z.object({ thread: threadIdSchema, turn: turnIdSchema })
  }
}
