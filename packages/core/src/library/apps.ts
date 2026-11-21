import {
  APP_MAX_LENGTH,
  type CommandError,
  type CommandOutput,
  type CommandRequest,
  httpsAddressSchema,
  isWithin,
  serviceSchema,
  widgetTitleSchema
} from '@repo/protocol'
import { z } from 'zod'
import type { Timers } from '../ports/clock.ts'
import type { Signal } from '../ports/harness.ts'
import { ERASURE, type Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'
import type { Web } from '../ports/web.ts'
import type { Connections } from '../services/connections.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import type { Library } from './library.ts'

/**
 * Widget apps (docs/SPEC.md, section 9.9): what a session builds them with, and what they reach once built, with no
 * model in between. An app reaches the web only through the core, and only the public addresses and the services it
 * declares; a service only once the person allowed it, with a sign-in the app never sees. It keeps its own values here.
 */

const WIDGET_BUILD_TOOL = 'widget_build'
const WIDGET_SOURCE_TOOL = 'widget_source'

/** The type of a record holding one value a widget app kept. A later one with the same widget and key replaces it. */
const STATE = 'widget.state'
const stateSchema = z.object({ widget: z.string().min(1).max(64), key: z.string().min(1).max(100), value: z.unknown() })

/** How many values an app keeps, and how long one may be written, in characters of JSON. */
const MAX_KEYS = 100
const MAX_VALUE = 64 * 1024
/** How much of a public address an app reads, and how long it waits for it. */
const PUBLIC_BYTES = 2 * 1024 * 1024
const PUBLIC_MS = 20_000
/** How often an app may tell the person something. */
const NOTIFY_EVERY_MS = 60_000
/** How long a build waits to hear how it started where it is drawn. */
const REPORT_MS = 8_000

/** Headers an app may not set: the sign-in is the core's to add, and the rest are the platform's. */
const KEPT_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'host', 'content-length', 'connection'])

type Report = CommandRequest<'widget.report'>
type Refused = { ok: false; error: CommandError }

interface WidgetAppsOptions {
  library: Library
  connections: Connections
  /** The public web, as the core reads it. Left out, an app reads no public address. */
  web: Web | undefined
  records: Records
  now: () => Date
  /** Show a notification on the person's devices. */
  notify(notice: { title: string; body: string }): void
  /** Left out, a build does not wait to hear how it started. */
  timers: Timers | undefined
}

export interface WidgetApps {
  call(asked: CommandRequest<'widget.call'>, signal: Signal): Promise<{ ok: true; output: CommandOutput<'widget.call'> } | Refused>
  readState(widget: string): { ok: true; state: Record<string, unknown> } | Refused
  writeState(asked: CommandRequest<'widget.state.write'>): { ok: true } | Refused
  notify(asked: CommandRequest<'widget.notify'>): { ok: true } | Refused
  /** A client said how a build started where it is drawn. */
  report(report: Report): void
  /** The tools a thread builds apps with. */
  tools(showing: () => Showing): Tool[]
}

const refuse = (message: string, code: CommandError['code'] = 'invalid-input'): Refused => ({ ok: false, error: { code, message } })

