import { z } from 'zod'
import { connectionIdSchema, connectionSchema, serviceSchema, servicesViewSchema } from '../services.ts'

const servicesOutput = z.object({ services: servicesViewSchema })

export const servicesCommands = {
  /** Read the services connected for widget apps. */
  'services.read': {
    input: z.object({}),
    output: servicesOutput
  },

  /**
   * Connect a service, or connect it again: with the token the person pasted, or, for OAuth, by signing in in the
   * system's browser with the client identifier of the app they registered. Answered when it is connected, or refused
   * with why, in words for the person. One sign-in at a time.
   */
  'services.connect': {
    input: z.object({ service: serviceSchema, token: z.string().trim().min(1).max(4000).optional(), clientId: z.string().trim().min(1).max(200).optional() }),
    output: servicesOutput.extend({ connection: connectionSchema })
  },

  /** Forget a service: its sign-in is erased from this computer, and no widget can call it any more. */
  'services.disconnect': {
    input: z.object({ connection: connectionIdSchema }),
    output: servicesOutput
  }
}
