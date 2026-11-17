import { z } from 'zod'
import { personaIdSchema, personaSchema } from './personas.ts'

/**
 * The user's settings: what follows the user from one device to the next. The core keeps them.
 * What belongs to one device (its microphone, its shortcuts) is not here.
 */
export const settingsSchema = z.object({
  /** Goes up by one with each change, so a client holding two copies keeps the later one. */
  revision: z.number().int().nonnegative(),
  personas: z.object({
    /** Every persona the user can pick, in the order to show them. */
    available: z.array(personaSchema).min(1),
    /** The one that answers. */
    active: personaIdSchema,
    /** Whether the user has chosen the personas' names. Until then a client asks, before anything else. */
    confirmed: z.boolean()
  }),
  /** The AI programs the assistant runs on: which one to use, and the model it answers with. */
  engines: z
    .object({
      /** The harness to run on whenever it is ready, by id. Left out, the first one ready, in the core's order. */
      preferred: z.string().min(1).max(64).optional(),
      /** The model the answers use, by harness id. A harness left out answers with its default model. */
      models: z.record(z.string().min(1).max(64), z.string().min(1).max(100)).default({})
    })
    .default({ models: {} })
})
export type Settings = z.infer<typeof settingsSchema>
