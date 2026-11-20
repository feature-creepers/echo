import type { Signal } from '@repo/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccounts } from '../src/accounts.ts'
import { addressesOf, type GmailPart, gmailContent } from '../src/providers/gmail-message.ts'
import { gmailQuery } from '../src/providers/google.ts'
import { graphSearch } from '../src/providers/microsoft.ts'
import { type FakeProvider, fakeProvider, handTimers, memoryVault } from './fake-provider.ts'

describe('a mail search', () => {
  it.each([
    [{ words: 'lease renewal', limit: 10 }, '"lease renewal"', '"\\"lease renewal\\""'],
    [{ from: 'bank', after: '2026-11-01', limit: 10 }, 'from:"bank" after:2026/11/01', '"from:\\"bank\\" AND received>=2026-11-01"'],
    [{ before: '2026-12-01', limit: 10 }, 'before:2026/12/01', '"received<2026-12-01"'],
    [
      { words: 'the "final" offer', from: 'Ada Lovelace', after: '2026-11-01', before: '2026-12-01', limit: 10 },
      '"the final offer" from:"Ada Lovelace" after:2026/11/01 before:2026/12/01',
      '"\\"the final offer\\" AND from:\\"Ada Lovelace\\" AND received>=2026-11-01 AND received<2026-12-01"'
    ],
    [{ words: 'x OR from:boss label:spam\\', limit: 10 }, '"x OR from:boss label:spam"', '"\\"x OR from:boss label:spam\\""']
  ])('%j is Gmail’s q %s and Graph’s $search %s, every value quoted', (search, q, kql) => {
    expect(gmailQuery(search)).toBe(q)
    expect(graphSearch(search)).toBe(kql)
  })
})

const text = (data: string, type = 'text/plain; charset="UTF-8"'): GmailPart => ({
  mimeType: type.split(';')[0],
  headers: [{ name: 'Content-Type', value: type }],
  body: { data: Buffer.from(data, 'utf8').toString('base64url'), size: data.length }
})

describe('a Gmail message', () => {
  it.each<[string, GmailPart, string, string[]]>([
    ['plain only', text('Your statement is ready.'), 'Your statement is ready.', []],
    [
      'alternative parts, the plain one taken',
      { mimeType: 'multipart/alternative', parts: [text('Plain words.'), text('<p>HTML <b>words</b>.</p>', 'text/html; charset=UTF-8')] },
      'Plain words.',
      []
    ],
    [
      'HTML only, made text',
      text('<p>Hello <b>Ada</b>,</p><p>See <a href="https://x.example">the offer</a>.</p>', 'text/html; charset=UTF-8'),
      'Hello Ada,\n\nSee the offer.',
      []
    ],
    [
      'nested parts with attachments',
      {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'multipart/alternative', parts: [text('The lease, attached.'), text('<p>The lease, attached.</p>', 'text/html')] },
          { mimeType: 'application/pdf', filename: 'lease.pdf', body: { size: 225_280 } },
          {
            mimeType: 'image/png',
            filename: 'map.png',
            headers: [{ name: 'Content-Disposition', value: 'attachment; filename="map.png"' }],
            body: { size: 900 }
          }
        ]
      },
      'The lease, attached.',
      ['lease.pdf application/pdf 225280', 'map.png image/png 900']
    ],
    [
      'base64url with its own alphabet',
      { mimeType: 'text/plain', body: { data: Buffer.from('ÿþ?>~ dashes and underscores', 'utf8').toString('base64url') } },
      'ÿþ?>~ dashes and underscores',
      []
    ],
    [
      'a Latin-1 part',
      {
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }],
        body: { data: Buffer.from('Réunion à 10h', 'latin1').toString('base64url') }
      },
      'Réunion à 10h',
      []
    ]
  ])('%s', (_case, payload, words, files) => {
    const { text: read, attachments } = gmailContent(payload)
    expect(read).toBe(words)
    expect(attachments.map((file) => `${file.name} ${file.kind} ${file.size}`)).toEqual(files)
  })

  it.each([
    ['Ada Lovelace <ada@example.com>', [{ name: 'Ada Lovelace', address: 'ada@example.com' }]],
    ['"Lovelace, Ada" <ada@example.com>, bob@example.com', [{ name: 'Lovelace, Ada', address: 'ada@example.com' }, { address: 'bob@example.com' }]],
    ['<no-reply@bank.example>', [{ address: 'no-reply@bank.example' }]]
  ])('reads the addresses of %s', (header, addresses) => {
    expect(addressesOf(header)).toEqual(addresses)
  })
})

