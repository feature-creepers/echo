import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Log, ToolHost } from '@repo/core'
import { answer, type Caller, failure, INVALID_REQUEST, PARSE_ERROR, PROTOCOL_VERSIONS, type Reply } from './mcp.ts'

/** The largest request accepted. The input of a tool is far smaller: this bounds what a stranger can make the server hold. */
export const MAX_BODY_BYTES = 1024 * 1024

const LOOPBACK = '127.0.0.1'
const PATH = '/mcp'

export interface ToolServerOptions {
  /** The port to listen on. Left out, the system picks a free one. */
  port?: number
  /** The version of the core, told to a harness for its own diagnostics. */
  version?: string
  /** Told when the host fails in a way its contract rules out. */
  log?: Log
}

export interface ToolServer {
  /** The address a harness is given: `http://127.0.0.1:53124/mcp`. */
  url: string
  /** Stop listening and cut the calls under way. Resolves once the port is free. */
  close(): Promise<void>
}

/**
 * Serve the tools of `host` to harnesses on this machine: MCP over HTTP, on the loopback address.
 *
 * Each POST carries one message, or a batch, and gets its whole answer as JSON. There is no stream of server
 * events and no session to keep: the bearer token of a request says which session of the core is calling, and
 * the host decides what that session may see and do.
 *
 * Any program on the machine, and any web page open in a browser, can reach a loopback port. The token keeps
 * out the programs. Web pages are kept out before the token is even looked at: a request that names another
 * host than this one, or that says which page it comes from, is refused.
 */
export function serveTools(host: ToolHost, options: ToolServerOptions = {}): Promise<ToolServer> {
  const serving: Serving = { host, version: options.version ?? '0.0.0', log: options.log }
  const server = createServer()
  // A tool may wait for the user as long as it takes, so no silence on a connection ends it. Node's other
  // limits bear on how long a client takes to send a request, never on how long the answer takes: they stay.
  server.timeout = 0

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, LOOPBACK, () => {
      const url = new URL(`http://${LOOPBACK}:${(server.address() as AddressInfo).port}${PATH}`)

      server.on('request', (request, response) => {
        handle(request, response, url.host, serving).catch((error: unknown) => {
          // Whatever went wrong with one request, the server goes on answering the others.
          serving.log?.error(`The tool server failed on a request: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
          if (!response.headersSent) refuse(response, 500, 'The tool server failed on this request.')
        })
      })

      resolve({
        url: url.href,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            // A call under way would keep its connection, and the port, for as long as its tool waits.
            server.closeAllConnections()
          })
      })
    })
  })
}

/** What every caller of one server shares: all of a caller but its token. */
type Serving = Omit<Caller, 'token'>

async function handle(request: IncomingMessage, response: ServerResponse, authority: string, serving: Serving): Promise<void> {
  // A web page can point a name of its own at this machine and have a browser send requests here (DNS rebinding).
  // Such a request names that host. A harness names the address it was given.
  if (request.headers.host !== authority) return refuse(response, 403, 'This server answers to its loopback address only.')
  // Browsers say which page a request comes from. A harness is not a page, and no page has business here.
  if (request.headers.origin !== undefined) return refuse(response, 403, 'Requests from a web page are refused.')
  if (request.url !== PATH) return refuse(response, 404, 'Nothing is served here.')
  // A GET would open a stream of server events and a DELETE would end a session. This server has neither.
  if (request.method !== 'POST') return refuse(response, 405, 'Only POST is served.', { allow: 'POST' })

  const token = /^Bearer +(\S+)$/i.exec(request.headers.authorization ?? '')?.[1]
  if (token === undefined || serving.host.list(token) === undefined) {
    return refuse(response, 401, 'A bearer token of a session is required.', { 'www-authenticate': 'Bearer' })
  }

  // After the handshake, a harness names the revision agreed on with every request. A harness that also speaks a
  // later revision, one with no handshake, tries it first and names it here. This refusal is what sends it back
  // to the handshake, and only as long as it is not a JSON-RPC error, which such a harness would take for the
  // answer of a server that speaks the later revision.
  const revision = request.headers['mcp-protocol-version']
  if (revision !== undefined && !PROTOCOL_VERSIONS.includes(String(revision))) {
    return refuse(response, 400, `This server does not speak revision ${String(revision)} of the protocol. It speaks ${PROTOCOL_VERSIONS.join(', ')}.`)
  }

  let body: string | undefined
  try {
    body = await read(request)
  } catch {
    // The client left before the end of its request: there is no one to answer.
    return
  }
  if (body === undefined) return refuse(response, 413, `A request is at most ${MAX_BODY_BYTES} bytes.`)

  let message: unknown
  try {
    message = JSON.parse(body)
  } catch {
    return send(response, 400, failure(null, PARSE_ERROR, 'The request is not JSON.'))
  }

  const caller: Caller = { ...serving, token }
  if (!Array.isArray(message)) {
    const reply = await answer(message, caller)
    if (reply === undefined) return accept(response)
    // An error that names no request cannot be matched to one by the sender: the status has to say it.
    return send(response, reply.id === null ? 400 : 200, reply)
  }

  if (message.length === 0) return send(response, 400, failure(null, INVALID_REQUEST, 'A batch holds at least one message.'))
  // The messages of a batch are answered one after the other, so that what they do happens in the order given.
  const replies: Reply[] = []
  for (const one of message) {
    // The sender hung up, which is how a harness gives up on a request: the rest is not carried out.
    if (response.destroyed) return
    const reply = await answer(one, caller)
    if (reply !== undefined) replies.push(reply)
  }
  return replies.length > 0 ? send(response, 200, replies) : accept(response)
}

/** The body of a request as text, or nothing when it is larger than allowed. Rejects when the client leaves before the end. */
function read(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) return void chunks.push(chunk)
      // Too much: keep nothing and answer now. What the client still sends is read and dropped, so that it
      // gets to read the answer instead of finding the connection gone.
      chunks.length = 0
      resolve(undefined)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** Answer with JSON-RPC. */
function send(response: ServerResponse, status: number, body: Reply | Reply[]): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** Answer a message that expects no answer: it was received, and that is all. */
function accept(response: ServerResponse): void {
  response.writeHead(202).end()
}

/** Turn a request away before it is read as a message, with the reason in plain text for whoever debugs a harness. */
function refuse(response: ServerResponse, status: number, reason: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers }).end(reason)
}
