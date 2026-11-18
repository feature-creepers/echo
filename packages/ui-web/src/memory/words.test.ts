import type { Fact, SleepSettings } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { ago, dayOf, keptFor, learnedFrom, retentionChoices, retentionDetail, retentionOf, retentionWarning, sleepStatus, whenItSleeps } from './words.ts'

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

  it('say how long what was said is kept', () => {
    expect(keptFor(null)).toBe('For good')
    expect(keptFor(365)).toBe('A year')
    expect(keptFor(45)).toBe('45 days')
    expect(retentionDetail(null)).toBe('Every word said is kept, and can be searched.')
    expect(retentionDetail(90)).toBe('Words older than three months are erased. What was learned from them stays.')
  })

  it('offer for good and each period, with the one set even when it is not among them', () => {
    expect(retentionChoices(null).map((choice) => choice.label)).toEqual(['For good', 'A month', 'Three months', 'Six months', 'A year', 'Two years'])
    expect(retentionChoices(45).map((choice) => choice.value)).toEqual(['for-good', '30', '45', '90', '180', '365', '730'])
    expect(retentionOf('for-good')).toBeNull()
    expect(retentionOf('90')).toBe(90)
  })

  it.each([
    [null, 30, true],
    [365, 30, true],
    [30, 365, false],
    [30, null, false],
    [90, 90, false]
  ])('warn, going from %j to %j days, only when words would be erased: %j', (from, to, warned) => {
    const warning = retentionWarning(from, to, now)
    expect(warning !== undefined).toBe(warned)
    if (warning) expect(warning).toContain(dayOf(new Date(now.getTime() - (to as number) * 86_400_000).toISOString()))
  })
})
