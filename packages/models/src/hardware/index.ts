import { availableParallelism, totalmem } from 'node:os'
import { engineThreads, type Hardware, type Tier, tierFor } from './tier.ts'

export { TIERS, type Tier } from './tier.ts'

/** The processors and memory of this machine. Node reports both the same way on every system. */
export function readHardware(): Hardware {
  return { processors: availableParallelism(), memoryBytes: totalmem() }
}

/** The tier of this machine. The user may choose another in settings: this is the default. */
export function detectTier(): Tier {
  return tierFor(readHardware())
}

/** How many processor threads a model engine should use on this machine, for a tier. */
export function detectEngineThreads(tier: Tier): number {
  return engineThreads(tier, readHardware().processors)
}
