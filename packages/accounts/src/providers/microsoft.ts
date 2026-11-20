import type { AccountPart, CalendarEvent, EventRange, MailAddress, MailArrival, MailMessage, MailSearch, MailSummary } from '@repo/core'
import { z } from 'zod'
import { type Call, CallFailed } from '../requests.ts'
import { MAX_PAGES, type Provider, quoted, scopeSet } from './provider.ts'

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

const recipientSchema = z.object({ emailAddress: z.object({ name: z.string().nullish(), address: z.string().nullish() }) })
const mailSchema = z.object({
  id: z.string(),
  receivedDateTime: z.string(),
  from: recipientSchema.nullish(),
  subject: z.string().nullish(),
  bodyPreview: z.string().nullish(),
  isRead: z.boolean().optional(),
  hasAttachments: z.boolean().optional()
})
const fullMailSchema = mailSchema.extend({
  toRecipients: z.array(recipientSchema).default([]),
  ccRecipients: z.array(recipientSchema).default([]),
  body: z.object({ content: z.string().nullish() }).nullish()
})
const attachmentsSchema = z.object({ value: z.array(z.object({ name: z.string().nullish(), contentType: z.string().nullish(), size: z.number().nullish() })) })

/** A search as Graph's `$search`: KQL, each value quoted, the whole quoted again as Graph asks. */
export function graphSearch(search: MailSearch): string {
  const kql = [
    search.words ? quoted(search.words) : '',
    search.from ? `from:${quoted(search.from)}` : '',
    search.after ? `received>=${search.after}` : '',
    search.before ? `received<${search.before}` : ''
  ]
    .filter(Boolean)
    .join(' AND ')
  return `"${kql.replaceAll('"', '\\"')}"`
}

const addressOf = (recipient: z.infer<typeof recipientSchema> | null | undefined): MailAddress => ({
  address: recipient?.emailAddress.address || recipient?.emailAddress.name || '(unknown)',
  ...(recipient?.emailAddress.name ? { name: recipient.emailAddress.name } : {})
})

const SUMMARY_FIELDS = 'id,receivedDateTime,from,subject,bodyPreview,isRead,hasAttachments'

async function graphMailSearch(call: Call, search: MailSearch): Promise<MailSummary[]> {
  const query = new URLSearchParams({ $search: graphSearch(search), $top: String(search.limit), $select: SUMMARY_FIELDS })
  const { value } = await call(`${GRAPH}/me/messages?${query}`, z.object({ value: z.array(mailSchema) }))
  return value.map((mail) => ({
    id: mail.id,
    date: new Date(mail.receivedDateTime).toISOString(),
    from: addressOf(mail.from),
    subject: mail.subject || '(no subject)',
    snippet: mail.bodyPreview ?? '',
    unread: mail.isRead === false,
    // Graph only says whether a mail carries files; counting them is a call for each.
    attachments: mail.hasAttachments ? 'some' : 0
  }))
}

async function graphMailRead(call: Call, id: string): Promise<MailMessage> {
  const at = `${GRAPH}/me/messages/${encodeURIComponent(id)}`
  const mail = await call(`${at}?$select=${SUMMARY_FIELDS},toRecipients,ccRecipients,body`, fullMailSchema, { prefer: 'outlook.body-content-type="text"' })
  const files = mail.hasAttachments ? (await call(`${at}/attachments?$select=name,contentType,size`, attachmentsSchema)).value : []
  return {
    id: mail.id,
    date: new Date(mail.receivedDateTime).toISOString(),
    from: addressOf(mail.from),
    to: mail.toRecipients.map(addressOf),
    cc: mail.ccRecipients.map(addressOf),
    subject: mail.subject || '(no subject)',
    text: (mail.body?.content ?? '').replace(/\r\n/g, '\n').trim(),
    attachments: files.map((file) => ({
      name: file.name || 'unnamed',
      kind: (file.contentType || 'application/octet-stream').toLowerCase(),
      size: file.size ?? 0
    }))
  }
}

const deltaSchema = z.object({
  value: z.array(z.object({ id: z.string(), from: recipientSchema.nullish(), subject: z.string().nullish(), '@removed': z.unknown().optional() })),
  '@odata.nextLink': z.string().optional(),
  '@odata.deltaLink': z.string().optional()
})

/**
 * What arrived in the inbox since a delta link, Graph's own cursor. The first look asks only from now, so the mails
 * already there are not told. A link Graph no longer knows (410) is replaced by one of now.
 */
async function graphArrived(call: Call, cursor: string | undefined): Promise<{ cursor: string; mails: MailArrival[] }> {
  const fresh = new URLSearchParams({ $filter: `receivedDateTime ge ${new Date().toISOString()}`, $select: 'from,subject,receivedDateTime,isRead' })
  const read = async (start: string) => {
    const mails: MailArrival[] = []
    let page: string | undefined = start
    for (let pages = 0; pages < MAX_PAGES && page !== undefined; pages++) {
      const answer: z.infer<typeof deltaSchema> = await call(page, deltaSchema)
      for (const mail of answer.value)
        if (mail['@removed'] === undefined) mails.push({ id: mail.id, from: addressOf(mail.from), subject: mail.subject || '(no subject)' })
      if (answer['@odata.deltaLink']) return { cursor: answer['@odata.deltaLink'], mails }
      page = answer['@odata.nextLink']
    }
    throw new CallFailed('Graph gave no delta link to carry on from.')
  }
  const now = async () => ({ cursor: (await read(`${GRAPH}/me/mailFolders/inbox/messages/delta?${fresh}`)).cursor, mails: [] })
  if (cursor === undefined) return now()
  try {
    return await read(cursor)
  } catch (error) {
    if (error instanceof CallFailed && error.status === 410) return now()
    throw error
  }
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
  searchMail: graphMailSearch,
  readMail: graphMailRead,
  arrived: graphArrived,
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
