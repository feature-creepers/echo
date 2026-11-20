import type { AccountPart } from '@repo/core'
import type { Call } from '../requests.ts'

/**
 * A provider of accounts: how to sign in to it, the hosts it may call, and how it answers what the core asks. Each
 * provider is one module of this folder; nothing outside it names a provider's hosts, scopes or calls. Adding one
 * is one more module, listed in `known.ts`.
 */
export interface Provider {
  /** How the core and the protocol know it: lower case, never shown. */
  id: string
  /** Its name for the person. */
  label: string
  /** The issuer its sign-in is discovered from. */
  issuer: URL
  /** The one host whose page a sign-in opens in the browser. */
  signInHost: string
  /** Every host it may call, its sign-in's included: anything else is refused, a redirect elsewhere too. */
  hosts: readonly string[]
  /**
   * Where the browser comes back to (RFC 8252): `127.0.0.1`, or `localhost` for a provider that ignores the port only
   * for that name, in which case both of this computer's loopback addresses listen.
   */
  loopback: '127.0.0.1' | 'localhost'
  /** Whether its app registration has a client secret, as a desktop client of Google's does. */
  secret: boolean
  /** Whether the assistant can revoke a sign-in itself when the person disconnects the account. */
  revokes: boolean
  /** The scopes to ask for the parts asked: read-only ones, always. */
  scopes(parts: readonly AccountPart[]): string[]
  /** What its sign-in page is given besides the standard parameters. */
  authorization: Readonly<Record<string, string>>
  /** The parts the scopes granted cover, of those asked. */
  granted(scope: string | undefined, asked: readonly AccountPart[]): AccountPart[]
  /** Who signed in: the account's address, and the person's name when the provider says it. */
  who(call: Call, parts: readonly AccountPart[]): Promise<{ address: string; name?: string | undefined }>
  /** Why a sign-in was refused, from the error the provider sent back, in words for the person. */
  refusal(error: string, description: string | undefined): string
  /** What the person should know before connecting an account, as the Accounts page says it. */
  notes: readonly string[]
  /** Where the person removes the app's access themselves, when it cannot revoke it. */
  permissions?: string
}

/** A provider's app registration, from the build's configuration: never the repository's. */
export interface Registration {
  clientId?: string | undefined
  clientSecret?: string | undefined
}

/** Scopes as a provider sends them back, compared whole and case set aside. */
export function scopeSet(scope: string | undefined): Set<string> {
  return new Set((scope ?? '').split(/\s+/).flatMap((one) => (one ? [one.toLowerCase()] : [])))
}
