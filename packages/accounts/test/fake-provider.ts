import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Timers } from '@repo/core'
import type { Vault } from '../src/accounts.ts'

/**
 * Google and Microsoft as the adapter reaches them, played by one server on this computer's loopback address: the
 * adapter's fetch is given one that sends `https://<host>/<path>` to `http://127.0.0.1:<port>/<host>/<path>`. Nothing
 * reaches either provider.
 */

/** How the person answers in the browser. */
export type Person = 'agree' | 'refuse' | 'wrong-state' | 'wander' | 'away'

interface Issued {
  challenge: string
  redirect: string
  scope: string
}

export interface FakeProvider {
  fetch(url: string, init: RequestInit): Promise<Response>
  /** The browser, as `open` reaches it: the pages the adapter opened, and how the person answers each. */
  open(url: string): Promise<void>
  person: Person
  opened: URL[]
  /** What the browser was answered when it came back, in order. */
  answers: number[]
  /** The token requests, as sent. */
  tokenRequests: URLSearchParams[]
  revoked: string[]
  /** Where the sign-in page is, as discovery says: change it to have the adapter refuse to open it. */
  authorizationHost: string
  /** The access tokens the provider accepts. */
  live: Set<string>
  /** What the provider answers for a path, beyond sign-in: the calls of the tools. */
  serve(route: string, answer: (url: URL, request: IncomingMessage) => { status?: number; body: unknown }): void
  close(): Promise<void>
}

const json = (response: ServerResponse, status: number, body: unknown) =>
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

const base64url = (bytes: Buffer) => bytes.toString('base64url')

export async function fakeProvider(): Promise<FakeProvider> {
  const issued = new Map<string, Issued>()
  const refreshes = new Set<string>()
  const routes = new Map<string, (url: URL, request: IncomingMessage) => { status?: number; body: unknown }>()
  let made = 0

  const read = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = ''
      request.setEncoding('utf8').on('data', (chunk: string) => (body += chunk))
      request.on('end', () => resolve(body))
    })

  const token = async (request: IncomingMessage, response: ServerResponse, rotates: boolean) => {
    const form = new URLSearchParams(await read(request))
    fake.tokenRequests.push(form)
    if (form.get('grant_type') === 'authorization_code') {
      const code = issued.get(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      if (!code || base64url(createHash('sha256').update(verifier).digest()) !== code.challenge || form.get('redirect_uri') !== code.redirect)
        return json(response, 400, { error: 'invalid_grant' })
      issued.delete(form.get('code') ?? '')
      const access = `access-${++made}`
      const refresh = `refresh-${made}`
      fake.live.add(access)
      refreshes.add(refresh)
      return json(response, 200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: code.scope })
    }
    const refresh = form.get('refresh_token') ?? ''
    if (!refreshes.has(refresh)) return json(response, 400, { error: 'invalid_grant' })
    const access = `access-${++made}`
    fake.live.add(access)
    if (!rotates) return json(response, 200, { access_token: access, expires_in: 3600, token_type: 'Bearer' })
    refreshes.delete(refresh)
    refreshes.add(`refresh-${made}`)
    return json(response, 200, { access_token: access, refresh_token: `refresh-${made}`, expires_in: 3600, token_type: 'Bearer' })
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const [, host = '', ...rest] = url.pathname.split('/')
    const path = `/${rest.join('/')}`
    const route = `${host}${decodeURIComponent(path)}`
    if (route === 'accounts.google.com/.well-known/openid-configuration')
      return json(response, 200, {
        issuer: 'https://accounts.google.com',
        authorization_endpoint: `https://${fake.authorizationHost}/o/oauth2/v2/auth`,
        token_endpoint: 'https://oauth2.googleapis.com/token',
        revocation_endpoint: 'https://oauth2.googleapis.com/revoke',
        code_challenge_methods_supported: ['S256']
      })
    if (route === 'login.microsoftonline.com/common/v2.0/.well-known/openid-configuration')
      return json(response, 200, {
        issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
        authorization_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
      })
    if (route === 'oauth2.googleapis.com/token') return void token(request, response, false)
    if (route === 'login.microsoftonline.com/common/oauth2/v2.0/token') return void token(request, response, true)
    if (route === 'oauth2.googleapis.com/revoke')
      return void read(request).then((body) => {
        fake.revoked.push(new URLSearchParams(body).get('token') ?? '')
        json(response, 200, {})
      })
    const answer = routes.get(route)
    if (!answer) return json(response, 404, { error: { message: 'Not found' } })
    if (!fake.live.has((request.headers.authorization ?? '').replace('Bearer ', ''))) return json(response, 401, { error: { message: 'Invalid token' } })
    const { status = 200, body } = answer(new URL(`https://${host}${path}${url.search}`), request)
    return json(response, status, body)
  })
  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const { port } = server.address() as AddressInfo

  /** The person in the browser, at the page the adapter opened: they come back to the app as `person` says. */
  const browse = async (page: URL) => {
    const redirect = page.searchParams.get('redirect_uri') ?? ''
    const state = page.searchParams.get('state') ?? ''
    const code = randomUUID()
    issued.set(code, { challenge: page.searchParams.get('code_challenge') ?? '', redirect, scope: page.searchParams.get('scope') ?? '' })
    const back = (query: Record<string, string>, path = '') => fetch(`${redirect}${path}?${new URLSearchParams(query)}`).then((answer) => answer.status)
    switch (fake.person) {
      case 'agree':
        fake.answers.push(await back({ code, state }))
        return
      case 'refuse':
        fake.answers.push(await back({ error: 'access_denied', state }))
        return
      case 'wrong-state':
        fake.answers.push(await back({ code, state: 'forged' }))
        fake.answers.push(await back({ code, state }))
        return
      case 'wander':
        fake.answers.push(await back({ code, state }, 'elsewhere'))
        fake.answers.push(await back({ code, state }))
        return
      case 'away':
        return
    }
  }

  const fake: FakeProvider = {
    fetch(url, init) {
      const target = new URL(url)
      return fetch(`http://127.0.0.1:${port}/${target.hostname}${target.pathname}${target.search}`, init)
    },
    async open(url) {
      const page = new URL(url)
      fake.opened.push(page)
      void browse(page)
    },
    person: 'agree',
    opened: [],
    answers: [],
    tokenRequests: [],
    revoked: [],
    authorizationHost: 'accounts.google.com',
    live: new Set(),
    serve: (route, answer) => void routes.set(route, answer),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
  return fake
}

/** A vault in memory, for the adapter's tests. */
export function memoryVault(): Vault & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    keeping: async () => ({ kept: true }),
    read: async (name) => entries.get(name),
    write: async (name, text) => void entries.set(name, text),
    erase: async (name) => void entries.delete(name)
  }
}

/** Timers whose time passes only when told. */
export function handTimers(): Timers & { advance(ms: number): void } {
  let now = 0
  const waiting = new Set<{ at: number; work: () => void }>()
  return {
    after(ms, work) {
      const timer = { at: now + ms, work }
      waiting.add(timer)
      return () => void waiting.delete(timer)
    },
    advance(ms) {
      now += ms
      for (const timer of [...waiting].filter((one) => one.at <= now)) {
        waiting.delete(timer)
        timer.work()
      }
    }
  }
}
