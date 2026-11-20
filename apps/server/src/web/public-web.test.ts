import type { LookupAddress } from 'node:dns'
import { createServer } from 'node:http'
import { type AddressInfo, isIP } from 'node:net'
import { fetch, Response } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkedLookup, createPublicWeb, isPrivateHost, isPublicAddress, publicAgent, type Resolve } from './public-web.ts'

// The reader's own fetch, watched: it goes to the network as ever unless a test answers for it.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  return { ...actual, fetch: vi.fn(actual.fetch) }
})
const { fetch: networkFetch } = await vi.importActual<typeof import('undici')>('undici')

const limits = { maxBytes: 1000, timeoutMs: 1000 }

/** A resolver that knows the names a test gives it, each with its addresses, and no other. */
const resolver =
  (names: Record<string, string[]>): Resolve =>
  (hostname, _options, callback) => {
    const addresses = names[hostname]
    setImmediate(() =>
      addresses
        ? callback(
            null,
            addresses.map((address) => ({ address, family: isIP(address) }))
          )
        : callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), [])
    )
  }

afterEach(() => {
  vi.mocked(fetch).mockReset()
})

describe('what is public', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['172.32.0.1', true],
    ['100.128.0.1', true],
    ['2606:4700:4700::1111', true],
    ['2001:4860:4860::8888', true],
    ['127.0.0.1', false],
    ['10.0.0.1', false],
    ['172.31.255.255', false],
    ['192.168.1.1', false],
    ['100.64.0.1', false],
    ['169.254.169.254', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['198.18.0.1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['fd12::1', false],
    ['ff02::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['::ffff:192.168.1.1', false],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::a00:1', false],
    ['example.org', false]
  ])('%s: %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected)
  })

  it.each(['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.1.1', '[::1]', '[::ffff:7f00:1]', 'printer.local'])(
    'refuses the host %s by its name',
    (host) => {
      expect(isPrivateHost(host)).toBe(true)
    }
  )

  it.each(['raw.githubusercontent.com', '8.8.8.8', '172.32.0.1', '[2606:4700:4700::1111]'])('leaves the host %s to its lookup', (host) => {
    expect(isPrivateHost(host)).toBe(false)
  })
})

describe('the lookup', () => {
  /** What the lookup answers for a name, as `net.connect` would be told. */
  const answer = (addresses: string[] | undefined, all: boolean) =>
    new Promise<{ error?: string; address?: string | LookupAddress[]; family?: number | undefined }>((resolve) =>
      checkedLookup(
        'name.test',
        { all },
        (error, address, family) => resolve(error ? { error: (error as { code?: string }).code ?? error.message } : { address, family }),
        resolver(addresses ? { 'name.test': addresses } : {})
      )
    )

  it.each([
    { resolves: ['93.184.215.14'], all: false, answer: { address: '93.184.215.14', family: 4 } },
    {
      resolves: ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
      all: true,
      answer: {
        address: [
          { address: '93.184.215.14', family: 4 },
          { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 }
        ]
      }
    },
    { resolves: ['127.0.0.1'], all: false, answer: { error: 'ENOTPUBLIC' } },
    { resolves: ['93.184.215.14', '10.0.0.1'], all: true, answer: { error: 'ENOTPUBLIC' } },
    { resolves: ['93.184.215.14', '10.0.0.1'], all: false, answer: { error: 'ENOTPUBLIC' } },
    { resolves: ['::ffff:127.0.0.1'], all: false, answer: { error: 'ENOTPUBLIC' } },
    { resolves: undefined, all: false, answer: { error: 'ENOTFOUND' } }
  ])('answers $resolves, all: $all', async ({ resolves, all, answer: expected }) => {
    expect(await answer(resolves, all)).toEqual(expected)
  })

  it('never connects to a name that leads to a private address', async () => {
    let requests = 0
    const server = createServer((_request, response) => {
      requests++
      response.end('{}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const agent = publicAgent(resolver({ 'public.test': ['127.0.0.1'] }))
    try {
      await expect(networkFetch(`http://public.test:${port}/`, { dispatcher: agent })).rejects.toMatchObject({ cause: { code: 'ENOTPUBLIC' } })
      expect(requests).toBe(0)
    } finally {
      await agent.close()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe('the public web', () => {
  const publicWeb = createPublicWeb({ resolve: resolver({ 'public.test': ['127.0.0.1'], 'private.test': ['93.184.215.14', '192.168.1.1'] }) })

  it.each([
    { url: 'http://example.org/a.json', reason: 'only https:// addresses are read.' },
    { url: 'https://127.0.0.1/a.json', reason: 'it is not a public address.' },
    { url: 'https://public.test/a.json', reason: 'it is not a public address.' }
  ])('refuses $url', async ({ url, reason }) => {
    expect(await publicWeb.read(url, limits)).toEqual({ ok: false, reason })
  })

  it.each([
    {
      case: 'to a private address',
      location: 'https://192.168.1.1/admin',
      asked: 1,
      read: { ok: false, reason: 'it leads to an address that is not public.' }
    },
    {
      case: 'to a name that leads to one',
      location: 'https://private.test/b.json',
      asked: 2,
      read: { ok: false, reason: 'it leads to an address that is not public.' }
    },
    { case: 'off https', location: 'http://example.org/a.json', asked: 1, read: { ok: false, reason: 'it leads to an address that is not public.' } },
    { case: 'to a public address', location: '/b.json', asked: 2, read: { ok: true, text: '{}' } },
    { case: 'without end', location: '/a.json', asked: 6, read: { ok: false, reason: 'it redirects too many times.' } }
  ])('checks a redirect $case before it follows it', async ({ location, asked, read }) => {
    // example.org answers here; any other name is asked of the network, through the reader's agent.
    vi.mocked(fetch).mockImplementation(async (address, init) => {
      const url = new URL(String(address))
      if (url.hostname !== 'example.org') return networkFetch(address, init)
      return url.pathname === '/b.json' ? new Response('{}', { status: 200 }) : new Response(null, { status: 302, headers: { location } })
    })
    expect(await publicWeb.read('https://example.org/a.json', limits)).toEqual(read)
    expect(fetch).toHaveBeenCalledTimes(asked)
  })
})
