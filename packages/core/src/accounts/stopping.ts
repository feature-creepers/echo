import type { Signal } from '../ports/harness.ts'

/**
 * A signal the core raises itself, for work it gives an adapter and may no longer want: a sign-in the person
 * cancelled, a read past its time. The core runs anywhere, so it makes its own rather than reach for the platform's.
 */
export function stopping(): { signal: Signal; stop(): void } {
  let aborted = false
  const listeners = new Set<() => void>()
  return {
    signal: {
      get aborted() {
        return aborted
      },
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener)
    },
    stop() {
      if (aborted) return
      aborted = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    }
  }
}
