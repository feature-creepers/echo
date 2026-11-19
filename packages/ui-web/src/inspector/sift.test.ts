import type { Logged } from '@repo/client'
import { describe, expect, it } from 'vitest'
import { arrivedSince, type EventGroup, siftEvents } from './sift.ts'

const said = (id: number, text: string): Logged => ({ id, at: 1_000 + id, event: { type: 'event', name: 'speech.say', turn: 'turn', text } })
const cleared = (id: number): Logged => ({ id, at: 1_000 + id, event: { type: 'event', name: 'view.cleared' } })

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
