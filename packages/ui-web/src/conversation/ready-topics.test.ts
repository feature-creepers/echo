import type { Exchange, Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { readyRows, waited } from './ready-topics.tsx'

const thread = (id: string): Thread => ({ id, title: `The ${id}`, kind: 'topic', state: 'ready', at: '2026-11-21T12:00:00.000Z' })

const line = (turn: string, threadId: string, replied: string, outcome: Exchange['outcome'] = 'done', written?: string): Exchange => ({
  turn,
  at: '2026-11-21T11:59:00.000Z',
  persona: 'ally',
  said: 'Find it',
  replied,
  outcome,
  thread: threadId,
  ...(written === undefined ? {} : { written })
})

describe('the answers that wait under the caption', () => {
  it.each([
    ['the latest answer, on one line', [line('t1', 'recipe', 'An old one.'), line('t2', 'recipe', 'A risotto\n  would do.')], 'A risotto would do.'],
    [
      'the title of the answer it wrote, without its marks',
      [line('t1', 'recipe', "I'll look for one.", 'done', 'Found three.\n\n## A **risotto** with `saffron`\n\n# Later')],
      'A risotto with saffron'
    ],
    ['what it said, when what it wrote has no title', [line('t1', 'recipe', 'A risotto would do.', 'done', 'Just a paragraph.')], 'A risotto would do.'],
    ['nothing when the answer is empty', [line('t1', 'recipe', '  ')], undefined],
    ['nothing when no answer of the topic is in the conversation', [line('t1', 'other', 'Something else.')], undefined],
    ['a finished answer, never one still running or stopped', [line('t1', 'recipe', 'Done.'), line('t2', 'recipe', 'Half', 'stopped')], 'Done.']
  ])('starts each row with %s', (_case, exchanges, answer) => {
    expect(readyRows([thread('recipe')], exchanges)).toEqual([{ thread: thread('recipe'), answer }])
  })

  it('keeps the order of the threads, the most recent first', () => {
    expect(readyRows([thread('b'), thread('a')], []).map((row) => row.thread.id)).toEqual(['b', 'a'])
  })

  it.each([
    [10_000, 'now'],
    [4 * 60_000 + 30_000, '4 min'],
    [2 * 3_600_000 + 1, '2 h'],
    [3 * 86_400_000, '3 d']
  ])('says an answer has waited %i ms as "%s"', (passed, words) => {
    const at = '2026-11-21T12:00:00.000Z'
    expect(waited(at, new Date(new Date(at).getTime() + passed))).toBe(words)
  })
})
