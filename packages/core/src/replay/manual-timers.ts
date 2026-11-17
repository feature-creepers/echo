import type { Timers } from '../ports/clock.ts'

/** Timers whose time passes only when told. For tests: what is due runs, in order, when the time comes. */
export interface ManualTimers extends Timers {
  /** Let this much time pass, running what falls due. */
  advance(ms: number): void
  /** How long until the next thing due, if anything is waiting. */
  next(): number | undefined
  /** How much time has passed since they were made. */
  elapsed(): number
}

export function manualTimers(): ManualTimers {
  let now = 0
  let made = 0
  const waiting = new Map<number, { at: number; work: () => void }>()
  return {
    after(ms, work) {
      const id = ++made
      waiting.set(id, { at: now + Math.max(0, ms), work })
      return () => void waiting.delete(id)
    },
    advance(ms) {
      const until = now + ms
      for (;;) {
        const due = [...waiting.entries()].filter(([, timer]) => timer.at <= until).sort(([, one], [, other]) => one.at - other.at)[0]
        if (!due) break
        const [id, timer] = due
        waiting.delete(id)
        now = timer.at
        timer.work()
      }
      now = until
    },
    elapsed: () => now,
    next() {
      const ats = [...waiting.values()].map((timer) => timer.at - now)
      return ats.length === 0 ? undefined : Math.min(...ats)
    }
  }
}
