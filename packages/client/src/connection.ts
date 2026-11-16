import { PROTOCOL_VERSION, handshakeReplySchema, type Capability, type Hello, type RefusalReason } from '@repo/protocol'
import type { Transport } from './transport.ts'

/** Who is connecting, and what proves it may. */
export interface Identity {
  client: Hello['client']
  capabilities: Capability[]
  credential: string
}

/** An open, admitted link to a core. */
export interface Connection {
  core: { version: string }
  /** Sets the one listener called once when the connection is gone, with the cause when it failed. */
  onClose(listener: (cause?: Error) => void): void
  close(): void
}

/** The core answered the hello with a refusal. */
export class ConnectionRefused extends Error {
  readonly reason: RefusalReason
  /** The protocol version of the core, to tell which side needs updating when the reason is 'protocol'. */
  readonly coreProtocol: number

  constructor(reason: RefusalReason, coreProtocol: number) {
    super(`The core refused the connection: ${reason}`)
    this.name = 'ConnectionRefused'
    this.reason = reason
    this.coreProtocol = coreProtocol
  }
}

/** The link ended, or the core sent something else than a handshake reply, before the client was admitted. */
export class HandshakeFailed extends Error {
  constructor(what: string, cause?: Error) {
    super(`The handshake with the core failed: ${what}`, cause ? { cause } : undefined)
    this.name = 'HandshakeFailed'
  }
}

/**
 * Say hello over a transport and wait for the core's answer.
 *
 * Resolves once the core has welcomed the client. Rejects with `ConnectionRefused` when it says no, and
 * with `HandshakeFailed` when the link ends or misbehaves first. In both cases the transport is closed.
 */
export function connect(transport: Transport, identity: Identity): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let closeListener: ((cause?: Error) => void) | undefined
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      transport.close()
      reject(error)
    }

    transport.onClose((cause) => {
      if (settled) closeListener?.(cause)
      else fail(new HandshakeFailed('the link closed before the core answered', cause))
    })

    transport.onMessage((message) => {
      // Nothing is defined after the handshake yet: later messages are for the layers built on top.
      if (settled) return
      const reply = handshakeReplySchema.safeParse(message)
      if (!reply.success) return fail(new HandshakeFailed('the core answered with something else than a welcome or a refusal'))
      if (reply.data.type === 'refusal') return fail(new ConnectionRefused(reply.data.reason, reply.data.protocol))

      settled = true
      resolve({
        core: reply.data.core,
        onClose: (listener) => {
          closeListener = listener
        },
        close: () => transport.close()
      })
    })

    const hello: Hello = { type: 'hello', protocol: PROTOCOL_VERSION, ...identity }
    transport.send(hello)
  })
}
