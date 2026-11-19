import { describe, expect, it } from 'vitest'
import { createInterruptionCap, INTERRUPTION_WINDOW_MS } from './interruptions.ts'

describe('the cap on interruptions', () => {
  const minutes = (count: number) => count * 60_000

  it.each([
    ['lets the first ones through, up to the cap', 3, [0, 1, 2, 3], [true, true, true, false]],
    ['lets one through again an hour after the oldest', 2, [0, 10, 59, 60, 61], [true, true, false, true, false]],
    ['counts only what it let through', 1, [0, 30, 60], [true, false, true]],
    ['lets everything through with no cap', null, [0, 0, 0, 0, 0], [true, true, true, true, true]]
  ] as const)('%s', (_case, cap, at, allowed) => {
    let clock = 0
    const interruptions = createInterruptionCap({ now: () => clock, perHour: () => cap })
    const answers = at.map((minute) => {
      clock = minutes(minute)
      return interruptions.take()
    })
    expect(answers).toEqual(allowed)
  })

  it('follows the cap as the person changes it', () => {
    let cap: number | null = 1
    const interruptions = createInterruptionCap({ now: () => 0, perHour: () => cap })
    expect([interruptions.take(), interruptions.take()]).toEqual([true, false])
    cap = null
    expect(interruptions.take()).toBe(true)
    expect(INTERRUPTION_WINDOW_MS).toBe(minutes(60))
  })
})
