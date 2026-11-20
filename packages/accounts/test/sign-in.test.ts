import type { Signal } from '@repo/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAccounts } from '../src/accounts.ts'
import { SIGN_IN_MS } from '../src/loopback.ts'
import { type FakeProvider, fakeProvider, handTimers, memoryVault } from './fake-provider.ts'

const REGISTRATIONS = { google: { clientId: 'test-google', clientSecret: 'test-secret' }, microsoft: { clientId: 'test-microsoft' } }

let fake: FakeProvider
beforeEach(async () => {
  fake = await fakeProvider()
  fake.serve('gmail.googleapis.com/gmail/v1/users/me/profile', () => ({ body: { emailAddress: 'ada@gmail.example', historyId: '1' } }))
  fake.serve('www.googleapis.com/calendar/v3/calendars/primary', () => ({ body: { id: 'ada@calendar.example' } }))
  fake.serve('graph.microsoft.com/v1.0/me', () => ({ body: { displayName: 'Ada Lovelace', mail: null, userPrincipalName: 'ada@outlook.example' } }))
})
afterEach(() => fake.close())

/** A signal the test raises, as the core's. */
function stopping(): Signal & { stop(): void } {
  const controller = new AbortController()
  return {
    get aborted() {
      return controller.signal.aborted
    },
    addEventListener: (_type, listener) => controller.signal.addEventListener('abort', listener),
    removeEventListener: (_type, listener) => controller.signal.removeEventListener('abort', listener),
    stop: () => controller.abort()
  }
}

function setup(registrations: Parameters<typeof createAccounts>[0]['registrations'] = REGISTRATIONS) {
  const vault = memoryVault()
  const timers = handTimers()
  const log = { error: vi.fn() }
  const accounts = createAccounts({ vault, open: (url) => fake.open(url), registrations, log, timers, fetch: (url, init) => fake.fetch(url, init) })
  return { accounts, vault, timers, log }
}

/** Whether something still listens where the browser was to come back. */
const listening = (address: string) =>
  fetch(address).then(
    () => true,
    () => false
  )

describe('a sign-in', () => {
  it.each([
    ['google', ['mail'] as const, '127.0.0.1', { ok: true, address: 'ada@gmail.example', parts: ['mail'] }],
    ['google', ['calendar'] as const, '127.0.0.1', { ok: true, address: 'ada@calendar.example', parts: ['calendar'] }],
    ['microsoft', ['calendar', 'mail'] as const, 'localhost', { ok: true, address: 'ada@outlook.example', name: 'Ada Lovelace', parts: ['calendar', 'mail'] }]
  ])('to %s for %j comes back to %s, exchanges the code with its verifier, and keeps only the refresh token', async (provider, parts, host, outcome) => {
    const { accounts, vault } = setup()

    expect(await accounts.connect({ account: 'a1', provider, parts: [...parts] }, stopping())).toEqual(outcome)

    const [page] = fake.opened
    expect(new URL(page?.searchParams.get('redirect_uri') ?? '').hostname).toBe(host)
    expect(page?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(page?.searchParams.get('scope')).not.toContain('openid')
    expect(fake.tokenRequests[0]?.get('code_verifier')).toBeTruthy()
    expect(fake.answers).toEqual([200])
    expect([...vault.entries.keys()]).toEqual(['account:a1'])
    expect(vault.entries.get('account:a1')).toContain('refresh-1')
    expect(vault.entries.get('account:a1')).not.toContain('access-1')
    expect(await accounts.holds('a1')).toBe(true)
  })

  it.each([
    ['a wrong state', 'wrong-state' as const, [404, 200]],
    ['another path', 'wander' as const, [404, 200]]
  ])('answers 404 to %s, and still waits for the right one', async (_case, person, answers) => {
    fake.person = person
    const { accounts } = setup()
    expect(await accounts.connect({ account: 'a1', provider: 'google', parts: ['mail'] }, stopping())).toMatchObject({ ok: true })
    expect(fake.answers).toEqual(answers)
  })

  it('says the person refused, and keeps nothing', async () => {
    fake.person = 'refuse'
    const { accounts, vault } = setup()
    const outcome = await accounts.connect({ account: 'a1', provider: 'microsoft', parts: ['mail'] }, stopping())
    expect(outcome).toEqual({ ok: false, reason: 'You declined in your browser. Nothing was connected.' })
    expect(vault.entries.size).toBe(0)
  })

  it.each([
    ['cancelled', (signal: ReturnType<typeof stopping>) => signal.stop(), 'The sign-in was cancelled: nothing was connected.'],
    [
      'given five minutes',
      (_signal: ReturnType<typeof stopping>, timers: ReturnType<typeof handTimers>) => timers.advance(SIGN_IN_MS),
      'The five minutes to sign in passed'
    ]
  ])('stops listening once %s', async (_case, end, reason) => {
    fake.person = 'away'
    const { accounts, timers } = setup()
    const signal = stopping()
    const connecting = accounts.connect({ account: 'a1', provider: 'google', parts: ['mail'] }, signal)
    await vi.waitFor(() => expect(fake.opened).toHaveLength(1))
    const redirect = fake.opened[0]?.searchParams.get('redirect_uri') ?? ''
    expect(await listening(redirect)).toBe(true)

    end(signal, timers)

    expect(await connecting).toMatchObject({ ok: false, reason: expect.stringContaining(reason) })
    expect(await listening(redirect)).toBe(false)
  })

  it('never opens a sign-in page that is not on the provider’s own host', async () => {
    fake.authorizationHost = 'sign-in.elsewhere.example'
    const { accounts } = setup()
    const outcome = await accounts.connect({ account: 'a1', provider: 'google', parts: ['mail'] }, stopping())
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('was not opened') })
    expect(fake.opened).toEqual([])
  })

  it('revokes a sign-in where the provider allows it when the account is disconnected, and only forgets it otherwise', async () => {
    const { accounts, vault } = setup()
    await accounts.connect({ account: 'g', provider: 'google', parts: ['mail'] }, stopping())
    await accounts.connect({ account: 'm', provider: 'microsoft', parts: ['mail'] }, stopping())

    await accounts.disconnect('g')
    await accounts.disconnect('m')

    expect(fake.revoked).toEqual(['refresh-1'])
    expect(vault.entries.size).toBe(0)
  })
})

describe('the providers a build offers', () => {
  it.each([
    ['every registration', REGISTRATIONS, { google: true, microsoft: true }],
    ['none', {}, { google: false, microsoft: false }],
    ['Google without its secret', { google: { clientId: 'test-google' }, microsoft: { clientId: 'test-microsoft' } }, { google: false, microsoft: true }]
  ])('with %s', async (_case, registrations, offered) => {
    const { accounts } = setup(registrations)
    const providers = accounts.providers()
    expect(Object.fromEntries(providers.map((provider) => [provider.id, provider.offered]))).toEqual(offered)
    for (const provider of providers.filter((one) => !one.offered)) expect(provider.problem).toContain('This build has no sign-in for')
    expect(await accounts.connect({ account: 'a1', provider: 'google', parts: ['mail'] }, stopping())).toMatchObject({ ok: offered.google })
  })
})
