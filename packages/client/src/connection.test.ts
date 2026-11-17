import { PROTOCOL_VERSION } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { ConnectionRefused, HandshakeFailed, connect, type Identity } from './connection.ts'
import type { Transport } from './transport.ts'

const identity: Identity = { client: { kind: 'desktop', version: '0.1.0', device: 'device-1' }, capabilities: ['display'], credential: 'token' }

/** A transport whose other end is the test. */
function fakeTransport() {
  let onMessage: (message: unknown) => void = () => undefined
  let onClose: (cause?: Error) => void = () => undefined
  const sent: unknown[] = []
  let closed = false
  const transport: Transport = {
    send: (message) => sent.push(message),
    onMessage: (listener) => (onMessage = listener),
    onClose: (listener) => (onClose = listener),
    close: () => (closed = true)
  }
  return { transport, sent, isClosed: () => closed, receive: (message: unknown) => onMessage(message), drop: (cause?: Error) => onClose(cause) }
}

describe('connect', () => {
  it('says hello with the protocol version and the identity', () => {
    const link = fakeTransport()
    void connect(link.transport, identity).catch(() => undefined)
    expect(link.sent).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION, ...identity }])
  })

  it('resolves once the core welcomes the client', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1.2.3' } })
    expect((await connecting).core).toEqual({ version: '1.2.3' })
    expect(link.isClosed()).toBe(false)
  })

  it('rejects with the reason when the core refuses, and closes the link', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'refusal', reason: 'protocol', protocol: 7 })
    const error = await connecting.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConnectionRefused)
    expect(error).toMatchObject({ reason: 'protocol', coreProtocol: 7 })
    expect(link.isClosed()).toBe(true)
  })

  it('rejects when the link closes before the core answers', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    const cause = new Error('gone')
    link.drop(cause)
    const error = await connecting.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HandshakeFailed)
    expect((error as Error).cause).toBe(cause)
  })

  it('rejects when the core answers with something else', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'surprise' })
    await expect(connecting).rejects.toBeInstanceOf(HandshakeFailed)
    expect(link.isClosed()).toBe(true)
  })

  it('reports the end of an admitted connection to its listener', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1.2.3' } })
    const connection = await connecting
    const causes: (Error | undefined)[] = []
    connection.onClose((cause) => causes.push(cause))
    link.drop()
    expect(causes).toEqual([undefined])
  })
  it('carries what follows the welcome, both ways, without reading it', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1.2.3' } })
    const connection = await connecting
    const received: unknown[] = []
    connection.onMessage((message) => received.push(message))

    connection.send({ type: 'command', id: 'c1' })
    link.receive({ type: 'result', id: 'c1' })
    link.receive('anything at all')

    expect(link.sent.at(-1)).toEqual({ type: 'command', id: 'c1' })
    expect(received).toEqual([{ type: 'result', id: 'c1' }, 'anything at all'])
  })

  it('keeps what the core sends before anyone listens, and delivers it in order', async () => {
    const link = fakeTransport()
    const connecting = connect(link.transport, identity)
    link.receive({ type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1.2.3' } })
    link.receive({ n: 1 })
    link.receive({ n: 2 })
    const connection = await connecting
    const received: unknown[] = []

    connection.onMessage((message) => received.push(message))
    link.receive({ n: 3 })

    expect(received).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })
})
