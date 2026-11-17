import { z } from 'zod'
import { personaIdSchema } from '../personas.ts'
import { settingsSchema } from '../settings.ts'

const settingsOutput = z.object({ settings: settingsSchema })

export const settingsCommands = {
  /** Read the user's settings as they stand. */
  'settings.read': {
    input: z.object({}),
    output: settingsOutput
  },

  /**
   * Name the personas and pick the one that answers. A persona left out of `names` keeps its name.
   * This is how the user confirms the personas at first launch, and how they change them afterwards.
   */
  'personas.set': {
    input: z.object({
      /** Names as the user typed them. The core reads them with `readPersonaName`. */
      names: z.array(z.object({ persona: personaIdSchema, name: z.string().max(200) })).max(32),
      active: personaIdSchema
    }),
    output: settingsOutput
  }
}
