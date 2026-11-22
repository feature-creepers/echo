import { describe, expect, it } from 'vitest'
import { whenWords } from './topic-story.tsx'

describe('when an answer was asked for', () => {
  const now = new Date(2026, 10, 22, 18, 0)
  it.each([
    { name: 'the time, today', at: new Date(2026, 10, 22, 9, 5), words: '09:05' },
    { name: 'the day and the time, within a week', at: new Date(2026, 10, 19, 17, 42), words: 'Thu 17:42' },
    { name: 'the date, a week ago or more', at: new Date(2026, 10, 15, 17, 42), words: '15 Nov' }
  ])('is $name', ({ at, words }) => {
    expect(whenWords(at.toISOString(), now, 'en-GB')).toBe(words)
  })

  it('is nothing for a date it cannot read', () => {
    expect(whenWords('never', now, 'en-GB')).toBe('')
  })
})
