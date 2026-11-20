import {
  type Account,
  type AccountPart,
  type AccountsView,
  accountPartSchema,
  type CommandError,
  type CommandInput,
  type Event,
  MAX_ACCOUNTS
} from '@repo/protocol'
import { z } from 'zod'
import type { Accounts, Keeping } from '../ports/accounts.ts'
import type { Log } from '../ports/log.ts'
import type { Records } from '../ports/records.ts'
import { stopping } from './stopping.ts'

/**
 * The person's accounts (docs/SPEC.md, section 12.1): the list is a user setting, kept as records that hold who each
 * account is and what it gives, never a secret. Whether this computer holds an account's sign-in is asked of the
 * adapter, which keeps them in its vault: an account it holds no sign-in for asks the person to sign in again.
 */

/** The type of the record written when an account is connected, or signed in again: it replaces the one before. */
const CONNECTED = 'account.connected'
/** The type of the record written when an account is disconnected. */
const DISCONNECTED = 'account.disconnected'

const connectedSchema = z.object({
  account: z.string().min(1).max(64),
  provider: z.string().min(1).max(32),
  address: z.string().min(1).max(320),
  name: z.string().max(200).optional(),
  parts: z.array(accountPartSchema).min(1)
})
const disconnectedSchema = z.object({ account: z.string().min(1).max(64) })

type Change = { ok: true; view: AccountsView } | { ok: false; error: CommandError }

interface AccountListOptions {
  /** The adapter. Left out, no account can be connected here. */
  port: Accounts | undefined
  records: Records
  newId: () => string
  now: () => Date
  log: Log
}

export interface AccountList {
  /** Everything the Accounts page shows, once this computer's sign-ins are known. */
  read(): Promise<AccountsView>
  /** Sign in, or sign in again to an account connected. Resolves when the sign-in ends. */
  connect(asked: CommandInput<'accounts.connect'>): Promise<{ ok: true; account: Account; view: AccountsView } | { ok: false; error: CommandError }>
  /** Give up the sign-in under way, if there is one. */
  cancel(): void
  disconnect(account: string): Promise<Change>
  /** The accounts this computer holds a sign-in for that grant a part, in the order they were connected. */
  ready(part: AccountPart): Account[]
  /** The provider refused an account's sign-in: the person must sign in again. */
  signInAgain(account: string): void
  /** Changes when what the ready accounts give changes: the sessions are then opened again with their tools. */
  version(): string
  /** Be told `accounts.changed`. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
}

export function createAccountList({ port, records, newId, now, log }: AccountListOptions): AccountList {
  const listeners = new Set<(event: Event) => void>()
  const kept = new Map<string, Omit<Account, 'state'>>()
  for (const record of records.read([CONNECTED, DISCONNECTED])) {
    if (record.type === DISCONNECTED) {
      const read = disconnectedSchema.safeParse(record.payload)
      if (read.success) kept.delete(read.data.account)
      continue
    }
    const read = connectedSchema.safeParse(record.payload)
    if (!read.success) continue
    const { account, ...rest } = read.data
    // Signed in again, an account keeps when it was first connected.
    kept.set(account, { id: account, ...rest, since: kept.get(account)?.since ?? record.at })
  }

  /** The accounts this computer holds a sign-in for. */
  const held = new Set<string>()
  const checked = Promise.all(
    [...kept.keys()].map(async (id) => {
      if (await port?.holds(id).catch(() => false)) held.add(id)
    })
  )
  let keeping: Promise<Keeping> | undefined
  const keepingHere = () => {
    keeping ??= port ? port.keeping().catch((error: unknown) => ({ kept: false, reason: String(error) })) : Promise.resolve(NOT_HERE)
    return keeping
  }
  let signingIn: { view: NonNullable<AccountsView['signingIn']>; stop: () => void } | undefined

  const accounts = (): Account[] => [...kept.values()].map((account) => ({ ...account, state: held.has(account.id) ? 'ready' : 'sign-in-again' }))

  const read = async (): Promise<AccountsView> => {
    await checked
    const keeps = await keepingHere()
    return {
      accounts: accounts(),
      providers: port?.providers() ?? [],
      keeping: keeps.kept ? { kept: true } : { kept: false, reason: keeps.reason },
      ...(signingIn ? { signingIn: signingIn.view } : {})
    }
  }

