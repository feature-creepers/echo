import type { AccountPart, Timers } from '@repo/core'
import * as client from 'openid-client'
import { listenLoopback } from './loopback.ts'
import type { Provider } from './providers/provider.ts'

/**
 * A sign-in (docs/SPEC.md, section 12.4, item 3): OAuth 2.0's authorisation code with PKCE, in the system's browser,
 * coming back to this computer's loopback address (RFC 8252). The code challenge is always sent, with `state`; no
 * ID token is asked for, since only the tokens to read with are needed.
 */

export type SignInOutcome =
  | { ok: true; tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers; parts: AccountPart[] }
  | { ok: false; reason: string }

interface SignInOptions {
  provider: Provider
  configuration: client.Configuration
  parts: readonly AccountPart[]
  /** Open an address with the system's browser. */
  open(url: string): Promise<void>
  timers: Timers
  signal: AbortSignal
}

export const CANCELLED = 'The sign-in was cancelled: nothing was connected.'
const LATE = 'The five minutes to sign in passed: nothing was connected. Try again when you are ready.'

export async function signIn({ provider, configuration, parts, open, timers, signal }: SignInOptions): Promise<SignInOutcome> {
  const verifier = client.randomPKCECodeVerifier()
  const challenge = await client.calculatePKCECodeChallenge(verifier)
  const state = client.randomState()
  const loopback = await listenLoopback(provider.loopback, state, timers, signal)
  try {
    const page = client.buildAuthorizationUrl(configuration, {
      ...provider.authorization,
      redirect_uri: loopback.redirect,
      scope: provider.scopes(parts).join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state
    })
    // What the browser opens is the provider's own sign-in page, never an address its discovery could have changed.
    if (page.protocol !== 'https:' || page.hostname !== provider.signInHost)
      return { ok: false, reason: `The sign-in page of ${provider.label} is not where it should be, so it was not opened.` }
    await open(page.href)
    const answer = await loopback.answer
    if (!answer.ok) return { ok: false, reason: answer.reason === 'late' ? LATE : CANCELLED }
    const tokens = await client.authorizationCodeGrant(configuration, answer.url, { pkceCodeVerifier: verifier, expectedState: state })
    const granted = provider.granted(tokens.scope, parts)
    if (granted.length === 0) return { ok: false, reason: 'Nothing was granted: when you sign in, leave ticked what the assistant may read.' }
    if (!tokens.refresh_token) return { ok: false, reason: `${provider.label} gave no lasting sign-in. Try again.` }
    return { ok: true, tokens, parts: granted }
  } catch (error) {
    if (error instanceof client.AuthorizationResponseError) return { ok: false, reason: provider.refusal(error.error, error.error_description) }
    return { ok: false, reason: `The sign-in to ${provider.label} failed: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    loopback.close()
  }
}
