import type { AccountPart } from '@repo/core'
import { z } from 'zod'
import { type Provider, scopeSet } from './provider.ts'

/**
 * Google accounts: Google Calendar and Gmail, read only. The app registration is a client of type "Desktop app",
 * whose "secret" Google gives and asks for at its token endpoint, while documenting that a desktop app cannot keep it
 * (RFC 8252, section 8.5): it comes from the build's configuration, and the person's own tokens never leave the vault.
 */

const SCOPES: Record<AccountPart, string> = {
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  mail: 'https://www.googleapis.com/auth/gmail.readonly'
}

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const google: Provider = {
  id: 'google',
  label: 'Google',
  issuer: new URL('https://accounts.google.com'),
  signInHost: 'accounts.google.com',
  hosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'gmail.googleapis.com'],
  loopback: '127.0.0.1',
  secret: true,
  revokes: true,
  scopes: (parts) => parts.map((part) => SCOPES[part]),
  // A refresh token comes only with offline access, and again on a later sign-in only when consent is asked again.
  authorization: { access_type: 'offline', prompt: 'consent' },
  granted(scope, asked) {
    const granted = scopeSet(scope)
    return asked.filter((part) => granted.has(SCOPES[part]))
  },
  async who(call, parts) {
    // Gmail's profile names the address; with the calendar alone, the primary calendar's identifier is the address.
    if (parts.includes('mail')) return { address: (await call(`${GMAIL_API}/profile`, z.object({ emailAddress: z.string().min(1) }))).emailAddress }
    return { address: (await call(`${CALENDAR_API}/calendars/primary`, z.object({ id: z.string().min(1) }))).id }
  },
  refusal: (error) =>
    error === 'access_denied'
      ? 'Google said no: you declined, or this account is not one of the test users the app allows while Google has not verified it. Nothing was connected.'
      : `Google refused the sign-in (${error}). Nothing was connected.`,
  notes: [
    'While Google has not verified the app, only the test users its owners added can connect a Google account, Google warns that the app is unverified, and a sign-in lasts seven days: the account then asks you to sign in again.'
  ]
}
