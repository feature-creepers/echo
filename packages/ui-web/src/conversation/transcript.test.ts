import { describe, expect, it } from 'vitest'
import { answerLine } from './transcript.tsx'

describe('the answer of a turn, on its line', () => {
  it.each([
    ['what it said, on one line', { replied: 'Built your CI widget.\n  It runs.' }, 'Built your CI widget. It runs.'],
    ['what it said, before the title of what it wrote', { replied: 'Done.', written: '# The report' }, 'Done.'],
    [
      'the title of what it wrote, without its marks, when it said nothing',
      { replied: '  ', written: 'Intro\n\n## Briefing — **Saturday**' },
      'Briefing — Saturday'
    ],
    ['nothing when it said and wrote nothing', { replied: '' }, undefined],
    ['nothing when what it wrote has no title', { replied: '', written: 'Just text.' }, undefined]
  ])('is %s', (_case, exchange, line) => {
    expect(answerLine(exchange)).toBe(line)
  })
})