const never: Signal = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }

let fake: FakeProvider
beforeEach(async () => {
  fake = await fakeProvider()
  fake.serve('gmail.googleapis.com/gmail/v1/users/me/profile', () => ({ body: { emailAddress: 'ada@gmail.example', historyId: '1' } }))
  fake.serve('graph.microsoft.com/v1.0/me', () => ({ body: { displayName: 'Ada', mail: 'ada@outlook.example', userPrincipalName: 'ada@outlook.example' } }))
})
afterEach(() => fake.close())

async function connected(provider: 'google' | 'microsoft') {
  const accounts = createAccounts({
    vault: memoryVault(),
    open: (url) => fake.open(url),
    registrations: { google: { clientId: 'test-google', clientSecret: 'test-secret' }, microsoft: { clientId: 'test-microsoft' } },
    log: { error: vi.fn() },
    timers: handTimers(),
    fetch: (url, init) => fake.fetch(url, init)
  })
  await accounts.connect({ account: 'a1', provider, parts: ['mail'] }, never)
  return accounts
}

describe('reading mail', () => {
  it('searches Gmail with its q, and reads each message for its sender, subject and files', async () => {
    const queries: string[] = []
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/messages', (url) => {
      queries.push(url.searchParams.get('q') ?? '')
      return { body: { messages: [{ id: 'm1' }] } }
    })
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/messages/m1', () => ({
      body: {
        id: 'm1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Your statement for November &amp; more',
        internalDate: String(Date.parse('2026-12-01T09:00:00Z')),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'Bank <no-reply@bank.example>' },
            { name: 'Subject', value: 'Your statement' }
          ],
          parts: [text('Here it is.'), { mimeType: 'application/pdf', filename: 'statement.pdf', body: { size: 1000 } }]
        }
      }
    }))
    const accounts = await connected('google')

    const found = await accounts.searchMail('a1', { from: 'bank', limit: 5 }, never)

    expect(queries).toEqual(['from:"bank"'])
    expect(found).toEqual({
      ok: true,
      mails: [
        {
          id: 'm1',
          date: '2026-12-01T09:00:00.000Z',
          from: { name: 'Bank', address: 'no-reply@bank.example' },
          subject: 'Your statement',
          snippet: 'Your statement for November & more',
          unread: true,
          attachments: 1
        }
      ]
    })
  })

  it('reads an Outlook mail as text, its attachments listed and never downloaded', async () => {
    const prefer: string[] = []
    fake.serve('graph.microsoft.com/v1.0/me/messages/AAMk-1=', (_url, request) => {
      prefer.push(String(request.headers.prefer))
      return {
        body: {
          id: 'AAMk-1=',
          receivedDateTime: '2026-12-01T09:00:00Z',
          from: { emailAddress: { name: 'Landlord', address: 'landlord@example.com' } },
          toRecipients: [{ emailAddress: { name: 'Ada', address: 'ada@outlook.example' } }],
          ccRecipients: [],
          subject: 'The lease',
          body: { content: 'Please sign.\r\nThanks.' },
          hasAttachments: true
        }
      }
    })
    fake.serve('graph.microsoft.com/v1.0/me/messages/AAMk-1=/attachments', (url) => {
      expect(url.searchParams.get('$select')).toBe('name,contentType,size')
      return { body: { value: [{ name: 'lease.pdf', contentType: 'application/pdf', size: 2048 }] } }
    })
    const accounts = await connected('microsoft')

    const read = await accounts.readMail('a1', 'AAMk-1=', never)

    expect(read).toMatchObject({
      ok: true,
      mail: {
        subject: 'The lease',
        text: 'Please sign.\nThanks.',
        to: [{ address: 'ada@outlook.example' }],
        attachments: [{ name: 'lease.pdf', kind: 'application/pdf', size: 2048 }]
      }
    })
    expect(prefer).toEqual(['outlook.body-content-type="text"'])
  })
})

