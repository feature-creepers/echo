import type { AccountFailure, AccountProvider, Accounts, Keeping, Log, Signal, Timers } from '@repo/core'
import * as client from 'openid-client'
import { z } from 'zod'
import { knownProviders } from './providers/known.ts'
import type { Provider, Registration } from './providers/provider.ts'
import { type Call, CallFailed, caller, type Fetch, guarded } from './requests.ts'
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

/** How long before an access token's end it is renewed. */
const RENEW_BEFORE_MS = 60_000

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

  const knownFor = (provider: string) => known.find((entry) => entry.provider.id === provider)

  const signInAgain = (label: string): AccountFailure => ({
    ok: false,
    reason: `${label} no longer accepts this computer's sign-in to the account: the person signs in again on the Accounts page.`,
    signIn: true
  })

  /** The access tokens of this run, by account, and the renewals under way, so that two reads renew once. */
  const access = new Map<string, { token: string; until: number }>()
  const renewing = new Map<string, Promise<{ token: string } | AccountFailure>>()

  /**
   * Each account's generation, moved on when its sign-in is forgotten: a renewal or a sign-in that ends after that
   * writes nothing back, so a disconnected account's token never returns to the vault.
   */
  const generations = new Map<string, number>()
  const generationOf = (account: string) => generations.get(account) ?? 0

  /**
   * Keep an account's entry while `current` says its sign-in still stands. A write and an erasure asked during it may
   * land in either order, since the vault seals before it writes: an entry dropped meanwhile is erased again.
   */
  const keepWhile = async (account: string, entry: Entry, current: () => boolean): Promise<boolean> => {
    if (!current()) return false
    await vault.write(nameOf(account), JSON.stringify(entry))
    if (current()) return true
    await vault.erase(nameOf(account))
    return false
  }

  const holdAccess = (account: string, tokens: { access_token: string; expiresIn(): number | undefined }) =>
    access.set(account, { token: tokens.access_token, until: Date.now() + (tokens.expiresIn() ?? 3600) * 1000 })

  /** An access token for an account, renewed with its refresh token within a minute of its end. */
  const tokenOf = (account: string, entry: Entry, known: Known): Promise<{ token: string } | AccountFailure> => {
    const held = access.get(account)
    if (held && held.until - RENEW_BEFORE_MS > Date.now()) return Promise.resolve({ token: held.token })
    let renewal = renewing.get(account)
    if (!renewal) {
      const generation = generationOf(account)
      const current = () => generationOf(account) === generation
      const gone: AccountFailure = { ok: false, reason: 'The account was disconnected while it was being read.' }
      renewal = (async () => {
        try {
          const tokens = await client.refreshTokenGrant(await configurationOf(known), entry.refresh)
          if (!current()) return gone
          holdAccess(account, tokens)
          // Microsoft gives a new refresh token at each renewal: the vault keeps the latest.
          const rotated = tokens.refresh_token !== undefined && tokens.refresh_token !== entry.refresh
          if (rotated && !(await keepWhile(account, { ...entry, refresh: tokens.refresh_token as string }, current))) return gone
          return { token: tokens.access_token }
        } catch (error) {
          if (error instanceof client.ResponseBodyError && error.error === 'invalid_grant') return signInAgain(known.provider.label)
          return { ok: false as const, reason: `${known.provider.label} could not be reached: ${error instanceof Error ? error.message : String(error)}` }
        } finally {
          renewing.delete(account)
        }
      })()
      renewing.set(account, renewal)
    }
    return renewal
  }

  /** Read from an account with a fresh access token: what `work` gives, or why not. */
  const reading = async <Answer>(
    account: string,
    signal: Signal,
    work: (provider: Provider, call: Call) => Promise<Answer>
  ): Promise<Answer | AccountFailure> => {
    const entry = await readEntry(account)
    if (!entry) return { ok: false, reason: 'This computer holds no sign-in for the account: the person signs in again on the Accounts page.', signIn: true }
    const known = knownFor(entry.provider)
    if (!known || known.problem !== undefined) return { ok: false, reason: known?.problem ?? 'This build does not know the account’s provider.' }
    const token = await tokenOf(account, entry, known)
    if (!('token' in token)) return token
    try {
      return await work(known.provider, caller(fetchFor(known.provider), token.token, abortOf(signal)))
    } catch (error) {
      // A token refused a minute after it was renewed was revoked: the person signs in again.
      if (error instanceof CallFailed && error.status === 401) {
        access.delete(account)
        return signInAgain(known.provider.label)
      }
      return { ok: false, reason: `${known.provider.label} could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Forget a sign-in here, then revoke it when asked and the provider allows it. It is erased first, so a provider
   * that cannot be reached never leaves the token in the vault: the revocation uses the token already in hand.
   */
  const drop = async (account: string, revoke: boolean) => {
    generations.set(account, generationOf(account) + 1)
    access.delete(account)
    const entry = await readEntry(account)
    await vault.erase(nameOf(account))
    const providerOf = entry && knownFor(entry.provider)
    if (!revoke || !entry || !providerOf?.provider.revokes) return
    try {
      await client.tokenRevocation(await configurationOf(providerOf), entry.refresh, { token_type_hint: 'refresh_token' })
    } catch (error) {
      log.error(`A sign-in to ${providerOf.provider.label} could not be revoked: ${error instanceof Error ? error.message : String(error)}`)
    }
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
      // Disconnected or cancelled before it ends, a sign-in keeps nothing.
      const generation = generationOf(account)
      const current = () => !stop.aborted && generationOf(account) === generation
      try {
        if (stop.aborted) return { ok: false, reason: CANCELLED }
        const configuration = await configurationOf(entry)
        const signed = await signIn({ provider: entry.provider, configuration, parts, open: options.open, timers, signal: stop })
        if (!signed.ok) return signed
        const call: Call = caller(fetchFor(entry.provider), signed.tokens.access_token, stop)
        const who = await entry.provider.who(call, signed.parts)
        if (!(await keepWhile(account, { provider: id, refresh: signed.tokens.refresh_token as string }, current))) return { ok: false, reason: CANCELLED }
        holdAccess(account, signed.tokens)
        return { ok: true, address: who.address, ...(who.name ? { name: who.name } : {}), parts: signed.parts }
      } catch (error) {
        return { ok: false, reason: `The sign-in to ${entry.provider.label} failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },

    disconnect: (account) => drop(account, true),
    forget: (account) => drop(account, false),
    holds: async (account) => (await readEntry(account)) !== undefined,

    events: (account, range, signal) => reading(account, signal, async (provider, call) => ({ ok: true as const, events: await provider.events(call, range) })),
    searchMail: (account, search, signal) =>
      reading(account, signal, async (provider, call) => ({ ok: true as const, mails: await provider.searchMail(call, search) })),
    readMail: (account, id, signal) => reading(account, signal, async (provider, call) => ({ ok: true as const, mail: await provider.readMail(call, id) })),
    arrived: (account, cursor, signal) => reading(account, signal, async (provider, call) => ({ ok: true as const, ...(await provider.arrived(call, cursor)) }))
  }
}

/** The core's signal as the platform's, for fetch and the listener. */
function abortOf(signal: Signal): AbortSignal {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller.signal
}
