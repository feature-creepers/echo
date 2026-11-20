import type { AccountPart } from '@repo/core'
import { z } from 'zod'
import { type Provider, scopeSet } from './provider.ts'

/**
 * Microsoft accounts, work, school and personal: Outlook's calendar and mail through Microsoft Graph, read only. The
 * app registration is a public client, with no secret, for the `common` audience. Entra ignores the port of a
 * loopback redirect only for `localhost`, so the browser comes back there.
 */

const SCOPES: Record<AccountPart, string> = { calendar: 'Calendars.Read', mail: 'Mail.Read' }

const GRAPH = 'https://graph.microsoft.com/v1.0'

/** Errors Entra sends when the organisation, not the person, keeps an app out: consent only an administrator gives. */
const ORGANISATION = /AADSTS(50105|65001|90094|90095)\b/

/** A scope as Entra sends it back, "https://graph.microsoft.com/Mail.Read" or "Mail.Read", by its last part. */
const lastPart = (scope: string) => scope.split('/').at(-1) ?? scope

export const microsoft: Provider = {
  id: 'microsoft',
  label: 'Microsoft',
  issuer: new URL('https://login.microsoftonline.com/common/v2.0'),
  signInHost: 'login.microsoftonline.com',
  hosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
  loopback: 'localhost',
  secret: false,
  revokes: false,
  // The address comes from the profile; a refresh token only with offline access.
  scopes: (parts) => [...parts.map((part) => SCOPES[part]), 'User.Read', 'offline_access'],
  authorization: {},
  granted(scope, asked) {
    const granted = new Set([...scopeSet(scope)].map(lastPart))
    return asked.filter((part) => granted.has(SCOPES[part].toLowerCase()))
  },
  async who(call) {
    const me = await call(
      `${GRAPH}/me?$select=displayName,mail,userPrincipalName`,
      z.object({ displayName: z.string().nullish(), mail: z.string().nullish(), userPrincipalName: z.string().min(1) })
    )
    return { address: me.mail || me.userPrincipalName, ...(me.displayName ? { name: me.displayName } : {}) }
  },
  refusal(error, description) {
    if (ORGANISATION.test(description ?? ''))
      return 'Your organisation does not let its members connect this app: its administrator decides. Nothing was connected.'
    if (error === 'access_denied') return 'You declined in your browser. Nothing was connected.'
    return `Microsoft refused the sign-in (${error}). Nothing was connected.`
  },
  notes: [
    'Personal accounts work, and no administrator is needed for what the assistant reads. An organisation may keep its members from connecting apps, or allow only those of a verified publisher: then a work account cannot be connected, and its administrator decides.',
    'A sign-in lasts 90 days without use. Disconnecting forgets it on this computer; to take the access away at Microsoft too, remove the app from your account’s app permissions (for a work or school account, in My Apps, myapps.microsoft.com).'
  ],
  permissions: 'https://account.live.com/consent/Manage'
}
