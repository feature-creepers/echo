import type { Result } from './envelope.ts'

/**
 * Framing for transports that carry a stream of bytes, such as a local pipe: one JSON message per line.
 * A transport that already delivers whole messages, such as a WebSocket, does not need it.
 */

/** The longest line a decoder accepts, in characters. A peer that sends more without a line break is cut off. */
export const MAX_LINE_LENGTH = 1024 * 1024

export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Encode a result so that the peer can always read it. A result too long for one line would make the client cut the
 * link, for good, over one answer: it is sent instead as the command having failed, and the link stays.
 */
export function encodeResult(result: Result, maxLineLength = MAX_LINE_LENGTH): string {
  const line = encodeLine(result)
  if (line.length - 1 <= maxLineLength) return line
  return encodeLine({
    type: 'result',
    id: result.id,
    ok: false,
    error: { code: 'failed', message: `The answer was too long to send (${line.length} characters).` }
  } satisfies Result)
}

/** Encode an event, or nothing when it is too long for one line: one event missed is better than the link cut. */
export function encodeEvent(event: unknown, maxLineLength = MAX_LINE_LENGTH): string | undefined {
  const line = encodeLine(event)
  return line.length - 1 <= maxLineLength ? line : undefined
}

export type DecodedLine = { ok: true; message: unknown } | { ok: false; error: 'not-json' | 'too-long' }

export interface LineDecoder {
  /** Feed what arrived. Returns the messages it completes, in order. After a 'too-long' error the decoder accepts nothing more. */
  push(chunk: string): DecodedLine[]
}

export function createLineDecoder(maxLineLength = MAX_LINE_LENGTH): LineDecoder {
  let pending = ''
  let broken = false
  return {
    push(chunk) {
      if (broken) return []
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      const out: DecodedLine[] = []
      for (const line of lines) {
        if (line.trim() === '') continue
        if (line.length > maxLineLength) {
          broken = true
          out.push({ ok: false, error: 'too-long' })
          return out
        }
        out.push(parse(line))
      }
      if (pending.length > maxLineLength) {
        broken = true
        pending = ''
        out.push({ ok: false, error: 'too-long' })
      }
      return out
    }
  }
}

function parse(line: string): DecodedLine {
  try {
    return { ok: true, message: JSON.parse(line) }
  } catch {
    return { ok: false, error: 'not-json' }
  }
}