describe('what arrived', () => {
  it('takes Gmail’s history from now on its first look, then the inbox’s new mails, and a new cursor for one too old', async () => {
    let historyId = '100'
    const asked: string[] = []
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/profile', () => ({ body: { emailAddress: 'ada@gmail.example', historyId } }))
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/history', (url) => {
      asked.push(`${url.searchParams.get('startHistoryId')} ${url.searchParams.get('labelId')} ${url.searchParams.get('historyTypes')}`)
      if (url.searchParams.get('startHistoryId') === 'gone') return { status: 404, body: { error: { message: 'Requested entity was not found.' } } }
      return { body: { history: [{ messagesAdded: [{ message: { id: 'm2' } }] }], historyId: '120' } }
    })
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/messages/m2', (url) => {
      expect(url.searchParams.get('format')).toBe('metadata')
      return {
        body: {
          id: 'm2',
          labelIds: ['INBOX'],
          payload: {
            headers: [
              { name: 'From', value: 'Landlord <landlord@example.com>' },
              { name: 'Subject', value: 'The lease' }
            ]
          }
        }
      }
    })
    const accounts = await connected('google')

    expect(await accounts.arrived('a1', undefined, never)).toEqual({ ok: true, cursor: '100', mails: [] })
    expect(await accounts.arrived('a1', '100', never)).toEqual({
      ok: true,
      cursor: '120',
      mails: [{ id: 'm2', from: { name: 'Landlord', address: 'landlord@example.com' }, subject: 'The lease' }]
    })
    historyId = '150'
    expect(await accounts.arrived('a1', 'gone', never)).toEqual({ ok: true, cursor: '150', mails: [] })
    expect(asked).toEqual(['100 INBOX messageAdded', 'gone INBOX messageAdded'])
  })

  it('follows Graph’s delta of the inbox from now, leaving out what was removed, and starts again from now when it is gone', async () => {
    const delta = 'graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta'
    fake.serve(delta, (url) => {
      if (url.searchParams.get('$filter')) return { body: { value: [], '@odata.deltaLink': `https://${delta}?$deltatoken=first` } }
      if (url.searchParams.get('$deltatoken') === 'expired') return { status: 410, body: { error: { message: 'Gone' } } }
      return {
        body: {
          value: [
            { id: 'n1', from: { emailAddress: { name: 'Bank', address: 'no-reply@bank.example' } }, subject: 'Your statement' },
            { id: 'n0', '@removed': { reason: 'deleted' } }
          ],
          '@odata.deltaLink': `https://${delta}?$deltatoken=second`
        }
      }
    })
    const accounts = await connected('microsoft')

    expect(await accounts.arrived('a1', undefined, never)).toEqual({ ok: true, cursor: `https://${delta}?$deltatoken=first`, mails: [] })
    expect(await accounts.arrived('a1', `https://${delta}?$deltatoken=first`, never)).toEqual({
      ok: true,
      cursor: `https://${delta}?$deltatoken=second`,
      mails: [{ id: 'n1', from: { name: 'Bank', address: 'no-reply@bank.example' }, subject: 'Your statement' }]
    })
    expect(await accounts.arrived('a1', `https://${delta}?$deltatoken=expired`, never)).toEqual({
      ok: true,
      cursor: `https://${delta}?$deltatoken=first`,
      mails: []
    })
  })

  it('never follows a cursor to another host', async () => {
    const accounts = await connected('microsoft')
    expect(await accounts.arrived('a1', 'https://elsewhere.example/delta', never)).toMatchObject({ ok: false, reason: expect.stringContaining('not a host') })
  })
})
