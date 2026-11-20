import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHold, HOLD_MS } from './hold.ts'

describe('press and hold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['a tap', 100, 'tap', 0],
    ['a press let go early', 1_500, 'early', 0],
    ['a press held to the end', HOLD_MS, 'done', 1]
  ] as const)('%s ends as %s', (_name, held, ending, times) => {
    let done = 0
    const changes: boolean[] = []
    const hold = createHold({ onDone: () => done++, onChange: (held) => changes.push(held) })
    hold.press()
    vi.advanceTimersByTime(held)
    expect(hold.release()).toBe(ending)
    expect(done).toBe(times)
    expect(changes).toEqual([true, false])
    expect(hold.held()).toBe(false)
  })

  it('counts from the first press when the key repeats', () => {
    let done = 0
    const hold = createHold({ onDone: () => done++ })
    hold.press()
    vi.advanceTimersByTime(1_000)
    hold.press()
    vi.advanceTimersByTime(1_000)
    expect(done).toBe(1)
  })
})
