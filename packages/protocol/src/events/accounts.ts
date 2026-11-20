import { z } from 'zod'
import { accountsViewSchema } from '../accounts.ts'
import { eventPrefixSchema } from '../envelope.ts'

/** An account was connected, disconnected or needs signing in again, or a sign-in started or ended. Carries them whole. */
export const accountsChangedSchema = eventPrefixSchema.extend({
  name: z.literal('accounts.changed'),
  accounts: accountsViewSchema
})
