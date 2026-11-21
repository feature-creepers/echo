import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { servicesViewSchema } from '../services.ts'

/** A service was connected or disconnected, or a sign-in started or ended. Carries them whole. */
export const servicesChangedSchema = eventPrefixSchema.extend({
  name: z.literal('services.changed'),
  services: servicesViewSchema
})
