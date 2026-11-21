import type { Thread } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { workingRows } from './running-threads.tsx'

const thread = (id: string, kind: Thread['kind'], state: Thread['state'], parent?: string): Thread => ({
  id,
  title: `The ${id}`,
  kind,
  state,
  at: '2026-11-19T12:00:00.000Z',
  ...(parent === undefined ? {} : { parent })
})

/** Each row as words: indented under the thread it is part of, or saying what it is part of. */
const read = (threads: Thread[]) =>
  workingRows(threads).map((row) => `${row.nested ? '  ' : ''}${row.thread.id}${row.partOf === undefined ? '' : ` (of ${row.partOf})`}`)

describe('the threads at work under the composer', () => {
  it.each([
    {
      name: 'sub-threads at work under their topic at work, in the order of the threads',
      threads: [
        thread('drawings', 'subthread', 'working', 'project'),
        thread('review', 'topic', 'working'),
        thread('word', 'subthread', 'working', 'project'),
        thread('project', 'topic', 'working')
      ],
      rows: ['review', 'project', '  drawings', '  word']
    },
    {
      name: 'a sub-thread whose topic rests, saying what it is part of',
      threads: [thread('drawings', 'subthread', 'working', 'project'), thread('project', 'topic', 'parked')],
      rows: ['drawings (of The project)']
    },
    {
      name: 'a sub-thread whose topic is gone, on its own',
      threads: [thread('drawings', 'subthread', 'working', 'gone')],
      rows: ['drawings']
    },
    {
      name: 'only what works',
      threads: [thread('idle', 'topic', 'parked'), thread('ready', 'topic', 'ready')],
      rows: []
    }
  ])('lists $name', ({ threads, rows }) => {
    expect(read(threads)).toEqual(rows)
  })
})