export function createWidgetApps({ library, connections, web, records, now, notify, timers }: WidgetAppsOptions): WidgetApps {
  // When each app last told the person something.
  const notified = new Map<string, number>()
  // Each value an app keeps, by widget and key, with the record that holds it.
  const kept = new Map<string, Map<string, { value: unknown; record: string }>>()
  for (const record of records.read([STATE])) {
    const read = stateSchema.safeParse(record.payload)
    if (!read.success) continue
    const values = kept.get(read.data.widget) ?? new Map()
    values.set(read.data.key, { value: read.data.value, record: record.id })
    kept.set(read.data.widget, values)
  }
  // A widget deleted takes what it kept with it.
  library.onEvent((event) => {
    if (event.name !== 'library.changed') return
    const present = new Set(event.library.widgets.map((widget) => widget.id))
    for (const [widget, values] of kept) {
      if (present.has(widget)) continue
      records.append([{ type: ERASURE, payload: { records: [...values.values()].map((one) => one.record) } }])
      kept.delete(widget)
    }
  })

  // How each build started, and the builds waiting to hear it.
  const reports = new Map<string, Report>()
  const waiting = new Map<string, (report: Report) => void>()
  const heard = (widget: string, built: string, ms: number) =>
    new Promise<Report | undefined>((resolve) => {
      const key = `${widget} ${built}`
      const known = reports.get(key)
      if (known || !timers) return resolve(known)
      const giveUp = timers.after(ms, () => {
        waiting.delete(key)
        resolve(undefined)
      })
      waiting.set(key, (report) => {
        giveUp()
        resolve(report)
      })
    })

  const appOf = (widget: string) => library.get(widget)?.app

  return {
    async call(asked, signal) {
      const app = appOf(asked.widget)
      if (!app) return refuse(`There is no widget app "${asked.widget}".`, 'unknown-widget')
      const service = app.services.find((one) => isWithin(asked.url, one.api))
      if (service) {
        if (!app.allowed.includes(service.api)) return refuse(`${service.name} is not allowed for this widget yet: allow it on the widget.`, 'failed')
        const headers = Object.fromEntries(Object.entries(asked.headers).filter(([name]) => !KEPT_HEADERS.has(name.toLowerCase())))
        const answer = await connections.call(service.api, { url: asked.url, method: asked.method, headers, body: asked.body }, signal)
        if (!answer.ok) return refuse(answer.reason, 'failed')
        return { ok: true, output: { status: answer.status, ...(answer.type === undefined ? {} : { type: answer.type }), body: answer.body } }
      }
      if (!app.addresses.some((start) => isWithin(asked.url, start))) return refuse(`${asked.url} is not among the addresses this widget declared.`)
      if (asked.method !== 'GET') return refuse('A public address is only read, with GET.')
      if (!web) return refuse('Public addresses cannot be read where this assistant runs.', 'failed')
      const read = await web.read(asked.url, { maxBytes: PUBLIC_BYTES, timeoutMs: PUBLIC_MS })
      return read.ok ? { ok: true, output: { status: 200, body: read.text } } : refuse(`${asked.url} could not be read: ${read.reason}`, 'failed')
    },

    readState(widget) {
      if (!appOf(widget)) return refuse(`There is no widget app "${widget}".`, 'unknown-widget')
      return { ok: true, state: Object.fromEntries([...(kept.get(widget) ?? [])].map(([key, one]) => [key, one.value])) }
    },

    writeState({ widget, key, value }) {
      if (!appOf(widget)) return refuse(`There is no widget app "${widget}".`, 'unknown-widget')
      const values = kept.get(widget) ?? new Map<string, { value: unknown; record: string }>()
      const before = values.get(key)
      if (value === null || value === undefined) {
        if (!before) return { ok: true }
        records.append([{ type: ERASURE, payload: { records: [before.record] } }])
        values.delete(key)
        return { ok: true }
      }
      if (!before && values.size >= MAX_KEYS) return refuse(`A widget keeps ${MAX_KEYS} values at most.`)
      const written = JSON.stringify(value)
      if (written === undefined || written.length > MAX_VALUE) return refuse(`A value is ${MAX_VALUE / 1024} KB of JSON at most.`)
      const [record] = records.append([{ type: STATE, payload: { widget, key, value } }])
      if (before) records.append([{ type: ERASURE, payload: { records: [before.record] } }])
      if (record) values.set(key, { value, record: record.id })
      kept.set(widget, values)
      return { ok: true }
    },

    notify({ widget, title, body }) {
      if (!appOf(widget)) return refuse(`There is no widget app "${widget}".`, 'unknown-widget')
      const at = now().getTime()
      if (at - (notified.get(widget) ?? Number.NEGATIVE_INFINITY) < NOTIFY_EVERY_MS) return refuse('A widget tells the person something once a minute at most.')
      notified.set(widget, at)
      notify({ title, body })
      return { ok: true }
    },

    report(report) {
      const key = `${report.widget} ${report.built}`
      // The first word on a build is the one that counts: another window drawing it says the same.
      if (reports.has(key)) return
      reports.set(key, report)
      waiting.get(key)?.(report)
      waiting.delete(key)
    },

    tools: (showing) => [
      {
        definition: {
          name: WIDGET_BUILD_TOOL,
          description: BUILD_DESCRIPTION,
          inputSchema: {
            type: 'object',
            properties: {
              widget: { type: 'string', description: 'The id of the widget app to change. Left out, a new one.' },
              title: { type: 'string', description: 'What the person calls it: "CI of echo", "My playlists".' },
              html: { type: 'string', description: 'The whole page.' },
              addresses: { type: 'array', items: { type: 'string' }, description: 'The public https addresses it reads, by their start.' },
              services: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { api: { type: 'string' }, name: { type: 'string' }, sign: { type: 'object' } },
                  required: ['api', 'name', 'sign']
                }
              }
            },
            required: ['title', 'html']
          }
        },
        async run(input) {
          const asked = buildInput.safeParse(input)
          if (!asked.success)
            return {
              ok: false,
              text: `Nothing was built. Correct it and call again:\n- ${asked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n- ')}`
            }
          const built = library.build(asked.data)
          if (!built.ok) return { ok: false, text: built.text }
          const { widget } = built
          const shown = library.show(widget.id, showing())
          if (!shown.ok) return { ok: true, text: `Built "${widget.title}" [${widget.id}], but it could not be shown: ${shown.text}` }
          const report = await heard(widget.id, widget.app?.built ?? '', REPORT_MS)
          return { ok: report?.outcome !== 'failed', text: reportText(widget.id, widget.title, report) }
        }
      },
      {
        definition: {
          name: WIDGET_SOURCE_TOOL,
          description: `The page and the declarations of a widget app of the library, to change it with ${WIDGET_BUILD_TOOL}.`,
          inputSchema: { type: 'object', properties: { widget: { type: 'string' } }, required: ['widget'] }
        },
        run(input): ToolResult {
          const asked = z.object({ widget: z.string().min(1).max(64) }).safeParse(input)
          const widget = asked.success ? library.get(asked.data.widget) : undefined
          if (!widget?.app) return { ok: false, text: 'Give the id of a widget app of the library as "widget".' }
          const { html, addresses, services } = widget.app
          return { ok: true, text: `${JSON.stringify({ widget: widget.id, title: widget.title, addresses, services })}\n\n${html}` }
        }
      }
    ]
  }
}

