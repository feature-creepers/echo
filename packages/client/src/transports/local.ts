import { connect as openSocket } from 'node:net'
import { createLineDecoder, encodeLine } from '@repo/protocol'
import type { Transport } from '../transport.ts'

/**
 * Open a link to a core listening on this machine.
 *
 * `endpoint` is what the core announced when it started: a Unix socket path, or a named pipe on Windows.
 * Messages that arrive before a listener is set are kept and delivered when it is.
 */
export function openLocal(endpoint: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const socket = openSocket(endpoint)
    socket.setEncoding('utf8')
    const decoder = createLineDecoder()

    let onMessage: ((message: unknown) => void) | undefined
    let onClose: ((cause?: Error) => void) | undefined
    const waiting: unknown[] = []
    let closed: { cause?: Error } | undefined
    let failure: Error | undefined

    const transport: Transport = {
      send: (message) => void socket.write(encodeLine(message)),
      onMessage: (listener) => {
        onMessage = listener
        for (const message of waiting.splice(0)) listener(message)
      },
      onClose: (listener) => {
        onClose = listener
        if (closed) listener(closed.cause)
      },
      close: () => void socket.destroy()
    }

    socket.once('connect', () => resolve(transport))
    socket.on('error', (error) => {
      failure = error
      // Has no effect once the link was opened: the close listener then reports the failure.
      reject(error)
    })
    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        if (!line.ok) {
          failure = new Error(`The core sent a line the client cannot read (${line.error}).`)
          socket.destroy()
          return
        }
        if (onMessage) onMessage(line.message)
        else waiting.push(line.message)
      }
    })
    socket.on('close', () => {
      closed = failure ? { cause: failure } : {}
      onClose?.(closed.cause)
    })
  })
}
