import type { SleepSettings } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { manualTimers } from '../replay/manual-timers.ts'
import { createSleepSchedule, DEFAULT_SLEEP, untilTimeOfDay } from './sleep.ts'

const MINUTE = 60_000

function schedule(settings: Partial<SleepSettings> = {}, { start = new Date(2026, 10, 17, 22, 0), busy = (): boolean => false } = {}) {
  const timers = manualTimers()
  const slept: number[] = []
  const now = () => new Date(start.getTime() + timers.elapsed())
  const sleeps = createSleepSchedule({ ...DEFAULT_SLEEP, ...settings }, { now, timers, busy, fallAsleep: () => slept.push(timers.elapsed()) })
  const pass = (ms: number) => timers.advance(ms)
  return { sleeps, slept, pass, timers }
}

describe('the time until a time of day', () => {
  it('is later today, or tomorrow once it has passed', () => {
    expect(untilTimeOfDay(new Date(2026, 10, 17, 22, 0), '23:30')).toBe(90 * MINUTE)
    expect(untilTimeOfDay(new Date(2026, 10, 17, 22, 0), '03:00')).toBe(5 * 60 * MINUTE)
    expect(untilTimeOfDay(new Date(2026, 10, 17, 3, 0), '03:00')).toBe(24 * 60 * MINUTE)
  })
})

describe('falling asleep', () => {
  it('happens after a quiet period, which each exchange starts again', () => {
    const { sleeps, slept, pass } = schedule({ when: 'quiet', quietMinutes: 10 })
    pass(9 * MINUTE)
    sleeps.heard()
    pass(9 * MINUTE)
    expect(slept).toEqual([])
    pass(MINUTE)
    expect(slept).toEqual([19 * MINUTE])
    // Once asleep, only something new said starts another quiet period.
    pass(60 * MINUTE)
    expect(slept).toHaveLength(1)
  })

  it('happens at the time of day, every day', () => {
    const { slept, pass } = schedule({ when: 'time', time: '23:00' })
    pass(25 * 60 * MINUTE)
    expect(slept).toEqual([60 * MINUTE, 25 * 60 * MINUTE])
  })

  it('happens at whichever comes first, when both are set', () => {
    const { slept, pass } = schedule({ when: 'quiet-or-time', quietMinutes: 30, time: '22:15' })
    pass(60 * MINUTE)
    expect(slept).toEqual([15 * MINUTE, 30 * MINUTE])
  })

  it('never happens by itself when only asked for, or never', () => {
    for (const when of ['asked', 'never'] as const) {
      const { slept, pass, timers } = schedule({ when })
      pass(48 * 60 * MINUTE)
      expect(slept).toEqual([])
      expect(timers.next()).toBeUndefined()
    }
  })

  it('waits for the answer under way to end', () => {
    let answering = true
    const { slept, pass } = schedule({ when: 'quiet', quietMinutes: 10 }, { busy: () => answering })
    pass(12 * MINUTE)
    expect(slept).toEqual([])
    answering = false
    pass(MINUTE)
    // It looks again a minute later, each minute, until the answer is over.
    expect(slept).toEqual([13 * MINUTE])
  })

  it('follows a change of setting, and stops when closed', () => {
    const { sleeps, slept, pass, timers } = schedule({ when: 'asked' })
    sleeps.follow({ ...DEFAULT_SLEEP, when: 'quiet', quietMinutes: 5 })
    pass(5 * MINUTE)
    expect(slept).toEqual([5 * MINUTE])
    sleeps.heard()
    sleeps.close()
    expect(timers.next()).toBeUndefined()
  })
})
