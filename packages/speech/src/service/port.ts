/**
 * What the speech service talks through: anything messages can be posted to and received from. A worker
 * thread and its parent port, the two ends of a message channel, an Electron utility process and the
 * parent port inside it all fit, as they are.
 */
export interface DuplexPort {
  postMessage(message: unknown, transfer?: never[]): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  /** Some ports deliver nothing until they are started. */
  start?(): void
}

/** A port seen the same way whatever kind it is. */
export interface Channel {
  /**
   * Send a message. The `buffers` are the memory of sounds inside it that the sender gives away: they are
   * moved to the other side when the port can do that, and copied like the rest of the message when it cannot.
   */
  post(message: unknown, buffers?: ArrayBuffer[]): void
  /** Whether buffers are moved. False once the port has refused to. */
  readonly moves: boolean
  /** Sets the one listener given each message received. */
  receive(listener: (message: unknown) => void): void
  /** Sets the one listener told that the other side is gone: its process or thread ended, or the port was closed. */
  gone(listener: () => void): void
  /** Stop passing messages on. The port itself is left as it is: whoever made it closes it. */
  close(): void
}

/** The events by which the kinds of port say that the other side is gone. One that a port does not have never fires. */
const GONE_EVENTS = ['close', 'exit'] as const

export function openChannel(port: DuplexPort): Channel {
  let moves = true
  let open = true
  let onMessage: ((message: unknown) => void) | undefined
  let onGone: (() => void) | undefined

  port.on('message', (payload) => {
    if (open) onMessage?.(unwrapped(payload))
  })
  for (const event of GONE_EVENTS) {
    ;(port as unknown as { on(event: string, listener: () => void): unknown }).on(event, () => {
      if (open) onGone?.()
    })
  }
  port.start?.()

  return {
    post(message, buffers = []) {
      if (moves && buffers.length > 0) {
        try {
          port.postMessage(message, buffers as never[])
          return
        } catch (error) {
          // Electron's ports only move other ports, and say so with a TypeError before sending anything.
          if (!(error instanceof TypeError)) throw error
          moves = false
        }
      }
      port.postMessage(message)
    },
    get moves() {
      return moves
    },
    receive: (listener) => {
      onMessage = listener
    },
    gone: (listener) => {
      onGone = listener
    },
    close: () => {
      open = false
    }
  }
}

/**
 * Electron's ports hand the listener an event that holds the message in `data`, where Node's hand it the
 * message itself. No message of the speech service has a `data` field, so the two cannot be confused.
 */
function unwrapped(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : payload
}

/**
 * The memory of every sound in a value, to give away with it. A sound that is a window on a larger piece
 * of memory is left out: moving that memory would take more than the sound, so it is copied instead.
 */
export function buffersOf(value: unknown): ArrayBuffer[] {
  if (value instanceof Float32Array) {
    const { buffer } = value
    return buffer instanceof ArrayBuffer && value.byteLength === buffer.byteLength ? [buffer] : []
  }
  if (Array.isArray(value)) return value.flatMap(buffersOf)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(buffersOf)
  return []
}
