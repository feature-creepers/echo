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

/** A read with the account's access token: the answer, checked against its schema. Rejects with `CallFailed`. */
export type Call = <Answer>(url: string, schema: z.ZodType<Answer>, headers?: Readonly<Record<string, string>>) => Promise<Answer>

/** Calls made with an access token, through a guarded fetch, stopped when `signal` aborts. */
export function caller(fetch: Fetch, token: string, signal: AbortSignal): Call {
  return async (url, schema, headers = {}) => {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
    })
    if (!response.ok) throw new CallFailed(await failure(response), response.status)
    const read = schema.safeParse(await response.json().catch(() => undefined))
    if (!read.success) throw new CallFailed(`${new URL(url).host} answered something this app does not read.`)
    return read.data
  }
}

/** What a provider said of a call it refused, in a few words: its own message when it gives one. */
async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { error?: { message?: unknown } | string } | undefined
  const said = typeof body?.error === 'object' && typeof body.error.message === 'string' ? body.error.message : undefined
  return `The provider answered ${response.status}${said ? `: ${said.slice(0, 200)}` : '.'}`
}
