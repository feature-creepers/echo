import type { MemoryView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryMarkdown } from './memory-markdown.ts'

const now = new Date('2026-11-17T10:00:00Z')

describe('the memory as Markdown', () => {
  it('gives the profile, then each kind of fact with when and where it was learned', () => {
    const memory: MemoryView = {
      revision: 3,
      profile: 'The user keeps bees.',
      groups: [
        {
          kind: 'person',
          facts: [
            {
              id: 'f1',
              text: 'Anna is the user’s *sister*.',
              kind: 'person',
              origin: 'conversation',
              since: '2026-11-02T09:00:00.000Z',
              at: '2026-11-02T09:00:00.000Z',
              sources: [{ turn: 't1', at: '2026-11-02T09:00:00.000Z', said: 'My sister\nAnna' }]
            }
          ]
        },
        {
          kind: 'override',
          facts: [
            { id: 'f2', text: 'Sent the letter anyway.', kind: 'override', origin: 'told', since: '2026-11-05T00:00:00.000Z', at: '2026-11-05', sources: [] }
          ]
        }
      ],
      sleep: { when: 'quiet', quietMinutes: 10, time: '03:00' },
      retentionDays: null
    }

    expect(memoryMarkdown(memory, { title: 'What I know about you', now })).toBe(
      [
        '# What I know about you',
        '',
        'Exported on 2026-11-17.',
        '',
        '## Profile',
        '',
        'The user keeps bees.',
        '',
        '## People',
        '',
        '- Anna is the user’s \\*sister\\*. _(learned 2026-11-02, from “My sister Anna”)_',
        '',
        '## Decisions you kept',
        '',
        '- Sent the letter anyway. _(learned 2026-11-05)_',
        ''
      ].join('\n')
    )
  })

  it('says when nothing is known', () => {
    const empty: MemoryView = { revision: 0, groups: [], sleep: { when: 'asked', quietMinutes: 10, time: '03:00' }, retentionDays: null }
    expect(memoryMarkdown(empty, { title: 'Memory', now })).toBe('# Memory\n\nExported on 2026-11-17.\n\nNothing is known yet.\n')
  })
})
