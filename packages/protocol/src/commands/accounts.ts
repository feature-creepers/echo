import { z } from 'zod'
import { accountIdSchema, accountPartsSchema, accountSchema, accountsViewSchema, providerIdSchema } from '../accounts.ts'

const accountsOutput = z.object({ accounts: accountsViewSchema })

export const accountsCommands = {
  /** Read the accounts connected, the providers this build offers, and whether sign-ins outlive the app here. */
  'accounts.read': {
    input: z.object({}),
    output: accountsOutput
  },

  /**
   * Sign in to an account, in the system's browser, for the parts asked; or sign in again to one connected, named by
   * `account`. Answered when the sign-in ends: connected, or refused with why, in words for the person. One at a time.
   */
  'accounts.connect': {
    input: z.object({ provider: providerIdSchema, parts: accountPartsSchema, account: accountIdSchema.optional() }),
    output: accountsOutput.extend({ account: accountSchema })
  },

  /** Give up the sign-in under way: its browser tab leads nowhere any more. */
  'accounts.cancel': {
    input: z.object({}),
    output: accountsOutput
  },

  /** Forget an account: its sign-in is erased from this computer, and revoked where the provider allows it. */
  'accounts.disconnect': {
    input: z.object({ account: accountIdSchema }),
    output: accountsOutput
  }
}
