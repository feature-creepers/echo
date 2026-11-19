import type { Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { groupThreads } from './thread-list.tsx'

const thread = (id: string, kind: Thread['kind'], parent?: string): Thread => ({
  id,
  title: id,
  kind,
  state: 'parked',
  at: '2026-11-19T12:00:00.000Z',
  ...(parent === undefined ? {} : { parent })
})

describe('the threads as the side sheet lists them', () => {
  it.each([
    {
      name: 'an aside and a sub-thread under their topic',
      threads: [thread('topic', 'topic'), thread('aside', 'aside', 'topic'), thread('part', 'subthread', 'topic')],
      groups: [['topic', 'aside', 'part']],
      loose: []
    },
    {
      name: 'a sub-thread whose topic is gone, apart',
      threads: [thread('topic', 'topic'), thread('part', 'subthread', 'gone')],
      groups: [['topic']],
      loose: ['part']
    },
    {
      name: 'an aside from before asides knew their topic, apart',
      threads: [thread('aside', 'aside')],
      groups: [],
      loose: ['aside']
    }
  ])('puts $name', ({ threads, groups, loose }) => {
    const grouped = groupThreads(threads)
    expect(grouped.groups.map((group) => [group.topic.id, ...group.asides.map((one) => one.id)])).toEqual(groups)
    expect(grouped.loose.map((one) => one.id)).toEqual(loose)
  })
})
