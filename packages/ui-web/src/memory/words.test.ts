import type { Fact, SleepSettings } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { ago, dayOf, learnedFrom, sleepStatus, whenItSleeps } from './words.ts'

const now = new Date('2026-11-17T12:00:00Z')
const sleep: SleepSettings = { when: 'quiet', quietMinutes: 10, time: '03:00' }

describe('the words of the memory section', () => {
  it('say how long ago, as a person would', () => {
    expect(ago('2026-11-17T11:59:30Z', now)).toBe('just now')
    expect(ago('2026-11-17T11:59:00Z', now)).toBe('1 minute ago')
    expect(ago('2026-11-17T09:00:00Z', now)).toBe('3 hours ago')
    expect(ago('2026-11-16T09:00:00Z', now)).toBe('yesterday')
    expect(ago('2026-11-14T09:00:00Z', now)).toBe('3 days ago')
    expect(ago('2026-10-02T09:00:00Z', now)).toBe(`on ${dayOf('2026-10-02T09:00:00Z')}`)
  })

  it('say when it sleeps', () => {
    expect(whenItSleeps(sleep)).toBe('Sleeps after 10 quiet minutes.')
    expect(whenItSleeps({ ...sleep, quietMinutes: 1, when: 'quiet-or-time' })).toBe('Sleeps after 1 quiet minute, or at 03:00.')
    expect(whenItSleeps({ ...sleep, when: 'time', time: '22:30' })).toBe('Sleeps at 22:30 every day.')
    expect(whenItSleeps({ ...sleep, when: 'never' })).toContain('Never sleeps')
  })

  it('say where it stands', () => {
    expect(sleepStatus({ asleep: false }, sleep, now)).toEqual({ title: 'Awake', detail: 'Has not slept yet. Sleeps after 10 quiet minutes.' })
    expect(sleepStatus({ asleep: false, lastSlept: '2026-11-17T10:00:00Z' }, sleep, now).detail).toMatch(/^Last slept 2 hours ago\./)
    expect(sleepStatus({ asleep: true, work: { done: 3, total: 12 } }, sleep, now)).toEqual({
      title: 'Asleep',
      detail: 'Making sense of what was said: 3 of 12 exchanges.'
    })
    expect(sleepStatus({ asleep: true, work: { done: 0, total: 0 } }, sleep, now).detail).toContain('wakes at once')
  })

  it('say where a fact comes from', () => {
    const fact: Fact = { id: 'f', text: 't', kind: 'other', origin: 'told', since: '2026-11-17T08:00:00Z', at: '2026-11-17T08:00:00Z', sources: [] }
    expect(learnedFrom(fact)).toBe(`You asked it to remember · ${dayOf(fact.since)}`)
    expect(learnedFrom({ ...fact, origin: 'conversation' })).toMatch(/^Learned · /)
  })
})