  const changed = async (): Promise<AccountsView> => {
    const view = await read()
    for (const listener of listeners) listener({ type: 'event', name: 'accounts.changed', accounts: view })
    return view
  }
  // The sessions hear of the accounts this computer holds once they are known.
  void checked.then(() => (held.size > 0 ? changed() : undefined))

  const refuse = (message: string, code: CommandError['code'] = 'invalid-input') => ({ ok: false as const, error: { code, message } })

  return {
    read,

    async connect(asked) {
      if (!port) return refuse('Accounts cannot be connected here.', 'failed')
      if (signingIn) return refuse('A sign-in is already under way: finish it in your browser, or cancel it.', 'failed')
      const provider = port.providers().find((one) => one.id === asked.provider)
      if (!provider) return refuse(`There is no provider "${asked.provider}".`)
      if (!provider.offered) return refuse(provider.problem ?? `This build cannot sign in to ${provider.label}.`)
      const again = asked.account === undefined ? undefined : kept.get(asked.account)
      if (asked.account !== undefined && again?.provider !== provider.id) return refuse('There is no such account to sign in to again.')
      if (!again && kept.size >= MAX_ACCOUNTS) return refuse(`${MAX_ACCOUNTS} accounts are connected already: disconnect one first.`)

      const id = again?.id ?? newId()
      const { signal, stop } = stopping()
      signingIn = {
        view: { provider: provider.id, parts: [...asked.parts], ...(again ? { account: again.id } : {}), since: now().toISOString() },
        stop
      }
      await changed()
      const signed = await port.connect({ account: id, provider: provider.id, parts: asked.parts }, signal)
      signingIn = undefined
      if (!signed.ok) {
        await changed()
        return refuse(signed.reason, 'failed')
      }
      // The same account connected under another identifier is the one signed in now: the other one's sign-in is
      // forgotten here, never revoked, which would end this one too.
      const twins = [...kept.values()].filter((one) => one.id !== id && one.provider === provider.id && sameAddress(one.address, signed.address))
      for (const twin of twins) {
        await port.forget(twin.id).catch((error: unknown) => log.error(`An account's sign-in could not be forgotten: ${String(error)}`))
        records.append([{ type: DISCONNECTED, payload: { account: twin.id } }])
        kept.delete(twin.id)
        held.delete(twin.id)
      }
      const [stored] = records.append([
        {
          type: CONNECTED,
          payload: { account: id, provider: provider.id, address: signed.address, ...(signed.name ? { name: signed.name } : {}), parts: signed.parts }
        }
      ])
      kept.set(id, {
        id,
        provider: provider.id,
        address: signed.address,
        ...(signed.name ? { name: signed.name } : {}),
        parts: signed.parts,
        since: again?.since ?? stored?.at ?? now().toISOString()
      })
      held.add(id)
      const view = await changed()
      return { ok: true, account: view.accounts.find((one) => one.id === id) as Account, view }
    },

    cancel() {
      signingIn?.stop()
    },

    async disconnect(id) {
      if (!kept.has(id)) return refuse('There is no such account.')
      if (signingIn?.view.account === id) signingIn.stop()
      await port?.disconnect(id).catch((error: unknown) => log.error(`An account's sign-in could not be revoked: ${String(error)}`))
      records.append([{ type: DISCONNECTED, payload: { account: id } }])
      kept.delete(id)
      held.delete(id)
      return { ok: true, view: await changed() }
    },

    ready: (part) => accounts().filter((account) => account.state === 'ready' && account.parts.includes(part)),

    signInAgain(id) {
      if (!held.delete(id)) return
      void changed()
    },

    version: () =>
      JSON.stringify(
        accounts()
          .filter((account) => account.state === 'ready')
          .map((account) => [account.id, account.address, account.parts])
      ),

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

const NOT_HERE: Keeping = { kept: false, reason: 'Accounts cannot be connected here.' }

/** Two addresses the same mailbox: case set aside. */
export const sameAddress = (one: string, other: string) => one.trim().toLowerCase() === other.trim().toLowerCase()
