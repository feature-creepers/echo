import type { Exchange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { lastRequest, resumesInARow, wakeRequest } from './resume.ts'

let turn = 0
const line = (thread: string, trigger: Exchange['trigger'], said = '', outcome: Exchange['outcome'] = 'done'): Exchange => ({
  turn: `t${++turn}`,
  at: '2026-11-20T08:00:00.000Z',
  persona: 'p1',
  thread,
  said,
  replied: '',
  outcome,
  ...(trigger === undefined ? {} : { trigger })
})

describe('resumesInARow', () => {
  it.each<[string, Exchange[], number]>([
    ['nothing yet', [], 0],
    ['the person spoke last', [line('a', 'resume'), line('a', undefined, 'Fix the test.')], 0],
    ['woken twice since the person spoke', [line('a', undefined, 'Build it.'), line('a', 'resume'), line('a', 'resume')], 2],
    ['other threads do not count', [line('a', undefined, 'Build it.'), line('b', 'resume'), line('a', 'resume')], 1],
    [
      'a turn the next restart cut short still counts',
      [line('a', undefined, 'Build it.'), line('a', 'resume', 'Check it.', 'stopped'), line('a', 'resume')],
      2
    ],
    ['a task it scheduled is not the person speaking', [line('a', undefined, 'Build it.'), line('a', 'resume'), line('a', 'task'), line('a', 'resume')], 2]
  ])('%s', (_, transcript, count) => {
    expect(resumesInARow(transcript, 'a')).toBe(count)
  })
})

describe('lastRequest', () => {
  it.each<[string, Exchange[], string | undefined]>([
    ['none', [line('a', 'resume', 'Go on.')], undefined],
    [
      'the latest in their words',
      [line('a', undefined, 'Fix the test.'), line('a', undefined, 'And commit it.'), line('a', 'resume', 'Go on.')],
      'And commit it.'
    ],
    ['only this thread', [line('a', undefined, 'Fix the test.'), line('b', undefined, 'Play FIP.')], 'Fix the test.']
  ])('%s', (_, transcript, said) => {
    expect(lastRequest(transcript, 'a')).toBe(said)
  })
})

describe('wakeRequest', () => {
  it.each([
    [
      'a planned note, held to what the person asked',
      { planned: 'Check the build.', asked: 'Make the handle wider.' },
      '(The app has opened again, as you planned before it restarted. Carry on only with what the person asked, and add nothing they did not ask for. When it is done, stop and report.)\n\nWhat the person asked, in their words: Make the handle wider.\n\nYour note for now: Check the build.'
    ],
    [
      'a request cut short, which is what the person asked',
      { cut: 'Make the handle wider.', asked: 'Make the handle wider.' },
      '(The app restarted while you were working on this: it was updated, or reopened. Your session is new. Check where the work stands, in the files and what you did above, then carry it on to the end without redoing what is done. Carry on only with what the person asked, and add nothing they did not ask for. When it is done, stop and report.)\n\nMake the handle wider.'
    ]
  ])('%s', (_, woken, request) => {
    expect(wakeRequest(woken)).toBe(request)
  })
})
