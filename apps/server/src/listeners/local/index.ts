import { createServer, type Socket } from 'node:net'
import { createLineDecoder, encodeLine } from '@repo/protocol'
import type { Core } from '../../compose.ts'
import { createEndpoint, type Endpoint } from './endpoint/index.ts'

/** How long a client has to say hello before it is disconnected. */
export const HANDSHAKE_TIMEOUT_MS = 5000

export interface LocalListenerOptions {
  /** Where to listen. Left out, a fresh endpoint is created, and removed when the listener closes. */
  address?: string | undefined
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
 * disconnects a client that was refused or that stayed silent.
 */
export function listenLocal(core: Core, options: LocalListenerOptions = {}): Promise<LocalListener> {
  const endpoint: Endpoint = options.address === undefined ? createEndpoint() : { address: options.address, remove: () => undefined }
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const sockets = new Set<Socket>()

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()
    let admitted = false

    const silent = setTimeout(() => socket.destroy(), handshakeTimeoutMs)
    socket.on('close', () => {
      clearTimeout(silent)
      sockets.delete(socket)
    })
    // A client that vanishes mid-write is not an error of the core: the close event does the cleanup.
    socket.on('error', () => undefined)

    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        // No message is defined after the handshake yet. What an admitted client sends is ignored until there is.
        if (admitted) continue

        clearTimeout(silent)
        const admission = core.admit(line.ok ? line.message : undefined)
        if (!admission.admitted) {
          socket.end(encodeLine(admission.reply))
          return
        }
        admitted = true
        socket.write(encodeLine(admission.reply))
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      endpoint.remove()
      reject(error)
    })
    server.listen(endpoint.address, () => {
      resolve({
        address: endpoint.address,
        close: () =>
          new Promise<void>((done) => {
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
