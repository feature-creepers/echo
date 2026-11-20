import type { Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { sectionThreads, underOf, underWords, usedWords } from './thread-list.tsx'

const thread = (
  id: string,
  kind: Thread['kind'],
  {
    title = id,
    parent,
    beside,
    state = 'parked',
    at = '12:00',
    folder
  }: { title?: string; parent?: string; beside?: string; state?: Thread['state']; at?: string; folder?: string } = {}
): Thread => ({
  id,
  title,
  kind,
  state,
  at: `2026-11-19T${at}:00.000Z`,
  ...(parent === undefined ? {} : { parent }),
  ...(beside === undefined ? {} : { beside }),
  ...(folder === undefined ? {} : { folder })
})

/** The sections as words: each section's name, then each group as its head and what is under it. */
const read = (threads: Thread[], query?: string) =>
  sectionThreads(threads, query).map((section) => [
    section.name,
    ...section.groups.map((group) => [group.head.id, ...group.under.map((one) => one.id)].join(' > '))
  ])

describe('the threads as the side sheet lists them', () => {
  it.each([
    {
      name: 'a side question and a sub-thread under their topic',
      threads: [thread('topic', 'topic'), thread('side', 'topic', { beside: 'topic' }), thread('part', 'subthread', { parent: 'topic' })],
      sections: [['earlier', 'topic > side > part']]
    },
    {
      name: 'a sub-thread whose topic is gone on its own row',
      threads: [thread('topic', 'topic'), thread('part', 'subthread', { parent: 'gone' })],
      sections: [['earlier', 'topic', 'part']]
    },
    {
      name: 'a side question whose topic is gone on its own row',
      threads: [thread('side', 'topic', { beside: 'gone' })],
      sections: [['earlier', 'side']]
    },
    {
      name: 'what is at work first, then what is ready, then the rest',
      threads: [
        thread('idle', 'topic', { at: '14:00' }),
        thread('ready', 'topic', { state: 'ready' }),
        thread('busy', 'topic', { state: 'working', at: '09:00' })
      ],
      sections: [
        ['working', 'busy'],
        ['ready', 'ready'],
        ['earlier', 'idle']
      ]
    },
    {
      name: 'a topic at work while only its sub-thread works',
      threads: [thread('project', 'topic'), thread('part', 'subthread', { parent: 'project', state: 'working' }), thread('other', 'topic')],
      sections: [
        ['working', 'project > part'],
        ['earlier', 'other']
      ]
    },
    {
      name: 'the groups used most recently first, a sub-thread counting for its topic',
      threads: [
        thread('late', 'topic', { at: '15:00' }),
        thread('early', 'topic', { at: '08:00' }),
        thread('part', 'subthread', { parent: 'early', at: '16:00' })
      ],
      sections: [['earlier', 'early > part', 'late']]
    }
  ])('puts $name', ({ threads, sections }) => {
    expect(read(threads)).toEqual(sections)
  })

  it.each([
    { name: 'a topic by its title, with everything under it', query: 'Proj', sections: [['earlier', 'project > review > drawings']] },
    { name: 'a sub-thread by its folder, under its topic', query: 'echo-draw', sections: [['earlier', 'project > drawings']] },
    { name: 'a sub-thread by every word typed, accents aside', query: 'REVIEW   proj', sections: [['earlier', 'project > review']] },
    { name: 'a thread by its name written with accents', query: 'resume', sections: [['earlier', 'Résumé']] },
    { name: 'nothing for words no thread holds', query: 'nowhere', sections: [] },
    { name: 'everything for spaces only', query: '   ', sections: [['earlier', 'Résumé', 'project > review > drawings']] }
  ])('finds $name', ({ query, sections }) => {
    const threads = [
      thread('Résumé', 'topic', { at: '13:00' }),
      thread('project', 'topic', { folder: 'C:\\GitHub\\echo' }),
      thread('review', 'subthread', { title: 'review project', parent: 'project' }),
      thread('drawings', 'subthread', { parent: 'project', folder: '/home/someone/echo-drawings' })
    ]
    expect(read(threads, query)).toEqual(sections)
  })
})

describe('when a thread was last used', () => {
  const now = new Date(2026, 10, 19, 16, 0)
  const local = (day: number, hour: number, year = 2026) => new Date(year, 10, day, hour, 30).toISOString()
  it.each([
    { name: 'the time, today', at: local(19, 9), words: new Date(2026, 10, 19, 9, 30).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
    { name: 'yesterday', at: local(18, 23), words: 'Yesterday' },
    { name: 'the day, this year', at: local(3, 12), words: '3 Nov' },
    { name: 'the day and year, before', at: local(3, 12, 2025), words: '3 Nov 2025' },
    { name: 'nothing, for a date it cannot read', at: 'never', words: '' }
  ])('says $name', ({ at, words }) => {
    expect(usedWords(at, now, 'en-GB')).toBe(words)
  })
})

describe('the threads under a thread, over its work', () => {
  it.each([
    { name: 'nothing, for a thread that handed nothing on', threads: [thread('project', 'topic'), thread('other', 'topic')], under: [], words: undefined },
    {
      name: 'its sub-threads, those at work first, then the latest',
      threads: [
        thread('project', 'topic'),
        thread('early', 'subthread', { parent: 'project', at: '08:00' }),
        thread('late', 'subthread', { parent: 'project', at: '15:00' }),
        thread('busy', 'subthread', { parent: 'project', state: 'working', at: '07:00' }),
        thread('elsewhere', 'subthread', { parent: 'other' })
      ],
      under: ['busy', 'late', 'early'],
      words: 'Sub-threads'
    },
    {
      name: 'one side question',
      threads: [thread('project', 'topic'), thread('side', 'topic', { beside: 'project' })],
      under: ['side'],
      words: 'Side question'
    },
    {
      name: 'both kinds together',
      threads: [thread('project', 'topic'), thread('side', 'topic', { beside: 'project', at: '13:00' }), thread('part', 'subthread', { parent: 'project' })],
      under: ['side', 'part'],
      words: 'Under this thread'
    }
  ])('lists $name', ({ threads, under, words }) => {
    const found = underOf('project', threads)
    expect(found.map((one) => one.id)).toEqual(under)
    if (words !== undefined) expect(underWords(found)).toBe(words)
  })
})
