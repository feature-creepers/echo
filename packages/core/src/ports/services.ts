import type { ServiceSign } from '@repo/protocol'
import type { Signal } from './harness.ts'

/** How a service is signed in to (`@repo/protocol`). */
export type { ServiceSign }

/** What a widget app asks of a service's API. The adapter adds the sign-in. */
export interface ServiceRequest {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers: Readonly<Record<string, string>>
  body?: string | undefined
}

/** What a service answered: its status, its media type, and its text. */
export interface ServiceAnswer {
  status: number
  type?: string | undefined
  body: string
}

/** Why something could not be done, in words for the person or a widget's code. */
export type ServiceRefusal = { ok: false; reason: string }

/** How a service is signed in to with OAuth. */
export type OAuthSign = Extract<ServiceSign, { kind: 'oauth' }>

/**
 * The sign-ins of the services the person connected for their widget apps (docs/SPEC.md, section 9.9), and the calls
 * made with them. The adapter keeps each one in the vault of the computer it runs on, under the core's identifier of
 * the connection: the core never handles a token, and neither does a widget. A method never rejects for what a service
 * answers: it resolves with why not.
 */
export interface Services {
  /** Keep a token the person pasted. */
  keep(connection: string, token: string): Promise<void>
  /** Sign in with OAuth 2.0 and PKCE, in the system's browser, with the app the person registered. Resolves when it ends. */
  signIn(connection: string, sign: OAuthSign, clientId: string, signal: Signal): Promise<{ ok: true } | ServiceRefusal>
  /** Whether this computer holds the connection's sign-in. */
  holds(connection: string): Promise<boolean>
  /** Forget the connection's sign-in on this computer. */
  forget(connection: string): Promise<void>
  /** Call the service's API with the connection's sign-in: only an address that starts with `api`. */
  call(connection: string, api: string, sign: ServiceSign, request: ServiceRequest, signal: Signal): Promise<({ ok: true } & ServiceAnswer) | ServiceRefusal>
}
