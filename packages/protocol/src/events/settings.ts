import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'
import { settingsSchema } from '../settings.ts'

/** The user's settings changed, on this device or another. Carries them whole. */
export const settingsChangedSchema = eventPrefixSchema.extend({
  name: z.literal('settings.changed'),
  settings: settingsSchema
})
