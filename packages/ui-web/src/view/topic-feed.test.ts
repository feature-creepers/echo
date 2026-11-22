import { describe, expect, it } from 'vitest'
import { dayWords } from './topic-feed.tsx'

describe('the day a topic was last active, as its section is named', () => {
  const now = new Date(2026, 10, 22, 18, 0)
  it.each([
    { name: 'today', at: new Date(2026, 10, 22, 0, 5), words: 'Today' },
    { name: 'yesterday, however few hours ago', at: new Date(2026, 10, 21, 23, 55), words: 'Yesterday' },
    { name: 'the date, before that', at: new Date(2026, 10, 17, 9, 0), words: '17 Nov' },
    { name: 'the date with its year, in another year', at: new Date(2025, 11, 31, 9, 0), words: '31 Dec 2025' }
  ])('is $name', ({ at, words }) => {
    expect(dayWords(at.toISOString(), now, 'en-GB')).toBe(words)
  })

  it('is nothing for a date it cannot read', () => {
    expect(dayWords('never', now, 'en-GB')).toBe('')
  })
})
