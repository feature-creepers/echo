import { CommandFailed } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Connection, SavedWidget, Service, WidgetApp } from '@repo/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { type LibraryControls, useLibraryControls } from '../library/library-context.ts'
import { usePlayer } from '../media/player-provider.tsx'
import { Button } from '../primitives/button.tsx'
import { answerQuestion, type FrameServices, readMessage } from './bridge.ts'
import { pageOf, policyOf, themeOf } from './page.ts'

/** The height a widget's frame starts at, and the most it grows to, in pixels: past that, the page scrolls itself. */
const FIRST_HEIGHT = 120
const MOST_HEIGHT = 720

const wordsOf = (error: unknown) => (error instanceof CommandFailed && error.detail ? error.detail : error instanceof Error ? error.message : String(error))
const sameApi = (one: string, other: string) => one.replace(/\/+$/, '') === other.replace(/\/+$/, '')

/**
 * A widget app, live (docs/SPEC.md, section 9.9): its page in a sandboxed frame of its own, which reaches the world only
 * through the window, and the window only through the core. Before it calls a service with the person's sign-in, the
 * person connects the service and allows the widget, here on the widget itself.
 */
export function AppFrame({ widget }: { widget: string }) {
  const controls = useLibraryControls()
  return controls ? <AppOf controls={controls} id={widget} /> : <Quiet>Widget apps run in the conversation.</Quiet>
}

function AppOf({ controls, id }: { controls: LibraryControls; id: string }) {
  const library = useFollowed(controls.library)
  const services = useFollowed(controls.services)
  const widget = library?.widgets.find((one) => one.id === id)
  const app = widget?.app
  const session = controls.session
  // A service waits for the person until it is connected here and the widget is allowed to call it.
  const waiting = (app?.services ?? []).filter((service) => {
    const connected = services?.connections.some((one) => sameApi(one.api, service.api) && one.state === 'ready')
    return !connected || !app?.allowed.includes(service.api)
  })
  const names = waiting.map((service) => service.name).join(', ')

  // The core hears once per build that it waits for the person, so the session that built it can say so.
  useEffect(() => {
    if (!app || services === undefined || names === '') return
    void session
      .run('widget.report', { widget: id, built: app.built, outcome: 'waiting', message: `connect and allow ${names} on the widget` })
      .catch(() => undefined)
  }, [session, services === undefined, names, id, app])

  if (!library || services === undefined) return <Quiet>Loading…</Quiet>
  if (!widget || !app) return <Quiet>This widget app is no longer in the library.</Quiet>
  const running = { ...widget, app }
  if (waiting.length > 0) return <Allow widget={running} waiting={waiting} connections={services.connections} />
  return <Frame widget={running} />
}

