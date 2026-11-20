import type { AccountFailure, AccountPart, AccountProvider, Accounts, Keeping, SignedIn } from '../ports/accounts.ts'
import type { Signal } from '../ports/harness.ts'

/** Two providers, one this build can sign in to and one it cannot. */
export const SCRIPTED_PROVIDERS: AccountProvider[] = [
  { id: 'mailbox', label: 'Mailbox', offered: true, notes: ['Reads as you allow.'] },
  { id: 'elsewhere', label: 'Elsewhere', offered: false, problem: 'This build has no sign-in for Elsewhere.', notes: [] }
]

/** A sign-in waiting for the person, as the test plays them. */
interface Signing {
  request: { account: string; provider: string; parts: readonly AccountPart[] }
  signal: Signal
  finish(outcome: SignedIn | AccountFailure): void
}

/** An `Accounts` port played by a test: sign-ins end when the test says, and what is held is what the test sets. */
export interface ScriptedAccounts extends Accounts {
  /** The sign-in under way, if any. */
  signing(): Signing | undefined
  /** The accounts this computer holds a sign-in for. */
  held: Set<string>
  disconnected: string[]
  forgotten: string[]
}

export function scriptedAccounts(keeping: Keeping = { kept: true }): ScriptedAccounts {
  let signing: Signing | undefined
  const held = new Set<string>()
  const disconnected: string[] = []
  const forgotten: string[] = []
  return {
    providers: () => SCRIPTED_PROVIDERS,
    keeping: async () => keeping,
    connect: (request, signal) =>
      new Promise((resolve) => {
        const finish = (outcome: SignedIn | AccountFailure) => {
          if (signing?.request !== request) return
          signing = undefined
          if (outcome.ok) held.add(request.account)
          resolve(outcome)
        }
        signing = { request, signal, finish }
        signal.addEventListener('abort', () => finish({ ok: false, reason: 'The sign-in was cancelled.' }))
      }),
    async disconnect(account) {
      disconnected.push(account)
      held.delete(account)
    },
    async forget(account) {
      forgotten.push(account)
      held.delete(account)
    },
    holds: async (account) => held.has(account),
    signing: () => signing,
    held,
    disconnected,
    forgotten
  }
}
