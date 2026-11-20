import type { Signal } from '@repo/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccounts } from '../src/accounts.ts'
import { googleEvent } from '../src/providers/google.ts'
import { microsoftEvent } from '../src/providers/microsoft.ts'
import { type FakeProvider, fakeProvider, handTimers, memoryVault } from './fake-provider.ts'

const never: Signal = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }
const RANGE = { from: '2026-12-02T23:00:00.000Z', until: '2026-12-09T23:00:00.000Z', zone: 'Europe/Paris' }

describe('an event of Google Calendar', () => {
  it.each([
    [
      'timed, in its own zone',
      { summary: 'Dentist', location: 'Lyon', start: { dateTime: '2026-12-03T09:00:00-05:00' }, end: { dateTime: '2026-12-03T10:00:00-05:00' } },
      { title: 'Dentist', place: 'Lyon', allDay: false, start: '2026-12-03T09:00:00-05:00', end: '2026-12-03T10:00:00-05:00', declined: false }
    ],
    [
      'all day',
      { summary: 'Holiday', start: { date: '2026-12-03' }, end: { date: '2026-12-04' } },
      { title: 'Holiday', allDay: true, start: '2026-12-03', end: '2026-12-04', declined: false }
    ],
    [
      'declined by the person',
      {
        start: { dateTime: '2026-12-03T09:00:00Z' },
        end: { dateTime: '2026-12-03T10:00:00Z' },
        attendees: [
          { self: false, responseStatus: 'accepted' },
          { self: true, responseStatus: 'declined' }
        ]
      },
      { title: '(no title)', allDay: false, declined: true }
    ]
  ])('%s', (_case, event, read) => {
    expect(googleEvent(event, 'Personal')).toMatchObject({ calendar: 'Personal', ...read })
  })
})

describe('an event of Outlook', () => {
  it.each([
    [
      'timed, asked in UTC',
      {
        subject: 'Board',
        start: { dateTime: '2026-12-03T09:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-12-03T10:30:00.0000000', timeZone: 'UTC' }
      },
      { title: 'Board', allDay: false, start: '2026-12-03T09:00:00.000Z', end: '2026-12-03T10:30:00.000Z', declined: false }
    ],
    [
      'all day',
      { subject: 'Holiday', isAllDay: true, start: { dateTime: '2026-12-03T00:00:00.0000000' }, end: { dateTime: '2026-12-05T00:00:00.0000000' } },
      { title: 'Holiday', allDay: true, start: '2026-12-03', end: '2026-12-05' }
    ],
    [
      'all day, Graph saying UTC',
      {
        subject: 'Holiday',
        isAllDay: true,
        start: { dateTime: '2026-12-03T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-12-04T00:00:00.0000000', timeZone: 'UTC' }
      },
      { allDay: true, start: '2026-12-03', end: '2026-12-04' }
    ],
    [
      'all day, Graph saying the event’s own zone',
      {
        subject: 'Holiday',
        isAllDay: true,
        start: { dateTime: '2026-12-03T00:00:00.0000000', timeZone: 'Tokyo Standard Time' },
        end: { dateTime: '2026-12-04T00:00:00.0000000', timeZone: 'Tokyo Standard Time' }
      },
      { allDay: true, start: '2026-12-03', end: '2026-12-04' }
    ],
    [
      'declined, with a place and a preview',
      {
        subject: 'Lunch',
        location: { displayName: 'Café' },
        bodyPreview: 'See you there',
        responseStatus: { response: 'declined' },
        start: { dateTime: '2026-12-03T12:00:00.0000000' },
        end: { dateTime: '2026-12-03T13:00:00.0000000' }
      },
      { title: 'Lunch', place: 'Café', description: 'See you there', declined: true }
    ]
  ])('%s', (_case, event, read) => {
    expect(microsoftEvent(event, 'Calendar')).toMatchObject({ calendar: 'Calendar', ...read })
  })
})

let fake: FakeProvider
beforeEach(async () => {
  fake = await fakeProvider()
  fake.serve('gmail.googleapis.com/gmail/v1/users/me/profile', () => ({ body: { emailAddress: 'ada@gmail.example', historyId: '1' } }))
  fake.serve('graph.microsoft.com/v1.0/me', () => ({ body: { displayName: 'Ada', mail: 'ada@outlook.example', userPrincipalName: 'ada@outlook.example' } }))
})
afterEach(async () => {
  vi.useRealTimers()
  await fake.close()
})

async function connected(provider: 'google' | 'microsoft') {
  const vault = memoryVault()
  const accounts = createAccounts({
    vault,
    open: (url) => fake.open(url),
    registrations: { google: { clientId: 'test-google', clientSecret: 'test-secret' }, microsoft: { clientId: 'test-microsoft' } },
    log: { error: vi.fn() },
    timers: handTimers(),
    fetch: (url, init) => fake.fetch(url, init)
  })
  await accounts.connect({ account: 'a1', provider, parts: ['calendar', 'mail'] }, never)
  return { accounts, vault }
}

