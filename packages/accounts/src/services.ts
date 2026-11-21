import type { OAuthSign, ServiceRefusal, ServiceSign, Services, Timers } from '@repo/core'
import * as client from 'openid-client'
import { z } from 'zod'
import { abortOf, type Vault } from './accounts.ts'
import { listenLoopback } from './loopback.ts'
import { ANSWER_BYTES, bodyOf, CallFailed, type Fetch } from './requests.ts'

/**
 * The sign-ins of the services the person connected for widget apps, as the core's `Services` port (docs/SPEC.md,
 * section 9.9). A pasted token, or an OAuth refresh token with what renews it, is kept in the vault under
 * `service:<connection>`; an access token is kept in memory only. A sign-in is sent to the service's API alone, never
 * following a redirect, and to its sign-in addresses.
 */

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('token'), token: z.string().min(1) }),
  z.object({ kind: z.literal('oauth'), clientId: z.string().min(1), authorize: z.string(), token: z.string(), refresh: z.string().min(1).optional() })
])
type Entry = z.infer<typeof entrySchema>
type OAuthEntry = Extract<Entry, { kind: 'oauth' }>

/** How long a service has to answer a call. */
const CALL_TIMEOUT_MS = 30_000
/** How long before an access token's end it is renewed. */
const RENEW_BEFORE_MS = 60_000

export interface ServicesOptions {
  vault: Vault
  /** Open an https address with the system's browser: where the person signs in. */
  open(url: string): Promise<void>
  timers: Timers
  /** Left out, the platform's. */
  fetch?: Fetch
}

const refuse = (reason: string): ServiceRefusal => ({ ok: false, reason })
const nameOf = (connection: string) => `service:${connection}`
const AGAIN = 'This service needs connecting again on the widget.'

/** Whether an address is under the API's start: the same origin, and a path at or below its path. The core checked it too. */
export function underApi(address: string, api: string): boolean {
  const url = new URL(address)
  const base = new URL(api)
  const path = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  return url.protocol === 'https:' && url.origin === base.origin && url.username === '' && (url.pathname === base.pathname || url.pathname.startsWith(path))
}

/** A service's sign-in, as openid-client reads it: no discovery, a public client with PKCE, and no redirect followed. */
function configurationOf(entry: Pick<OAuthEntry, 'authorize' | 'token' | 'clientId'>, fetch: Fetch): client.Configuration {
  const configuration = new client.Configuration(
    { issuer: new URL(entry.authorize).origin, authorization_endpoint: entry.authorize, token_endpoint: entry.token },
    entry.clientId,
    undefined,
    client.None()
  )
  configuration[client.customFetch] = (url, init) => fetch(url, { ...(init as RequestInit), redirect: 'manual' })
  return configuration
}

export function createServices({ vault, open, timers, fetch: given }: ServicesOptions): Services {
  const fetchVia: Fetch = given ?? ((url, init) => fetch(url, init))
  /** Access tokens, by connection, until a minute before they end. */
  const access = new Map<string, { token: string; until: number }>()

  const read = async (connection: string): Promise<Entry | undefined> => {
    const text = await vault.read(nameOf(connection))
    if (text === undefined) return undefined
    try {
      const entry = entrySchema.safeParse(JSON.parse(text))
      return entry.success ? entry.data : undefined
    } catch {
      return undefined
    }
  }
  const keep = (connection: string, entry: Entry) => vault.write(nameOf(connection), JSON.stringify(entry))
  const hold = (connection: string, tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers) => {
    const seconds = tokens.expiresIn() ?? 3600
    access.set(connection, { token: tokens.access_token, until: Date.now() + seconds * 1000 - RENEW_BEFORE_MS })
  }

  /** An access token of an OAuth connection, renewed with its refresh token when it is about to end. */
  const accessOf = async (connection: string, entry: OAuthEntry): Promise<string | undefined> => {
    const held = access.get(connection)
    if (held && held.until > Date.now()) return held.token
    if (!entry.refresh) return undefined
    const tokens = await client.refreshTokenGrant(configurationOf(entry, fetchVia), entry.refresh)
    hold(connection, tokens)
    if (tokens.refresh_token && tokens.refresh_token !== entry.refresh) await keep(connection, { ...entry, refresh: tokens.refresh_token })
    return tokens.access_token
  }

  return {
    async keep(connection, token) {
      access.delete(connection)
      await keep(connection, { kind: 'token', token })
    },

    async signIn(connection, sign: OAuthSign, clientId, signal) {
      const stop = abortOf(signal)
      const configuration = configurationOf({ authorize: sign.authorize, token: sign.token, clientId }, fetchVia)
      const verifier = client.randomPKCECodeVerifier()
      const state = client.randomState()
      const loopback = await listenLoopback('127.0.0.1', state, timers, stop)
      try {
        const page = client.buildAuthorizationUrl(configuration, {
          redirect_uri: loopback.redirect,
          ...(sign.scopes.length > 0 ? { scope: sign.scopes.join(' ') } : {}),
          code_challenge: await client.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state
        })
        await open(page.href)
        const answer = await loopback.answer
        if (!answer.ok) return refuse(answer.reason === 'late' ? 'The five minutes to sign in passed: nothing was connected.' : 'The sign-in was cancelled.')
        const tokens = await client.authorizationCodeGrant(configuration, answer.url, { pkceCodeVerifier: verifier, expectedState: state })
        hold(connection, tokens)
        await keep(connection, {
          kind: 'oauth',
          clientId,
          authorize: sign.authorize,
          token: sign.token,
          ...(tokens.refresh_token ? { refresh: tokens.refresh_token } : {})
        })
        return { ok: true }
      } catch (error) {
        if (error instanceof client.AuthorizationResponseError) return refuse(`The service refused the sign-in: ${error.error_description ?? error.error}.`)
        return refuse(`The sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        loopback.close()
      }
    },

    holds: async (connection) => (await read(connection)) !== undefined,

    async forget(connection) {
      access.delete(connection)
      await vault.erase(nameOf(connection))
    },

    async call(connection, api, sign: ServiceSign, request, signal) {
      if (!underApi(request.url, api)) return refuse(`${request.url} is not an address of this service's API.`)
      const entry = await read(connection)
      if (!entry) return refuse(AGAIN)
      const target = new URL(request.url)
      try {
        const token = entry.kind === 'token' ? entry.token : await accessOf(connection, entry)
        if (!token) return refuse(AGAIN)
        const header = sign.kind === 'token' ? sign.header : 'Authorization'
        const headers: Record<string, string> = { accept: 'application/json' }
        // The widget's own headers, but never one in place of the sign-in.
        for (const [name, value] of Object.entries(request.headers)) if (name.toLowerCase() !== header.toLowerCase()) headers[name] = value
        headers[header] = sign.kind === 'token' ? `${sign.prefix}${token}` : `Bearer ${token}`
        const response = await fetchVia(target.href, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: 'manual',
          signal: AbortSignal.any([abortOf(signal), AbortSignal.timeout(CALL_TIMEOUT_MS)])
        })
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel()
          return refuse(`${target.host} answered with a redirect, which is not followed.`)
        }
        // A refused access token is dropped, so the next call renews it.
        if (response.status === 401) access.delete(connection)
        const type = response.headers.get('content-type') ?? undefined
        return { ok: true, status: response.status, ...(type === undefined ? {} : { type }), body: await bodyOf(response, target.host, ANSWER_BYTES) }
      } catch (error) {
        if (error instanceof CallFailed) return refuse(error.message)
        return refuse(`${target.host} could not be reached: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
