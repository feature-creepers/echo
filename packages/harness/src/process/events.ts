import type { Log, SessionEvent } from '@repo/core'

export interface SessionEvents {
  emit(event: SessionEvent): void
  /** Sets the one listener. It is given what happened before it was set, in order, then every event as it happens. */
  listen(listener: (event: SessionEvent) => void): void
  /** True once `failed` was emitted. Nothing is emitted after it. */
  readonly ended: boolean
  /** Emit nothing from now on: the session was closed by its owner, who expects no more of it. */
  silence(): void
}

/**
 * The events of one session.
 *
 * A session starts working the moment it is opened, before its owner had a chance to listen, so what happens
 * until then is kept. A `failed` event is the last one: the session is closed by it.
 */
export function createSessionEvents(log: Log): SessionEvents {
  let listener: ((event: SessionEvent) => void) | undefined
  let kept: SessionEvent[] = []
  let ended = false
  let silent = false

  function deliver(event: SessionEvent): void {
    try {
      listener?.(event)
    } catch (error) {
      // A listener that throws must not stop the reading of what the CLI says next.
      log.error(`A session event of type "${event.type}" could not be handled: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    emit(event) {
      if (ended || silent) return
      if (event.type === 'failed') ended = true
      if (listener) deliver(event)
      else kept.push(event)
    },
    listen(next) {
      listener = next
      const waiting = kept
      kept = []
      for (const event of waiting) deliver(event)
    },
    get ended() {
      return ended
    },
    silence() {
      silent = true
      kept = []
    }
  }
}
