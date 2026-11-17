import { connect, type Socket } from 'node:net'
import type { Core } from '@repo/core'
import { createLineDecoder, type Event, encodeLine, MAX_LINE_LENGTH, PROTOCOL_VERSION, type Settings } from '@repo/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { type LocalListener, listenLocal } from './index.ts'

const settings: Settings = {
  revision: 1,
  personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }], active: 'first', confirmed: true }
}
const changed: Event = { type: 'event', name: 'settings.changed', settings }

/** A core that welcomes everyone and answers every command with its name, to test the listener alone. */
function welcoming() {
  const listeners = new Set<(event: Event) => void>()
  const core: Core = {
    admit: () => ({
      admitted: true,
      hello: { type: 'hello', protocol: PROTOCOL_VERSION, client: { kind: 'desktop', version: '1', device: 'd' }, capabilities: [], credential: 'c' },
      reply: { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1' } }
    }),
    execute: async (message) => {
      if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'string') return undefined
      return { type: 'result', id: message.id, ok: true, output: message }
    },
    close: () => undefined,
    toolHost: { list: () => undefined, call: async () => ({ ok: false, text: '' }) },
    serveToolsAt: () => undefined,
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  return { core, emit, listening: () => listeners.size }
}

let listener: LocalListener | undefined
const sockets = new Set<Socket>()
afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await listener?.close()
  listener = undefined
})

/** Resolves with how long the core kept a connection that did `say`, once the core hangs up. */
function untilHungUp(address: string, say?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const socket = connect(address)
    sockets.add(socket)
    socket.once('connect', () => say !== undefined && socket.write(say))
    socket.on('error', reject)
    socket.on('data', () => undefined)
    socket.on('close', () => resolve(Date.now() - started))
  })
}

/** Connect, and optionally say hello. Gives the messages received, in order, as they arrive. */
async function open(address: string, { hello = true } = {}) {
  const socket = connect(address)
  sockets.add(socket)
  socket.setEncoding('utf8')
  const decoder = createLineDecoder()
  const received: unknown[] = []
  socket.on('data', (text: string) => {
    for (const line of decoder.push(text)) received.push(line.ok ? line.message : line)
  })
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject))
  if (hello) socket.write(encodeLine({ type: 'hello' }))
  return { socket, received, closed, say: (message: unknown) => socket.write(encodeLine(message)) }
}

const soon = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('listenLocal', () => {
  it('disconnects a client that stays silent', async () => {
    listener = await listenLocal(welcoming().core, { handshakeTimeoutMs: 50 })
    const kept = await untilHungUp(listener.address)
    expect(kept).toBeGreaterThanOrEqual(40)
    expect(kept).toBeLessThan(2000)
  })

  it('keeps a client that said hello past the time allowed for the handshake', async () => {
    listener = await listenLocal(welcoming().core, { handshakeTimeoutMs: 50 })
    let hungUp = false
    void untilHungUp(listener.address, encodeLine({ type: 'hello' })).then(() => (hungUp = true))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(hungUp).toBe(false)
  })

  it('disconnects its clients when it closes, and stops listening to the core', async () => {
    const { core, listening } = welcoming()
    listener = await listenLocal(core)
    const hungUp = untilHungUp(listener.address, encodeLine({ type: 'hello' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(listening()).toBe(1)
    await listener.close()
    listener = undefined
    await hungUp
    expect(listening()).toBe(0)
  })

  it('carries the commands of an admitted client to the core, and each result back to that client only', async () => {
    listener = await listenLocal(welcoming().core)
    const [one, other] = await Promise.all([open(listener.address), open(listener.address)])

    one.say({ id: 'c1', ask: 'first' })
    one.say({ id: 'c2', ask: 'second' })
    await soon()

    expect(one.received).toEqual([
      { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1' } },
      { type: 'result', id: 'c1', ok: true, output: { id: 'c1', ask: 'first' } },
      { type: 'result', id: 'c2', ok: true, output: { id: 'c2', ask: 'second' } }
    ])
    expect(other.received).toHaveLength(1)
  })

  it('sends nothing back for what the core does not answer, and keeps the client', async () => {
    listener = await listenLocal(welcoming().core)
    const client = await open(listener.address)

    client.socket.write('this is not JSON\n')
    client.say({ no: 'identifier' })
    client.say({ id: 'c1' })
    await soon()

    expect(client.received.slice(1)).toEqual([{ type: 'result', id: 'c1', ok: true, output: { id: 'c1' } }])
  })

  it('sends every event to every admitted client, and to no other', async () => {
    const { core, emit } = welcoming()
    listener = await listenLocal(core)
    const [one, other, stranger] = await Promise.all([open(listener.address), open(listener.address), open(listener.address, { hello: false })])
    await soon()

    emit(changed)
    await soon()

    expect(one.received.at(-1)).toEqual(changed)
    expect(other.received.at(-1)).toEqual(changed)
    expect(stranger.received).toEqual([])
  })

  it('stops sending events to a client that left', async () => {
    const { core, emit } = welcoming()
    listener = await listenLocal(core)
    const [stays, leaves] = await Promise.all([open(listener.address), open(listener.address)])
    await soon()
    leaves.socket.destroy()
    await leaves.closed
    await soon()

    emit(changed)
    await soon()

    expect(stays.received.at(-1)).toEqual(changed)
  })

  it('hangs up on an admitted client that sends a line too long to be a message', async () => {
    listener = await listenLocal(welcoming().core)
    const client = await open(listener.address)
    await soon()

    client.socket.write('x'.repeat(MAX_LINE_LENGTH + 1))

    await client.closed
  })
})
