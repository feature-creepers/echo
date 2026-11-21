import { describe, expect, it } from 'vitest'
import { type CaptionFacts, type CaptionLine, captionOf } from './caption.ts'

const asked = { request: true, heard: false, replied: false }
const spoken = { request: true, heard: true, replied: true }

describe('the line under the eye', () => {
  const cases: [string, CaptionFacts, CaptionLine][] = [
    ['shows the sentence heard now, whatever else is going on', { hearing: true, busy: true, last: spoken, problem: true }, 'sentence'],
    ['reminds what was asked while the assistant works and has said nothing', { hearing: false, busy: true, last: asked, problem: false }, 'asked'],
    ['still reminds it while the first sentence is being voiced', { hearing: false, busy: true, last: { ...asked, replied: true }, problem: false }, 'asked'],
    [
      'shows nothing for a greeting, a reminder or a result the assistant started itself',
      { hearing: false, busy: true, last: { ...asked, request: false }, problem: false },
      'nothing'
    ],
    ['stays on the last sentence between sentences', { hearing: false, busy: true, last: spoken, problem: false }, 'heard'],
    ['stays on the last sentence while the turn goes on after the voice is done', { hearing: false, busy: true, last: spoken, problem: false }, 'heard'],
    ['stays on the last sentence once the turn is over', { hearing: false, busy: false, last: spoken, problem: false }, 'heard'],
    ['shows a problem over what was said', { hearing: false, busy: false, last: spoken, problem: true }, 'problem'],
    ['shows the reply when none of it was heard here', { hearing: false, busy: false, last: { ...spoken, heard: false }, problem: false }, 'replied'],
    ['shows nothing before anything was said', { hearing: false, busy: false, last: undefined, problem: false }, 'nothing'],
    ['shows nothing after a turn that said nothing', { hearing: false, busy: false, last: asked, problem: false }, 'nothing']
  ]
  it.each(cases)('%s', (_name, facts, line) => {
    expect(captionOf(facts)).toBe(line)
  })

  it('never brings back what was asked once a sentence was heard', () => {
    for (const busy of [true, false])
      for (const problem of [true, false])
        for (const replied of [true, false]) {
          expect(captionOf({ hearing: false, busy, last: { request: true, heard: true, replied }, problem })).not.toBe('asked')
        }
  })
})
