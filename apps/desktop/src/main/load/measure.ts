/**
 * How hard the computer works, worked out from what the system reports: plain numbers, so they are tested on every
 * system alike. The window's core follows the result (`ui-web`'s presence), brighter as the computer works harder.
 */

/** What a processor has spent its time on, in milliseconds, as Node's `os.cpus()` reports it. */
export interface ProcessorTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

/**
 * The share of the time the processors were busy between two readings, from 0 to 1, over all of them. A processor
 * that is missing from either reading, or whose clock went backwards, counts for nothing.
 */
export function processorBusy(before: readonly ProcessorTimes[], after: readonly ProcessorTimes[]): number {
  let busy = 0
  let total = 0
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    const was = before[index]
    const now = after[index]
    if (!was || !now) continue
    const idle = now.idle - was.idle
    const working = now.user - was.user + (now.nice - was.nice) + (now.sys - was.sys) + (now.irq - was.irq)
    if (idle < 0 || working < 0) continue
    busy += working
    total += working + idle
  }
  return total > 0 ? Math.min(1, busy / total) : 0
}

/**
 * How pressed for memory the computer is, from 0 to 1: nothing until three quarters of it is in use, as a computer
 * at work always uses much of it, then rising to full as the last of it goes.
 */
export function memoryPressure(free: number, total: number): number {
  if (total <= 0) return 0
  const used = 1 - Math.min(1, Math.max(0, free / total))
  const share = Math.min(1, Math.max(0, (used - 0.75) / 0.2))
  return share * share * (3 - 2 * share)
}

/** What the load is made of, each from 0 to 1; the graphics card's is missing where the system does not say. */
export interface LoadParts {
  processor: number
  memory: number
  graphics?: number | undefined
}

/** How hard the computer works, from 0 to 1: the busiest of its processor, its graphics card and its memory. */
export function loadOf({ processor, memory, graphics }: LoadParts): number {
  const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return Math.max(clamp(processor), clamp(memory), clamp(graphics ?? 0))
}
