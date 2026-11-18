import { describe, expect, it } from 'vitest'
import { createHold, HOLD_MS } from './hold.ts'

/** A clock and timers the test moves by hand. */
function clock() {
  let at = 0
  const pending = new Map<number, { run: () => void; at: number }>()
  let ids = 0
  return {
    now: () => at,
    timers: {
      set: (run: () => void, ms: number) => {
        pending.set(++ids, { run, at: at + ms })
        return ids
      },
      clear: (timer: unknown) => void pending.delete(timer as number)
    },
    advance(ms: number) {
      at += ms
      for (const [id, timer] of [...pending]) {
        if (timer.at > at) continue
        pending.delete(id)
        timer.run()
      }
    }
  }
}

describe('press and hold', () => {
  it.each([
    ['a tap', 100, 'tap', 0],
    ['a press let go early', 1_500, 'early', 0],
    ['a press held to the end', HOLD_MS, 'done', 1]
  ] as const)('%s ends as %s', (_name, held, ending, times) => {
    const time = clock()
    let done = 0
    const changes: boolean[] = []
    const hold = createHold({ onDone: () => done++, onChange: (held) => changes.push(held), now: time.now, timers: time.timers })
    hold.press()
    time.advance(held)
    expect(hold.release()).toBe(ending)
    expect(done).toBe(times)
    expect(changes).toEqual([true, false])
    expect(hold.held()).toBe(false)
  })

  it('counts from the first press when the key repeats', () => {
    const time = clock()
    let done = 0
    const hold = createHold({ onDone: () => done++, now: time.now, timers: time.timers })
    hold.press()
    time.advance(1_000)
    hold.press()
    time.advance(1_000)
    expect(done).toBe(1)
  })
})
