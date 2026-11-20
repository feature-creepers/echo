import { z } from 'zod'
import { enginesSchema, exchangeSchema, languageSchema, turnIdSchema, UTTERANCE_MAX_LENGTH } from '../conversation.ts'
import { ATTACHMENTS_PER_TURN, attachmentIdSchema } from '../files.ts'

export const conversationCommands = {
  /**
   * Say something to the assistant: typed, or recognised from speech by the device.
   * The answer does not come in the result: it arrives as events, sentence by sentence.
   * Said while the assistant is answering, it stops that answer first.
   */
  'utterance.send': {
    input: z
      .object({
        text: z.string().trim().max(UTTERANCE_MAX_LENGTH),
        /** The language spoken, when the device's recogniser could tell. */
        language: languageSchema.optional(),
        /**
         * Heard by the device's recogniser, rather than typed or pressed: an answer said aloud to a question about
         * what sends, pays or publishes needs the person's confirmation phrase, when they set one.
         */
        spoken: z.boolean().optional(),
        /** Files handed over with it, each sent first with `attachment.open`. */
        attachments: z.array(attachmentIdSchema).max(ATTACHMENTS_PER_TURN).optional(),
        /**
         * Folders given with it, by where they are on the core's computer: a desktop knows where a folder dropped
         * on it is. Giving one is consent to read it: it is granted read only.
         */
        folders: z.array(z.string().min(1).max(4096)).max(ATTACHMENTS_PER_TURN).optional(),
        /**
         * False when the device shows no views now, as the desktop's Mini window: the person sees no screen, so the
         * assistant says a little more. Left out, it does.
         */
        screen: z.boolean().optional()
      })
      // Something said, or something handed over without a word.
      .refine((input) => input.text !== '' || (input.attachments?.length ?? 0) + (input.folders?.length ?? 0) > 0),
    output: z.object({ turn: turnIdSchema })
  },

  /**
   * The app has opened on the main screen. The assistant greets the user and gives a short briefing, unless
   * it did so a little while ago or is already answering. Says which turn it started, if any.
   */
  'assistant.greet': {
    input: z.object({}),
    output: z.object({ turn: turnIdSchema.optional() })
  },

  /** Stop the answer under way, if there is one, and put the side questions' cards away: what Escape does. */
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
