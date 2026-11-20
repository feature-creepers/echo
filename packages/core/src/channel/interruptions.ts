/** The window the cap on interruptions counts over. */
const INTERRUPTION_WINDOW_MS = 60 * 60_000

/** How often the assistant may speak up by itself, as the person set it (docs/SPEC.md, section 7.10). */
export interface InterruptionCap {
  /**
   * Whether the assistant may speak up by itself now: a reminder said aloud, a scheduled task's answer, an answer
   * finished out of sight. A yes counts as one; past the cap, what it would say is shown and not said.
   */
  take(): boolean
}

export interface InterruptionCapOptions {
  now: () => number
  /** How many times an hour at most, as set now; `null` for no cap. */
  perHour: () => number | null
}

/** The times it spoke up in the last hour are kept in memory: after a restart it counts afresh. */
export function createInterruptionCap({ now, perHour }: InterruptionCapOptions): InterruptionCap {
  const spoke: number[] = []
  return {
    take() {
      const at = now()
      while (spoke.length > 0 && (spoke[0] as number) <= at - INTERRUPTION_WINDOW_MS) spoke.shift()
      const cap = perHour()
      if (cap !== null && spoke.length >= cap) return false
      spoke.push(at)
      return true
    }
  }
}