describe('reading a calendar', () => {
  it('reads the calendars the person shows in Google, recurring events expanded, without the cancelled ones', async () => {
    const asked: URL[] = []
    fake.serve('www.googleapis.com/calendar/v3/users/me/calendarList', () => ({
      body: {
        items: [
          { id: 'ada@gmail.example', summary: 'Ada', selected: true },
          { id: 'holidays', summary: 'Holidays', summaryOverride: 'Days off', selected: true },
          { id: 'hidden', summary: 'Hidden' }
        ]
      }
    }))
    fake.serve('www.googleapis.com/calendar/v3/calendars/ada@gmail.example/events', (url) => {
      asked.push(url)
      return url.searchParams.get('pageToken')
        ? { body: { items: [{ summary: 'Yoga', start: { dateTime: '2026-12-05T08:00:00Z' }, end: { dateTime: '2026-12-05T09:00:00Z' } }] } }
        : {
            body: {
              items: [
                { summary: 'Yoga', start: { dateTime: '2026-12-03T08:00:00Z' }, end: { dateTime: '2026-12-03T09:00:00Z' } },
                { status: 'cancelled', summary: 'Gone', start: { dateTime: '2026-12-04T08:00:00Z' }, end: { dateTime: '2026-12-04T09:00:00Z' } }
              ],
              nextPageToken: 'next'
            }
          }
    })
    fake.serve('www.googleapis.com/calendar/v3/calendars/holidays/events', () => ({
      body: { items: [{ summary: 'Holiday', start: { date: '2026-12-04' }, end: { date: '2026-12-05' } }] }
    }))
    const { accounts } = await connected('google')

    const read = await accounts.events('a1', RANGE, never)

    expect(read.ok && read.events.map((event) => `${event.calendar}: ${event.title} ${event.start}`)).toEqual([
      'Ada: Yoga 2026-12-03T08:00:00Z',
      'Ada: Yoga 2026-12-05T08:00:00Z',
      'Days off: Holiday 2026-12-04'
    ])
    expect(Object.fromEntries(asked[0]?.searchParams ?? [])).toMatchObject({
      timeMin: RANGE.from,
      timeMax: RANGE.until,
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone: 'Europe/Paris'
    })
  })

  it('reads every Outlook calendar as a view of the span, in UTC, page after page', async () => {
    const prefer: (string | undefined)[] = []
    fake.serve('graph.microsoft.com/v1.0/me/calendars', () => ({ body: { value: [{ id: 'main', name: 'Calendar' }] } }))
    fake.serve('graph.microsoft.com/v1.0/me/calendars/main/calendarView', (url, request) => {
      prefer.push(String(request.headers.prefer))
      const moment = (time: string) => ({ dateTime: `2026-12-03T${time}:00.0000000`, timeZone: 'UTC' })
      return url.searchParams.get('$skip')
        ? { body: { value: [{ subject: 'Later', start: moment('15:00'), end: moment('16:00') }] } }
        : {
            body: {
              value: [
                { subject: 'Board', start: moment('09:00'), end: moment('10:00') },
                { subject: 'Gone', isCancelled: true, start: moment('11:00'), end: moment('12:00') }
              ],
              '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/calendars/main/calendarView?${url.searchParams}&$skip=2`
            }
          }
    })
    const { accounts } = await connected('microsoft')

    const read = await accounts.events('a1', RANGE, never)

    expect(read.ok && read.events.map((event) => `${event.title} ${event.start}`)).toEqual(['Board 2026-12-03T09:00:00.000Z', 'Later 2026-12-03T15:00:00.000Z'])
    expect(prefer).toEqual(['outlook.timezone="UTC"', 'outlook.timezone="UTC"'])
  })

  it('renews an access token near its end, and keeps the new refresh token Microsoft gives', async () => {
    fake.serve('graph.microsoft.com/v1.0/me/calendars', () => ({ body: { value: [] } }))
    const { accounts, vault } = await connected('microsoft')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 3_600_000)

    expect(await accounts.events('a1', RANGE, never)).toEqual({ ok: true, events: [] })
    expect(fake.tokenRequests.map((form) => form.get('grant_type'))).toEqual(['authorization_code', 'refresh_token'])
    expect(vault.entries.get('account:a1')).toContain('refresh-2')
  })

  it('asks for a new sign-in when the provider no longer takes the token', async () => {
    fake.serve('graph.microsoft.com/v1.0/me/calendars', () => ({ body: { value: [] } }))
    const { accounts } = await connected('microsoft')
    fake.live.clear()

    expect(await accounts.events('a1', RANGE, never)).toMatchObject({ ok: false, signIn: true })
  })

  it('asks for a new sign-in when this computer holds none', async () => {
    const { accounts } = await connected('google')
    expect(await accounts.events('other', RANGE, never)).toMatchObject({ ok: false, signIn: true })
  })
})
