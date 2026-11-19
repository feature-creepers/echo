import { z } from 'zod'
import {
  assistantStateSchema,
  FACT_MAX_LENGTH,
  factIdSchema,
  factKindSchema,
  importSchema,
  memoryViewSchema,
  retentionDaysSchema,
  sleepSettingsSchema
} from '../memory.ts'

const memoryOutput = z.object({ memory: memoryViewSchema })

export const memoryCommands = {
  /** Read what the assistant knows about the user, and whether it is asleep. */
  'memory.read': {
    input: z.object({}),
    output: z.object({ memory: memoryViewSchema, state: assistantStateSchema })
  },

  /** Correct a fact. Its earlier wording is kept as history; the fact keeps its sources. */
  'memory.edit': {
    input: z.object({ fact: factIdSchema, text: z.string().trim().min(1).max(FACT_MAX_LENGTH), kind: factKindSchema.optional() }),
    output: memoryOutput
  },

  /** Forget a fact: its content is erased, with the earlier facts it replaced. */
  'memory.forget': {
    input: z.object({ fact: factIdSchema }),
    output: memoryOutput
  },

  /**
   * Bring in, once, what the proof of concept knew, from its data folder on the core's computer (in the home
   * folder, named after it): its notes and the person's context file as facts, its history as lines of earlier conversations,
   * dated when they were said. Choosing the folder is the person's consent to its being read; nothing there is
   * changed, and the folder is not granted to the assistant. What is already known is not brought in twice.
   */
  'memory.import': {
    input: z.object({ folder: z.string().trim().min(1).max(4096) }),
    output: z.object({ memory: memoryViewSchema, imported: importSchema })
  },

  /** Choose when the assistant sleeps. What is left out keeps its value. */
  'memory.sleep-settings.set': {
    input: sleepSettingsSchema.partial(),
    output: memoryOutput
  },

  /**
   * Choose how many days the conversation's words are kept, or null to keep them for good. The words older than
   * that are erased at once, and from then on as they pass it; what was learned from them stays.
   */
  'memory.retention.set': {
    input: z.object({ days: retentionDaysSchema.nullable() }),
    output: memoryOutput
  },

  /**
   * Put the assistant to sleep now, to make sense of what it heard. Answers at once; the progress arrives
   * as `assistant.state` events. Refused with `sleep-off` when the user chose that it never sleeps.
   */
  'memory.sleep-now': {
    input: z.object({}),
    output: z.object({})
  }
}
