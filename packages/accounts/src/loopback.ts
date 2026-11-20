import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Timers } from '@repo/core'

/**
 * Where the browser comes back to after a sign-in (RFC 8252, section 7.3): a listener on this computer's loopback
 * address, on a port the system picks, that takes one request on `/` carrying the sign-in's `state`, answers with a
 * page saying the tab can be closed, and closes. Anything else is answered 404 and changes nothing. It gives up after
 * five minutes, or when the sign-in is cancelled.
 */

/** How long the person has to sign in, in the browser. */
export const SIGN_IN_MS = 5 * 60_000

/** How many ports are tried for `localhost`, where the same one must be free on both loopback addresses. */
const PORT_TRIES = 5

export type LoopbackAnswer = { ok: true; url: URL } | { ok: false; reason: 'cancelled' | 'late' }

export interface Loopback {
  /** The redirect address the provider sends the browser to: `http://127.0.0.1:<port>/` or `http://localhost:<port>/`. */
  redirect: string
  /** The address the browser came back to, its query whole; or why it never did. */
  answer: Promise<LoopbackAnswer>
  /** Stop listening. Called once the sign-in is over, whichever way. */
  close(): void
}

const page = (words: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${words}</title></head><body style="font:15px system-ui,sans-serif;margin:3rem"><p>${words} You can close this tab.</p></body></html>`

/** Listen on `host` for the browser to come back with `state`. */
export async function listenLoopback(host: '127.0.0.1' | 'localhost', state: string, timers: Timers, signal: AbortSignal): Promise<Loopback> {
  let settle: (answer: LoopbackAnswer) => void = () => undefined
  const answer = new Promise<LoopbackAnswer>((resolve) => (settle = resolve))
  let redirect = ''
  let answered = false

  const hear = (request: IncomingMessage, response: ServerResponse) => {
    const asked = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (answered || request.method !== 'GET' || asked.pathname !== '/' || asked.searchParams.get('state') !== state) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('Not found.')
      return
    }
    answered = true
    const refused = asked.searchParams.has('error')
    response
      .writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        connection: 'close'
      })
      .end(page(refused ? 'Nothing was connected.' : 'Signed in.'))
    settle({ ok: true, url: new URL(`${redirect}${asked.search}`) })
  }

  const servers = await bind(host, hear)
  const [first] = servers
  if (!first) throw new Error('No loopback address could be listened on.')
  const { port } = first.address() as AddressInfo
  redirect = `http://${host}:${port}/`

  const cancel = () => settle({ ok: false, reason: 'cancelled' })
  const giveUp = timers.after(SIGN_IN_MS, () => settle({ ok: false, reason: 'late' }))
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()

  return {
    redirect,
    answer,
    close() {
      giveUp()
      signal.removeEventListener('abort', cancel)
      cancel()
      for (const server of servers) {
        server.close()
        server.closeAllConnections()
      }
    }
  }
}

/** The listeners: `127.0.0.1` alone, or for `localhost` both loopback addresses on one port, wherever `localhost` leads. */
async function bind(host: '127.0.0.1' | 'localhost', hear: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server[]> {
  for (let tried = 0; tried < PORT_TRIES; tried++) {
    const first = await start(hear, '127.0.0.1', 0)
    if (host === '127.0.0.1') return [first]
    const port = (first.address() as AddressInfo).port
    try {
      return [first, await start(hear, '::1', port)]
    } catch (error) {
      // A computer with no IPv6 resolves `localhost` to 127.0.0.1 alone. A port taken on ::1 is tried again elsewhere.
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') return [first]
      first.close()
    }
  }
  throw new Error('No port of this computer was free to come back to after signing in.')
}

function start(hear: (request: IncomingMessage, response: ServerResponse) => void, address: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(hear)
    server.once('error', reject)
    server.listen({ host: address, port, ipv6Only: address === '::1' }, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
