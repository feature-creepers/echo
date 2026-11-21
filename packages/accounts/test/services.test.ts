import type { ServiceSign } from '@repo/core'
import { describe, expect, it } from 'vitest'
import type { Vault } from '../src/accounts.ts'
import { createServices, underApi } from '../src/services.ts'

/** A vault that keeps its entries in memory. */
function memoryVault(): Vault & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    keeping: async () => ({ kept: true }),
    read: async (name) => entries.get(name),
    write: async (name, text) => void entries.set(name, text),
    erase: async (name) => void entries.delete(name)
  }
}

const never = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }
const timers = { after: () => () => undefined }
const API = 'https://api.github.com/'
const token: ServiceSign = { kind: 'token', header: 'Authorization', prefix: 'Bearer ' }

function setup(answer: (url: string, init: RequestInit) => Response = () => Response.json({ runs: 3 })) {
  const vault = memoryVault()
  const asked: { url: string; init: RequestInit }[] = []
  const services = createServices({
    vault,
    open: async () => undefined,
    timers,
    fetch: async (url, init) => {
      asked.push({ url, init })
      return answer(url, init)
    }
  })
  return { vault, asked, services }
}

const get = (url: string, headers: Record<string, string> = {}) => ({ url, method: 'GET' as const, headers })

describe('a service connected with a token', () => {
  it('keeps the token in the vault and sends it to its API alone, in its header, whatever the widget sent there', async () => {
    const { vault, asked, services } = setup()
    await services.keep('c1', 'ghp_secret')
    expect(vault.entries.get('service:c1')).toContain('ghp_secret')

    const answer = await services.call(
      'c1',
      API,
      token,
      get('https://api.github.com/repos/a/b/actions/runs', { authorization: 'Bearer stolen', 'x-page': '2' }),
      never
    )
    expect(answer).toEqual({ ok: true, status: 200, type: 'application/json', body: '{"runs":3}' })
    expect(asked[0]?.init.headers).toEqual({ accept: 'application/json', 'x-page': '2', Authorization: 'Bearer ghp_secret' })
    expect(asked[0]?.init.redirect).toBe('manual')
  })

  it('puts the token in the header and after the prefix the service uses', async () => {
    const { asked, services } = setup()
    await services.keep('c1', 'k')
    await services.call('c1', 'https://api.example.com/', { kind: 'token', header: 'X-Api-Key', prefix: '' }, get('https://api.example.com/items'), never)
    expect(asked[0]?.init.headers).toMatchObject({ 'X-Api-Key': 'k' })
  })

  it.each([
    ['an address outside its API', get('https://api.github.com.evil.net/'), 'not an address of'],
    ['a connection it holds no sign-in for', get('https://api.github.com/user'), 'connecting again']
  ])('refuses %s, and sends nothing', async (_case, request, said) => {
    const { asked, services } = setup()
    if (!said.includes('connecting')) await services.keep('c1', 'k')
    expect(await services.call('c1', API, token, request, never)).toEqual({ ok: false, reason: expect.stringContaining(said) })
    expect(asked).toEqual([])
  })

  it('never follows a redirect, which would take the sign-in elsewhere', async () => {
    const { services } = setup(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }))
    await services.keep('c1', 'k')
    expect(await services.call('c1', API, token, get('https://api.github.com/user'), never)).toEqual({ ok: false, reason: expect.stringContaining('redirect') })
  })

  it('forgets the sign-in when the service is disconnected', async () => {
    const { vault, services } = setup()
    await services.keep('c1', 'k')
    await services.forget('c1')
    expect(await services.holds('c1')).toBe(false)
    expect(vault.entries.size).toBe(0)
  })
})

describe('an address under an API', () => {
  it.each([
    ['https://api.spotify.com/v1/me/playlists', 'https://api.spotify.com/v1', true],
    ['https://api.spotify.com/v10/me', 'https://api.spotify.com/v1', false],
    ['https://api.spotify.com:444/v1/me', 'https://api.spotify.com/v1', false]
  ])('%s under %s: %s', (address, api, under) => {
    expect(underApi(address, api)).toBe(under)
  })
})
