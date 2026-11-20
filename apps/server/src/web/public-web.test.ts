import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrivateHost, publicWeb } from './public-web.ts'

const limits = { maxBytes: 1000, timeoutMs: 1000 }

describe('the public web', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.1.1', '[::1]', 'printer.local'])(
    'refuses %s',
    (host) => {
      expect(isPrivateHost(host)).toBe(true)
    }
  )

  it.each(['raw.githubusercontent.com', '8.8.8.8', '172.32.0.1'])('reads %s', (host) => {
    expect(isPrivateHost(host)).toBe(false)
  })

  it('reads https only, and never a private address', async () => {
    expect(await publicWeb.read('http://example.org/a.json', limits)).toEqual({ ok: false, reason: 'only https:// addresses are read.' })
    expect(await publicWeb.read('https://127.0.0.1/a.json', limits)).toEqual({ ok: false, reason: 'it is not a public address.' })
  })

  it.each([
    {
      case: 'to a private address',
      location: 'https://192.168.1.1/admin',
      asked: 1,
      read: { ok: false, reason: 'it leads to an address that is not public.' }
    },
    { case: 'off https', location: 'http://example.org/a.json', asked: 1, read: { ok: false, reason: 'it leads to an address that is not public.' } },
    { case: 'to a public address', location: '/b.json', asked: 2, read: { ok: true, text: '{}' } },
    { case: 'without end', location: '/a.json', asked: 6, read: { ok: false, reason: 'it redirects too many times.' } }
  ])('checks a redirect $case before it follows it', async ({ location, asked, read }) => {
    const fetch = vi.fn(async (address: URL) =>
      address.pathname === '/b.json' ? new Response('{}', { status: 200 }) : new Response(null, { status: 302, headers: { location } })
    )
    vi.stubGlobal('fetch', fetch)
    expect(await publicWeb.read('https://example.org/a.json', limits)).toEqual(read)
    expect(fetch).toHaveBeenCalledTimes(asked)
  })
})
