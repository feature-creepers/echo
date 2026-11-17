import { z } from 'zod'
import { enginesSchema, exchangeSchema, languageSchema, turnIdSchema } from '../conversation.ts'
import { eventPrefixSchema } from '../envelope.ts'

/** The user said something and the assistant started on it. Carries the new line of the transcript. */
export const turnStartedSchema = eventPrefixSchema.extend({
  name: z.literal('turn.started'),
  exchange: exchangeSchema
})

/**
 * One sentence of the answer, to say aloud and to show as the caption. Sentences of a turn arrive in order.
 * The device that last captured speech voices it; the others show it.
 */
export const speechSaySchema = eventPrefixSchema.extend({
  name: z.literal('speech.say'),
  turn: turnIdSchema,
  text: z.string().min(1),
  /** The language of the sentence, for the voice. */
  language: languageSchema.optional()
})

/** The turn is over: answered, stopped or failed. Carries the line of the transcript as it now stands. */
export const turnEndedSchema = eventPrefixSchema.extend({
  name: z.literal('turn.ended'),
  exchange: exchangeSchema
})

/** A tool started or ended while the assistant works on a turn. For those who want to see it work. */
export const activitySchema = eventPrefixSchema.extend({
  name: z.literal('activity'),
  turn: turnIdSchema,
  tool: z.string(),
  phase: z.enum(['started', 'ended'])
})

/** Which harnesses can be used changed: one was installed, signed in or out, or another was picked. */
export const enginesChangedSchema = eventPrefixSchema.extend({
  name: z.literal('engines.changed'),
  engines: enginesSchema
})
