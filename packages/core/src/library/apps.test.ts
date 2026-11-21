import type { Service } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { Timers } from '../ports/clock.ts'
import type { Services } from '../ports/services.ts'
import type { Web } from '../ports/web.ts'
import { memoryRecords } from '../records/memory.ts'
import { createConnections } from '../services/connections.ts'
import { createScreen, type Showing } from '../views/screen.ts'
import { createWidgetApps } from './apps.ts'
import { createLibrary } from './library.ts'

const onStage: Showing = { thread: 'a', turn: 't1', focused: true }

const github: Service = { api: 'https://api.github.com/', name: 'GitHub', sign: { kind: 'token', header: 'Authorization', prefix: 'Bearer ' } }
const spotify: Service = {
  api: 'https://api.spotify.com/v1',
  name: 'Spotify',
  sign: { kind: 'oauth', authorize: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token', scopes: [] }
}

/** Timers that fire only when told: a build waits as long as a test wants. */
function heldTimers() {
  const due: (() => void)[] = []
  const timers: Timers = {
    after(_ms, work) {
      due.push(work)
      return () => void due.splice(due.indexOf(work), 1)
    }
  }
  return {
    timers,
    fire: () => {
      for (const work of due.splice(0)) work()
    }
  }
}

function setup() {
  const records = memoryRecords()
  let ids = 0
  let clock = Date.parse('2026-11-21T08:00:00Z')
  const newId = () => `id-${++ids}`
  const now = () => new Date(clock)
  const screen = createScreen({ records, newId })
  const library = createLibrary({ records, screen, now, newId })
  const kept = new Set<string>()
  const port: Services = {
    keep: async (connection) => void kept.add(connection),
    signIn: async () => ({ ok: false, reason: 'Not here.' }),
    holds: async (connection) => kept.has(connection),
    forget: async (connection) => void kept.delete(connection),
    call: vi.fn(async (_connection, _api, _sign, request) => ({
      ok: true as const,
      status: 200,
      type: 'application/json',
      body: JSON.stringify({ asked: request.url })
    }))
  }
  const connections = createConnections({ port, records, newId, now })
  const web: Web = { read: vi.fn(async (url: string) => ({ ok: true as const, text: `read ${url}` })) }
  const notified: { title: string; body: string }[] = []
  const { timers, fire } = heldTimers()
  const apps = createWidgetApps({ library, connections, web, records, now, notify: (notice) => notified.push(notice), timers })
  const [build, source] = apps.tools(() => onStage)
  const built = (services: Service[] = [github], addresses = ['https://github.com/']) => {
    const done = library.build({ title: 'CI of echo', html: '<p>Runs</p>', addresses, services })
    if (!done.ok) throw new Error(done.text)
    return done.widget
  }
  const later = (ms: number) => {
    clock += ms
  }
  return { records, screen, library, connections, port, web, apps, build, source, built, notified, fire, later }
}

describe('a widget app built', () => {
  it('is saved in the library as a view of one App block, its code beside it, and calls nothing yet', () => {
    const { built } = setup()
    const widget = built()
    expect(widget.spec).toEqual({ root: 'app', elements: { app: { type: 'App', props: { widget: widget.id }, children: [] } } })
    expect(widget.app).toMatchObject({ html: '<p>Runs</p>', addresses: ['https://github.com/'], services: [github], allowed: [] })
  })

  it('keeps what the person allowed across a new version that still calls it, and asks again for what is new', () => {
    const { library, built } = setup()
    const first = built()
    library.allow(first.id)
    const second = library.build({ widget: first.id, title: 'CI of echo', html: '<p>Runs, now</p>', addresses: [], services: [github, spotify] })
    expect(second.ok && second.widget.app).toMatchObject({ allowed: [github.api], html: '<p>Runs, now</p>' })
    expect(second.ok && second.widget.app?.built).not.toBe(first.app?.built)
  })

  it('refuses a new version of a widget that is not an app', () => {
    expect(setup().library.build({ widget: 'nothing', title: 'A', html: 'x', addresses: [], services: [] })).toMatchObject({ ok: false })
  })

  it.each([
    ['runs', 'started', undefined, true, 'it runs'],
    ['failed', 'failed', 'echo is not defined', false, 'failed where it is drawn: echo is not defined'],
    ['waits for the person', 'waiting', 'connect and allow GitHub on the widget', true, 'It waits for the person: connect and allow GitHub']
  ] as const)('says when it %s where it is drawn', async (_case, outcome, message, ok, said) => {
    const { build, apps, library } = setup()
    const result = build?.run({ title: 'CI of echo', html: '<p>Runs</p>', services: [github] })
    const [widget] = library.read().widgets
    apps.report({ widget: widget?.id ?? '', built: widget?.app?.built ?? '', outcome, ...(message ? { message } : {}) })
    expect(await result).toMatchObject({ ok, text: expect.stringContaining(said) })
  })

  it('says when no window drew it in time', async () => {
    const { build, fire } = setup()
    const result = build?.run({ title: 'CI of echo', html: '<p>Runs</p>' })
    await Promise.resolve()
    fire()
    expect((await result)?.text).toContain('No window has drawn it yet')
  })

  it('refuses a build that declares a plain http address, saying what to correct', async () => {
    const { build, library } = setup()
    const result = await build?.run({ title: 'A', html: '<p>A</p>', addresses: ['http://example.org/'] })
    expect(result).toMatchObject({ ok: false, text: expect.stringContaining('addresses.0') })
    expect(library.read().widgets).toEqual([])
  })

  it('gives its page and declarations back to be changed', () => {
    const { source, built } = setup()
    const widget = built()
    expect(source?.run({ widget: widget.id })).toMatchObject({ ok: true, text: expect.stringContaining('<p>Runs</p>') })
  })
})

describe('what a widget app reaches', () => {
  const call = (url: string, more: Record<string, unknown> = {}) => ({ url, method: 'GET' as const, headers: {}, ...more })
  const signal = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }

  it('refuses an address it did not declare', async () => {
    const { apps, built } = setup()
    const widget = built()
    expect(await apps.call({ widget: widget.id, ...call('https://evil.example/steal') }, signal)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('not among the addresses') }
    })
  })

  it('reads a public address it declared, only with GET', async () => {
    const { apps, built } = setup()
    const widget = built([], ['https://api.open-meteo.com/v1/'])
    expect(await apps.call({ widget: widget.id, ...call('https://api.open-meteo.com/v1/forecast') }, signal)).toEqual({
      ok: true,
      output: { status: 200, body: 'read https://api.open-meteo.com/v1/forecast' }
    })
    expect(await apps.call({ widget: widget.id, ...call('https://api.open-meteo.com/v1/forecast', { method: 'POST' }) }, signal)).toMatchObject({ ok: false })
  })

  it('calls a service only once it is connected and the person allowed the widget, never with a sign-in of its own', async () => {
    const { apps, library, connections, port, built } = setup()
    const widget = built()
    const runs = call('https://api.github.com/repos/a/b/actions/runs', { headers: { Authorization: 'Bearer stolen', accept: 'application/json' } })

    expect(await apps.call({ widget: widget.id, ...runs }, signal)).toMatchObject({ ok: false, error: { message: expect.stringContaining('not allowed') } })
    library.allow(widget.id)
    expect(await apps.call({ widget: widget.id, ...runs }, signal)).toMatchObject({ ok: false, error: { message: expect.stringContaining('not connected') } })

    await connections.connect({ service: github, token: 'ghp_x' })
    expect(await apps.call({ widget: widget.id, ...runs }, signal)).toMatchObject({ ok: true, output: { status: 200 } })
    expect(vi.mocked(port.call).mock.calls[0]?.[3]).toEqual({ url: runs.url, method: 'GET', headers: { accept: 'application/json' }, body: undefined })
  })

  it('keeps its values, forgets one set to null, and loses them all with the widget', () => {
    const { apps, library, built } = setup()
    const widget = built()
    apps.writeState({ widget: widget.id, key: 'repo', value: 'feature-creepers/echo' })
    apps.writeState({ widget: widget.id, key: 'seen', value: [1, 2] })
    apps.writeState({ widget: widget.id, key: 'seen', value: null })
    expect(apps.readState(widget.id)).toEqual({ ok: true, state: { repo: 'feature-creepers/echo' } })
    library.remove(widget.id)
    expect(apps.readState(widget.id)).toMatchObject({ ok: false })
  })

  it('writes a value again only when it changed', () => {
    const { apps, records, built } = setup()
    const widget = built()
    const count = () => records.read(['widget.state']).length
    apps.writeState({ widget: widget.id, key: 'runs', value: [1, 2] })
    apps.writeState({ widget: widget.id, key: 'runs', value: [1, 2] })
    expect(count()).toBe(1)
    apps.writeState({ widget: widget.id, key: 'runs', value: [1, 2, 3] })
    expect(apps.readState(widget.id)).toEqual({ ok: true, state: { runs: [1, 2, 3] } })
  })

  it('tells the person something once a minute at most', () => {
    const { apps, built, notified, later } = setup()
    const widget = built()
    expect(apps.notify({ widget: widget.id, title: 'CI failed', body: 'main' })).toEqual({ ok: true })
    expect(apps.notify({ widget: widget.id, title: 'CI failed again', body: '' })).toMatchObject({ ok: false })
    later(60_000)
    expect(apps.notify({ widget: widget.id, title: 'CI passed', body: '' })).toEqual({ ok: true })
    expect(notified.map((notice) => notice.title)).toEqual(['CI failed', 'CI passed'])
  })
})

describe('the services connected', () => {
  it('connects one API once, whoever calls it, and forgets it on disconnect', async () => {
    const { connections } = setup()
    const first = await connections.connect({ service: github, token: 'one' })
    const again = await connections.connect({ service: { ...github, api: 'https://api.github.com' }, token: 'two' })
    expect(first.ok && again.ok && first.connection.id === again.connection.id).toBe(true)
    expect((await connections.read()).connections).toMatchObject([{ name: 'GitHub', kind: 'token', state: 'ready' }])
    if (first.ok) await connections.disconnect(first.connection.id)
    expect((await connections.read()).connections).toEqual([])
  })

  it.each([
    ['a token service with no token', github, {}, 'Paste the token'],
    ['an OAuth service with no client identifier', spotify, {}, 'client identifier'],
    ['an OAuth sign-in the adapter refused', spotify, { clientId: 'abc' }, 'Not here.']
  ])('refuses %s', async (_case, service, given, said) => {
    expect(await setup().connections.connect({ service, ...given })).toMatchObject({ ok: false, error: { message: expect.stringContaining(said) } })
  })
})
