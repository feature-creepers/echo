import { request } from 'node:http'
import { connect } from 'node:net'
import type { ToolDefinition, ToolHost, ToolResult } from '@repo/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSIONS } from './mcp.ts'
import { MAX_BODY_BYTES, serveTools, type ToolServer, type ToolServerOptions } from './server.ts'

const TOKEN = 'token-of-a-session'

const TOOLS: ToolDefinition[] = [
  { name: 'ui_render', description: 'Show a view.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'memory_search', description: 'Search what is remembered.', inputSchema: { type: 'object' } }
]

/** A host with one session, whose tools do what `run` says. It remembers every call it was given. */
function hosting(run: (name: string, input: unknown) => ToolResult | Promise<ToolResult> = () => ({ ok: true, text: 'done' })) {
  const calls: { token: string; name: string; input: unknown }[] = []
  const host: ToolHost = {
    list: (token) => (token === TOKEN ? TOOLS : undefined),
    call: async (token, name, input) => {
      calls.push({ token, name, input })
      return run(name, input)
    }
  }
  return { host, calls }
}

const servers: ToolServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

async function serve(host: ToolHost, options?: ToolServerOptions): Promise<ToolServer> {
  const server = await serveTools(host, options)
  servers.push(server)
  return server
}

/** Send what a harness would. `token: null` sends no token at all. */
function post(url: string, message: unknown, { token = TOKEN as string | null, headers = {} as Record<string, string> } = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers
    },
    body: typeof message === 'string' ? message : JSON.stringify(message)
  })
}

/** Make a request and give the answer to it. */
async function ask(url: string, method: string, params?: unknown): Promise<unknown> {
  const response = await post(url, { jsonrpc: '2.0', id: 1, method, params })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/json')
  return response.json()
}

/** A ping that names `host` as the host it is for, which `fetch` cannot be made to do. */
function pingNaming(url: string, host: string): Promise<number> {
  const { hostname, port, pathname } = new URL(url)
  return new Promise((resolve, reject) => {
    const sent = request(
      { hostname, port, path: pathname, method: 'POST', headers: { host, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } },
      (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      }
    )
    sent.on('error', reject)
    sent.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }))
  })
}

const calling = (name: string, input?: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: input === undefined ? { name } : { name, arguments: input }
})
const failed = (id: string | number | null, code: number) => ({ jsonrpc: '2.0', id, error: { code, message: expect.any(String) } })
const shown = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError })

