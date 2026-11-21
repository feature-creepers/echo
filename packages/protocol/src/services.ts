import { z } from 'zod'

/**
 * The services the person connected for their widget apps (docs/SPEC.md, section 9.9): an API they signed in to once,
 * with a token they pasted or with OAuth, that the widgets they allow call with that sign-in. The list is kept by the
 * core; the tokens are kept in the vault of the computer that made them, never in the store, and never given to a
 * widget.
 */

/** An https address, or the start of addresses: "https://api.github.com/". */
export const httpsAddressSchema = z.url({ protocol: /^https$/ }).max(500)

/** How the person signs in to a service. */
export const serviceSignSchema = z.discriminatedUnion('kind', [
  z.object({
    /** A token the person makes at the service and pastes: sent in `header`, after `prefix`. */
    kind: z.literal('token'),
    header: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/)
      .default('Authorization'),
    prefix: z.string().max(40).default('Bearer '),
    /** The service's page where the person makes one. */
    help: httpsAddressSchema.optional()
  }),
  z.object({
    /** OAuth 2.0's authorisation code with PKCE, in the system's browser, with an app the person registered at the service. */
    kind: z.literal('oauth'),
    authorize: httpsAddressSchema,
    token: httpsAddressSchema,
    scopes: z.array(z.string().min(1).max(200)).max(30).default([]),
    /** The service's page where the person registers the app, whose client identifier they give. */
    help: httpsAddressSchema.optional()
  })
])
export type ServiceSign = z.infer<typeof serviceSignSchema>

/** A service a widget app calls with the person's sign-in. */
export const serviceSchema = z.object({
  /** The start of every address of its API. A sign-in is sent nowhere else. */
  api: httpsAddressSchema,
  /** Its name for the person: "GitHub". */
  name: z.string().trim().min(1).max(60),
  sign: serviceSignSchema
})
export type Service = z.infer<typeof serviceSchema>

export const connectionIdSchema = z.string().min(1).max(64)

/** A service connected, as a client shows it. */
export const connectionSchema = z.object({
  id: connectionIdSchema,
  api: httpsAddressSchema,
  name: z.string().min(1).max(60),
  kind: z.enum(['token', 'oauth']),
  /** When it was connected: an ISO 8601 date in UTC. */
  since: z.string(),
  /** Whether this computer holds its sign-in (`ready`), or the person must connect it again. */
  state: z.enum(['ready', 'sign-in-again'])
})
export type Connection = z.infer<typeof connectionSchema>

/** The most services connected at once. */
export const MAX_CONNECTIONS = 32

/** Every service connected, and the sign-in under way in the browser, if one is. */
export const servicesViewSchema = z.object({
  connections: z.array(connectionSchema).max(MAX_CONNECTIONS),
  signingIn: z.object({ api: httpsAddressSchema, since: z.string() }).optional()
})
export type ServicesView = z.infer<typeof servicesViewSchema>

/** The host and path of an https address, or nothing for one that is not plainly one: with a user, a backslash or a dot segment. */
function partsOf(address: string): { authority: string; path: string } | undefined {
  const match = /^https:\/\/([^/?#\\]*)([^?#]*)/i.exec(address)
  const authority = match?.[1]?.toLowerCase()
  if (!match || !authority || authority.includes('@')) return undefined
  const path = match[2] || '/'
  if (path.includes('\\') || /(^|\/)(\.|%2e){1,2}(\/|$)/i.test(path)) return undefined
  return { authority, path }
}

/**
 * Whether an address is one of those that start with `start`: the same host and port over https, and a path at or
 * under its path, so "https://api.example.com/v1" never covers "https://api.example.com.evil.net/" or "/v10".
 */
export function isWithin(address: string, start: string): boolean {
  const url = partsOf(address)
  const base = partsOf(start)
  if (!url || !base || url.authority !== base.authority) return false
  const path = base.path.endsWith('/') ? base.path : `${base.path}/`
  return url.path === base.path || url.path.startsWith(path)
}
