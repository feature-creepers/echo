import { z } from 'zod'

/**
 * The person's accounts (docs/SPEC.md, section 12.1, `calendar` and `mail`): what the assistant may read in them, and
 * whether this computer holds their sign-in. The list is a user setting, kept by the core; the sign-ins themselves
 * are kept in the vault of the computer that made them, never in the store. A provider is known by an identifier and
 * the label the person reads, and nothing else: which providers a build offers is its own configuration.
 */

/** What an account gives the assistant to read. */
export const ACCOUNT_PARTS = ['calendar', 'mail'] as const
export const accountPartSchema = z.enum(ACCOUNT_PARTS)
export type AccountPart = z.infer<typeof accountPartSchema>

export const accountIdSchema = z.string().min(1).max(64)
export const providerIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)

/** The most accounts the assistant reads. */
export const MAX_ACCOUNTS = 8

/** The parts asked or granted, each once. */
export const accountPartsSchema = z
  .array(accountPartSchema)
  .min(1)
  .max(ACCOUNT_PARTS.length)
  .refine((parts) => new Set(parts).size === parts.length, 'Each part is named once.')

/** An account connected, as a client shows it. */
export const accountSchema = z.object({
  id: accountIdSchema,
  provider: providerIdSchema,
  /** The address the provider gave: "ada@example.com". */
  address: z.string().min(1).max(320),
  /** The person's name, as the provider gave it. */
  name: z.string().max(200).optional(),
  /** What the person granted when they signed in. */
  parts: accountPartsSchema,
  /** When it was connected: an ISO 8601 date in UTC. */
  since: z.string(),
  /** Whether this computer holds its sign-in (`ready`), or the person must sign in again. */
  state: z.enum(['ready', 'sign-in-again'])
})
export type Account = z.infer<typeof accountSchema>

/** A provider as the Accounts page offers it. */
export const accountProviderSchema = z.object({
  id: providerIdSchema,
  /** Its name for the person: what the page writes in "Connect a … account". */
  label: z.string().min(1).max(60),
  /** Whether this build can sign in to it. When not, `problem` says why. */
  offered: z.boolean(),
  problem: z.string().max(500).optional(),
  /** What the person should know before connecting one, each a sentence or two. */
  notes: z.array(z.string().max(800)).max(6),
  /**
   * Where the person removes the assistant's access themselves, for a provider whose sign-in the assistant cannot
   * revoke on its own: an https page of the provider's.
   */
  permissions: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional()
})
export type AccountProvider = z.infer<typeof accountProviderSchema>

/** Everything the Accounts page shows. */
export const accountsViewSchema = z.object({
  accounts: z.array(accountSchema).max(MAX_ACCOUNTS),
  providers: z.array(accountProviderSchema).max(16),
  /** Whether sign-ins outlive the app on this computer, and why not, in words for the person. */
  keeping: z.object({ kept: z.boolean(), reason: z.string().max(1000).optional() }),
  /** The sign-in under way, waiting for the person in their browser: one at a time. */
  signingIn: z
    .object({
      provider: providerIdSchema,
      parts: accountPartsSchema,
      /** The account signed in again, when it is one already connected. */
      account: accountIdSchema.optional(),
      since: z.string()
    })
    .optional()
})
export type AccountsView = z.infer<typeof accountsViewSchema>
