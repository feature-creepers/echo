import { z } from 'zod'
import { browserStateSchema } from '../browser.ts'

const browserOutput = z.object({ browser: browserStateSchema })

export const browserCommands = {
  /** Which browser the assistant drives on the core's computer, and whether its window is open. */
  'browser.read': {
    input: z.object({}),
    output: browserOutput
  },

  /**
   * Open the assistant's browser and bring its window forward, for the person to use it themselves: to sign in
   * to the sites the assistant will use for them. Refused while the browser is off in the settings.
   */
  'browser.show': {
    input: z.object({}),
    output: browserOutput
  }
}
