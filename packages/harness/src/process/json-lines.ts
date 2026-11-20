import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

/**
 * Both CLIs talk in JSON, one value per line, in each direction.
 *
 * Gives `onMessage` each value a stream carries. A line that is not JSON is dropped: a CLI may print a
 * warning among its messages, and one bad line must not end the conversation.
 */
export function readJsonLines(stream: Readable, onMessage: (message: unknown) => void): void {
  createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }
    onMessage(message)
  })
}

/** Writes one value as one line. Nothing happens when the stream is closed: the program it leads to has stopped. */
export function writeJsonLine(stream: Writable | null | undefined, message: unknown): void {
  if (stream?.writable) stream.write(`${JSON.stringify(message)}\n`)
}