/** The page itself, once nothing waits. */
function Frame({ widget }: { widget: SavedWidget & { app: WidgetApp } }) {
  const { host } = useDevice()
  const controls = useLibraryControls()
  const session = controls?.session
  const { app } = widget
  const player = usePlayer()
  const frame = useRef<HTMLIFrameElement>(null)
  const around = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState<string>()
  const [height, setHeight] = useState(FIRST_HEIGHT)
  const [problem, setProblem] = useState<string>()

  // A new build is a new page, in Echo's look, with the accent of the persona where it is drawn.
  useEffect(() => {
    const widgets = host?.widgets
    if (!widgets || !around.current) return
    let current = true
    const style = getComputedStyle(around.current)
    import('./faces.ts')
      .then(({ FACES }) =>
        widgets.frame(
          pageOf(
            app,
            themeOf((name) => style.getPropertyValue(name)),
            FACES
          ),
          policyOf(app)
        )
      )
      .then(
        (url) => current && setAddress(url),
        (error: unknown) => current && setProblem(wordsOf(error))
      )
    return () => {
      current = false
    }
  }, [host, app])

  const answering = useMemo<FrameServices | undefined>(() => {
    if (!session) return undefined
    return {
      call: (request) => session.run('widget.call', { widget: widget.id, ...request }),
      state: async () => (await session.run('widget.state.read', { widget: widget.id })).state,
      keep: async (key, value) => void (await session.run('widget.state.write', { widget: widget.id, key, value })),
      notify: async (title, body) => void (await session.run('widget.notify', { widget: widget.id, title, body })),
      // The window opens an https page in the person's browser.
      open: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
      // Echo's one player: what a widget plays is lowered under the voice, and goes on when the widget is closed.
      media: {
        play: (source) => player.play({ ...source, kind: 'audio' }),
        pause: () => player.pause(),
        resume: () => {
          const { source } = player.current()
          if (source) player.play(source)
        },
        stop: () => player.stop(),
        volume: (level) => player.setVolume(level),
        state: () => {
          const now = player.current()
          return { title: now.source?.title, status: now.status, volume: now.volume, position: now.position, duration: now.duration }
        }
      }
    }
  }, [session, widget.id, player])

  useEffect(() => {
    if (!answering || !session) return
    const hear = (event: MessageEvent) => {
      const page = frame.current?.contentWindow
      if (!page || event.source !== page) return
      const message = readMessage(event.data)
      if (!message) return
      if ('question' in message) {
        void answerQuestion(message.question, app, answering).then((answer) => page.postMessage(answer, '*'))
        return
      }
      if (message.news.type === 'size') return setHeight(Math.min(MOST_HEIGHT, Math.max(40, message.news.height)))
      if (message.news.outcome === 'failed') setProblem(message.news.message ?? 'It stopped on an error.')
      void session
        .run('widget.report', {
          widget: widget.id,
          built: app.built,
          outcome: message.news.outcome,
          ...(message.news.message === undefined ? {} : { message: message.news.message })
        })
        .catch(() => undefined)
    }
    window.addEventListener('message', hear)
    return () => window.removeEventListener('message', hear)
  }, [answering, session, app, widget.id])

  if (!host?.widgets) return <Quiet>Widget apps run in the desktop app.</Quiet>
  return (
    <div ref={around} className="grid min-w-0 gap-1">
      {address && (
        <iframe
          ref={frame}
          src={address}
          title={widget.title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="w-full min-w-0 border-0 bg-transparent"
          style={{ height }}
        />
      )}
      {problem && (
        <p role="alert" className="text-danger text-xs break-words">
          {problem}
        </p>
      )}
    </div>
  )
}

/** What the person does before the widget runs: connect each service it calls, and allow it to call them. */
function Allow({ widget, waiting, connections }: { widget: SavedWidget & { app: WidgetApp }; waiting: Service[]; connections: readonly Connection[] }) {
  const controls = useLibraryControls()
  const [problem, setProblem] = useState<string>()
  const unconnected = waiting.filter((service) => !connections.some((one) => sameApi(one.api, service.api) && one.state === 'ready'))
  const allow = () => {
    setProblem(undefined)
    controls?.session.run('widget.allow', { widget: widget.id }).catch((error: unknown) => setProblem(wordsOf(error)))
  }
  return (
    <div className="grid gap-3 border border-line bg-text/[0.018] p-3">
      <p className="text-sm">
        {`${widget.title} calls ${waiting.map((service) => service.name).join(' and ')} with your sign-in. Echo keeps the sign-in; the widget never sees it.`}
      </p>
      {unconnected.map((service) => (
        <Connect key={service.api} service={service} />
      ))}
      {unconnected.length === 0 && (
        <Button kind="primary" size="sm" className="w-fit" onClick={allow}>
          {`Allow it to use ${waiting.map((service) => service.name).join(' and ')}`}
        </Button>
      )}
      {problem && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Connect one service: with a token the person pastes, or by signing in in the browser with the app they registered. */
function Connect({ service }: { service: Service }) {
  const controls = useLibraryControls()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const token = service.sign.kind === 'token'
  const host = /^https:\/\/([^/?#]+)/.exec(service.api)?.[1] ?? service.api
  const connect = () => {
    if (!controls || value.trim() === '') return
    setBusy(true)
    setProblem(undefined)
    controls.services
      .connect({ service, ...(token ? { token: value.trim() } : { clientId: value.trim() }) })
      .catch((error: unknown) => setProblem(wordsOf(error)))
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        connect()
      }}
    >
      <p className="text-text-soft text-xs">
        {token
          ? `${service.name} (${host}): paste a token you make at ${service.name}.`
          : `${service.name} (${host}): sign in with an app you registered at ${service.name}, its redirect http://127.0.0.1.`}
        {service.sign.help && (
          <>
            {' '}
            <a href={service.sign.help} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
              {token ? 'Make one' : 'Register it'}
            </a>
          </>
        )}
      </p>
      <div className="flex gap-1.5">
        <input
          type={token ? 'password' : 'text'}
          aria-label={token ? `Token for ${service.name}` : `Client identifier of your ${service.name} app`}
          placeholder={token ? 'Token' : 'Client ID'}
          autoComplete="off"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 min-w-0 flex-1 border border-line-strong bg-black/25 px-2.5 text-sm placeholder:text-text-faint disabled:opacity-60"
        />
        <Button type="submit" kind="secondary" size="sm" disabled={busy || value.trim() === ''}>
          {busy ? (token ? 'Connecting…' : 'Signing in…') : token ? 'Connect' : 'Sign in'}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
    </form>
  )
}

function Quiet({ children }: { children: string }) {
  return <p className="text-text-faint text-sm">{children}</p>
}
