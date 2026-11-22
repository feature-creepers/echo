import { describe, expect, it, vi } from 'vitest'
import { answerQuestion, type FrameServices, readMessage } from './bridge.ts'
import { type Face, pageOf, policyOf, themeOf } from './page.ts'

describe("a widget app's page", () => {
  it('may load pictures and sounds from the origins of the addresses it declares, and reach nothing else itself', () => {
    const policy = policyOf({ addresses: ['https://i.scdn.co/image/', 'https://api.open-meteo.com/v1/', 'https://i.scdn.co/'] })
    expect(policy).toContain('img-src data: blob: https://i.scdn.co https://api.open-meteo.com;')
    expect(policy).toContain('media-src blob: https://i.scdn.co https://api.open-meteo.com;')
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policyOf({ addresses: [] })).toContain('img-src data: blob:;')
  })

  it('loads a font from the page itself only', () => {
    expect(policyOf({ addresses: ['https://fonts.example/'] })).toContain('; font-src data:;')
  })

  it("is given Echo's look, with the accent where it is drawn, and no value that could end its style", () => {
    const theme = themeOf((name) => ({ '--accent': ' #6b85f5 ', '--accent-ink': '#0f0f0d}</style><script>alert(1)' })[name] ?? '')
    const page = pageOf({ html: '<p>Runs</p>' }, theme)
    for (const name of ['ground', 'surface', 'text', 'soft', 'faint', 'line', 'line-strong', 'danger', 'warn', 'info', 'accent'])
      expect(page).toMatch(new RegExp(`--echo-${name}:[^;]`))
    for (const face of ['sans', 'display', 'pixel', 'mono']) expect(page).toContain(`--echo-font-${face}:"`)
    expect(page).toContain('--echo-accent:#6b85f5')
    expect(page).not.toContain('alert(1)')
    expect(page.endsWith('<p>Runs</p>')).toBe(true)
  })

  it.each([
    ['square corners', '*,*::before,*::after{box-sizing:border-box;border-radius:0}'],
    ['a label in capitals in the pixel face', '.caps{font:400 0.6875rem/1rem var(--echo-font-pixel);letter-spacing:0.04em;text-transform:uppercase}'],
    ['a figure in the display face', '.display{font-family:var(--echo-font-display);font-weight:900;'],
    ['hairlines between rows', 'border-top:1px solid var(--echo-line)'],
    ['buttons drawn as lines', 'button{min-height:28px;padding:0 10px;border:1px solid var(--echo-line-strong);background:transparent;'],
    ['the one action on a plane of the ink', 'button.primary{border-color:var(--echo-text);background:var(--echo-text);color:var(--echo-ground)}'],
    ['the names pages used before', '--echo-font:var(--echo-font-sans);--echo-mono:var(--echo-font-mono)'],
    ['a rule of the full ink over a list', '.rule{border-top:2px solid var(--echo-text)}'],
    ['a small square that says how something stands', '.mark.warn{background:var(--echo-warn)}'],
    ['parts side by side, parted by a hairline', '.cols>*+*{margin-left:16px;padding-left:16px;border-left:1px solid var(--echo-line)}'],
    ["the illustrations' movement", '@keyframes echo-il-turn{to{transform:rotate(360deg)}}']
  ])('starts from the base style of the app: %s', (_case, rule) => {
    expect(pageOf({ html: '' }, {})).toContain(rule)
  })

  it("gives the page the app's illustrations by name, written so that none can end its script", () => {
    const page = pageOf({ html: '' }, {})
    const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'))
    expect(script).toContain("illustration: (name) => drawn[name] || ''")
    const drawn = script.split('\n').find((line) => line.includes('const drawn = ')) ?? ''
    expect(drawn).toContain('"rain":"\\u003csvg class=')
    expect(drawn).not.toContain('<')
  })

  it.each<[string, Face, boolean]>([
    ['a face of the app', { family: 'Geist Pixel', weight: '400', source: 'data:font/woff2;base64,d09GMgAB' }, true],
    ['a variable face', { family: 'Big Shoulders Variable', weight: '100 900', source: 'data:font/woff2;base64,d09GMgAB==' }, true],
    ['a face from an address', { family: 'Geist Pixel', weight: '400', source: 'https://fonts.example/pixel.woff2' }, false],
    ['a family that ends the rule', { family: 'X"}body{display:none', weight: '400', source: 'data:font/woff2;base64,d09G' }, false],
    ['a source that ends the address', { family: 'Geist Pixel', weight: '400', source: 'data:font/woff2;base64,d09G)}body{' }, false]
  ])('declares %s: %s', (_case, face, declared) => {
    expect(pageOf({ html: '' }, {}, [face]).includes('@font-face')).toBe(declared)
  })

  it("declares the app's four faces, each written into the page", async () => {
    const { FACES } = await import('./faces.ts')
    const page = pageOf({ html: '' }, {}, FACES)
    for (const family of ['Instrument Sans Variable', 'Big Shoulders Variable', 'Geist Pixel', 'Geist Mono Variable'])
      expect(page).toContain(`@font-face{font-family:"${family}";`)
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
