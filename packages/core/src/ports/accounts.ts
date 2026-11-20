import type { AccountPart, AccountProvider } from '@repo/protocol'
import type { Signal } from './harness.ts'

/** What an account gives to read, and a provider as the Accounts page offers it (`@repo/protocol`). */
export type { AccountPart, AccountProvider }

/**
 * The person's accounts at their providers (docs/SPEC.md, section 12.1, `calendar` and `mail`): signing in, and
 * reading what they granted. The adapter holds the sign-ins, in the vault of the computer it runs on: the core never
 * handles a token. It names an account by its own identifier, and a provider by the identifier the adapter gives it.
 *
 * A method never rejects for what a provider answers: it resolves with why not, in words for the person or a model.
 */
export interface Accounts {
  /** The providers this build knows, each with whether it can sign in to it and why not. */
  providers(): AccountProvider[]
  /** Whether sign-ins outlive the app on this computer, and why not. */
  keeping(): Promise<Keeping>
  /**
   * Sign in, in the system's browser, for the core's account identifier and the parts asked. Resolves once the person
   * is done, the sign-in gives up, or `signal` aborts it, with the address, the name and the parts granted, or why not.
   */
  connect(request: { account: string; provider: string; parts: readonly AccountPart[] }, signal: Signal): Promise<SignedIn | AccountFailure>
  /** Forget an account's sign-in on this computer, and revoke it at the provider where the provider allows it. */
  disconnect(account: string): Promise<void>
  /**
   * Forget an account's sign-in on this computer without revoking it: the same account was signed in again under
   * another identifier, and revoking would end that one too.
   */
  forget(account: string): Promise<void>
  /** Whether this computer holds a sign-in for the account. */
  holds(account: string): Promise<boolean>
}

/** Whether sign-ins outlive the app here: when not, they last until it quits, and `reason` says why. */
export type Keeping = { kept: true } | { kept: false; reason: string }

/** A sign-in that worked: who it is, and what the person granted. */
export interface SignedIn {
  ok: true
  address: string
  name?: string | undefined
  parts: AccountPart[]
}

/** Why something could not be done. `signIn` when the provider refused the sign-in: the person must sign in again. */
export interface AccountFailure {
  ok: false
  reason: string
  signIn?: true | undefined
}
