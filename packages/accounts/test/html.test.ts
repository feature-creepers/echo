import type { Signal } from '@repo/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccounts } from '../src/accounts.ts'
import { type GmailPart, gmailContent } from '../src/providers/gmail-message.ts'
import { type FakeProvider, fakeProvider, handTimers, memoryVault } from './fake-provider.ts'

/** html-to-text as the adapter uses it, watched: it converts as it does, unless a test says otherwise. */
const convert = vi.hoisted(() => vi.fn<(html: string, options?: object) => string>())
vi.mock('html-to-text', async (original) => {
  const actual = await original<typeof import('html-to-text')>()
  convert.mockImplementation(actual.convert)
  return { convert }
})

const html = (data: string): GmailPart => ({
  mimeType: 'text/html',
  headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }],
  body: { data: Buffer.from(data, 'utf8').toString('base64url'), size: data.length }
})

describe('a Gmail message in HTML', () => {
  it.each([
    ['nested 5,000 levels deep', `${'<div>'.repeat(5000)}deep${'</div>'.repeat(5000)}`],
    ['two million characters of paragraphs', '<p>words</p>'.repeat(170_000)],
    ['ten thousand siblings', `<body>${'<span>a</span>'.repeat(10_000)}</body>`]
  ])('is read whole or cut when it is %s, never failing', (_case, page) => {
    const { text } = gmailContent(html(page))
    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThan(500_000)
  })

  it('says its text could not be read when making it text fails', () => {
    convert.mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    expect(gmailContent(html('<p>Hello</p>')).text).toBe('This mail’s text could not be read.')
  })
})

const never: Signal = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }

let fake: FakeProvider
beforeEach(async () => {
  fake = await fakeProvider()
  fake.serve('gmail.googleapis.com/gmail/v1/users/me/profile', () => ({ body: { emailAddress: 'ada@gmail.example', historyId: '1' } }))
})
afterEach(() => fake.close())

describe('a Gmail search', () => {
  it('counts each mail’s files without making its text', async () => {
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/messages', () => ({ body: { messages: [{ id: 'm1' }] } }))
    fake.serve('gmail.googleapis.com/gmail/v1/users/me/messages/m1', () => ({
      body: {
        id: 'm1',
        snippet: 'Your statement',
        internalDate: String(Date.parse('2026-12-01T09:00:00Z')),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [{ name: 'Subject', value: 'Your statement' }],
          parts: [html('<p>Here it is.</p>'), { mimeType: 'application/pdf', filename: 'statement.pdf', body: { size: 1000 } }]
        }
      }
    }))
    const accounts = createAccounts({
      vault: memoryVault(),
      open: (url) => fake.open(url),
      registrations: { google: { clientId: 'test-google', clientSecret: 'test-secret' } },
      log: { error: vi.fn() },
      timers: handTimers(),
      fetch: (url, init) => fake.fetch(url, init)
    })
    await accounts.connect({ account: 'a1', provider: 'google', parts: ['mail'] }, never)
    convert.mockClear()

    expect(await accounts.searchMail('a1', { words: 'statement', limit: 5 }, never)).toMatchObject({ ok: true, mails: [{ attachments: 1 }] })
    expect(convert.mock.calls.map(([text]) => text)).toEqual(['Your statement'])
  })
})
