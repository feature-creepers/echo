import type { WidgetApp } from '@repo/protocol'
import { color, font, label } from '@repo/tokens'

/**
 * A widget app's page as its frame is given it (docs/SPEC.md, section 9.9): the app's own HTML, after Echo's look
 * and the `echo` object its code reaches the world with, and the security policy it is served under. The policy lets
 * the page run its own scripts and styles, load pictures and sounds from the addresses it declares and fonts given in
 * the page, and nothing else: no request of its own, no form sent, no frame, no other script. Everything else goes
 * through `echo`, which asks the window, which asks the core.
 */

/** Echo's colours and faces, by the names a widget's CSS uses. They are the same everywhere, but for the accent. */
const FIXED: Readonly<Record<string, string>> = {
  '--echo-ground': color.ground,
  '--echo-surface': color.surface,
  '--echo-text': color.text,
  '--echo-soft': color.textSoft,
  '--echo-faint': color.textFaint,
  '--echo-line': color.line,
  '--echo-line-strong': color.lineStrong,
  '--echo-ok': color.ok,
  '--echo-warn': color.warn,
  '--echo-danger': color.danger,
  '--echo-info': color.info,
  '--echo-font-sans': font.sans,
  '--echo-font-display': font.display,
  '--echo-font-pixel': font.pixel,
  '--echo-font-mono': font.mono
}

/** The theme a page is given: Echo's own, with the accent of the persona where the widget is drawn, read there. */
export function themeOf(read: (name: string) => string): Record<string, string> {
  return { ...FIXED, '--echo-accent': read('--accent').trim(), '--echo-accent-ink': read('--accent-ink').trim() }
}

/** One of the app's faces, as a page declares it: its family, its weights, and the font itself as a data: address. */
export interface Face {
  family: string
  weight: string
  source: string
}

/** A face's declaration. One that could end its rule, or load from anywhere but its own data, is left out. */
const declared = ({ family, weight, source }: Face) =>
  /^[\w ]+$/.test(family) && /^\d{3}( \d{3})?$/.test(weight) && /^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/.test(source)
    ? `@font-face{font-family:"${family}";font-weight:${weight};font-display:swap;src:url(${source}) format("woff2")}`
    : ''

/** Small labels, as the app sets them: the pixel face, in capitals, spaced a little. */
const CAPS = `font:400 ${label.size}/${label.lineHeight} var(--echo-font-pixel);letter-spacing:${label.letterSpacing};text-transform:uppercase`

/**
 * What every page starts from: the app's look (docs/SPEC.md, section 13.1). Content lies bare, corners are square,
 * rules are hairlines of the ink, `caps` sets a small label and `display` a short title or a large figure, and
 * buttons and fields are drawn in lines, `primary` the one action a page is there for. The page's own style comes
 * after it. Pages built before the faces had names of their own use `--echo-font` and `--echo-mono`.
 */
const BASE = [
  ':root{color-scheme:dark;scrollbar-width:thin;scrollbar-color:var(--echo-line-strong) transparent;--echo-font:var(--echo-font-sans);--echo-mono:var(--echo-font-mono)}',
  '*,*::before,*::after{box-sizing:border-box;border-radius:0}',
  // Nothing of a widget scrolls sideways, as nothing of the window does; what is too tall scrolls with a thin bar.
  'html,body{margin:0;overflow-x:hidden;background:transparent;color:var(--echo-text);font:13px/1.45 var(--echo-font-sans);-webkit-font-smoothing:antialiased}',
  '::selection{background:color-mix(in oklab,var(--echo-accent) 35%,transparent)}',
  ':focus-visible{outline:1px solid var(--echo-text);outline-offset:2px}',
  `.caps{${CAPS}}`,
  '.display{font-family:var(--echo-font-display);font-weight:900;line-height:.9;text-transform:uppercase;letter-spacing:-.005em;font-variant-numeric:tabular-nums}',
  'hr{margin:12px 0;border:0;border-top:1px solid var(--echo-line)}',
  'table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}',
  'th,td{padding:6px 12px 6px 0;border-top:1px solid var(--echo-line);text-align:start;vertical-align:baseline}',
  `th{${CAPS};color:var(--echo-soft);border-top:0}`,
  'a{color:inherit;text-underline-offset:2px}',
  'button,input,select,textarea{font:inherit;color:inherit}',
  `button{min-height:28px;padding:0 10px;border:1px solid var(--echo-line-strong);background:transparent;cursor:pointer;${CAPS}}`,
  'button:hover{border-color:var(--echo-text)}',
  'button.primary{border-color:var(--echo-text);background:var(--echo-text);color:var(--echo-ground)}',
  'button:disabled{opacity:.4;cursor:default}',
  'input,select,textarea{min-height:28px;padding:4px 8px;border:1px solid var(--echo-line-strong);background:transparent}',
  'input:focus,select:focus,textarea:focus{border-color:var(--echo-text);outline:0}',
  '::placeholder{color:var(--echo-faint)}'
].join('')

