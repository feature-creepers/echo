import { z } from 'zod'
import { APPROVALS, appSchema, COMPUTER_REACH, hostSchema, MAX_APPROVAL_WAIT, MAX_APPS, MAX_HOSTS, MAX_PLACES, placeSchema } from '../access.ts'
import { answerLanguageSchema, spokenLanguageSchema } from '../languages.ts'
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
   * the first one ready. Takes effect from the next question: a session opens on it, told what was said.
   */
  'engines.prefer': {
    input: z.object({ harness: z.string().min(1).max(64).nullable() }),
    output: settingsOutput
  },

  /**
   * What the assistant may reach on the computer: its own folder, the folders and files granted, the whole
   * computer, whether changes are asked first, whether what destroys or publishes is always asked, how long a
   * question waits, whether it may drive a browser, and whether it may use other apps, and which. What is left out keeps its value. A place is checked by the
   * core, which refuses one that does not exist. Takes effect at once, for the session under way too.
   */
  'access.set': {
    input: z.object({
      workspace: z.boolean().optional(),
      places: z.array(placeSchema).max(MAX_PLACES).optional(),
      computer: z.enum(COMPUTER_REACH).optional(),
      approvals: z.enum(APPROVALS).optional(),
      askDestroying: z.boolean().optional(),
      askPublishing: z.boolean().optional(),
      askNetwork: z.boolean().optional(),
      askLocalNetwork: z.boolean().optional(),
      askSending: z.boolean().optional(),
      allowedHosts: z.array(hostSchema).max(MAX_HOSTS).optional(),
      refusedHosts: z.array(hostSchema).max(MAX_HOSTS).optional(),
      approvalWait: z.number().int().min(1).max(MAX_APPROVAL_WAIT).nullable().optional(),
      browser: z.boolean().optional(),
      desktop: z.boolean().optional(),
      apps: z.array(appSchema).max(MAX_APPS).optional()
    }),
    output: settingsOutput
  },

  /**
   * The language the person speaks (`auto`: found from what they say) and the one the assistant answers in
   * (`spoken`: theirs). What is left out keeps its value. Takes effect from the next question.
   */
  'languages.set': {
    input: z.object({ spoken: spokenLanguageSchema.optional(), answers: answerLanguageSchema.optional() }),
    output: settingsOutput
  },

  /**
   * The model a harness answers with, from those it offers. `null` goes back to its default. Takes effect
   * from the next question: the topic it goes to opens again on the new model, told what was said.
   */
  'engines.model.set': {
    input: z.object({ harness: z.string().min(1).max(64), model: z.string().min(1).max(100).nullable() }),
    output: settingsOutput
  },

  /**
   * How hard a harness's answers reason, from the levels its model offers. `null` goes back to the model's
   * default. Kept across a change of model, and used while the model offers it. Takes effect from the next
   * question, as a change of model does.
   */
  'engines.effort.set': {
    input: z.object({ harness: z.string().min(1).max(64), effort: z.string().min(1).max(32).nullable() }),
    output: settingsOutput
  }
}
