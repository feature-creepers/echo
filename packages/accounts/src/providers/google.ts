import type { AccountPart, CalendarEvent, EventRange } from '@repo/core'
import { z } from 'zod'
import type { Call } from '../requests.ts'
import { MAX_PAGES, type Provider, scopeSet } from './provider.ts'

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

const calendarListSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), summary: z.string().optional(), summaryOverride: z.string().optional(), selected: z.boolean().optional() }))
    .default([])
})

/** When an event starts or ends: a date for an event all day, else a date and time with its offset. */
const whenSchema = z.object({ date: z.string().optional(), dateTime: z.string().optional() })

const eventSchema = z.object({
  status: z.string().optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  start: whenSchema,
  end: whenSchema,
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional()
})
const eventsSchema = z.object({ items: z.array(eventSchema).default([]), nextPageToken: z.string().optional() })

/** An event as the core reads it. */
export function googleEvent(event: z.infer<typeof eventSchema>, calendar: string): CalendarEvent {
  const allDay = event.start.date !== undefined
  return {
    calendar,
    title: event.summary ?? '(no title)',
    ...(event.location ? { place: event.location } : {}),
    ...(event.description ? { description: event.description } : {}),
    allDay,
    start: (allDay ? event.start.date : event.start.dateTime) ?? '',
    end: (allDay ? event.end.date : event.end.dateTime) ?? '',
    declined: (event.attendees ?? []).some((attendee) => attendee.self === true && attendee.responseStatus === 'declined')
  }
}

/** The calendars the person shows (`selected`), each read for the span, recurring events expanded, in the person's zone. */
async function googleEvents(call: Call, range: EventRange): Promise<CalendarEvent[]> {
  const { items } = await call(`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader`, calendarListSchema)
  const calendars = items.filter((calendar) => calendar.selected === true)
  const read = await Promise.all(
    calendars.map(async (calendar) => {
      const name = calendar.summaryOverride ?? calendar.summary ?? calendar.id
      const found: CalendarEvent[] = []
      let page: string | undefined
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const query = new URLSearchParams({
          timeMin: range.from,
          timeMax: range.until,
          singleEvents: 'true',
          orderBy: 'startTime',
          timeZone: range.zone,
          maxResults: '250',
          ...(page === undefined ? {} : { pageToken: page })
        })
        const answer = await call(`${CALENDAR_API}/calendars/${encodeURIComponent(calendar.id)}/events?${query}`, eventsSchema)
        found.push(...answer.items.filter((event) => event.status !== 'cancelled').map((event) => googleEvent(event, name)))
        page = answer.nextPageToken
        if (page === undefined) break
      }
      return found
    })
  )
  return read.flat()
}

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
  events: googleEvents,
  refusal: (error) =>
    error === 'access_denied'
      ? 'Google said no: you declined, or this account is not one of the test users the app allows while Google has not verified it. Nothing was connected.'
      : `Google refused the sign-in (${error}). Nothing was connected.`,
  notes: [
    'While Google has not verified the app, only the test users its owners added can connect a Google account, Google warns that the app is unverified, and a sign-in lasts seven days: the account then asks you to sign in again.'
  ]
}
