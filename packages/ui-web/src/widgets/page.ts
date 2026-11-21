import type { WidgetApp } from '@repo/protocol'

/**
 * A widget app's page as its frame is given it (docs/SPEC.md, section 9.9): the app's own HTML, after Echo's colours
 * and the `echo` object its code reaches the world with, and the security policy it is served under. The policy lets
 * the page run its own scripts and styles and load pictures and sounds from the addresses it declares, and nothing
 * else: no request of its own, no form sent, no frame, no other script. Everything else goes through `echo`, which
 * asks the window, which asks the core.
 */

/** Echo's colours and fonts, by the names a widget's CSS uses, from the theme's variables of the window. */
const THEME: Readonly<Record<string, string>> = {
  '--echo-text': '--color-text',
  '--echo-soft': '--color-text-soft',
  '--echo-faint': '--color-text-faint',
  '--echo-accent': '--color-accent',
  '--echo-accent-ink': '--color-accent-ink',
  '--echo-ok': '--color-ok',
  '--echo-warn': '--color-warn',
  '--echo-danger': '--color-danger',
  '--echo-line': '--color-line',
  '--echo-line-strong': '--color-line-strong',
  '--echo-surface': '--color-raised',
  '--echo-font': '--font-sans',
  '--echo-mono': '--font-mono'
}

/** The theme's values a page is given, read from the window's own variables. */
export function themeOf(read: (name: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(THEME).map(([name, from]) => [name, read(from).trim()]))
}

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

/** The page whole: Echo's theme and the `echo` object, then the app's HTML. */
export function pageOf(app: Pick<WidgetApp, 'html'>, theme: Readonly<Record<string, string>>): string {
  // A value goes in a style element: one that could close it is left out.
  const variables = Object.entries(theme)
    .filter(([, value]) => !/[<>{};]/.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  // Nothing of a widget scrolls sideways, as nothing of the window does; what is too tall scrolls with a thin bar.
  const style = `:root{${variables};color-scheme:dark;scrollbar-width:thin;scrollbar-color:var(--echo-line-strong) transparent}*,*::before,*::after{box-sizing:border-box}html,body{margin:0;overflow-x:hidden;background:transparent;color:var(--echo-text);font:13px/1.45 var(--echo-font)}`
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
    open: (url) => ask('open', { url: String(url) })
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
