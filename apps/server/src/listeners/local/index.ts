import { createServer, type Socket } from 'node:net'
import type { Core } from '@repo/core'
import { createLineDecoder, encodeEvent, encodeLine, encodeResult } from '@repo/protocol'
import { createEndpoint } from './endpoint/index.ts'

/** How long a client has to say hello before it is disconnected. */
const HANDSHAKE_TIMEOUT_MS = 5000

export interface LocalListenerOptions {
  handshakeTimeoutMs?: number
}

export interface LocalListener {
  /** Where clients connect. */
  address: string
  /** Stop accepting clients and disconnect the ones connected. */
  close(): Promise<void>
}

/**
 * Listen for clients on this machine, over a Unix socket or a Windows named pipe.
 *
 * Each connection must start with a hello. The core decides; the listener sends its answer and
 * disconnects a client that was refused or that stayed silent. From then on the listener carries
 * the client's commands to the core, each result back to that client, and every event to all of them.
 */
export function listenLocal(core: Core, options: LocalListenerOptions = {}): Promise<LocalListener> {
  // A fresh endpoint, removed when the listener closes.
  const endpoint = createEndpoint()
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const sockets = new Set<Socket>()
  const admitted = new Set<Socket>()

  const stopEvents = core.onEvent((event) => {
    const line = encodeEvent(event)
    if (line === undefined) return
    for (const socket of admitted) socket.write(line)
  })

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()

    const silent = setTimeout(() => socket.destroy(), handshakeTimeoutMs)
    socket.on('close', () => {
      clearTimeout(silent)
      sockets.delete(socket)
      admitted.delete(socket)
    })
    // A client that vanishes mid-write is not an error of the core: the close event does the cleanup.
    socket.on('error', () => undefined)

    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        if (admitted.has(socket)) {
          // A line too long to be a message ends the connection: nothing after it can be trusted to be whole.
          if (!line.ok && line.error === 'too-long') return void socket.destroy()
          void core.execute(line.ok ? line.message : undefined).then((result) => {
            if (result && !socket.destroyed) socket.write(encodeResult(result))
          })
          continue
        }

        clearTimeout(silent)
        const admission = core.admit(line.ok ? line.message : undefined)
        if (!admission.admitted) {
          socket.end(encodeLine(admission.reply))
          return
        }
        socket.write(encodeLine(admission.reply))
        admitted.add(socket)
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      stopEvents()
      endpoint.remove()
      reject(error)
    })
    server.listen(endpoint.address, () => {
      resolve({
        address: endpoint.address,
        close: () =>
          new Promise<void>((done) => {
            stopEvents()
            for (const socket of sockets) socket.destroy()
            server.close(() => {
              endpoint.remove()
              done()
            })
          })
      })
    })
  })
}
