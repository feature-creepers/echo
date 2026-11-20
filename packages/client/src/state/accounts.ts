import type { AccountsView, CommandInput } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The accounts connected, kept current for as long as they are followed. Nothing until the core has answered. */
export interface AccountsState extends Followed<AccountsView | undefined> {
  /** The core could not be read from: nothing will arrive until the accounts are followed again. */
  unread: Followed<boolean>
  /** Sign in, in the system's browser. Resolves once signed in; rejects with why not, in the core's words. */
  connect(asked: CommandInput<'accounts.connect'>): Promise<void>
  /** Give up the sign-in under way. */
  cancel(): Promise<void>
  disconnect(account: string): Promise<void>
  unfollow(): void
}

/** Read the accounts from the core and follow their changes, from this device or another. */
export function followAccounts(session: Session): AccountsState {
  const accounts = cell<AccountsView | undefined>(undefined)
  const unread = cell(false)
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'accounts.changed') accounts.set(event.accounts)
  })
  session.run('accounts.read', {}).then(
    ({ accounts: view }) => accounts.set(view),
    () => unread.set(accounts.current() === undefined)
  )
  return {
    current: accounts.current,
    subscribe: accounts.subscribe,
    unread: { current: unread.current, subscribe: unread.subscribe },
    async connect(asked) {
      accounts.set((await session.run('accounts.connect', asked)).accounts)
    },
    async cancel() {
      accounts.set((await session.run('accounts.cancel', {})).accounts)
    },
    async disconnect(account) {
      accounts.set((await session.run('accounts.disconnect', { account })).accounts)
    },
    unfollow: stopEvents
  }
}
