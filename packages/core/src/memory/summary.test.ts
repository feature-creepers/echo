import type { Exchange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { SUMMARIES_PER_SLEEP, type SummaryRecord, summariesDue } from './summary.ts'

let turns = 0
const line = (thread: string | undefined, at: string, more: Partial<Exchange> = {}): Exchange => ({
  turn: `t${++turns}`,
  at,
  persona: 'first',
  said: 'Something.',
  replied: 'An answer.',
  outcome: 'done',
  ...(thread === undefined ? {} : { thread }),
  ...more
})

describe('summariesDue', () => {
  it('gives each thread its lines after its last summary, the most recently used first', () => {
    const a1 = line('a', '2026-11-18T09:00')
    const b1 = line('b', '2026-11-18T09:05')
    const a2 = line('a', '2026-11-18T09:10')
    const quick = line(undefined, '2026-11-18T09:20')
    const summaries = new Map<string, SummaryRecord>([['a', { thread: 'a', text: 'So far.', through: a1.turn }]])
    expect(summariesDue([a1, b1, a2, quick], summaries)).toEqual([
      { thread: 'a', exchanges: [a2] },
      { thread: 'b', exchanges: [b1] }
    ])
  })

  it.each([
    [
      'a thread summarised up to its last line',
      [line('c', '2026-11-18T10:00', { turn: 'last' })],
      new Map([['c', { thread: 'c', text: 'x', through: 'last' }]])
    ],
    ['a line still running', [line('c', '2026-11-18T10:00', { outcome: 'running' })], new Map()],
    ['a line with nothing said or answered', [line('c', '2026-11-18T10:00', { said: ' ', replied: '' })], new Map()]
  ])('leaves out %s', (_, exchanges, summaries) => {
    expect(summariesDue(exchanges, summaries as Map<string, SummaryRecord>)).toEqual([])
  })

  it('takes every line again when the line it was written through is gone', () => {
    const lines = [line('d', '2026-11-18T10:00'), line('d', '2026-11-18T10:01')]
    expect(summariesDue(lines, new Map([['d', { thread: 'd', text: 'x', through: 'erased' }]]))).toEqual([{ thread: 'd', exchanges: lines }])
  })

  it(`summarises ${SUMMARIES_PER_SLEEP} threads at most in one sleep`, () => {
    const lines = Array.from({ length: 12 }, (_, index) => line(`thread-${index}`, `2026-11-18T10:${String(index).padStart(2, '0')}`))
    const due = summariesDue(lines, new Map())
    expect(due).toHaveLength(SUMMARIES_PER_SLEEP)
    expect(due[0]?.thread).toBe('thread-11')
  })
})
