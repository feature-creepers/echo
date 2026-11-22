import type { Logged } from '@repo/client'
import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { arrivedSince, concerns, type EventGroup, siftEvents } from './sift.ts'

const said = (id: number, text: string): Logged => ({ id, at: 1_000 + id, event: { type: 'event', name: 'speech.say', turn: 'turn', text } })
const cleared = (id: number): Logged => ({ id, at: 1_000 + id, event: { type: 'event', name: 'view.cleared', view: 'view' } })

const log = [said(1, 'Bonjour à tous'), cleared(2), said(3, 'The weather is fine'), said(4, 'The weather is fine')]

describe('the events the inspector lists', () => {
  it.each<{ name: string; group: EventGroup; query: string; ids: number[] }>([
    { name: 'every event, newest first', group: 'all', query: '', ids: [4, 3, 2, 1] },
    { name: 'those of one group', group: 'screen', query: '', ids: [2] },
    { name: 'none, for a group without one', group: 'work', query: '', ids: [] },
    { name: 'those holding every word typed', group: 'all', query: 'weather fine', ids: [4, 3] },
    { name: 'a word without its accents or case', group: 'all', query: 'BONJOUR a', ids: [1] },
    { name: 'a word of the name', group: 'all', query: 'cleared', ids: [2] },
    { name: 'a group and words together', group: 'screen', query: 'weather', ids: [] }
  ])('lists $name', ({ group, query, ids }) => {
    expect(siftEvents(log, group, query).map((logged) => logged.id)).toEqual(ids)
  })

  it('tells apart two events with the same words at the same moment', () => {
    const twins = [
      { ...said(7, 'Same'), at: 5 },
      { ...said(8, 'Same'), at: 5 }
    ]
    expect(new Set(siftEvents(twins, 'all', '').map((logged) => logged.id)).size).toBe(2)
  })
})

describe('the events that arrived while the log was held', () => {
  it.each([
    { name: 'none, when nothing came', events: log, held: log, count: 0 },
    { name: 'those after the newest held', events: [...log, cleared(5), said(6, 'Later')], held: log, count: 2 },
    { name: 'every one, when nothing was held', events: log, held: [], count: 4 },
    { name: 'those kept, when the oldest held have gone out of the log', events: [said(9, 'a'), said(10, 'b')], held: log, count: 2 }
  ])('counts $name', ({ events, held, count }) => {
    expect(arrivedSince(events, held)).toBe(count)
  })
})

describe('the events about a topic', () => {
  const about = { topic: 'camping', threads: new Set(['gear']), turns: new Set(['t1']) }
  const line = (turn: string, thread?: string): Exchange => ({
    turn,
    at: '2026-11-22T09:00:00.000Z',
    persona: 'one',
    said: 'pack',
    replied: '',
    outcome: 'running',
    ...(thread === undefined ? {} : { thread })
  })
  const view = { id: 'v', title: 'Gear', spec: { root: 'a', elements: {} } }
  const topic = (id: string) => ({ topic: { id, title: id, at: '2026-11-22T09:00:00.000Z', answers: 1 }, answers: [] })
  it.each<[string, Event, boolean]>([
    ['a turn it answered', { type: 'event', name: 'turn.ended', exchange: line('t1') }, true],
    ['a turn of one of its threads, not read yet as an answer', { type: 'event', name: 'turn.started', exchange: line('t9', 'gear') }, true],
    ["another topic's turn", { type: 'event', name: 'turn.started', exchange: line('t9', 'taxes') }, false],
    ['a sentence of one of its turns', { type: 'event', name: 'speech.say', turn: 't1', text: 'A tent.' }, true],
    ['a tool call of one of its turns', { type: 'event', name: 'activity', turn: 't1', tool: 'web_search', phase: 'started' }, true],
    ['a tool call of another turn', { type: 'event', name: 'activity', turn: 't9', tool: 'web_search', phase: 'started' }, false],
    ['a view one of its threads shows', { type: 'event', name: 'view.shown', view: { ...view, thread: 'gear', turn: 't9' } }, true],
    ['a view of another topic', { type: 'event', name: 'view.shown', view: { ...view, thread: 'taxes', turn: 't9' } }, false],
    ['a change of the topic itself', { type: 'event', name: 'topics.changed', topics: [topic('camping')], gone: [] }, true],
    ['its going away', { type: 'event', name: 'topics.changed', topics: [], gone: ['camping'] }, true],
    ['a change of another topic', { type: 'event', name: 'topics.changed', topics: [topic('taxes')], gone: [] }, false],
    ['what is about no topic', { type: 'event', name: 'view.cleared', view: 'v' }, false]
  ])('hold %s', (_case, event, held) => {
    expect(concerns(event, about)).toBe(held)
  })

  it('are the only ones listed when a topic is given', () => {
    const said = (id: number, turn: string) => ({ id, at: 1_000 + id, event: { type: 'event' as const, name: 'speech.say' as const, turn, text: 'x' } })
    expect(siftEvents([said(1, 't1'), said(2, 't9'), said(3, 't1')], 'all', '', about).map((logged) => logged.id)).toEqual([3, 1])
  })
})
