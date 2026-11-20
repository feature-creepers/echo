import { COMMANDS, type Event } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createCore } from '../core.ts'
import type { SignedIn } from '../ports/accounts.ts'
import { memoryRecords } from '../records/memory.ts'
import { scriptedAccounts } from '../replay/scripted-accounts.ts'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { createAccountList } from './accounts.ts'

/** Lets what was started without waiting for it come to its end. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()
}

function setup(records = memoryRecords(), port = scriptedAccounts()) {
  let ids = 0
  const log = { error: vi.fn() }
  const list = createAccountList({ port, records, newId: () => `account-${++ids}`, now: () => new Date('2026-11-20T09:00:00Z'), log })
  const events: Event[] = []
  list.onEvent((event) => events.push(event))
  return { list, port, records, events }
}

/** Sign in as the person would: the test answers the sign-in the list started. */
async function signIn(setting: ReturnType<typeof setup>, address: string, account?: string) {
  const connecting = setting.list.connect({ provider: 'mailbox', parts: ['calendar', 'mail'], ...(account ? { account } : {}) })
  await settled()
  setting.port.signing()?.finish({ ok: true, address, name: 'Ada', parts: ['calendar', 'mail'] })
  return connecting
}

describe('the list of accounts', () => {
  it('connects an account, keeping who it is and what it gives, and never a secret', async () => {
    const setting = setup()
    const connected = await signIn(setting, 'ada@example.com')

    expect(connected).toMatchObject({ ok: true, account: { address: 'ada@example.com', parts: ['calendar', 'mail'], state: 'ready' } })
    expect(setting.records.read(['account.connected']).map((record) => record.payload)).toEqual([
      { account: 'account-1', provider: 'mailbox', address: 'ada@example.com', name: 'Ada', parts: ['calendar', 'mail'] }
    ])
    expect(setting.list.ready('mail').map((account) => account.address)).toEqual(['ada@example.com'])
  })

  it('shows the sign-in under way, and allows one at a time', async () => {
    const setting = setup()
    const first = setting.list.connect({ provider: 'mailbox', parts: ['mail'] })
    await settled()

    expect((await setting.list.read()).signingIn).toMatchObject({ provider: 'mailbox', parts: ['mail'] })
    expect(await setting.list.connect({ provider: 'mailbox', parts: ['calendar'] })).toMatchObject({ ok: false, error: { code: 'failed' } })

    setting.list.cancel()
    expect(await first).toMatchObject({ ok: false, error: { message: 'The sign-in was cancelled.' } })
    expect((await setting.list.read()).signingIn).toBeUndefined()
  })

  it.each([
    ['a provider this build cannot sign in to', { provider: 'elsewhere', parts: ['mail'] as const }, 'This build has no sign-in for Elsewhere.'],
    ['a provider it does not know', { provider: 'nowhere', parts: ['mail'] as const }, 'There is no provider "nowhere".'],
    [
      'an account to sign in again that is not connected',
      { provider: 'mailbox', parts: ['mail'] as const, account: 'gone' },
      'There is no such account to sign in to again.'
    ]
  ])('refuses %s', async (_case, asked, message) => {
    expect(await setup().list.connect({ ...asked, parts: [...asked.parts] })).toEqual({ ok: false, error: { code: 'invalid-input', message } })
  })

  it('holds eight accounts at most', async () => {
    const setting = setup()
    for (let one = 1; one <= 8; one++) await signIn(setting, `person${one}@example.com`)
    expect(await setting.list.connect({ provider: 'mailbox', parts: ['mail'] })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('8 accounts') }
    })
  })

  it('reads an account it holds no sign-in for as one to sign in to again, and signs in again under the same identifier', async () => {
    const records = memoryRecords()
    const first = setup(records)
    await signIn(first, 'ada@example.com')

    // Another computer, or a vault that cannot open what it kept: the list follows the person, the sign-in does not.
    const later = setup(records, scriptedAccounts())
    const [account] = (await later.list.read()).accounts
    expect(account).toMatchObject({ id: 'account-1', state: 'sign-in-again' })
    expect(later.list.ready('calendar')).toEqual([])

    await signIn(later, 'ada@example.com', 'account-1')
    expect((await later.list.read()).accounts).toMatchObject([{ id: 'account-1', state: 'ready', since: account?.since }])
  })

  it('takes the same account signed in under another identifier as one, forgetting the other sign-in without revoking it', async () => {
    const setting = setup()
    await signIn(setting, 'ada@example.com')
    await signIn(setting, 'ADA@example.com')

    expect((await setting.list.read()).accounts.map((account) => account.id)).toEqual(['account-2'])
    expect(setting.port.forgotten).toEqual(['account-1'])
    expect(setting.port.disconnected).toEqual([])
  })

  it('disconnects an account: its sign-in is revoked, and it leaves the list for good', async () => {
    const records = memoryRecords()
    const setting = setup(records)
    await signIn(setting, 'ada@example.com')

    expect(await setting.list.disconnect('account-1')).toMatchObject({ ok: true, view: { accounts: [] } })
    expect(setting.port.disconnected).toEqual(['account-1'])
    expect((await setup(records).list.read()).accounts).toEqual([])
  })

  it('ignores a sign-in again that succeeds after its account was disconnected', async () => {
    const records = memoryRecords()
    const setting = setup(records)
    await signIn(setting, 'ada@example.com')
    // The provider answers after the person disconnected the account, as if it never heard the cancelling.
    let finish: (outcome: SignedIn) => void = () => undefined
    setting.port.connect = () => new Promise((resolve) => (finish = resolve))

    const again = setting.list.connect({ provider: 'mailbox', parts: ['mail'], account: 'account-1' })
    await settled()
    await setting.list.disconnect('account-1')
    finish({ ok: true, address: 'ada@example.com', parts: ['mail'] })

    expect(await again).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect((await setting.list.read()).accounts).toEqual([])
    expect(setting.list.ready('mail')).toEqual([])
    expect(setting.port.disconnected).toEqual(['account-1', 'account-1'])
    expect((await setup(records).list.read()).accounts).toEqual([])
  })

  it('asks the person to sign in again once the provider refuses the sign-in', async () => {
    const setting = setup()
    await signIn(setting, 'ada@example.com')
    const before = setting.list.version()

    setting.list.signInAgain('account-1')
    await settled()

    expect(setting.list.version()).not.toBe(before)
    expect(setting.events.at(-1)).toMatchObject({ name: 'accounts.changed', accounts: { accounts: [{ state: 'sign-in-again' }] } })
  })

  it('says why sign-ins do not outlive the app here', async () => {
    const view = await setup(memoryRecords(), scriptedAccounts({ kept: false, reason: 'No keyring.' })).list.read()
    expect(view.keeping).toEqual({ kept: false, reason: 'No keyring.' })
  })
})

describe('accounts in the core', () => {
  it('cancels the sign-in under way when everything is stopped', async () => {
    const port = scriptedAccounts()
    const core = createCore({
      version: '1',
      acceptsCredential: () => true,
      records: memoryRecords(),
      blobs: { put: () => 'hash', get: () => undefined },
      log: { error: vi.fn() },
      harnesses: [scriptedHarness()],
      newId: () => 'id',
      accounts: port
    })
    const connecting = core.execute({ type: 'command', id: 'c1', name: 'accounts.connect', input: { provider: 'mailbox', parts: ['mail'] } })
    await settled()
    expect(port.signing()).toBeDefined()

    await core.execute({ type: 'command', id: 'c2', name: 'everything.stop', input: {} })

    expect(await connecting).toMatchObject({ ok: false, error: { code: 'failed' } })
    const read = await core.execute({ type: 'command', id: 'c3', name: 'accounts.read', input: {} })
    expect(read?.ok && COMMANDS['accounts.read'].output.parse(read.output).accounts.signingIn).toBeUndefined()
  })
})
