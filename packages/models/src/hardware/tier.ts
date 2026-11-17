/**
 * The hardware tier of a machine: which of the heavy components it runs, and how hard it may work them.
 * See docs/SPEC.md, section 8.2.
 */
export type Tier = 'light' | 'standard' | 'performance'

export const TIERS: readonly Tier[] = ['light', 'standard', 'performance']

/** What the tier is decided from. */
export interface Hardware {
  /** How many processors the system schedules work on: cores, counted twice when each runs two threads. */
  processors: number
  /** The memory installed, in bytes. */
  memoryBytes: number
}

const GIGABYTE = 1024 ** 3

/**
 * A machine sold with 8 GB or 32 GB reports a little less, since some is kept for its firmware and graphics.
 * The thresholds sit below the round numbers for that reason.
 */
const LIGHT_BELOW_BYTES = 7 * GIGABYTE
const PERFORMANCE_FROM_BYTES = 30 * GIGABYTE

/** An older laptop has two cores, seen as four processors at most. */
const LIGHT_UP_TO_PROCESSORS = 4
const PERFORMANCE_FROM_PROCESSORS = 8

/**
 * The tier a machine belongs to. Light: an older laptop, or less than 8 GB. Performance: 32 GB or more
 * with the processors to use them. Standard: everything between.
 */
export function tierFor({ processors, memoryBytes }: Hardware): Tier {
  if (processors <= LIGHT_UP_TO_PROCESSORS || memoryBytes < LIGHT_BELOW_BYTES) return 'light'
  if (processors >= PERFORMANCE_FROM_PROCESSORS && memoryBytes >= PERFORMANCE_FROM_BYTES) return 'performance'
  return 'standard'
}

/** The most processor threads one engine may use, by tier. More than that buys almost nothing for these models. */
const MOST_ENGINE_THREADS: Record<Tier, number> = { light: 2, standard: 4, performance: 6 }

/**
 * How many processor threads a model engine should use. Never more than half the processors: the other
 * half are the second thread of a core, or slow cores, or what the rest of the app runs on.
 */
export function engineThreads(tier: Tier, processors: number): number {
  return Math.max(1, Math.min(MOST_ENGINE_THREADS[tier], Math.floor(processors / 2)))
}