describe('serveTools', () => {
  describe('where it listens', () => {
    it('gives an address on the loopback interface, on a port the system picked', async () => {
      const one = await serve(hosting().host)
      const other = await serve(hosting().host)

      expect(one.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      expect(other.url).not.toBe(one.url)
    })

    it('listens on the port it is given, and fails when that port is taken', async () => {
      const { host } = hosting()
      const first = await serve(host)
      const port = Number(new URL(first.url).port)
      await first.close()

      const again = await serve(host, { port })
      expect(again.url).toBe(first.url)
      await expect(serveTools(host, { port })).rejects.toThrow(/EADDRINUSE/)
    })
  })

  describe('the handshake', () => {
    it('takes a harness from its first request to a call, the way Claude Code goes about it', async () => {
      const { host, calls } = hosting(() => ({ ok: true, text: 'shown' }))
      const { url } = await serve(host, { version: '1.2.3' })

      // It first tries a later revision of the protocol, and is told this server does not speak it.
      const probe = await post(url, { jsonrpc: '2.0', id: 'probe', method: 'server/discover' }, { headers: { 'mcp-protocol-version': '2026-07-28' } })
      expect(probe.status).toBe(400)

      expect(await ask(url, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'a-harness', version: '1' } })).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'tools', version: '1.2.3' } }
      })

      const agreed = { headers: { 'mcp-protocol-version': '2025-11-25' } }
      const ready = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, agreed)
      expect(ready.status).toBe(202)
      expect(await ready.text()).toBe('')

      const listed = await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, agreed)
      expect(await listed.json()).toEqual({ jsonrpc: '2.0', id: 2, result: { tools: TOOLS } })

      const called = await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ui_render', arguments: { title: 'Hello' } } }, agreed)
      expect(await called.json()).toEqual({ jsonrpc: '2.0', id: 3, result: shown('shown') })
      expect(calls).toEqual([{ token: TOKEN, name: 'ui_render', input: { title: 'Hello' } }])
    })

    it('answers with the revision asked for when it speaks it, and with its most recent otherwise', async () => {
      const { url } = await serve(hosting().host)
      const agreedOn = async (params?: unknown) => ((await ask(url, 'initialize', params)) as { result: { protocolVersion: string } }).result.protocolVersion

      for (const version of PROTOCOL_VERSIONS) expect(await agreedOn({ protocolVersion: version })).toBe(version)
      expect(await agreedOn({ protocolVersion: '2099-01-01' })).toBe('2025-11-25')
      expect(await agreedOn({ protocolVersion: 7 })).toBe('2025-11-25')
      expect(await agreedOn()).toBe('2025-11-25')
    })

    it('refuses a request made in a revision it does not speak, in a way that is not a JSON-RPC error', async () => {
      const { url } = await serve(hosting().host)

      const refused = await post(url, { jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { 'mcp-protocol-version': '2026-07-28' } })

      expect(refused.status).toBe(400)
      expect(refused.headers.get('content-type')).toMatch(/^text\/plain/)
      expect(await refused.text()).toContain('2026-07-28')
    })

    it('answers a ping', async () => {
      const { url } = await serve(hosting().host)
      expect(await ask(url, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })
  })

  describe('tools', () => {
    it('lists the tools of the session, with what a model needs and nothing else', async () => {
      const kept = { name: 'ui_clear', description: 'Clear the views.', inputSchema: { type: 'object' } }
      const host: ToolHost = { list: () => [{ ...kept, internal: 'not for a model' } as ToolDefinition], call: async () => ({ ok: true, text: '' }) }
      const { url } = await serve(host)

      expect(await ask(url, 'tools/list')).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [kept] } })
    })

    it('carries a call to the host with the token, the name and the input, and the result back as one text', async () => {
      const { host, calls } = hosting((name, input) => ({ ok: true, text: `${name} got ${JSON.stringify(input)}` }))
      const { url } = await serve(host)

      const response = await post(url, calling('ui_render', { title: 'Hello', nested: { list: [1, 2] } }))

      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: shown('ui_render got {"title":"Hello","nested":{"list":[1,2]}}') })
      expect(calls).toEqual([{ token: TOKEN, name: 'ui_render', input: { title: 'Hello', nested: { list: [1, 2] } } }])
    })

    it('gives the host an empty input when the call has none', async () => {
      const { host, calls } = hosting()
      const { url } = await serve(host)

      await post(url, calling('memory_search'))

      expect(calls).toEqual([{ token: TOKEN, name: 'memory_search', input: {} }])
    })

    it('marks as an error the result of a call the host refused or failed', async () => {
      const { url } = await serve(hosting(() => ({ ok: false, text: 'A view needs a title.' })).host)

      const response = await post(url, calling('ui_render', {}))

      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: shown('A view needs a title.', true) })
    })

    it('answers a call to a tool the session does not have as a failed call, without troubling the host', async () => {
      const { host, calls } = hosting()
      const { url } = await serve(host)

      const response = await post(url, calling('thread_open', { topic: 'x' }))

      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: shown('There is no tool named "thread_open".', true) })
      expect(calls).toEqual([])
    })

    it('gives a tool’s pictures after its text, as MCP image content', async () => {
      const { host } = hosting(() => ({ ok: true, text: 'The page is in the picture.', images: [{ data: 'AAAA', mime: 'image/jpeg' }] }))
      const { url } = await serve(host)

      expect(await (await post(url, calling('memory_search'))).json()).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            { type: 'text', text: 'The page is in the picture.' },
            { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }
          ],
          isError: false
        }
      })
    })

    it('refuses a call that names no tool', async () => {
      const { url } = await serve(hosting().host)

      expect(await (await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { arguments: {} } })).json()).toEqual(failed(1, -32602))
      expect(await (await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/call' })).json()).toEqual(failed(2, -32602))
    })

    it('does not hold up other requests while a tool waits, and delivers its answer when it comes', async () => {
      let answerNow: (result: ToolResult) => void = () => undefined
      const { host, calls } = hosting((name) => (name === 'ui_render' ? new Promise((resolve) => (answerNow = resolve)) : { ok: true, text: 'found' }))
      const { url } = await serve(host)

      const waiting = post(url, calling('ui_render', { title: 'A question to the user' }))
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      expect(await ask(url, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
      expect(await (await post(url, calling('memory_search'))).json()).toEqual({ jsonrpc: '2.0', id: 1, result: shown('found') })
      await new Promise((resolve) => setTimeout(resolve, 300))

      answerNow({ ok: true, text: 'The user said yes.' })
      expect(await (await waiting).json()).toEqual({ jsonrpc: '2.0', id: 1, result: shown('The user said yes.') })
    })
  })

  describe('a host that breaks its contract', () => {
    it('answers a call that threw as a failed call, tells the log why, and goes on', async () => {
      const errors: string[] = []
      const { host } = hosting((name) => {
        if (name === 'ui_render') throw new Error('a secret detail')
        return Promise.reject(new Error('another detail'))
      })
      const { url } = await serve(host, { log: { error: (message) => errors.push(message) } })

      const thrown = await (await post(url, calling('ui_render', {}))).json()
      const rejected = await (await post(url, calling('memory_search', {}))).json()

      expect(thrown).toEqual({ jsonrpc: '2.0', id: 1, result: shown('The tool "ui_render" failed unexpectedly.', true) })
      expect(rejected).toEqual({ jsonrpc: '2.0', id: 1, result: shown('The tool "memory_search" failed unexpectedly.', true) })
      expect(errors).toEqual([expect.stringContaining('a secret detail'), expect.stringContaining('another detail')])
      expect(await ask(url, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })

    it('answers 500 when the host cannot even say who is calling, and goes on', async () => {
      const errors: string[] = []
      const host: ToolHost = {
        list: (token) => {
          if (token === 'breaks') throw new Error('the sessions are gone')
          return TOOLS
        },
        call: async () => ({ ok: true, text: 'done' })
      }
      const { url } = await serve(host, { log: { error: (message) => errors.push(message) } })

      const broken = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: 'breaks' })

      expect(broken.status).toBe(500)
      expect(await broken.text()).not.toContain('the sessions are gone')
      expect(errors).toEqual([expect.stringContaining('the sessions are gone')])
      expect(await ask(url, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })
  })

  describe('who may call', () => {
    it('answers 401 to a token the host does not know, whatever is asked', async () => {
      const { host, calls } = hosting()
      const { url } = await serve(host)

      for (const message of [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 1, method: 'initialize' }, calling('ui_render', {})]) {
        const response = await post(url, message, { token: 'token-of-nobody' })
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toBe('Bearer')
      }
      expect(calls).toEqual([])
    })

    it('answers 401 to a request with no token, or with something else than a bearer token', async () => {
      const { url } = await serve(hosting().host)
      const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }

      expect((await post(url, ping, { token: null })).status).toBe(401)
      expect((await post(url, ping, { token: null, headers: { authorization: TOKEN } })).status).toBe(401)
      expect((await post(url, ping, { token: null, headers: { authorization: `Basic ${TOKEN}` } })).status).toBe(401)
      expect((await post(url, ping, { token: null, headers: { authorization: `bearer ${TOKEN}` } })).status).toBe(200)
    })

    it('refuses a request that names another host than its loopback address', async () => {
      const { url } = await serve(hosting().host)
      const { host: authority, port } = new URL(url)

      expect(await pingNaming(url, authority)).toBe(200)
      for (const host of ['attacker.example', `attacker.example:${port}`, `localhost:${port}`, '127.0.0.1', `127.0.0.1:${Number(port) + 1}`]) {
        expect(await pingNaming(url, host), host).toBe(403)
      }
    })

    it('refuses a request that says which web page it comes from', async () => {
      const { host, calls } = hosting()
      const { url } = await serve(host)

      for (const origin of ['https://attacker.example', new URL(url).origin, 'null']) {
        expect((await post(url, calling('ui_render', {}), { headers: { origin } })).status, origin).toBe(403)
      }
      expect(calls).toEqual([])
    })

    it('serves POST on its one path and nothing else', async () => {
      const { url } = await serve(hosting().host)
      const headers = { authorization: `Bearer ${TOKEN}` }

      for (const method of ['GET', 'DELETE', 'PUT']) {
        const response = await fetch(url, { method, headers })
        expect(response.status, method).toBe(405)
        expect(response.headers.get('allow')).toBe('POST')
      }
      for (const path of ['/', '/mcp/', '/mcp?x=1', '/.well-known/oauth-protected-resource']) {
        expect((await post(new URL(path, url).href, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, path).toBe(404)
      }
    })
  })

  describe('what it reads', () => {
    const padded = (length: number) => {
      const empty = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { padding: '' } })
      return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { padding: 'x'.repeat(length - empty.length) } })
    }

    it('reads a request of the largest size allowed, and refuses one byte more', async () => {
      const { url } = await serve(hosting().host)

      const allowed = await post(url, padded(MAX_BODY_BYTES))
      const tooLarge = await post(url, padded(MAX_BODY_BYTES + 1))

      expect(allowed.status).toBe(200)
      expect(tooLarge.status).toBe(413)
    })

    it('refuses a request that grows too large without having said how large it would be', async () => {
      const { url } = await serve(hosting().host)
      const piece = new TextEncoder().encode('x'.repeat(64 * 1024))
      let sent = 0
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > 2 * MAX_BODY_BYTES) return controller.close()
          sent += piece.length
          controller.enqueue(piece)
        }
      })

      const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: endless, duplex: 'half' } as RequestInit)

      expect(response.status).toBe(413)
      expect(await (await post(url, { jsonrpc: '2.0', id: 1, method: 'ping' })).json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })

    it('answers what is not JSON with a parse error', async () => {
      const { url } = await serve(hosting().host)

      for (const body of ['{"jsonrpc":', '', 'ping']) {
        const response = await post(url, body)
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual(failed(null, -32700))
      }
    })

    it('answers JSON that is not a request with an invalid-request error', async () => {
      const { url } = await serve(hosting().host)

      for (const message of [
        'a text',
        7,
        null,
        {},
        { id: 1, method: 'ping' },
        { jsonrpc: '1.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 1 },
        { jsonrpc: '2.0', id: 1, method: 7 },
        { jsonrpc: '2.0', id: null, method: 'ping' },
        { jsonrpc: '2.0', id: { n: 1 }, method: 'ping' },
        []
      ]) {
        const response = await post(url, JSON.stringify(message))
        expect(response.status, JSON.stringify(message)).toBe(400)
        expect(await response.json()).toEqual(failed(null, -32600))
      }
    })

    it('answers a method it does not have with method-not-found, under the id of the request', async () => {
      const { url } = await serve(hosting().host)

      expect(await ask(url, 'resources/list')).toEqual(failed(1, -32601))
      expect(await (await post(url, { jsonrpc: '2.0', id: 'text-id', method: 'server/discover' })).json()).toEqual(failed('text-id', -32601))
    })

    it('accepts without an answer what expects none: a notification, or an answer to a request it never made', async () => {
      const { host, calls } = hosting()
      const { url } = await serve(host)

      for (const message of [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
        { jsonrpc: '2.0', method: 'tools/call', params: { name: 'ui_render' } },
        { jsonrpc: '2.0', id: 1, result: {} },
        { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'No.' } }
      ]) {
        const response = await post(url, message)
        expect(response.status, JSON.stringify(message)).toBe(202)
        expect(await response.text()).toBe('')
      }
      expect(calls).toEqual([])
    })

    it('answers a batch with the answers its requests expect, in the order given', async () => {
      const { url } = await serve(hosting((_name, input) => ({ ok: true, text: `shown ${(input as { title: string }).title}` })).host)

      const response = await post(url, [
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'ui_render', arguments: { title: 'one' } } },
        { jsonrpc: '2.0', id: 'c', method: 'resources/list' },
        'not a message',
        { jsonrpc: '2.0', id: 'd', method: 'tools/list' }
      ])

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([
        { jsonrpc: '2.0', id: 'a', result: {} },
        { jsonrpc: '2.0', id: 'b', result: shown('shown one') },
        failed('c', -32601),
        failed(null, -32600),
        { jsonrpc: '2.0', id: 'd', result: { tools: TOOLS } }
      ])
    })

    it('runs the calls of a batch one after the other', async () => {
      const steps: string[] = []
      const { host } = hosting(async (_name, input) => {
        const { title, takes } = input as { title: string; takes: number }
        steps.push(`${title} starts`)
        await new Promise((resolve) => setTimeout(resolve, takes))
        steps.push(`${title} ends`)
        return { ok: true, text: title }
      })
      const { url } = await serve(host)

      await post(url, [
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ui_render', arguments: { title: 'slow', takes: 60 } } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ui_render', arguments: { title: 'fast', takes: 0 } } }
      ])

      expect(steps).toEqual(['slow starts', 'slow ends', 'fast starts', 'fast ends'])
    })

    it('carries out no more of a batch once its sender hung up', async () => {
      let answerNow: (result: ToolResult) => void = () => undefined
      const { host, calls } = hosting(() => new Promise((resolve) => (answerNow = resolve)))
      const { url } = await serve(host)
      const givingUp = new AbortController()
      const sent = fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify([calling('ui_render', { title: 'first' }), calling('ui_render', { title: 'second' })]),
        signal: givingUp.signal
      }).catch(() => 'given up')
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      givingUp.abort()
      expect(await sent).toBe('given up')
      await new Promise((resolve) => setTimeout(resolve, 50))
      answerNow({ ok: true, text: 'first' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(calls).toEqual([{ token: TOKEN, name: 'ui_render', input: { title: 'first' } }])
    })

    it('is not troubled by a client that leaves in the middle of its request', async () => {
      const errors: string[] = []
      const { host, calls } = hosting()
      const { url } = await serve(host, { log: { error: (message) => errors.push(message) } })
      const { hostname, port, host: authority } = new URL(url)

      const socket = connect(Number(port), hostname)
      await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject))
      socket.write(`POST /mcp HTTP/1.1\r\nHost: ${authority}\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Length: 500\r\n\r\n{"jsonrpc":"2.0",`)
      await new Promise((resolve) => setTimeout(resolve, 50))
      socket.destroy()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(errors).toEqual([])
      expect(calls).toEqual([])
      expect(await ask(url, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    })

    it('accepts without an answer a batch that expects none, and refuses an empty one', async () => {
      const { url } = await serve(hosting().host)

      const silent = await post(url, [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', method: 'notifications/cancelled' }
      ])
      const empty = await post(url, [])

      expect(silent.status).toBe(202)
      expect(empty.status).toBe(400)
      expect(await empty.json()).toEqual(failed(null, -32600))
    })
  })

  describe('closing', () => {
    it('cuts the calls under way, frees the port, and ignores an answer that comes afterwards', async () => {
      let answerNow: (result: ToolResult) => void = () => undefined
      const { host, calls } = hosting(() => new Promise((resolve) => (answerNow = resolve)))
      const server = await serveTools(host)
      const cut = post(server.url, calling('ui_render', {})).then(
        () => 'answered',
        () => 'cut'
      )
      await vi.waitFor(() => expect(calls).toHaveLength(1))

      await server.close()

      expect(await cut).toBe('cut')
      await expect(post(server.url, { jsonrpc: '2.0', id: 1, method: 'ping' })).rejects.toThrow()
      const again = await serve(host, { port: Number(new URL(server.url).port) })
      expect(again.url).toBe(server.url)

      answerNow({ ok: true, text: 'too late' })
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    it('can be closed twice', async () => {
      const server = await serveTools(hosting().host)
      await server.close()
      await server.close()
    })
  })
})
