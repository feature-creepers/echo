import { describe, expect, it } from 'vitest'
import { detectEngineThreads, detectTier, readHardware } from './index.ts'
import { engineThreads, TIERS, tierFor } from './tier.ts'

const GB = 1024 ** 3

describe('the hardware tier', () => {
  it.each([
    // An older laptop: two cores seen as four processors, 8 GB.
    { processors: 4, memory: 7.7, tier: 'light' },
    { processors: 2, memory: 4, tier: 'light' },
    // Many processors do not make up for too little memory, nor memory for too few processors.
    { processors: 8, memory: 5.8, tier: 'light' },
    { processors: 4, memory: 64, tier: 'light' },
    // A recent laptop: 8 GB or 16 GB as the system reports them.
    { processors: 8, memory: 7.6, tier: 'standard' },
    { processors: 8, memory: 15.4, tier: 'standard' },
    { processors: 6, memory: 31.3, tier: 'standard' },
    { processors: 16, memory: 23.4, tier: 'standard' },
    // 32 GB or more, as the system reports them.
    { processors: 8, memory: 31.2, tier: 'performance' },
    { processors: 12, memory: 62.7, tier: 'performance' }
  ] as const)('is $tier for $processors processors and $memory GB', ({ processors, memory, tier }) => {
    expect(tierFor({ processors, memoryBytes: memory * GB })).toBe(tier)
  })

  it('gives engines more threads on a stronger tier, and never more than half the processors', () => {
    expect(engineThreads('light', 4)).toBe(2)
    expect(engineThreads('light', 2)).toBe(1)
    expect(engineThreads('light', 1)).toBe(1)
    expect(engineThreads('light', 16)).toBe(2)
    expect(engineThreads('standard', 8)).toBe(4)
    expect(engineThreads('standard', 6)).toBe(3)
    expect(engineThreads('performance', 8)).toBe(4)
    expect(engineThreads('performance', 12)).toBe(6)
    expect(engineThreads('performance', 32)).toBe(6)
  })

  it('reads this machine, whatever it is', () => {
    const hardware = readHardware()
    expect(hardware.processors).toBeGreaterThanOrEqual(1)
    expect(hardware.memoryBytes).toBeGreaterThan(0)
    expect(TIERS).toContain(detectTier())
    expect(detectTier()).toBe(tierFor(hardware))
    for (const tier of TIERS) expect(detectEngineThreads(tier)).toBe(engineThreads(tier, hardware.processors))
  })
})
