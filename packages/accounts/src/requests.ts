import type { z } from 'zod'

/**
 * Every request the adapter makes, the sign-in's included, goes through `guarded`: https only, to the hosts of the
 * provider it is for, and never following a redirect. Answers are read with zod, as every input of the product is.
 */

/** The fetch the adapter is given: the platform's, or a test's that answers from this computer. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** How long a provider has to answer a call. */
const CALL_TIMEOUT_MS = 30_000

/** A call a provider refused or failed: the status it answered, when it answered. The message never holds a token. */
export class CallFailed extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'CallFailed'
    this.status = status
  }
}

/** A fetch held to the hosts a provider may call, over https, refusing redirects. */
export function guarded(hosts: readonly string[], fetch: Fetch): Fetch {
  return async (url, init) => {
    const target = new URL(url)
    if (target.protocol !== 'https:' || !hosts.includes(target.hostname)) throw new CallFailed(`${target.host} is not a host this provider may call.`)
    const response = await fetch(target.href, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new CallFailed(`${target.host} answered with a redirect, which is not followed.`, response.status)
    }
    return response
  }
}

/**
 * The most bytes an answer is read to: one mail read whole, and anything else. Others decide how long a mail or an
 * event is, so an answer past its bound is refused rather than held in memory.
 */
export const MAIL_BYTES = 16 * 1024 * 1024
export const ANSWER_BYTES = 4 * 1024 * 1024
/** A refusal is read only for its message. */
const REFUSAL_BYTES = 64 * 1024

interface CallOptions {
  headers?: Readonly<Record<string, string>>
  /** The most bytes its answer may hold: `ANSWER_BYTES` when left out. */
  most?: number
}

/** A read with the account's access token: the answer, checked against its schema. Rejects with `CallFailed`. */
export type Call = <Answer>(url: string, schema: z.ZodType<Answer>, options?: CallOptions) => Promise<Answer>

/** Calls made with an access token, through a guarded fetch, stopped when `signal` aborts. */
export function caller(fetch: Fetch, token: string, signal: AbortSignal): Call {
  return async (url, schema, { headers = {}, most = ANSWER_BYTES } = {}) => {
    const { host } = new URL(url)
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
    })
    if (!response.ok) throw new CallFailed(await failure(response, host), response.status)
    const read = schema.safeParse(parsed(await bodyOf(response, host, most)))
    if (!read.success) throw new CallFailed(`${host} answered something this app does not read.`)
    return read.data
  }
}

/** An answer's text, read as it arrives and refused once past `most` bytes, the rest never read. */
async function bodyOf(response: Response, host: string, most: number): Promise<string> {
  const tooLong = () => new CallFailed(`${host} answered more than ${most / 1024 / 1024} MB, more than this app reads.`)
  if (Number(response.headers.get('content-length')) > most) {
    await response.body?.cancel()
    throw tooLong()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    size += value.byteLength
    if (size > most) {
      await reader.cancel()
      throw tooLong()
    }
    text += decoder.decode(value, { stream: true })
  }
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** What a provider said of a call it refused, in a few words: its own message when it gives one. */
async function failure(response: Response, host: string): Promise<string> {
  const body = parsed(await bodyOf(response, host, REFUSAL_BYTES).catch(() => '')) as { error?: { message?: unknown } | string } | undefined
  const said = typeof body?.error === 'object' && typeof body.error.message === 'string' ? body.error.message : undefined
  return `The provider answered ${response.status}${said ? `: ${said.slice(0, 200)}` : '.'}`
}