const buildInput = z.object({
  widget: z.string().min(1).max(64).optional(),
  title: widgetTitleSchema,
  html: z.string().min(1).max(APP_MAX_LENGTH),
  addresses: z.array(httpsAddressSchema).max(8).default([]),
  services: z.array(serviceSchema).max(4).default([])
})

/** What a build came to, for the session that built it. */
function reportText(id: string, title: string, report: Report | undefined): string {
  const named = `"${title}" [${id}]`
  if (!report) return `Built ${named} and shown. No window has drawn it yet, so whether it runs is not known.`
  if (report.outcome === 'started') return `Built ${named} and shown: it runs.`
  if (report.outcome === 'waiting')
    return `Built ${named} and shown. It waits for the person: ${report.message ?? 'they connect and allow its services on the widget'}. Tell them in a sentence what to do.`
  return `${named} failed where it is drawn: ${report.message ?? 'an error'}. Correct it and call ${WIDGET_BUILD_TOOL} again with "widget": "${id}".`
}

const BUILD_DESCRIPTION = [
  'Build a widget app the person asked for, or change one: a small web page of its own that runs in Echo, live, and is used with no call to you. It checks, shows and does things by itself: the CI of a repository, their playlists, a tracker, a dashboard. It is saved in their library and shown at once.',
  'Write the page whole each time in `html`: HTML, CSS and JavaScript in the page itself, with no script, stylesheet or font to load from elsewhere and no framework. Keep it compact and quiet: the background is transparent, and Echo gives its colours and font as CSS variables (--echo-text, --echo-soft, --echo-faint, --echo-accent, --echo-ok, --echo-warn, --echo-danger, --echo-line, --echo-surface, --echo-font). Show a short state while it loads, and a plain sentence when something fails.',
  "It reaches the web only with `await echo.fetch(url, { method, headers, body })`, which gives `{ ok, status, type, text, json() }` and throws with why when refused: a public https address that starts with one of `addresses` (read only), or the API of one of `services`, called with the person's sign-in, which neither you nor the page ever sees. It keeps values with `await echo.state.get(key)` and `await echo.state.set(key, value)`, tells the person something with `echo.notify(title, body)`, and opens a page of a declared address in the browser with `echo.open(url)`. It refreshes itself with setInterval when what it shows changes.",
  'A service is { "api": its start ("https://api.github.com/"), "name", "sign" }. Sign in with a token the person makes at `help`: { "kind": "token", "help", "header"?, "prefix"? }, Authorization: Bearer by default; ask for the fewest rights it needs. Or with OAuth 2.0 and PKCE: { "kind": "oauth", "authorize", "token", "scopes", "help" }, where the person registers an app with the redirect http://127.0.0.1 and gives its client id. They connect and allow it on the widget itself.',
  'The result says whether it runs, failed with why, or waits for the person. When it failed, correct it and build again.'
].join('\n')
