import { describe, expect, it, vi } from 'vitest'
import { answerQuestion, type FrameServices, readMessage } from './bridge.ts'
import { pageOf, policyOf, themeOf } from './page.ts'

describe("a widget app's page", () => {
  it('may load pictures and sounds from the origins of the addresses it declares, and reach nothing else itself', () => {
    const policy = policyOf({ addresses: ['https://i.scdn.co/image/', 'https://api.open-meteo.com/v1/', 'https://i.scdn.co/'] })
    expect(policy).toContain('img-src data: blob: https://i.scdn.co https://api.open-meteo.com;')
    expect(policy).toContain('media-src blob: https://i.scdn.co https://api.open-meteo.com;')
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policyOf({ addresses: [] })).toContain('img-src data: blob:;')
  })

  it("is given Echo's colours, and none that could end its style", () => {
    const theme = themeOf((name) => ({ '--color-accent': ' #5ac8ff ', '--color-text': 'red}</style><script>' })[name] ?? '')
    expect(theme['--echo-accent']).toBe('#5ac8ff')
    const page = pageOf({ html: '<p>Runs</p>' }, theme)
    expect(page).toContain('--echo-accent:#5ac8ff')
    expect(page).not.toContain('</style><script>alert')
    expect(page.endsWith('<p>Runs</p>')).toBe(true)
  })
})

describe('what a page asks the window', () => {
  const services = (): FrameServices => ({
    call: vi.fn(async () => ({ status: 200, body: '{}' })),
    state: vi.fn(async () => ({ repo: 'a/b' })),
    keep: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    open: vi.fn(),
    media: {
      play: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      volume: vi.fn(),
      state: vi.fn(() => ({ title: 'FIP', status: 'playing', volume: 0.8, position: 0, duration: undefined }))
    }
  })

  it.each([
    [{ echo: 1, type: 'call', id: 1, url: 'https://api.github.com/', method: 'GET', headers: {} }, 'question'],
    [{ echo: 1, type: 'size', height: 140 }, 'news'],
    [{ echo: 1, type: 'report', outcome: 'started' }, 'news'],
    [{ echo: 1, type: 'run', code: 'alert(1)' }, undefined],
    [{ type: 'call', id: 1 }, undefined],
    ['a string', undefined]
  ])('reads %j as %s', (data, kind) => {
    const read = readMessage(data)
    expect(read === undefined ? undefined : 'question' in read ? 'question' : 'news').toBe(kind)
  })

  it('opens in the browser only a page of an address the widget declared', async () => {
    const given = services()
    const app = { addresses: ['https://github.com/'] }
    expect(await answerQuestion({ echo: 1, type: 'open', id: 3, url: 'https://github.com/a/b/actions' }, app, given)).toEqual({
      echo: 1,
      id: 3,
      ok: true,
      value: null
    })
    expect(await answerQuestion({ echo: 1, type: 'open', id: 4, url: 'https://evil.example/' }, app, given)).toMatchObject({ id: 4, ok: false })
    expect(given.open).toHaveBeenCalledTimes(1)
  })

  it("plays in Echo's player only what comes from an address the widget declared", async () => {
    const given = services()
    const app = { addresses: ['https://icecast.radiofrance.fr/', 'https://i.scdn.co/'] }
    const play = (url: string, artwork?: string) =>
      answerQuestion({ echo: 1, type: 'media', id: 6, action: 'play', source: { url, title: 'FIP', live: true, ...(artwork ? { artwork } : {}) } }, app, given)
    expect(await play('https://icecast.radiofrance.fr/fip-hifi.aac', 'https://i.scdn.co/cover.jpg')).toMatchObject({ ok: true })
    expect(await play('https://evil.example/stream.mp3')).toMatchObject({ ok: false })
    expect(await play('https://icecast.radiofrance.fr/fip.aac', 'https://evil.example/pixel.gif')).toMatchObject({ ok: false })
    expect(given.media.play).toHaveBeenCalledTimes(1)
    expect(await answerQuestion({ echo: 1, type: 'media', id: 7, action: 'state' }, app, given)).toMatchObject({
      ok: true,
      value: { title: 'FIP', status: 'playing' }
    })
    expect(await answerQuestion({ echo: 1, type: 'media', id: 8, action: 'volume' }, app, given)).toMatchObject({ ok: false })
  })

  it("answers with why when the core refuses, in the core's words", async () => {
    const given = { ...services(), call: vi.fn(async () => Promise.reject(new Error('GitHub is not allowed for this widget yet.'))) }
    expect(
      await answerQuestion({ echo: 1, type: 'call', id: 5, url: 'https://api.github.com/', method: 'GET', headers: {} }, { addresses: [] }, given)
    ).toEqual({
      echo: 1,
      id: 5,
      ok: false,
      error: 'GitHub is not allowed for this widget yet.'
    })
  })
})
