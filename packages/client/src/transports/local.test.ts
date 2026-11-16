import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION, createLineDecoder, encodeLine } from '@repo/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionRefused, connect, type Identity } from '../connection.ts'
import { openLocal } from './local.ts'

const identity: Identity = { client: { kind: 'desktop', version: '0.1.0', device: 'device-1' }, capabilities: ['display'], credential: 'token' }

/** A stand-in for a core: answers each line it receives with what `answer` returns, over a real local socket. */
async function standIn(answer: (message: unknown, socket: Socket) => unknown) {
  const folder = process.platform === 'win32' ? undefined : mkdtempSync(join(tmpdir(), 'client-test-'))
  const endpoint = folder ? join(folder, 'core.sock') : `\\\\.\\pipe\\client-test-${process.pid}-${Date.now()}`
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()
    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        const reply = answer(line.ok ? line.message : undefined, socket)
        if (reply !== undefined) socket.write(encodeLine(reply))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(endpoint, resolve))
  return {
    endpoint,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
      if (folder) rmSync(folder, { recursive: true, force: true })
    }
  }
}

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  await stop?.()
  stop = undefined
})

describe('openLocal', () => {
  it('carries the handshake to a core on this machine and back', async () => {
    const received: unknown[] = []
    const core = await standIn((message) => {
      received.push(message)
      return { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '9.9.9' } }
    })
    stop = core.stop

    const connection = await connect(await openLocal(core.endpoint), identity)

    expect(connection.core).toEqual({ version: '9.9.9' })
    expect(received).toEqual([{ type: 'hello', protocol: PROTOCOL_VERSION, ...identity }])
    connection.close()
  })

  it('reports a refusal from the core', async () => {
    const core = await standIn(() => ({ type: 'refusal', reason: 'credential', protocol: PROTOCOL_VERSION }))
    stop = core.stop
    await expect(connect(await openLocal(core.endpoint), identity)).rejects.toBeInstanceOf(ConnectionRefused)
  })

  it('tells an admitted connection when the core goes away', async () => {
    let coreSide: Socket | undefined
    const core = await standIn((_message, socket) => {
      coreSide = socket
      return { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '9.9.9' } }
    })
    stop = core.stop

    const connection = await connect(await openLocal(core.endpoint), identity)
    const gone = new Promise<void>((resolve) => connection.onClose(() => resolve()))
    coreSide?.destroy()
    await gone
  })

  it('fails to open when nothing listens at the endpoint', async () => {
    const core = await standIn(() => undefined)
    await core.stop()
    await expect(openLocal(core.endpoint)).rejects.toThrow()
  })
})
