/**
 * Framing for transports that carry a stream of bytes, such as a local pipe: one JSON message per line.
 * A transport that already delivers whole messages, such as a WebSocket, does not need it.
 */

/** The longest line a decoder accepts, in characters. A peer that sends more without a line break is cut off. */
export const MAX_LINE_LENGTH = 1024 * 1024

export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`
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
