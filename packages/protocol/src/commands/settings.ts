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
  },

  /**
   * Run on this harness whenever it is ready; the others are used only when it is not. `null` goes back to
   * the first one ready. Takes effect for the next conversation the assistant opens.
   */
  'engines.prefer': {
    input: z.object({ harness: z.string().min(1).max(64).nullable() }),
    output: settingsOutput
  },

  /**
   * The model a harness answers with, from those it offers. `null` goes back to its default.
   * Takes effect for the next conversation the assistant opens; the one under way keeps its model.
   */
  'engines.model.set': {
    input: z.object({ harness: z.string().min(1).max(64), model: z.string().min(1).max(100).nullable() }),
    output: settingsOutput
  }
}
