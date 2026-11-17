import { describe, expect, it } from 'vitest'
import { isPrivateHost, publicWeb } from './public-web.ts'

describe('the public web', () => {
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
    const limits = { maxBytes: 1000, timeoutMs: 1000 }
    expect(await publicWeb.read('http://example.org/a.json', limits)).toEqual({ ok: false, reason: 'only https:// addresses are read.' })
    expect(await publicWeb.read('https://127.0.0.1/a.json', limits)).toEqual({ ok: false, reason: 'it is not a public address.' })
  })
})
