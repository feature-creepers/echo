import type { AccountPart, CalendarEvent, EventRange } from '@repo/core'
import { z } from 'zod'
import type { Call } from '../requests.ts'
import { MAX_PAGES, type Provider, scopeSet } from './provider.ts'

/**
 * Microsoft accounts, work, school and personal: Outlook's calendar and mail through Microsoft Graph, read only. The
 * app registration is a public client, with no secret, for the `common` audience. Entra ignores the port of a
 * loopback redirect only for `localhost`, so the browser comes back there.
 */

const SCOPES: Record<AccountPart, string> = { calendar: 'Calendars.Read', mail: 'Mail.Read' }

const GRAPH = 'https://graph.microsoft.com/v1.0'

/** Errors Entra sends when the organisation, not the person, keeps an app out: consent only an administrator gives. */
const ORGANISATION = /AADSTS(50105|65001|90094|90095)\b/

const calendarsSchema = z.object({ value: z.array(z.object({ id: z.string(), name: z.string().nullish() })) })

/** A moment as Graph gives it, in the zone asked for: "2026-12-03T09:00:00.0000000", with no offset. */
const momentSchema = z.object({ dateTime: z.string(), timeZone: z.string().optional() })

const eventSchema = z.object({
  subject: z.string().nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  bodyPreview: z.string().nullish(),
  start: momentSchema,
  end: momentSchema,
  isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  responseStatus: z.object({ response: z.string().nullish() }).nullish()
})
const viewSchema = z.object({ value: z.array(eventSchema), '@odata.nextLink': z.string().optional() })

/**
 * An event as the core reads it. Graph is asked for its times in UTC, so they are read as instants whatever the
 * zone; an event all day keeps its dates.
 */
export function microsoftEvent(event: z.infer<typeof eventSchema>, calendar: string): CalendarEvent {
  const allDay = event.isAllDay === true
  const moment = (when: z.infer<typeof momentSchema>) => (allDay ? when.dateTime.slice(0, 10) : new Date(`${when.dateTime.slice(0, 23)}Z`).toISOString())
  return {
    calendar,
    title: event.subject || '(no title)',
    ...(event.location?.displayName ? { place: event.location.displayName } : {}),
    ...(event.bodyPreview ? { description: event.bodyPreview } : {}),
    allDay,
    start: moment(event.start),
    end: moment(event.end),
    declined: event.responseStatus?.response === 'declined'
  }
}

/** Every calendar of the account, each read as a view of the span, which expands recurring events. */
async function microsoftEvents(call: Call, range: EventRange): Promise<CalendarEvent[]> {
  const { value: calendars } = await call(`${GRAPH}/me/calendars?$select=id,name&$top=100`, calendarsSchema)
  const read = await Promise.all(
    calendars.map(async (calendar) => {
      const found: CalendarEvent[] = []
      const query = new URLSearchParams({
        startDateTime: range.from,
        endDateTime: range.until,
        $select: 'subject,location,bodyPreview,start,end,isAllDay,isCancelled,responseStatus',
        $top: '250'
      })
      let page: string | undefined = `${GRAPH}/me/calendars/${encodeURIComponent(calendar.id)}/calendarView?${query}`
      for (let pages = 0; pages < MAX_PAGES && page !== undefined; pages++) {
        const answer: z.infer<typeof viewSchema> = await call(page, viewSchema, { prefer: 'outlook.timezone="UTC"' })
        found.push(...answer.value.filter((event) => event.isCancelled !== true).map((event) => microsoftEvent(event, calendar.name ?? 'Calendar')))
        page = answer['@odata.nextLink']
      }
      return found
    })
  )
  return read.flat()
}

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
  events: microsoftEvents,
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
