import type { Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { threadsFor } from './topic-work.tsx'

const thread = (id: string, at: string, more: Partial<Thread> = {}): Thread => ({
  id,
  title: id,
  kind: 'topic',
  state: 'parked',
  at: `2026-11-22T${at}:00.000Z`,
  ...more
})

describe('the threads that work for a topic', () => {
  it('are those that file their answers in it, at work first, then the one last used, each sub-thread after its thread', () => {
    const threads = [
      thread('weather', '09:00', { topic: 'camping' }),
      thread('gear', '08:00', { topic: 'camping', state: 'working' }),
      thread('prices', '08:30', { kind: 'subthread', parent: 'gear' }),
      thread('sites', '10:00', { topic: 'camping' }),
      thread('taxes', '11:00', { topic: 'taxes' }),
      thread('receipts', '11:30', { kind: 'subthread', parent: 'taxes', state: 'working' })
    ]
    expect(threadsFor('camping', threads).map((one) => one.id)).toEqual(['gear', 'prices', 'sites', 'weather'])
  })

  it('are the thread itself for a topic made of a thread recorded before there were topics', () => {
    expect(threadsFor('old', [thread('old', '09:00'), thread('other', '10:00')]).map((one) => one.id)).toEqual(['old'])
  })
})
