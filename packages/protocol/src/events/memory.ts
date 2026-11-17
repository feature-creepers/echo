import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { assistantStateSchema, memoryViewSchema } from '../memory.ts'

/** What the assistant knows changed: a fact was learned, corrected or forgotten, or the sleep setting changed. Carries it whole. */
export const memoryChangedSchema = eventPrefixSchema.extend({
  name: z.literal('memory.changed'),
  memory: memoryViewSchema
})

/** The assistant fell asleep, woke up, or went further in its sleep's work. The core dims while it sleeps. */
export const assistantStateChangedSchema = eventPrefixSchema.extend({
  name: z.literal('assistant.state'),
  state: assistantStateSchema
})
