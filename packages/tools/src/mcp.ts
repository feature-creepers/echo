import type { Log, ToolHost, ToolResult } from '@repo/core'

/**
 * What a tool server says: JSON-RPC 2.0 messages carrying the part of the Model Context Protocol (MCP)
 * that serves tools. Nothing here knows how a message arrived, or what a tool does.
 */

/**
 * The revisions of MCP this server speaks, most recent first. It answers the same in all of them: tools with
 * a name, a description and an input schema, and results made of one text.
 */
export const PROTOCOL_VERSIONS: readonly [string, ...string[]] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/** The errors of JSON-RPC 2.0 that this server gives. */
export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

type Outcome = { result: unknown } | { error: { code: number; message: string } }

/** The answer to one message. `id` is the one of the request, or null when the message was too wrong to have one. */
export type Reply = { jsonrpc: '2.0'; id: string | number | null } & Outcome

/** What answering a message takes. */
export interface Caller {
  host: ToolHost
  /** The bearer token the message came with: it tells the host which session is calling. */
  token: string
  /** The version this server gives when a harness asks what it is talking to. */
  version: string
  log: Log | undefined
}

export function failure(id: string | number | null, code: number, message: string): Reply {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Answer one message. Gives nothing when the message expects no answer. */
export async function answer(message: unknown, caller: Caller): Promise<Reply | undefined> {
  if (!isObject(message) || message.jsonrpc !== '2.0') return failure(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 message.')
  const { id, method, params } = message

  if (typeof method !== 'string') {
    // An answer to a request. This server makes none, so there is nothing to match it with.
    if ('result' in message || 'error' in message) return undefined
    return failure(null, INVALID_REQUEST, 'A message needs a method.')
  }
  // A notification: the harness is ready, or gave up on a call. None of them changes what the server does.
  if (id === undefined) return undefined
  if (typeof id !== 'string' && typeof id !== 'number') return failure(null, INVALID_REQUEST, 'The id of a request is a string or a number.')

  return { jsonrpc: '2.0', id, ...(await respond(method, params, caller)) }
}

async function respond(method: string, params: unknown, caller: Caller): Promise<Outcome> {
  switch (method) {
    case 'initialize': {
      // A harness asks for the revision it prefers. It gets that one when we speak it, and our most recent otherwise:
      // it then decides whether it can go on.
      const asked = isObject(params) ? params.protocolVersion : undefined
      const protocolVersion = PROTOCOL_VERSIONS.find((version) => version === asked) ?? PROTOCOL_VERSIONS[0]
      return { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'tools', version: caller.version } } }
    }
    case 'ping':
      return { result: {} }
    case 'tools/list': {
      // Only what a model needs is passed on, whatever else the host keeps on a tool.
      const tools = caller.host.list(caller.token) ?? []
      return { result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } }
    }
    case 'tools/call': {
      const name = isObject(params) ? params.name : undefined
      if (!isObject(params) || typeof name !== 'string') return { error: { code: INVALID_PARAMS, message: 'A call needs the name of a tool.' } }
      return { result: shown(await call(name, params.arguments ?? {}, caller)) }
    }
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } }
  }
}

async function call(name: string, input: unknown, caller: Caller): Promise<ToolResult> {
  // A name the session was not given is answered as a failed call, which a model reads and corrects,
  // and never reaches the host.
  const offered = caller.host.list(caller.token)?.some((tool) => tool.name === name)
  if (!offered) return { ok: false, text: `There is no tool named "${name}".` }

  try {
    return await caller.host.call(caller.token, name, input)
  } catch (error) {
    // The host never rejects, by contract. If it does anyway, the model learns that the call failed, and the
    // person running the core learns why.
    caller.log?.error(`The tool "${name}" threw instead of giving a result: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    return { ok: false, text: `The tool "${name}" failed unexpectedly.` }
  }
}

/** A result as MCP carries it. */
function shown(result: ToolResult): { content: [{ type: 'text'; text: string }]; isError: boolean } {
  return { content: [{ type: 'text', text: result.text }], isError: !result.ok }
}
