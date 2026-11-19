import { describe, expect, it } from 'vitest'
import { contextOf, EARLIER_FILES, type EarlierFact, type EarlierLine, historyOf, notesOf } from './earlier.ts'

describe("the proof of concept's files", () => {
  const notes: { name: string; text: string; facts: EarlierFact[] }[] = [
    {
      name: 'each item of the notes is a fact',
      text: '- Rodolphe lives in Paris.\n- Prefers green tea.\r\n\nSome text that is not an item\n* Sister Ana visits on 2026-03-20.\n•   Works on Echo  ',
      facts: [
        { text: 'Rodolphe lives in Paris.', kind: 'other' },
        { text: 'Prefers green tea.', kind: 'other' },
        { text: 'Sister Ana visits on 2026-03-20.', kind: 'other' },
        { text: 'Works on Echo', kind: 'other' }
      ]
    },
    { name: 'nothing to keep', text: 'NONE\n', facts: [] }
  ]
  for (const { name, text, facts } of notes) it(name, () => expect(notesOf(text)).toEqual(facts))

  const contexts: { name: string; text: string; facts: EarlierFact[] }[] = [
    {
      name: 'the template as it came, filled in nowhere, gives nothing',
      text: [
        '# Context',
        '',
        'This file is what the assistant knows about you. Edit it freely; it is read at the start of every conversation.',
        '',
        '## Who I am',
        '- Name: (your name, and how to address you)',
        '- Role: (what you do)',
        '',
        '## What I do',
        '- (your business or work, in two or three lines)',
        '',
        '## Files',
        'Any file you drop into this folder can be read. Nothing outside it can.'
      ].join('\n'),
      facts: []
    },
    {
      name: 'what the person wrote, of the kind its section says',
      text: [
        '## Who I am',
        '- Name: Rodolphe, call me Sir',
        '- Languages: French and English',
        '## What I do',
        '- Builds a voice assistant',
        '## How I work',
        '- Short answers, no small talk',
        '## Habits',
        '- Runs on Sundays'
      ].join('\n'),
      facts: [
        { text: 'Name: Rodolphe, call me Sir', kind: 'person' },
        { text: 'Languages: French and English', kind: 'person' },
        { text: 'Builds a voice assistant', kind: 'project' },
        { text: 'Short answers, no small talk', kind: 'preference' },
        { text: 'Runs on Sundays', kind: 'other' }
      ]
    }
  ]
  for (const { name, text, facts } of contexts) it(name, () => expect(contextOf(text)).toEqual(facts))

  const days: { name: string; text: string; lines: EarlierLine[] }[] = [
    {
      name: 'each line of a day, dated when it was said',
      text: [
        JSON.stringify({ t: '2026-03-01T09:15:00.000Z', user: 'What is the weather?', reply: 'Sunny.', tools: [] }),
        JSON.stringify({ t: '2026-03-01T09:16:00Z', user: '', reply: 'Good morning, Sir.', tools: [], screen: 'briefing' }),
        ''
      ].join('\n'),
      lines: [
        { at: '2026-03-01T09:15:00.000Z', said: 'What is the weather?', replied: 'Sunny.' },
        { at: '2026-03-01T09:16:00.000Z', said: '', replied: 'Good morning, Sir.' }
      ]
    },
    {
      name: 'a line cut short, with no date, or with no words is left out',
      text: [
        '{"t":"2026-03-01T09:15:00Z","user":"cut',
        '{"user":"no date","reply":"x"}',
        '{"t":"not a date","user":"a","reply":"b"}',
        '{"t":"2026-03-01T09:15:00Z","user":" ","reply":""}'
      ].join('\n'),
      lines: []
    }
  ]
  for (const { name, text, lines } of days) it(name, () => expect(historyOf(text)).toEqual(lines))

  it('finds its files in its folder, with the separator the system writes', () => {
    expect(EARLIER_FILES.notes('/Users/ada/Proof')).toBe('/Users/ada/Proof/workspace/memory.md')
    expect(EARLIER_FILES.context('C:\\Users\\ada\\Proof')).toBe('C:\\Users\\ada\\Proof\\workspace\\CLAUDE.md')
    expect(EARLIER_FILES.history('/Users/ada/Proof/')).toBe('/Users/ada/Proof/history')
  })
})
