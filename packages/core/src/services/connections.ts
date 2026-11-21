import {
  type CommandError,
  type CommandRequest,
  type Connection,
  type Event,
  isWithin,
  MAX_CONNECTIONS,
  type ServiceSign,
  type ServicesView,
  serviceSignSchema
} from '@repo/protocol'
import { z } from 'zod'
import { stopping } from '../accounts/stopping.ts'
import type { Signal } from '../ports/harness.ts'
import type { Records } from '../ports/records.ts'
import type { ServiceAnswer, ServiceRefusal, ServiceRequest, Services } from '../ports/services.ts'

/**
 * The services the person connected for their widget apps (docs/SPEC.md, section 9.9). The list is kept as records
 * that say which API each one is and how it is signed in to, never a secret; whether this computer holds its sign-in is
 * asked of the adapter, which keeps them in its vault. A service is known by the start of its API's addresses, so two
 * widgets that call the same API share one connection.
 */

const CONNECTED = 'service.connected'
const DISCONNECTED = 'service.disconnected'

const connectedSchema = z.object({
  connection: z.string().min(1).max(64),
  api: z.string().min(1).max(500),
  name: z.string().min(1).max(60),
  sign: serviceSignSchema
})
const disconnectedSchema = z.object({ connection: z.string().min(1).max(64) })

/** A connection as the core keeps it: what a client sees, and how its API is signed in to. */
interface Kept {
  id: string
  api: string
  name: string
  sign: ServiceSign
  since: string
}

type Refused = { ok: false; error: CommandError }

interface ConnectionsOptions {
  /** The adapter. Left out, no service can be connected here. */
  port: Services | undefined
  records: Records
  newId: () => string
  now: () => Date
}

export interface Connections {
  read(): Promise<ServicesView>
  /** Connect a service, or connect it again: with a token, or by signing in in the browser. Resolves when it ends. */
  connect(asked: CommandRequest<'services.connect'>): Promise<{ ok: true; connection: Connection; view: ServicesView } | Refused>
  disconnect(connection: string): Promise<{ ok: true; view: ServicesView } | Refused>
  /** Give up the sign-in under way, if there is one: the core stops. */
  cancel(): void
  /** Call a connected service's API with its sign-in. */
  call(api: string, request: ServiceRequest, signal: Signal): Promise<({ ok: true } & ServiceAnswer) | ServiceRefusal>
  /** Whether a service's API is connected and its sign-in held here. */
  ready(api: string): Promise<boolean>
  onEvent(listener: (event: Event) => void): () => void
}

/** Two writings of an API's start, with and without its last slash, are one API. */
const sameApi = (one: string, other: string) => one.replace(/\/+$/, '') === other.replace(/\/+$/, '')

export function createConnections({ port, records, newId, now }: ConnectionsOptions): Connections {
  const listeners = new Set<(event: Event) => void>()
  const kept = new Map<string, Kept>()
  for (const record of records.read([CONNECTED, DISCONNECTED])) {
    if (record.type === DISCONNECTED) {
      const read = disconnectedSchema.safeParse(record.payload)
      if (read.success) kept.delete(read.data.connection)
      continue
    }
    const read = connectedSchema.safeParse(record.payload)
    if (read.success)
      kept.set(read.data.connection, { id: read.data.connection, api: read.data.api, name: read.data.name, sign: read.data.sign, since: record.at })
  }
  let signingIn: { api: string; since: string; stop: () => void } | undefined

  const byApi = (api: string) => [...kept.values()].find((one) => sameApi(one.api, api))

  const read = async (): Promise<ServicesView> => {
    const connections = await Promise.all(
      [...kept.values()].map(
        async (one): Promise<Connection> => ({
          id: one.id,
          api: one.api,
          name: one.name,
          kind: one.sign.kind,
          since: one.since,
          state: port && (await port.holds(one.id).catch(() => false)) ? 'ready' : 'sign-in-again'
        })
      )
    )
    return { connections, ...(signingIn ? { signingIn: { api: signingIn.api, since: signingIn.since } } : {}) }
  }
  const changed = async () => {
    const view = await read()
    for (const listener of listeners) listener({ type: 'event', name: 'services.changed', services: view })
    return view
  }
  const refuse = (message: string, code: CommandError['code'] = 'invalid-input'): Refused => ({ ok: false, error: { code, message } })

  return {
    read,

    async connect({ service, token, clientId }) {
      if (!port) return refuse('Services cannot be connected where this assistant runs.', 'failed')
      const before = byApi(service.api)
      if (!before && kept.size >= MAX_CONNECTIONS) return refuse(`At most ${MAX_CONNECTIONS} services are connected at once. Disconnect one first.`)
      const id = before?.id ?? newId()
      if (service.sign.kind === 'token') {
        if (!token) return refuse(`Paste the token ${service.name} gave you.`)
        await port.keep(id, token)
      } else {
        if (!clientId) return refuse(`Give the client identifier of the app you registered at ${service.name}.`)
        if (signingIn) return refuse('A sign-in is already under way: finish it in your browser first.', 'failed')
        const stop = stopping()
        signingIn = { api: service.api, since: now().toISOString(), stop: stop.stop }
        void changed()
        const signed = await port.signIn(id, service.sign, clientId, stop.signal).finally(() => {
          signingIn = undefined
        })
        if (!signed.ok) {
          void changed()
          return refuse(signed.reason, 'failed')
        }
      }
      const [record] = records.append([{ type: CONNECTED, payload: { connection: id, api: service.api, name: service.name, sign: service.sign } }])
      kept.set(id, { id, api: service.api, name: service.name, sign: service.sign, since: before?.since ?? record?.at ?? now().toISOString() })
      const view = await changed()
      const connection = view.connections.find((one) => one.id === id) as Connection
      return { ok: true, connection, view }
    },

    async disconnect(id) {
      if (!kept.has(id)) return refuse('That service is not connected.')
      await port?.forget(id)
      records.append([{ type: DISCONNECTED, payload: { connection: id } }])
      kept.delete(id)
      return { ok: true, view: await changed() }
    },

    cancel() {
      signingIn?.stop()
    },

    async call(api, request, signal) {
      const connection = byApi(api)
      if (!port || !connection) return { ok: false, reason: `${api} is not connected: connect it on the widget first.` }
      if (!isWithin(request.url, connection.api)) return { ok: false, reason: `${request.url} is not an address of ${connection.name}'s API.` }
      return port.call(connection.id, connection.api, connection.sign, request, signal)
    },

    async ready(api) {
      const connection = byApi(api)
      return Boolean(port && connection && (await port.holds(connection.id).catch(() => false)))
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
