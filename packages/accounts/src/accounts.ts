import type { AccountProvider, Accounts, Keeping, Log, Signal, Timers } from '@repo/core'
import * as client from 'openid-client'
import { z } from 'zod'
import { knownProviders } from './providers/known.ts'
import type { Provider, Registration } from './providers/provider.ts'
import { type Call, caller, type Fetch, guarded } from './requests.ts'
import { CANCELLED, signIn } from './sign-in.ts'

/**
 * The person's accounts, as the core's `Accounts` port (docs/SPEC.md, section 12.1). A refresh token is kept in the
 * vault, under `account:<identifier>`, and rewritten when the provider gives a new one; an access token is kept in
 * memory only, and renewed within a minute of its end. No token is ever given to the core, logged or written elsewhere.
 */

/** Where the adapter keeps the sign-ins: sealed with the system's own store, or in memory when nothing can be kept safely. */
export interface Vault {
  keeping(): Promise<Keeping>
  read(name: string): Promise<string | undefined>
  write(name: string, text: string): Promise<void>
  erase(name: string): Promise<void>
}

export interface AccountsOptions {
  vault: Vault
  /** Open an https address with the system's browser: where the person signs in. */
  open(url: string): Promise<void>
  /** Each provider's app registration, by the provider's identifier, from the build's configuration. */
  registrations: Readonly<Record<string, Registration | undefined>>
  log: Log
  /** Left out, the machine's own. */
  timers?: Timers
  /** Left out, the platform's. */
  fetch?: Fetch
}

/** What the vault holds for an account. */
const entrySchema = z.object({ provider: z.string(), refresh: z.string().min(1) })
type Entry = z.infer<typeof entrySchema>

const systemTimers: Timers = {
  after(ms, work) {
    const timer = setTimeout(work, ms)
    return () => clearTimeout(timer)
  }
}

/** A provider this build knows, with its registration when it has one. */
interface Known {
  provider: Provider
  registration: Registration | undefined
  problem: string | undefined
}

export function createAccounts(options: AccountsOptions): Accounts {
  const { vault, log } = options
  const timers = options.timers ?? systemTimers
  const fetchVia = options.fetch ?? ((url, init) => fetch(url, init))
  const known: Known[] = knownProviders().map((provider) => {
    const registration = options.registrations[provider.id]
    const registered = Boolean(registration?.clientId) && (!provider.secret || Boolean(registration?.clientSecret))
    return {
      provider,
      registration,
      problem: registered ? undefined : `This build has no sign-in for ${provider.label}: it was made without an app registration for it.`
    }
  })
  const fetchFor = (provider: Provider) => guarded(provider.hosts, fetchVia)
  const nameOf = (account: string) => `account:${account}`

  /** Each provider's sign-in, discovered once for the run. A failed discovery is tried again next time. */
  const configurations = new Map<string, Promise<client.Configuration>>()
  const configurationOf = (entry: Known): Promise<client.Configuration> => {
    let found = configurations.get(entry.provider.id)
    if (!found) {
      const { clientId = '', clientSecret } = entry.registration ?? {}
      found = client.discovery(
        entry.provider.issuer,
        clientId,
        entry.provider.secret ? clientSecret : undefined,
        entry.provider.secret ? client.ClientSecretPost(clientSecret) : client.None(),
        { [client.customFetch]: (url, init) => fetchFor(entry.provider)(url, { ...init, body: init.body ?? null } as RequestInit) }
      )
      found.catch(() => configurations.delete(entry.provider.id))
      configurations.set(entry.provider.id, found)
    }
    return found
  }

  const readEntry = async (account: string): Promise<Entry | undefined> => {
    const text = await vault.read(nameOf(account)).catch(() => undefined)
    if (text === undefined) return undefined
    try {
      const read = entrySchema.safeParse(JSON.parse(text))
      return read.success ? read.data : undefined
    } catch {
      return undefined
    }
  }

  const keep = (account: string, entry: Entry) => vault.write(nameOf(account), JSON.stringify(entry))

  const knownFor = (provider: string) => known.find((entry) => entry.provider.id === provider)

  /** Forget a sign-in here, revoking it first when asked and the provider allows it. */
  const drop = async (account: string, revoke: boolean) => {
    const entry = await readEntry(account)
    const providerOf = entry && knownFor(entry.provider)
    if (revoke && entry && providerOf?.provider.revokes) {
      await client
        .tokenRevocation(await configurationOf(providerOf), entry.refresh, { token_type_hint: 'refresh_token' })
        .catch((error: unknown) =>
          log.error(`A sign-in to ${providerOf.provider.label} could not be revoked: ${error instanceof Error ? error.message : String(error)}`)
        )
    }
    await vault.erase(nameOf(account))
  }

  return {
    providers: (): AccountProvider[] =>
      known.map(({ provider, problem }) => ({
        id: provider.id,
        label: provider.label,
        offered: problem === undefined,
        ...(problem === undefined ? {} : { problem }),
        notes: [...provider.notes],
        ...(provider.permissions === undefined ? {} : { permissions: provider.permissions })
      })),

    keeping: () => vault.keeping(),

    async connect({ account, provider: id, parts }, signal) {
      const entry = knownFor(id)
      if (!entry || entry.problem !== undefined) return { ok: false, reason: entry?.problem ?? `There is no provider "${id}".` }
      const stop = abortOf(signal)
      try {
        if (stop.aborted) return { ok: false, reason: CANCELLED }
        const configuration = await configurationOf(entry)
        const signed = await signIn({ provider: entry.provider, configuration, parts, open: options.open, timers, signal: stop })
        if (!signed.ok) return signed
        const call: Call = caller(fetchFor(entry.provider), signed.tokens.access_token, stop)
        const who = await entry.provider.who(call, signed.parts)
        await keep(account, { provider: id, refresh: signed.tokens.refresh_token as string })
        return { ok: true, address: who.address, ...(who.name ? { name: who.name } : {}), parts: signed.parts }
      } catch (error) {
        return { ok: false, reason: `The sign-in to ${entry.provider.label} failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },

    disconnect: (account) => drop(account, true),
    forget: (account) => drop(account, false),
    holds: async (account) => (await readEntry(account)) !== undefined
  }
}

/** The core's signal as the platform's, for fetch and the listener. */
function abortOf(signal: Signal): AbortSignal {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller.signal
}
