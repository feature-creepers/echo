import { z } from 'zod'
import { enginesSchema, exchangeSchema, languageSchema, turnIdSchema, UTTERANCE_MAX_LENGTH } from '../conversation.ts'

export const conversationCommands = {
  /**
   * Say something to the assistant: typed, or recognised from speech by the device.
   * The answer does not come in the result: it arrives as events, sentence by sentence.
   * Said while the assistant is answering, it stops that answer first.
   */
  'utterance.send': {
    input: z.object({
      text: z.string().trim().min(1).max(UTTERANCE_MAX_LENGTH),
      /** The language spoken, when the device's recogniser could tell. */
      language: languageSchema.optional()
    }),
    output: z.object({ turn: turnIdSchema })
  },

  /** Stop the answer under way, if there is one. */
  'turn.stop': {
    input: z.object({}),
    output: z.object({})
  },

  /** Read the latest lines of the transcript, oldest first. */
  'channel.read': {
    input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    output: z.object({ exchanges: z.array(exchangeSchema) })
  },

  /** Look again at which harnesses are installed and signed in on the core's machine. */
  'engines.read': {
    input: z.object({}),
    output: z.object({ engines: enginesSchema })
  },

  /** Open a harness's own sign-in on the core's machine. The core never sees the credentials. */
  'engines.sign-in': {
    input: z.object({ harness: z.string().min(1).max(64) }),
    output: z.object({})
  }
}
