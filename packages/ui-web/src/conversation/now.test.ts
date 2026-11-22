import type { Exchange, Thread, TopicAnswers } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { hubTurn, latestLine, topicOf, topicsNow } from './now.ts'

const NOW = new Date('2026-11-22T12:00:00.000Z')

const topic = (id: string, progress: TopicAnswers['topic']['progress'], at = '2026-11-22T10:00:00.000Z'): TopicAnswers => ({
  topic: { id, title: id, at, answers: 2, ...(progress === undefined ? {} : { progress }) },
  answers: []
})

describe('the topics in progress', () => {
  it('are those that stand somehow and were active in the last three days, what needs the person first', () => {
    const topics = [
      topic('weather today', undefined),
      topic('kitchen', 'quiet', '2026-11-21T09:00:00.000Z'),
      topic('echo app', 'working', '2026-11-22T08:00:00.000Z'),
      topic('taxes', 'ready'),
      topic('japan trip', 'quiet', '2026-11-22T11:00:00.000Z'),
      topic('camping', 'asks', '2026-11-20T09:00:00.000Z'),
      topic('old thesis', 'quiet', '2026-11-18T09:00:00.000Z'),
      topic('long build', 'working', '2026-11-10T09:00:00.000Z')
    ]
    expect(topicsNow(topics, NOW).map((one) => one.topic.id)).toEqual(['camping', 'echo app', 'long build', 'taxes', 'japan trip', 'kitchen'])
  })
})

describe('what a topic last found', () => {
  const line = (more: Partial<Exchange>): Exchange => ({
    turn: 't',
    at: NOW.toISOString(),
    persona: 'one',
    said: 'Find a recipe',
    replied: '',
    outcome: 'done',
    ...more
  })
  it.each<[string, Partial<Exchange>, string | undefined]>([
    [
      'the title of the answer it wrote, without its marks',
      { replied: "I'll look.", written: 'Found three.\n\n## A **risotto** with `saffron`' },
      'A risotto with saffron'
    ],
    ['what it said, on one line, when what it wrote has no title', { replied: 'A risotto\n  would do.', written: 'Just a paragraph.' }, 'A risotto would do.'],
    ['what was asked, while nothing is said yet', { outcome: 'running' }, 'Find a recipe'],
    ['nothing, with no words at all', { said: '' }, undefined]
  ])('is %s', (_case, more, found) => {
    expect(latestLine({ id: 't', at: NOW.toISOString(), exchange: line(more), views: [] })).toBe(found)
  })

  it('is nothing for an answer that is no line of the conversation', () => {
    expect(latestLine({ id: 'w', at: NOW.toISOString(), views: [] })).toBeUndefined()
    expect(latestLine(undefined)).toBeUndefined()
  })
})

describe('the hub', () => {
  it.each<[string, number, number, string, number]>([
    ['holds one topic on its left', 1, 0, '0 |', 0],
    ['shares a few between its sides', 5, 0, '0 1 2 | 3 4', 0],
    ['holds eight, four on each side', 8, 0, '0 1 2 3 | 4 5 6 7', 0],
    ['holds seven of more than eight, and keeps a spoke to turn it', 12, 0, '0 1 2 3 | 4 5 6', 5],
    ['turns to the next seven', 12, 1, '7 8 9 10 | 11', 7],
    ['comes round to the first again', 12, 2, '0 1 2 3 | 4 5 6', 5],
    ['holds nothing with no topic', 0, 0, ' |', 0]
  ])('%s', (_case, count, turn, spokes, more) => {
    const { left, right, more: waiting } = hubTurn(count, turn)
    expect(`${left.join(' ')} | ${right.join(' ')}`.trim()).toBe(spokes.trim())
    expect(waiting).toBe(more)
  })
})

describe("a thread's topic", () => {
  const thread = (id: string, more: Partial<Thread> = {}): Thread => ({ id, title: id, kind: 'topic', state: 'parked', at: NOW.toISOString(), ...more })
  const threads = [
    thread('weather', { topic: 'camping' }),
    thread('old'),
    thread('part', { kind: 'subthread', parent: 'weather' }),
    thread('lost', { kind: 'subthread', parent: 'gone' })
  ]
  it.each<[string, string, string | undefined]>([
    ['the one it files its answers in', 'weather', 'camping'],
    ['itself, for one recorded before there were topics', 'old', 'old'],
    ["its thread's, for a sub-thread", 'part', 'camping'],
    ['none, for a sub-thread whose thread is gone', 'lost', undefined]
  ])('is %s', (_case, id, found) => {
    expect(
      topicOf(
        threads.find((one) => one.id === id),
        threads
      )
    ).toBe(found)
  })
})
