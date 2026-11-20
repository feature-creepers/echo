import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccounts, type Vault } from '@repo/accounts'
import { createCore, type Harness, type SessionEvent, type SessionRequest } from '@repo/core'
import { COMMANDS, type CommandInput, type CommandName, type CommandOutput } from '@repo/protocol'
import { openStore, STORE_FILE } from '@repo/store'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Secrets are never written to the store (docs/SPEC.md, section 5.2): after a sign-in and a few reads through the
 * core's tools, neither the database nor its write-ahead log holds a token. Google is played by the test's fetch.
 */

const ACCESS = 'access-token-of-ada-5f2c9e71'
const REFRESH = 'refresh-token-of-ada-8d41b7c3'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

async function provider(url: string): Promise<Response> {
  const { host, pathname } = new URL(url)
  switch (`${host}${pathname}`) {
    case 'accounts.google.com/.well-known/openid-configuration':
      return json({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token'
      })
    case 'oauth2.googleapis.com/token':
      return json({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly'
      })
    case 'gmail.googleapis.com/gmail/v1/users/me/profile':
      return json({ emailAddress: 'ada@example.com', historyId: '7' })
    case 'www.googleapis.com/calendar/v3/users/me/calendarList':
      return json({ items: [{ id: 'primary', summary: 'Ada', selected: true }] })
    case 'www.googleapis.com/calendar/v3/calendars/primary/events':
      return json({ items: [{ summary: 'Dentist', start: { dateTime: '2026-12-04T09:00:00Z' }, end: { dateTime: '2026-12-04T10:00:00Z' } }] })
    case 'gmail.googleapis.com/gmail/v1/users/me/messages':
      return json({ messages: [{ id: 'm1' }] })
    case 'gmail.googleapis.com/gmail/v1/users/me/messages/m1':
      return json({
        id: 'm1',
        labelIds: ['INBOX'],
        snippet: 'Here it is.',
        internalDate: '1764579600000',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Bank <no-reply@bank.example>' },
            { name: 'Subject', value: 'Your statement' }
          ],
          body: { data: Buffer.from('Here it is.').toString('base64url') }
        }
      })
    default:
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  }
}

/** A harness whose sessions say nothing: what matters here is what the tools read, and what the store keeps of it. */
function silentHarness() {
  const sessions: { request: SessionRequest; emit(event: SessionEvent): void }[] = []
  const harness: Harness = {
    id: 'silent',
    name: 'Silent',
    status: async () => ({ installed: true, signedIn: true, version: '1' }),
    signIn: async () => undefined,
    models: async () => ({ models: [{ id: 'model', name: 'Model', description: 'The only one.' }], default: 'model' }),
    complete: async () => '',
    open(request) {
      let listener: (event: SessionEvent) => void = () => undefined
      sessions.push({ request, emit: (event) => listener(event) })
      return {
        send: () => undefined,
        interrupt: () => undefined,
        close: () => undefined,
        onEvent: (heard) => {
          listener = heard
        }
      }
    }
  }
  return { harness, sessions }
}

const memoryVault = (): Vault => {
  const entries = new Map<string, string>()
  return {
    keeping: async () => ({ kept: false, reason: 'In memory, for the test.' }),
    read: async (name) => entries.get(name),
    write: async (name, text) => void entries.set(name, text),
    erase: async (name) => void entries.delete(name)
  }
}

const settled = async () => {
  for (let turn = 0; turn < 30; turn++) await new Promise((resolve) => setImmediate(resolve))
}

let folder: string | undefined
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
})

describe('the store', () => {
  it('holds no token after a sign-in and reads of the calendar and mail', async () => {
    folder = mkdtempSync(join(tmpdir(), 'tokens-'))
    const store = openStore({ folder })
    const { harness, sessions } = silentHarness()
    let ids = 0
    const accounts = createAccounts({
      vault: memoryVault(),
      // The person signs in at the page opened, and the browser comes back to the app.
      open: async (url) => {
        const page = new URL(url)
        void fetch(`${page.searchParams.get('redirect_uri')}?code=code&state=${page.searchParams.get('state')}`)
      },
      registrations: { google: { clientId: 'test-google', clientSecret: 'test-secret' } },
      log: { error: vi.fn() },
      fetch: provider
    })
    const core = createCore({
      version: '1',
      acceptsCredential: () => true,
      records: store.records,
      blobs: store.blobs,
      versions: store.versions,
      search: store.search,
      log: { error: vi.fn() },
      harnesses: [harness],
      newId: () => `id-${++ids}`,
      timeZone: () => 'Europe/Paris',
      accounts
    })
    core.serveToolsAt('http://127.0.0.1:1/mcp')
    const run = async <Name extends CommandName>(name: Name, input: CommandInput<Name>): Promise<CommandOutput<Name>> => {
      const result = await core.execute({ type: 'command', id: 'c', name, input })
      if (!result?.ok) throw new Error(JSON.stringify(result))
      return COMMANDS[name].output.parse(result.output) as CommandOutput<Name>
    }

    expect((await run('accounts.connect', { provider: 'google', parts: ['calendar', 'mail'] })).account).toMatchObject({ address: 'ada@example.com' })
    await settled()
    await run('utterance.send', { text: 'What do I have, and did the bank write?' })
    await settled()
    const orchestrator = sessions.at(-1)
    await core.toolHost.call(orchestrator?.request.tools?.token ?? '', 'thread_open', { title: 'The week' })
    orchestrator?.emit({ type: 'turn-end' })
    await settled()
    const token = sessions.at(-1)?.request.tools?.token ?? ''
    const reads = [
      await core.toolHost.call(token, 'calendar_events', { from: '2026-12-04', until: '2026-12-04' }),
      await core.toolHost.call(token, 'mail_search', { from: 'bank' }),
      await core.toolHost.call(token, 'mail_read', { account: 'ada@example.com', id: 'm1' })
    ]
    expect(reads.map((read) => read.ok)).toEqual([true, true, true])
    // The store kept what the reads left: the account, and each read in the activity.
    expect((await run('activity.read', {})).uses.map((use) => use.tool)).toEqual(['mail_read', 'mail_search', 'calendar_events'])

    const files = [STORE_FILE, `${STORE_FILE}-wal`].map((name) => join(folder as string, name)).filter((path) => existsSync(path))
    expect(files.length).toBeGreaterThan(0)
    for (const path of files) {
      const bytes = readFileSync(path)
      expect(bytes.includes(ACCESS)).toBe(false)
      expect(bytes.includes(REFRESH)).toBe(false)
    }
    core.close()
    store.close()
  })
})