/** The origins a page may load pictures and sounds from: those of the public addresses it declares. */
function originsOf(app: Pick<WidgetApp, 'addresses'>): string[] {
  return [...new Set(app.addresses.flatMap((address) => /^https:\/\/[^/?#\\@\s;'"]+/i.exec(address)?.[0] ?? []))]
}

/** The security policy a widget's page is served under. */
export function policyOf(app: Pick<WidgetApp, 'addresses'>): string {
  const from = originsOf(app).join(' ')
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${from}`.trim(),
    `media-src blob: ${from}`.trim(),
    'font-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')
}

/** The page whole: Echo's theme, faces and base style, and the `echo` object, then the app's HTML. */
export function pageOf(app: Pick<WidgetApp, 'html'>, theme: Readonly<Record<string, string>>, faces: readonly Face[] = []): string {
  // A value goes in a style element: one that could close it is left out.
  const variables = Object.entries(theme)
    .filter(([, value]) => !/[<>{};]/.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  const style = `${faces.map(declared).join('')}:root{${variables}}${BASE}`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${style}</style><script>${SDK}</script>${app.html}`
}

/**
 * The `echo` object of a widget's page, and how the page says it started, failed and how tall it is. A message to the
 * window carries `echo: 1`; the window answers a question with its `id`.
 */
const SDK = `(() => {
  const waiting = new Map()
  let next = 0
  const ask = (type, data) => new Promise((resolve, reject) => {
    const id = ++next
    waiting.set(id, { resolve, reject })
    parent.postMessage({ echo: 1, id, type, ...data }, '*')
  })
  addEventListener('message', (event) => {
    const message = event.data
    if (event.source !== parent || !message || message.echo !== 1 || !waiting.has(message.id)) return
    const asked = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.ok) asked.resolve(message.value)
    else asked.reject(new Error(message.error))
  })
  const answer = (value) => ({ ok: value.status >= 200 && value.status < 300, status: value.status, type: value.type, text: value.body, json: () => JSON.parse(value.body) })
  window.echo = Object.freeze({
    fetch: async (url, init = {}) => answer(await ask('call', { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body === undefined ? undefined : String(init.body) })),
    state: Object.freeze({
      get: async (key) => (await ask('state', {}))[key],
      set: (key, value) => ask('keep', { key: String(key), value: value === undefined ? null : value })
    }),
    notify: (title, body) => ask('notify', { title: String(title), body: body === undefined ? '' : String(body) }),
    open: (url) => ask('open', { url: String(url) }),
    media: Object.freeze({
      play: (source) => ask('media', { action: 'play', source }),
      pause: () => ask('media', { action: 'pause' }),
      resume: () => ask('media', { action: 'resume' }),
      stop: () => ask('media', { action: 'stop' }),
      volume: (level) => ask('media', { action: 'volume', level: Number(level) }),
      state: () => ask('media', { action: 'state' })
    })
  })
  let failed = false
  const report = (outcome, message) => parent.postMessage({ echo: 1, type: 'report', outcome, message }, '*')
  const fail = (message) => {
    if (failed) return
    failed = true
    report('failed', String(message || 'An error.'))
  }
  addEventListener('error', (event) => fail(event.message))
  addEventListener('unhandledrejection', (event) => fail(event.reason && event.reason.message ? event.reason.message : event.reason))
  const size = () => parent.postMessage({ echo: 1, type: 'size', height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')
  addEventListener('load', () => {
    size()
    new ResizeObserver(size).observe(document.documentElement)
    setTimeout(() => { if (!failed) report('started') }, 1500)
  })
})()`
