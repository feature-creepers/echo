import type { Readable, Writable } from 'node:stream'

/**
 * Both CLIs talk in JSON, one value per line, in each direction.
 *
 * Gives `onMessage` each value a stream carries. A line that is not JSON is dropped: a CLI may print a
 * warning among its messages, and one bad line must not end the conversation.
 */
export function readJsonLines(stream: Readable, onMessage: (message: unknown) => void): void {
  let pending = ''
  // Decoding as text here keeps a character whole when its bytes arrive in two chunks.
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    pending += chunk
    let end = pending.indexOf('\n')
    while (end >= 0) {
      const line = pending.slice(0, end).trim()
      pending = pending.slice(end + 1)
      end = pending.indexOf('\n')
      if (line === '') continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      onMessage(message)
    }
  })
}

/** Writes one value as one line. Nothing happens when the stream is closed: the program it leads to has stopped. */
export function writeJsonLine(stream: Writable | null | undefined, message: unknown): void {
  if (stream?.writable) stream.write(`${JSON.stringify(message)}\n`)
}
